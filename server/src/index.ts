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
        // Both players are present; start authoritative game and clock
        const startPayload = room.startGame();
        console.log(`[Game] Started in room ${room.id}! White: ${room.players.w?.socketId} vs Black: ${room.players.b?.socketId}`);
        io.to(room.id).emit('game_started', startPayload);
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
        await processEscrowResolution(room, result.gameOver);
        io.to(room.id).emit('game_over', result.gameOver);
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
        await processEscrowResolution(room, gameOverPayload);
        io.to(room.id).emit('game_over', gameOverPayload);
      }
    } catch (err) {
      console.error('[Resign] Error processing resignation:', err);
    }
  });

  // Disconnect Cleanup
  socket.on('disconnect', () => {
    console.log(`[Socket] Disconnected: ${socket.id}`);
    const { roomId, color, deleted } = roomManager.handleDisconnect(socket.id);

    if (deleted && roomId) {
      console.log(`[Room] ${roomId} abandoned while waiting; cleaned up.`);
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
