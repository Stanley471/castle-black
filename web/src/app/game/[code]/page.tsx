'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Chessboard } from 'react-chessboard';
import {
  Crown,
  Clock,
  Coins,
  Copy,
  Check,
  Flag,
  ArrowLeft,
  RotateCcw,
  ExternalLink,
  ShieldAlert,
  Trophy,
  Loader2,
  AlertCircle
} from 'lucide-react';
import { connectSocket, getSocket } from '@/lib/socket';
import { truncateAddress } from '@/lib/stellar';
import {
  ClockState,
  ClockTickPayload,
  GameOverPayload,
  GameOverReason,
  GameStartedPayload,
  GameStatus,
  MoveAppliedPayload,
  PieceColor,
  RoomState,
  WagerConfig
} from '@/types';

const INITIAL_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export default function GameRoomPage() {
  const params = useParams();
  const router = useRouter();
  const rawCode = params?.code;
  const roomCode = (typeof rawCode === 'string' ? rawCode : Array.isArray(rawCode) ? rawCode[0] : '')?.toUpperCase();

  // Game & Board State
  const [fen, setFen] = useState<string>(INITIAL_FEN);
  const [myColor, setMyColor] = useState<PieceColor | null>(null);
  const [turn, setTurn] = useState<PieceColor>('w');
  const [gameStatus, setGameStatus] = useState<GameStatus>('waiting');
  const [inCheck, setInCheck] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [clocks, setClocks] = useState<{ white: number; black: number }>({
    white: 5 * 60 * 1000,
    black: 5 * 60 * 1000
  });
  const [wager, setWager] = useState<WagerConfig>({
    enabled: false,
    amount: '0',
    asset: 'XLM'
  });
  const [whitePlayer, setWhitePlayer] = useState<{ id: string; address?: string } | null>(null);
  const [blackPlayer, setBlackPlayer] = useState<{ id: string; address?: string } | null>(null);

  // UI State
  const [copiedLink, setCopiedLink] = useState(false);
  const [showResignModal, setShowResignModal] = useState(false);
  const [gameOverData, setGameOverData] = useState<GameOverPayload | null>(null);
  const [rejectedMessage, setRejectedMessage] = useState<string | null>(null);
  const [opponentDisconnected, setOpponentDisconnected] = useState<boolean>(false);

  const historyEndRef = useRef<HTMLDivElement>(null);

  // Scroll move history to bottom when new move arrives
  useEffect(() => {
    historyEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [history]);

  // Format millisecond clocks to MM:SS
  const formatTime = (ms: number): string => {
    if (ms <= 0) return '00:00';
    const totalSecs = Math.floor(ms / 1000);
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Connect and join room
  useEffect(() => {
    if (!roomCode) return;

    const socket = connectSocket();

    // Request to join room
    socket.emit('join_room', { roomId: roomCode });

    // Joined room (waiting for 2nd player or joined as spectator)
    socket.on(
      'room_joined',
      (data: { roomId: string; color?: PieceColor; isSpectator: boolean; roomState: RoomState }) => {
        if (data.color) setMyColor(data.color);
        if (data.roomState) {
          setFen(data.roomState.fen || INITIAL_FEN);
          setTurn(data.roomState.turn);
          setHistory(data.roomState.history || []);
          setClocks({
            white: data.roomState.clock.white,
            black: data.roomState.clock.black
          });
          setWager(data.roomState.wager);
          setGameStatus(data.roomState.status);
          if (data.roomState.players.w) {
            setWhitePlayer({
              id: data.roomState.players.w.socketId,
              address: data.roomState.players.w.address
            });
          }
          if (data.roomState.players.b) {
            setBlackPlayer({
              id: data.roomState.players.b.socketId,
              address: data.roomState.players.b.address
            });
          }
        }
      }
    );

    // Both players joined, match started
    socket.on('game_started', (payload: GameStartedPayload) => {
      setFen(payload.fen);
      setTurn(payload.turn);
      setGameStatus('in_progress');
      setClocks({
        white: payload.clock.white,
        black: payload.clock.black
      });
      setWager(payload.wager);
      setWhitePlayer({
        id: payload.whiteSocketId,
        address: payload.whiteAddress
      });
      setBlackPlayer({
        id: payload.blackSocketId,
        address: payload.blackAddress
      });

      // Determine local color assignment if not set
      if (socket.id === payload.whiteSocketId) {
        setMyColor('w');
      } else if (socket.id === payload.blackSocketId) {
        setMyColor('b');
      }
    });

    // Authoritative move applied from server
    socket.on('move_applied', (payload: MoveAppliedPayload) => {
      setFen(payload.fen);
      setTurn(payload.turn);
      setInCheck(payload.inCheck);
      setClocks({
        white: payload.clock.white,
        black: payload.clock.black
      });
      setHistory((prev) => [...prev, payload.move.san]);
      setRejectedMessage(null);
    });

    // Move rejected by server
    socket.on('move_rejected', (payload: { reason: string; expectedTurn?: PieceColor }) => {
      setRejectedMessage(payload.reason);
      // Force board refresh to authoritative FEN to snap illegal drop back
      setFen((current) => current + ' ');
      setTimeout(() => {
        setFen((current) => current.trim());
      }, 50);
      setTimeout(() => setRejectedMessage(null), 3000);
    });

    // Real-time clock tick from server
    socket.on('clock_tick', (payload: ClockTickPayload) => {
      setClocks({
        white: payload.white,
        black: payload.black
      });
    });

    // Game Over
    socket.on('game_over', (payload: GameOverPayload) => {
      setGameOverData(payload);
      setGameStatus(payload.reason as GameStatus);
      setFen(payload.fen);
    });

    // Opponent disconnected
    socket.on('opponent_disconnected', () => {
      setOpponentDisconnected(true);
    });

    // Error messages
    socket.on('error_message', (err: { message: string }) => {
      alert(err.message);
      router.push('/');
    });

    return () => {
      socket.off('room_joined');
      socket.off('game_started');
      socket.off('move_applied');
      socket.off('move_rejected');
      socket.off('clock_tick');
      socket.off('game_over');
      socket.off('opponent_disconnected');
      socket.off('error_message');
    };
  }, [roomCode, router]);

  // Handle piece drop - Emit to server, wait for authoritative confirmation
  const handlePieceDrop = useCallback(
    ({
      piece,
      sourceSquare,
      targetSquare
    }: {
      piece: { pieceType: string };
      sourceSquare: string;
      targetSquare: string | null;
    }): boolean => {
      if (!targetSquare) return false;
      if (gameStatus !== 'in_progress') return false;
      if (myColor !== turn) return false;

      // Auto queen promotion for 7th->8th rank moves
      let promotion: string | undefined;
      const isWhitePawn = piece.pieceType.toLowerCase() === 'wp' || piece.pieceType === 'p';
      const isBlackPawn = piece.pieceType.toLowerCase() === 'bp' || piece.pieceType === 'p';

      if (isWhitePawn && sourceSquare[1] === '7' && targetSquare[1] === '8') {
        promotion = 'q';
      } else if (isBlackPawn && sourceSquare[1] === '2' && targetSquare[1] === '1') {
        promotion = 'q';
      }

      // Authoritative socket emission
      const socket = getSocket();
      socket.emit('make_move', {
        roomId: roomCode,
        from: sourceSquare,
        to: targetSquare,
        promotion
      });

      return true;
    },
    [gameStatus, myColor, turn, roomCode]
  );

  // Copy shareable link
  const copyInviteLink = () => {
    const url = typeof window !== 'undefined' ? window.location.href : '';
    navigator.clipboard.writeText(url);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2500);
  };

  // Confirm resignation
  const handleResign = () => {
    const socket = getSocket();
    socket.emit('resign', { roomId: roomCode });
    setShowResignModal(false);
  };

  // Format move pairs for display
  const movePairs: { num: number; white: string; black?: string }[] = [];
  for (let i = 0; i < history.length; i += 2) {
    movePairs.push({
      num: Math.floor(i / 2) + 1,
      white: history[i]!,
      black: history[i + 1]
    });
  }

  const isMyTurn = gameStatus === 'in_progress' && myColor === turn;
  const boardOrientation = myColor === 'b' ? 'black' : 'white';

  // Opponent vs Player configuration based on orientation
  const opponentColor: PieceColor = myColor === 'b' ? 'w' : 'b';
  const opponentClock = opponentColor === 'w' ? clocks.white : clocks.black;
  const myClock = myColor === 'b' ? clocks.black : clocks.white;
  const opponentPlayer = opponentColor === 'w' ? whitePlayer : blackPlayer;
  const myPlayer = myColor === 'b' ? blackPlayer : whitePlayer;

  return (
    <div className="flex-1 flex flex-col min-h-screen bg-zinc-950 text-zinc-100">
      {/* Top Header */}
      <header className="border-b border-zinc-800 bg-zinc-900/50 backdrop-blur-md px-4 py-3 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-100 transition-colors"
              title="Return to Lobby"
            >
              <ArrowLeft className="w-4 h-4" />
            </Link>

            <div className="flex items-center gap-2">
              <span className="font-bold text-sm tracking-wider flex items-center gap-1">
                CASTLE <span className="text-amber-400">BLACK</span>
              </span>
              <span className="text-zinc-600">•</span>
              <div className="flex items-center gap-1.5 bg-zinc-900 border border-zinc-800 px-2.5 py-1 rounded-md text-xs font-mono">
                <span className="text-zinc-400">ROOM:</span>
                <span className="text-amber-400 font-bold tracking-widest">{roomCode}</span>
                <button
                  onClick={copyInviteLink}
                  className="ml-1 text-zinc-400 hover:text-zinc-200 cursor-pointer"
                  title="Copy Invite Link"
                >
                  {copiedLink ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
          </div>

          {/* Wager Indicator */}
          <div className="flex items-center gap-3">
            {wager.enabled && (
              <div className="flex items-center gap-1.5 bg-amber-500/10 border border-amber-500/30 text-amber-300 px-3 py-1 rounded-full text-xs font-mono font-semibold">
                <Coins className="w-3.5 h-3.5 text-amber-400" />
                <span>POT: {Number(wager.amount) * 2} XLM</span>
              </div>
            )}

            {myColor && (
              <div className="flex items-center gap-1.5 bg-zinc-900 border border-zinc-800 px-3 py-1 rounded-full text-xs font-medium">
                <span
                  className={`w-2.5 h-2.5 rounded-full ${
                    myColor === 'w' ? 'bg-zinc-100 border border-zinc-400' : 'bg-zinc-900 border border-zinc-500'
                  }`}
                />
                <span className="text-zinc-300">
                  You: {myColor === 'w' ? 'White' : 'Black'}
                </span>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8 flex flex-col lg:flex-row gap-8 items-center lg:items-start justify-center">
        {/* Left / Center: Chessboard Area */}
        <div className="w-full max-w-[560px] flex flex-col gap-3">
          {/* Rejection Notification Banner */}
          {rejectedMessage && (
            <div className="bg-rose-500/15 border border-rose-500/40 text-rose-300 text-xs px-3.5 py-2 rounded-lg flex items-center gap-2 animate-bounce">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{rejectedMessage}</span>
            </div>
          )}

          {/* Opponent Player Card (Top) */}
          <div
            className={`flex items-center justify-between bg-zinc-900/80 border rounded-xl px-4 py-2.5 transition-all ${
              turn === opponentColor && gameStatus === 'in_progress'
                ? 'border-amber-500/60 shadow-lg shadow-amber-500/10'
                : 'border-zinc-800'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <div
                className={`w-4 h-4 rounded-full ${
                  opponentColor === 'w' ? 'bg-zinc-100 border border-zinc-400' : 'bg-zinc-900 border border-zinc-500'
                }`}
              />
              <div>
                <div className="text-xs font-semibold text-zinc-200 flex items-center gap-1.5">
                  <span>Opponent ({opponentColor === 'w' ? 'White' : 'Black'})</span>
                  {turn === opponentColor && gameStatus === 'in_progress' && (
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping" />
                  )}
                </div>
                <div className="text-[11px] text-zinc-500 font-mono">
                  {opponentPlayer?.address ? truncateAddress(opponentPlayer.address) : opponentPlayer?.id || 'Waiting...'}
                </div>
              </div>
            </div>

            {/* Opponent Clock */}
            <div
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-mono font-bold text-sm border transition-colors ${
                opponentClock < 30000 && gameStatus === 'in_progress'
                  ? 'bg-rose-500/20 border-rose-500 text-rose-300 animate-pulse'
                  : turn === opponentColor && gameStatus === 'in_progress'
                  ? 'bg-amber-500/15 border-amber-500/50 text-amber-200'
                  : 'bg-zinc-950 border-zinc-800 text-zinc-400'
              }`}
            >
              <Clock className="w-3.5 h-3.5" />
              <span>{formatTime(opponentClock)}</span>
            </div>
          </div>

          {/* Interactive Chessboard Container */}
          <div className="relative aspect-square w-full rounded-2xl overflow-hidden shadow-2xl border border-zinc-800 bg-zinc-900 flex items-center justify-center">
            <Chessboard
              options={{
                position: fen,
                boardOrientation,
                onPieceDrop: handlePieceDrop,
                canDragPiece: ({ piece }) => {
                  if (gameStatus !== 'in_progress') return false;
                  if (myColor !== turn) return false;
                  const isWhite = piece.pieceType.toLowerCase().startsWith('w') || piece.pieceType === 'P';
                  if (myColor === 'w' && !isWhite) return false;
                  if (myColor === 'b' && isWhite) return false;
                  return true;
                },
                boardStyle: {
                  borderRadius: '12px',
                  boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)',
                },
                darkSquareStyle: { backgroundColor: '#27272a' }, // zinc-800
                lightSquareStyle: { backgroundColor: '#52525b' }, // zinc-600
                showNotation: true,
                animationDurationInMs: 200,
              }}
            />

            {/* Waiting for Opponent Overlay */}
            {gameStatus === 'waiting' && (
              <div className="absolute inset-0 bg-zinc-950/85 backdrop-blur-sm flex flex-col items-center justify-center p-6 text-center z-20">
                <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center mb-4">
                  <Loader2 className="w-7 h-7 text-amber-400 animate-spin" />
                </div>
                <h3 className="text-xl font-bold text-zinc-100 mb-1">Waiting for Opponent</h3>
                <p className="text-xs text-zinc-400 max-w-xs mb-5">
                  Share this 6-character room code or invite link with your opponent to begin.
                </p>

                <div className="bg-zinc-900 border border-zinc-800 px-6 py-3 rounded-xl mb-4">
                  <span className="font-mono text-2xl font-black tracking-[0.3em] text-amber-400 uppercase">
                    {roomCode}
                  </span>
                </div>

                <button
                  onClick={copyInviteLink}
                  className="flex items-center gap-2 bg-zinc-100 hover:bg-white text-zinc-950 font-semibold px-4 py-2 rounded-lg text-xs transition-all shadow-md active:scale-95 cursor-pointer"
                >
                  {copiedLink ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedLink ? 'Link Copied to Clipboard!' : 'Copy Invite Link'}</span>
                </button>
              </div>
            )}
          </div>

          {/* Player (Self) Card (Bottom) */}
          <div
            className={`flex items-center justify-between bg-zinc-900/80 border rounded-xl px-4 py-2.5 transition-all ${
              turn === myColor && gameStatus === 'in_progress'
                ? 'border-amber-500/60 shadow-lg shadow-amber-500/10'
                : 'border-zinc-800'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <div
                className={`w-4 h-4 rounded-full ${
                  myColor === 'w' ? 'bg-zinc-100 border border-zinc-400' : 'bg-zinc-900 border border-zinc-500'
                }`}
              />
              <div>
                <div className="text-xs font-semibold text-zinc-200 flex items-center gap-1.5">
                  <span>You ({myColor === 'w' ? 'White' : 'Black'})</span>
                  {turn === myColor && gameStatus === 'in_progress' && (
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                  )}
                </div>
                <div className="text-[11px] text-zinc-500 font-mono">
                  {myPlayer?.address ? truncateAddress(myPlayer.address) : myPlayer?.id || 'Connected'}
                </div>
              </div>
            </div>

            {/* Self Clock */}
            <div
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-mono font-bold text-sm border transition-colors ${
                myClock < 30000 && gameStatus === 'in_progress'
                  ? 'bg-rose-500/20 border-rose-500 text-rose-300 animate-pulse'
                  : turn === myColor && gameStatus === 'in_progress'
                  ? 'bg-amber-500/15 border-amber-500/50 text-amber-200'
                  : 'bg-zinc-950 border-zinc-800 text-zinc-400'
              }`}
            >
              <Clock className="w-3.5 h-3.5" />
              <span>{formatTime(myClock)}</span>
            </div>
          </div>
        </div>

        {/* Right: Sidebar / Game Controls & Move Log */}
        <div className="w-full lg:w-80 flex flex-col gap-4">
          {/* Status Badge */}
          <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-4">
            <div className="text-xs text-zinc-400 uppercase tracking-wider font-semibold mb-1">
              Match Status
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span
                  className={`w-2.5 h-2.5 rounded-full ${
                    gameStatus === 'in_progress'
                      ? 'bg-emerald-400 animate-pulse'
                      : gameStatus === 'waiting'
                      ? 'bg-amber-400 animate-bounce'
                      : 'bg-zinc-500'
                  }`}
                />
                <span className="font-semibold text-sm capitalize">
                  {gameStatus === 'in_progress'
                    ? isMyTurn
                      ? 'Your Turn'
                      : 'Opponent Thinking...'
                    : gameStatus.replace('_', ' ')}
                </span>
              </div>

              {inCheck && gameStatus === 'in_progress' && (
                <span className="text-[11px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/40 px-2 py-0.5 rounded-md animate-pulse">
                  CHECK
                </span>
              )}
            </div>

            {opponentDisconnected && gameStatus === 'in_progress' && (
              <div className="mt-3 text-[11px] text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded p-2 flex items-center gap-1.5">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span>Opponent disconnected. 60s reconnection grace period active.</span>
              </div>
            )}
          </div>

          {/* Move History Table */}
          <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-4 flex-1 flex flex-col min-h-[220px] max-h-[360px]">
            <div className="flex items-center justify-between mb-2 pb-2 border-b border-zinc-800">
              <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
                Move History
              </span>
              <span className="text-[11px] text-zinc-500 font-mono">
                {history.length} moves
              </span>
            </div>

            <div className="flex-1 overflow-y-auto space-y-1 pr-1 font-mono text-xs">
              {movePairs.length === 0 ? (
                <div className="h-full flex items-center justify-center text-zinc-600 text-xs italic">
                  No moves played yet
                </div>
              ) : (
                movePairs.map((pair) => (
                  <div
                    key={pair.num}
                    className="grid grid-cols-12 py-1 px-2 rounded hover:bg-zinc-800/40 text-zinc-300"
                  >
                    <span className="col-span-3 text-zinc-500">{pair.num}.</span>
                    <span className="col-span-4 font-semibold text-zinc-200">{pair.white}</span>
                    <span className="col-span-5 font-semibold text-zinc-400">
                      {pair.black || ''}
                    </span>
                  </div>
                ))
              )}
              <div ref={historyEndRef} />
            </div>
          </div>

          {/* Actions & Resign */}
          <div className="flex flex-col gap-2">
            {gameStatus === 'in_progress' && myColor && (
              <button
                onClick={() => setShowResignModal(true)}
                className="w-full py-2.5 px-4 bg-zinc-900 hover:bg-rose-950/40 text-zinc-400 hover:text-rose-300 border border-zinc-800 hover:border-rose-800/60 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer"
              >
                <Flag className="w-3.5 h-3.5" />
                <span>Resign Match</span>
              </button>
            )}

            <button
              onClick={copyInviteLink}
              className="w-full py-2.5 px-4 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-800 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer"
            >
              {copiedLink ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedLink ? 'Link Copied!' : 'Copy Match Link'}</span>
            </button>
          </div>
        </div>
      </main>

      {/* Resignation Confirmation Modal */}
      {showResignModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 max-w-sm w-full shadow-2xl">
            <h3 className="text-lg font-bold text-zinc-100 mb-2">Resign Match?</h3>
            <p className="text-xs text-zinc-400 mb-5 leading-relaxed">
              Are you sure you want to resign? Your opponent will be declared the winner immediately
              {wager.enabled && ' and claim the escrow pot'}.
            </p>

            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowResignModal(false)}
                className="flex-1 py-2.5 px-4 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-xl text-xs font-semibold transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleResign}
                className="flex-1 py-2.5 px-4 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-semibold transition-colors cursor-pointer"
              >
                Confirm Resign
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Game Over Modal Overlay */}
      {gameOverData && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-md z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-zinc-900 border border-zinc-700/80 rounded-2xl p-6 sm:p-8 max-w-md w-full shadow-2xl text-center">
            <div className="w-16 h-16 rounded-full bg-amber-500/15 border border-amber-500/40 mx-auto flex items-center justify-center mb-4">
              <Trophy className="w-8 h-8 text-amber-400" />
            </div>

            <h2 className="text-2xl font-black tracking-tight text-zinc-50 mb-1">
              {gameOverData.winner === 'draw'
                ? 'MATCH DRAW'
                : gameOverData.winner === myColor
                ? 'VICTORY!'
                : 'DEFEAT'}
            </h2>

            <p className="text-xs font-semibold uppercase tracking-wider text-amber-400 mb-4">
              {gameOverData.winner === 'draw'
                ? `Drawn by ${gameOverData.reason.replace('_', ' ')}`
                : `${gameOverData.winner === 'w' ? 'White' : 'Black'} wins by ${gameOverData.reason.replace('_', ' ')}`}
            </p>

            {/* Escrow Resolution Card */}
            {wager.enabled && (
              <div className="bg-zinc-950/80 border border-amber-500/30 rounded-xl p-4 mb-6 text-left">
                <div className="flex items-center gap-2 mb-2">
                  <Coins className="w-4 h-4 text-amber-400" />
                  <span className="text-xs font-bold text-amber-300">
                    Stellar Escrow Payout
                  </span>
                </div>

                <div className="text-xs text-zinc-400 space-y-1 mb-3">
                  <div>
                    Winner Pot: <span className="font-mono text-zinc-200">{Number(wager.amount) * 2} XLM</span>
                  </div>
                  <div>
                    Arbiter Verification: <span className="text-emerald-400 font-semibold">Authoritative</span>
                  </div>
                </div>

                {gameOverData.escrowTxHash && (
                  <a
                    href={`https://stellar.expert/explorer/testnet/tx/${gameOverData.escrowTxHash}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-[11px] text-amber-400 hover:text-amber-300 underline underline-offset-2 font-mono"
                  >
                    <span>View Payout on StellarExpert</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
            )}

            <div className="flex flex-col gap-2">
              <Link
                href="/"
                className="w-full py-3 px-4 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-zinc-950 font-bold rounded-xl text-xs transition-all shadow-lg shadow-amber-500/20 text-center"
              >
                Return to Lobby
              </Link>
              <button
                onClick={() => setGameOverData(null)}
                className="w-full py-2.5 px-4 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 rounded-xl text-xs font-semibold transition-colors cursor-pointer"
              >
                Review Board
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
