import { Chess } from 'chess.js';
import {
  ClockState,
  ClockTickPayload,
  CreateRoomPayload,
  GameOverPayload,
  GameOverReason,
  GameStartedPayload,
  GameStatus,
  MoveAppliedPayload,
  PieceColor,
  Player,
  RoomState,
  WagerConfig
} from './types';

const ROOM_CODE_CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const DEFAULT_TIME_CONTROL_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_INCREMENT_MS = 0;
const CLOCK_TICK_INTERVAL_MS = 500; // sync 2x per second

export interface MoveResult {
  success: boolean;
  error?: string;
  applied?: MoveAppliedPayload;
  gameOver?: GameOverPayload;
}

export class GameRoom {
  public readonly id: string;
  public readonly chess: Chess;
  public players: { w?: Player; b?: Player } = {};
  public spectators: Set<string> = new Set();
  public clock: ClockState;
  public wager: WagerConfig;
  public status: GameStatus = 'waiting';
  public winner: PieceColor | 'draw' | null = null;
  public gameOverReason?: GameOverReason;
  public readonly createdAt: number = Date.now();
  public escrowTxHash?: string;

  private timerInterval: NodeJS.Timeout | null = null;
  private onClockTickCallback?: (tick: ClockTickPayload) => void;
  private onGameOverCallback?: (payload: GameOverPayload) => void;

  constructor(
    id: string,
    options?: CreateRoomPayload,
    onClockTick?: (tick: ClockTickPayload) => void,
    onGameOver?: (payload: GameOverPayload) => void
  ) {
    this.id = id;
    this.chess = new Chess();
    this.onClockTickCallback = onClockTick;
    this.onGameOverCallback = onGameOver;

    const initialTime = options?.timeControlMs ?? DEFAULT_TIME_CONTROL_MS;
    const increment = options?.incrementMs ?? DEFAULT_INCREMENT_MS;

    this.clock = {
      white: initialTime,
      black: initialTime,
      lastMoveTimestamp: null,
      initialTimeMs: initialTime,
      incrementMs: increment
    };

    this.wager = {
      enabled: options?.wager?.enabled ?? false,
      amount: options?.wager?.amount ?? '0',
      asset: 'XLM',
      contractId: options?.wager?.contractId,
      whiteAddress: options?.wager?.playerAddress
    };
  }

  public toState(): RoomState {
    return {
      id: this.id,
      players: { ...this.players },
      spectators: Array.from(this.spectators),
      fen: this.chess.fen(),
      pgn: this.chess.pgn(),
      history: this.chess.history(),
      turn: this.chess.turn() as PieceColor,
      status: this.status,
      winner: this.winner,
      gameOverReason: this.gameOverReason,
      clock: { ...this.clock },
      wager: { ...this.wager },
      createdAt: this.createdAt,
      escrowTxHash: this.escrowTxHash
    };
  }

  public addPlayer(
    socketId: string,
    playerAddress?: string
  ): { color: PieceColor; gameReady: boolean } {
    if (!this.players.w) {
      this.players.w = {
        socketId,
        color: 'w',
        address: playerAddress,
        connected: true
      };
      if (playerAddress && !this.wager.whiteAddress) {
        this.wager.whiteAddress = playerAddress;
      }
      return { color: 'w', gameReady: false };
    }

    if (!this.players.b) {
      this.players.b = {
        socketId,
        color: 'b',
        address: playerAddress,
        connected: true
      };
      if (playerAddress) {
        this.wager.blackAddress = playerAddress;
      }
      return { color: 'b', gameReady: true };
    }

    // Both player slots are occupied; join as spectator
    this.spectators.add(socketId);
    return { color: 'w', gameReady: false };
  }

  public startGame(): GameStartedPayload {
    this.status = 'in_progress';
    this.clock.lastMoveTimestamp = Date.now();
    this.startClockTicker();

    return {
      roomId: this.id,
      fen: this.chess.fen(),
      whiteSocketId: this.players.w!.socketId,
      blackSocketId: this.players.b!.socketId,
      whiteAddress: this.players.w?.address,
      blackAddress: this.players.b?.address,
      clock: { ...this.clock },
      turn: this.chess.turn() as PieceColor,
      wager: { ...this.wager }
    };
  }

  public getPlayerBySocket(socketId: string): Player | null {
    if (this.players.w?.socketId === socketId) return this.players.w;
    if (this.players.b?.socketId === socketId) return this.players.b;
    return null;
  }

