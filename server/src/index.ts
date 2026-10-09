import express, { Request, Response } from 'express';
import http from 'http';
import { Server, Socket } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import { RoomManager, GameRoom } from './rooms';
import { arbiter } from './arbiter';
import {
  CreateRoomPayload,
  JoinRoomPayload,
  MakeMovePayload,
  ResignPayload,
  GameOverPayload,
  ClockTickPayload,
  PieceColor
} from './types';

dotenv.config();

const PORT = parseInt(process.env.PORT || '4000', 10);
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:3000';

const app = express();
app.use(cors({ origin: CLIENT_ORIGIN, credentials: true }));
app.use(express.json());

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: CLIENT_ORIGIN,
    methods: ['GET', 'POST'],
    credentials: true
  }
});

const roomManager = new RoomManager();

/**
 * Handles blockchain escrow resolution if wager is enabled
 */
async function processEscrowResolution(room: GameRoom, payload: GameOverPayload): Promise<void> {
  if (!room.wager.enabled) return;

  const isDraw = payload.winner === 'draw';
  let winnerAddress: string | null = null;

  if (payload.winner === 'w') {
    winnerAddress = room.wager.whiteAddress || room.players.w?.address || null;
  } else if (payload.winner === 'b') {
    winnerAddress = room.wager.blackAddress || room.players.b?.address || null;
  }

  try {
    const res = await arbiter.resolveEscrowMatch({
      roomId: room.id,
      winnerAddress,
      isDraw,
      contractId: room.wager.contractId
    });

    if (res.txHash) {
      payload.escrowTxHash = res.txHash;
      room.escrowTxHash = res.txHash;
    }
  } catch (err) {
    console.error(`[Escrow] Failed to resolve payout for room ${room.id}:`, err);
  }
}

// Register RoomManager callbacks for background events (clock tick, timeout flag fall)
roomManager.setCallbacks(
  (tick: ClockTickPayload) => {
    io.to(tick.roomId).emit('clock_tick', tick);
  },
  async (payload: GameOverPayload) => {
    const room = roomManager.getRoom(payload.roomId);
    if (room) {
      await processEscrowResolution(room, payload);
    }
    io.to(payload.roomId).emit('game_over', payload);
  }
);

// REST API Endpoints
app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'castle-black-arbiter',
    activeRooms: roomManager.getActiveRoomCount(),
    arbiterPublicKey: arbiter.getPublicKey(),
    arbiterLive: arbiter.isLive(),
    timestamp: new Date().toISOString()
  });
});

app.get('/rooms/:roomId', (req: Request, res: Response) => {
  const param = req.params['roomId'];
  const roomId = Array.isArray(param) ? param[0] : param;
  if (!roomId || typeof roomId !== 'string') {
    res.status(400).json({ error: 'Room ID required' });
    return;
  }
  const room = roomManager.getRoom(roomId);
  if (!room) {
    res.status(404).json({ error: 'Room not found' });
    return;
  }
  res.json(room.toState());
});

