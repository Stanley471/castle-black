export type PieceColor = 'w' | 'b';

export type GameStatus =
  | 'waiting'
  | 'in_progress'
  | 'checkmate'
  | 'stalemate'
  | 'draw'
  | 'timeout'
  | 'resigned'
  | 'abandoned';

export type GameOverReason =
  | 'checkmate'
  | 'stalemate'
  | 'threefold_repetition'
  | 'insufficient_material'
  | 'fifty_moves'
  | 'timeout'
  | 'resignation'
  | 'abandoned';

export interface Player {
  socketId: string;
  color: PieceColor;
  address?: string;
  connected: boolean;
  deposited?: boolean;
}

export interface ClockState {
  white: number;
  black: number;
  lastMoveTimestamp: number | null;
  initialTimeMs: number;
  incrementMs: number;
}

export interface WagerConfig {
  enabled: boolean;
  amount: string;
  asset: string;
  contractId?: string;
  whiteAddress?: string;
  blackAddress?: string;
}

export interface RoomState {
  id: string;
  players: {
    w?: Player;
    b?: Player;
  };
  spectators: string[];
  fen: string;
  pgn: string;
  history: string[];
  turn: PieceColor;
  status: GameStatus;
  winner: PieceColor | 'draw' | null;
  gameOverReason?: GameOverReason;
  clock: ClockState;
  wager: WagerConfig;
  createdAt: number;
  escrowTxHash?: string;
}

export interface CreateRoomPayload {
  timeControlMs?: number;
  incrementMs?: number;
  wager?: {
    enabled: boolean;
    amount: string;
    playerAddress?: string;
    contractId?: string;
  };
}

export interface JoinRoomPayload {
  roomId: string;
  playerAddress?: string;
}

export interface MakeMovePayload {
  roomId: string;
  from: string;
  to: string;
  promotion?: string;
}

export interface ResignPayload {
  roomId: string;
}

export interface RoomCreatedPayload {
  roomId: string;
  color: PieceColor;
  wager: WagerConfig;
}

export interface GameStartedPayload {
  roomId: string;
  fen: string;
  whiteSocketId: string;
  blackSocketId: string;
  whiteAddress?: string;
  blackAddress?: string;
  clock: ClockState;
  turn: PieceColor;
  wager: WagerConfig;
}

export interface MoveAppliedPayload {
  move: {
    from: string;
    to: string;
    promotion?: string;
    san: string;
  };
  fen: string;
  turn: PieceColor;
  clock: ClockState;
  inCheck: boolean;
}

export interface MoveRejectedPayload {
  reason: string;
  expectedTurn?: PieceColor;
}

export interface GameOverPayload {
  roomId: string;
  winner: PieceColor | 'draw' | null;
  reason: GameOverReason;
  fen: string;
  escrowTxHash?: string;
}

export interface ClockTickPayload {
  roomId: string;
  white: number;
  black: number;
  turn: PieceColor;
}

export interface OpponentDisconnectedPayload {
  color: PieceColor;
  gracePeriodSeconds: number;
}