  public makeMove(
    socketId: string,
    from: string,
    to: string,
    promotion?: string
  ): MoveResult {
    if (this.status !== 'in_progress') {
      return { success: false, error: 'Game is not in progress' };
    }

    const player = this.getPlayerBySocket(socketId);
    if (!player) {
      return { success: false, error: 'Player not recognized in this room' };
    }

    const currentTurn = this.chess.turn() as PieceColor;
    if (player.color !== currentTurn) {
      return { success: false, error: `It is not your turn (${currentTurn.toUpperCase()} to move)` };
    }

    const now = Date.now();
    const elapsed = this.clock.lastMoveTimestamp ? now - this.clock.lastMoveTimestamp : 0;

    // Deduct elapsed time from active player
    if (currentTurn === 'w') {
      this.clock.white = Math.max(0, this.clock.white - elapsed);
      if (this.clock.white === 0) {
        return this.handleFlagFall('w');
      }
      this.clock.white += this.clock.incrementMs;
    } else {
      this.clock.black = Math.max(0, this.clock.black - elapsed);
      if (this.clock.black === 0) {
        return this.handleFlagFall('b');
      }
      this.clock.black += this.clock.incrementMs;
    }

    // Authoritative move validation via chess.js
    let moveObj;
    try {
      moveObj = this.chess.move({
        from,
        to,
        promotion: promotion ? (promotion.toLowerCase() as 'q' | 'r' | 'b' | 'n') : 'q'
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Illegal chess move';
      return { success: false, error: message };
    }

    if (!moveObj) {
      return { success: false, error: 'Illegal chess move' };
    }

    // Switch turn timestamp
    this.clock.lastMoveTimestamp = now;

    // Check game termination states
    let gameOverPayload: GameOverPayload | undefined;

    if (this.chess.isGameOver()) {
      this.stopClockTicker();

      if (this.chess.isCheckmate()) {
        this.status = 'checkmate';
        this.winner = player.color; // The player who just moved delivered checkmate
        this.gameOverReason = 'checkmate';
      } else if (this.chess.isStalemate()) {
        this.status = 'stalemate';
        this.winner = 'draw';
        this.gameOverReason = 'stalemate';
      } else if (this.chess.isThreefoldRepetition()) {
        this.status = 'draw';
        this.winner = 'draw';
        this.gameOverReason = 'threefold_repetition';
      } else if (this.chess.isInsufficientMaterial()) {
        this.status = 'draw';
        this.winner = 'draw';
        this.gameOverReason = 'insufficient_material';
      } else {
        this.status = 'draw';
        this.winner = 'draw';
        this.gameOverReason = 'fifty_moves';
      }

      gameOverPayload = {
        roomId: this.id,
        winner: this.winner,
        reason: this.gameOverReason,
        fen: this.chess.fen()
      };

      if (this.onGameOverCallback) {
        this.onGameOverCallback(gameOverPayload);
      }
    }

    const applied: MoveAppliedPayload = {
      move: {
        from: moveObj.from,
        to: moveObj.to,
        promotion: moveObj.promotion,
        san: moveObj.san
      },
      fen: this.chess.fen(),
      turn: this.chess.turn() as PieceColor,
      clock: { ...this.clock },
      inCheck: this.chess.inCheck()
    };

    return {
      success: true,
      applied,
      gameOver: gameOverPayload
    };
  }

  public resign(socketId: string): GameOverPayload | null {
    if (this.status !== 'in_progress') return null;

    const player = this.getPlayerBySocket(socketId);
    if (!player) return null;

    this.stopClockTicker();
    this.status = 'resigned';
    this.winner = player.color === 'w' ? 'b' : 'w';
    this.gameOverReason = 'resignation';

    const payload: GameOverPayload = {
      roomId: this.id,
      winner: this.winner,
      reason: 'resignation',
      fen: this.chess.fen()
    };

    if (this.onGameOverCallback) {
      this.onGameOverCallback(payload);
    }

    return payload;
  }

  public handleDisconnect(socketId: string): { removeRoom: boolean; color?: PieceColor } {
    if (this.players.w?.socketId === socketId) {
      this.players.w.connected = false;
      if (this.status === 'waiting') {
        this.stopClockTicker();
        return { removeRoom: true, color: 'w' };
      }
      return { removeRoom: false, color: 'w' };
    }

    if (this.players.b?.socketId === socketId) {
      this.players.b.connected = false;
      if (this.status === 'waiting') {
        this.stopClockTicker();
        return { removeRoom: true, color: 'b' };
      }
      return { removeRoom: false, color: 'b' };
    }

    this.spectators.delete(socketId);
    return { removeRoom: false };
  }

  private startClockTicker(): void {
    if (this.timerInterval) clearInterval(this.timerInterval);

    this.timerInterval = setInterval(() => {
      if (this.status !== 'in_progress' || !this.clock.lastMoveTimestamp) {
        return;
      }

      const now = Date.now();
      const elapsed = now - this.clock.lastMoveTimestamp;
      const turn = this.chess.turn() as PieceColor;

      let whiteRemaining = this.clock.white;
      let blackRemaining = this.clock.black;

      if (turn === 'w') {
        whiteRemaining = Math.max(0, this.clock.white - elapsed);
        if (whiteRemaining === 0) {
          this.clock.white = 0;
          this.handleFlagFall('w');
          return;
        }
      } else {
        blackRemaining = Math.max(0, this.clock.black - elapsed);
        if (blackRemaining === 0) {
          this.clock.black = 0;
          this.handleFlagFall('b');
          return;
        }
      }

      if (this.onClockTickCallback) {
        this.onClockTickCallback({
          roomId: this.id,
          white: whiteRemaining,
          black: blackRemaining,
          turn
        });
      }
    }, CLOCK_TICK_INTERVAL_MS);
  }

  private handleFlagFall(flaggedColor: PieceColor): MoveResult {
    this.stopClockTicker();
    this.status = 'timeout';
    this.winner = flaggedColor === 'w' ? 'b' : 'w';
    this.gameOverReason = 'timeout';

    const gameOverPayload: GameOverPayload = {
      roomId: this.id,
      winner: this.winner,
      reason: 'timeout',
      fen: this.chess.fen()
    };

    if (this.onGameOverCallback) {
      this.onGameOverCallback(gameOverPayload);
    }

    return {
      success: true,
      gameOver: gameOverPayload
    };
  }

  public stopClockTicker(): void {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }
}

export class RoomManager {
  private rooms: Map<string, GameRoom> = new Map();
  private socketToRoom: Map<string, string> = new Map();

  private onClockTickCallback?: (tick: ClockTickPayload) => void;
  private onGameOverCallback?: (payload: GameOverPayload) => void;

  public setCallbacks(
    onClockTick: (tick: ClockTickPayload) => void,
    onGameOver: (payload: GameOverPayload) => void
  ): void {
    this.onClockTickCallback = onClockTick;
    this.onGameOverCallback = onGameOver;
  }

  public generateRoomCode(): string {
    let code = '';
    do {
      code = '';
      for (let i = 0; i < 6; i++) {
        const randomIndex = Math.floor(Math.random() * ROOM_CODE_CHARSET.length);
        code += ROOM_CODE_CHARSET[randomIndex];
      }
    } while (this.rooms.has(code));
    return code;
  }

  public createRoom(socketId: string, options?: CreateRoomPayload): { room: GameRoom; color: PieceColor } {
    const roomId = this.generateRoomCode();
    const room = new GameRoom(
      roomId,
      options,
      this.onClockTickCallback,
      this.onGameOverCallback
    );

    const { color } = room.addPlayer(socketId, options?.wager?.playerAddress);
    this.rooms.set(roomId, room);
    this.socketToRoom.set(socketId, roomId);

    return { room, color };
  }

  public joinRoom(
    roomId: string,
    socketId: string,
    playerAddress?: string
  ): { success: boolean; error?: string; room?: GameRoom; color?: PieceColor; gameReady?: boolean } {
    const cleanId = roomId.trim().toUpperCase();
    const room = this.rooms.get(cleanId);

    if (!room) {
      return { success: false, error: 'Room code not found' };
    }

    if (room.status !== 'waiting') {
      // Allow spectator join
      room.spectators.add(socketId);
      this.socketToRoom.set(socketId, cleanId);
      return { success: true, room, gameReady: false };
    }

    const { color, gameReady } = room.addPlayer(socketId, playerAddress);
    this.socketToRoom.set(socketId, cleanId);

    return { success: true, room, color, gameReady };
  }

  public getRoom(roomId: string): GameRoom | undefined {
    return this.rooms.get(roomId.trim().toUpperCase());
  }

  public getRoomBySocketId(socketId: string): GameRoom | undefined {
    const roomId = this.socketToRoom.get(socketId);
    if (!roomId) return undefined;
    return this.rooms.get(roomId);
  }

  public handleDisconnect(socketId: string): { roomId?: string; color?: PieceColor; deleted: boolean } {
    const roomId = this.socketToRoom.get(socketId);
    if (!roomId) return { deleted: false };

    this.socketToRoom.delete(socketId);
    const room = this.rooms.get(roomId);
    if (!room) return { roomId, deleted: false };

    const { removeRoom, color } = room.handleDisconnect(socketId);
    if (removeRoom) {
      room.stopClockTicker();
      this.rooms.delete(roomId);
      return { roomId, color, deleted: true };
    }

    return { roomId, color, deleted: false };
  }

  public deleteRoom(roomId: string): void {
    const cleanId = roomId.trim().toUpperCase();
    const room = this.rooms.get(cleanId);
    if (room) {
      room.stopClockTicker();
      if (room.players.w?.socketId) this.socketToRoom.delete(room.players.w.socketId);
      if (room.players.b?.socketId) this.socketToRoom.delete(room.players.b.socketId);
      for (const spectator of room.spectators) {
        this.socketToRoom.delete(spectator);
      }
      this.rooms.delete(cleanId);
    }
  }

  public getActiveRoomCount(): number {
    return this.rooms.size;
  }
}