// Real-Time Socket.io Handlers
io.on('connection', (socket: Socket) => {
  console.log(`[Socket] Connected: ${socket.id}`);

  // Create Room
  socket.on('create_room', (payload: CreateRoomPayload = {}) => {
    try {
      const { room, color } = roomManager.createRoom(socket.id, payload);
      socket.join(room.id);

      console.log(`[Room] Created ${room.id} by ${socket.id} (${color.toUpperCase()}) | Wager: ${room.wager.enabled ? room.wager.amount + ' XLM' : 'None'}`);

      socket.emit('room_created', {
        roomId: room.id,
        color,
        wager: room.wager
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create room';
      socket.emit('error_message', { message });
    }
  });

  // Join Room
  socket.on('join_room', (payload: JoinRoomPayload) => {
    try {
      const { roomId, playerAddress } = payload || {};
      if (!roomId) {
        socket.emit('error_message', { message: 'Room code is required' });
        return;
      }

      const result = roomManager.joinRoom(roomId, socket.id, playerAddress);
      if (!result.success || !result.room) {
        socket.emit('error_message', { message: result.error || 'Failed to join room' });
        return;
      }

      const room = result.room;
      socket.join(room.id);
      console.log(`[Room] ${socket.id} joined room ${room.id} as ${result.color ? result.color.toUpperCase() : 'SPECTATOR'}`);

      if (result.gameReady) {
        if (room.status === 'waiting') {
          if (room.wager.enabled) {
            room.status = 'depositing';
            io.to(room.id).emit('room_joined', {
              roomId: room.id,
              color: result.color,
              isSpectator: !result.color,
              roomState: room.toState()
            });
            // Re-emit room_joined for the other player so they know we transitioned to depositing
            socket.to(room.id).emit('room_joined', {
              roomId: room.id,
              color: result.color === 'w' ? 'b' : 'w',
              isSpectator: false,
              roomState: room.toState()
            });
          } else {
            // Both players are present; start authoritative game and clock
            const startPayload = room.startGame();
            console.log(`[Game] Started in room ${room.id}! White: ${room.players.w?.socketId} vs Black: ${room.players.b?.socketId}`);
            io.to(room.id).emit('game_started', startPayload);
          }
        } else {
          // Game already started, emit current state so they can resync
          socket.emit('room_joined', {
            roomId: room.id,
            color: result.color,
            isSpectator: !result.color,
            roomState: room.toState()
          });
        }
      } else {
        socket.emit('room_joined', {
          roomId: room.id,
          color: result.color,
          isSpectator: !result.color,
          roomState: room.toState()
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error joining room';
      socket.emit('error_message', { message });
    }
  });

  // Deposit Wager
  socket.on('deposit_wager', async (payload: { roomId: string; txHash: string }) => {
    try {
      const { roomId, txHash } = payload || {};
      const room = roomManager.getRoom(roomId);
      
      if (!room || room.status !== 'depositing') {
        socket.emit('error_message', { message: 'Room not found or not in depositing state' });
        return;
      }

      const player = room.getPlayerBySocket(socket.id);
      if (!player) return;

      player.deposited = true;
      console.log(`[Escrow] Player ${player.color.toUpperCase()} deposited for room ${room.id} (tx: ${txHash})`);
      
      io.to(room.id).emit('player_deposited', { roomId: room.id, color: player.color });

      if (room.players.w?.deposited && room.players.b?.deposited) {
        console.log(`[Escrow] Both players deposited for room ${room.id}. Starting game.`);
        const startPayload = room.startGame();
        io.to(room.id).emit('game_started', startPayload);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error depositing wager';
      socket.emit('error_message', { message });
    }
  });

  // Make Move (Authoritative)
  socket.on('make_move', async (payload: MakeMovePayload) => {
    try {
      const { roomId, from, to, promotion } = payload || {};
      const room = roomManager.getRoom(roomId);

      if (!room) {
        socket.emit('move_rejected', { reason: 'Room not found' });
        return;
      }

      const result = room.makeMove(socket.id, from, to, promotion);

      if (!result.success || !result.applied) {
        socket.emit('move_rejected', {
          reason: result.error || 'Move rejected',
          expectedTurn: room.chess.turn() as PieceColor
        });
        return;
      }

      // Broadcast verified move to everyone in the room
      io.to(room.id).emit('move_applied', result.applied);

      // If this move concluded the game (checkmate, stalemate, draw)
      if (result.gameOver) {
        console.log(`[Game] Concluded in room ${room.id}: Winner = ${result.gameOver.winner} (${result.gameOver.reason})`);
        // `room.applyMove()` already calls `onGameOverCallback` which handles escrow and emit.
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error applying move';
      socket.emit('move_rejected', { reason: message });
    }
  });

  // Resign
  socket.on('resign', async (payload: ResignPayload) => {
    try {
      const { roomId } = payload || {};
      const room = roomManager.getRoom(roomId);
      if (!room) return;

      const gameOverPayload = room.resign(socket.id);
      if (gameOverPayload) {
        console.log(`[Game] Resignation in room ${room.id} by ${socket.id}`);
        // `room.resign()` already calls `onGameOverCallback` which handles escrow and emit,
        // so we don't need to do it again here.
      }
    } catch (err) {
      console.error('[Resign] Error processing resignation:', err);
    }
  });

  // Offer Draw
  socket.on('offer_draw', (payload: { roomId: string }) => {
    const { roomId } = payload || {};
    const room = roomManager.getRoom(roomId);
    if (!room || room.status !== 'in_progress') return;

    const player = room.getPlayerBySocket(socket.id);
    if (!player) return;

    room.drawOffer = player.color;
    socket.to(roomId).emit('draw_offered');
  });

  // Accept Draw
  socket.on('accept_draw', (payload: { roomId: string }) => {
    const { roomId } = payload || {};
    const room = roomManager.getRoom(roomId);
    if (!room || room.status !== 'in_progress') return;

    const player = room.getPlayerBySocket(socket.id);
    if (!player) return;

    // Only the player who didn't offer can accept
    if (room.drawOffer && room.drawOffer !== player.color) {
      const gameOverPayload = room.acceptDraw();
      if (gameOverPayload) {
        console.log(`[Game] Draw agreed in room ${room.id}`);
        // `acceptDraw()` calls `onGameOverCallback` which handles escrow and emit
      }
    }
  });

  // Decline Draw
  socket.on('decline_draw', (payload: { roomId: string }) => {
    const { roomId } = payload || {};
    const room = roomManager.getRoom(roomId);
    if (!room || room.status !== 'in_progress') return;

    const player = room.getPlayerBySocket(socket.id);
    if (!player) return;

    room.drawOffer = null;
    socket.to(roomId).emit('draw_declined');
  });

  // Cancel Match
  socket.on('cancel_match', (payload: { roomId: string }) => {
    const { roomId } = payload || {};
    const room = roomManager.getRoom(roomId);
    if (!room || room.status !== 'waiting') return;

    // Must be a player in the room
    if (room.players.w?.socketId !== socket.id && room.players.b?.socketId !== socket.id) return;

    console.log(`[Room] ${roomId} explicitly cancelled by ${socket.id}`);
    
    // Process refund
    if (room.wager.enabled) {
      const gameOverPayload: GameOverPayload = {
        roomId: room.id,
        winner: null,
        reason: 'abandoned',
        fen: room.chess.fen()
      };
      processEscrowResolution(room, gameOverPayload)
        .then(() => console.log(`[Escrow] Successfully refunded cancelled room ${roomId}`))
        .catch(err => console.error(`[Escrow] Failed to refund cancelled room ${roomId}:`, err));
    }

    roomManager.deleteRoom(roomId);
  });

  // Request Rematch
  socket.on('request_rematch', (payload: { roomId: string }) => {
    const { roomId } = payload || {};
    const room = roomManager.getRoom(roomId);
    if (!room || room.status === 'waiting') return;

    const player = room.getPlayerBySocket(socket.id);
    if (!player) return;

    room.rematchRequests[player.color] = true;

    // Check if both have requested
    if (room.rematchRequests.w && room.rematchRequests.b) {
      // Both requested, auto-accept. Swap colors by making previous black the creator.
      const newRoom = roomManager.createRoom(room.players.b!.socketId, room.initialOptions);
      newRoom.room.addPlayer(room.players.w!.socketId, room.players.w!.address);
      
      io.to(roomId).emit('rematch_accepted', { newRoomId: newRoom.room.id });
    } else {
      // Notify the opponent
      socket.to(roomId).emit('rematch_requested');
    }
  });

  // Accept Rematch
  socket.on('accept_rematch', (payload: { roomId: string }) => {
    const { roomId } = payload || {};
    const room = roomManager.getRoom(roomId);
    if (!room || room.status === 'waiting') return;

    const player = room.getPlayerBySocket(socket.id);
    if (!player) return;

    room.rematchRequests[player.color] = true;

    if (room.rematchRequests.w && room.rematchRequests.b) {
      // Both requested, auto-accept. Swap colors by making previous black the creator.
      const newRoom = roomManager.createRoom(room.players.b!.socketId, room.initialOptions);
      newRoom.room.addPlayer(room.players.w!.socketId, room.players.w!.address);
      io.to(roomId).emit('rematch_accepted', { newRoomId: newRoom.room.id });
    }
  });

  // Decline Rematch
  socket.on('decline_rematch', (payload: { roomId: string }) => {
    const { roomId } = payload || {};
    const room = roomManager.getRoom(roomId);
    if (!room) return;
    
    const player = room.getPlayerBySocket(socket.id);
    if (!player) return;
    
    room.rematchRequests.w = false;
    room.rematchRequests.b = false;
    socket.to(roomId).emit('rematch_declined');
  });

  // Disconnect Cleanup
  socket.on('disconnect', () => {
    console.log(`[Socket] Disconnected: ${socket.id}`);
    const { roomId, color, deleted, room } = roomManager.handleDisconnect(socket.id);

    if (deleted && roomId && room) {
      console.log(`[Room] ${roomId} abandoned while waiting; cleaned up.`);
      
      // Cancel the escrow so the waiting player gets refunded
      if (room.wager.enabled) {
        const payload: GameOverPayload = {
          roomId: room.id,
          winner: null,
          reason: 'abandoned',
          fen: room.chess.fen()
        };
        processEscrowResolution(room, payload)
          .then(() => console.log(`[Escrow] Successfully refunded abandoned room ${roomId}`))
          .catch(err => console.error(`[Escrow] Failed to refund abandoned room ${roomId}:`, err));
      }
    } else if (roomId && color) {
      console.log(`[Room] Player ${color.toUpperCase()} disconnected from room ${roomId}`);
      io.to(roomId).emit('opponent_disconnected', {
        color,
        gracePeriodSeconds: 60
      });
    }
  });
});

server.listen(PORT, () => {
  console.log(`=========================================`);
  console.log(`🏰 CASTLE BLACK CHESS SERVER & ARBITER 🏰`);
  console.log(`=========================================`);
  console.log(`Server listening on port: ${PORT}`);
  console.log(`Client Origin: ${CLIENT_ORIGIN}`);
  console.log(`Arbiter Public Key: ${arbiter.getPublicKey()}`);
  console.log(`Arbiter Live Mode: ${arbiter.isLive()}`);
  console.log(`=========================================`);
});
