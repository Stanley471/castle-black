'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Crown,
  Shield,
  Clock,
  Coins,
  ArrowRight,
  Copy,
  Check,
  ExternalLink,
  Wallet,
  Sparkles,
  Zap,
  Info,
  Loader2,
  AlertCircle
} from 'lucide-react';
import { connectSocket } from '@/lib/socket';
import { getFreighterPublicKey, truncateAddress } from '@/lib/stellar';
import { RoomCreatedPayload } from '@/types';

const TIME_CONTROLS = [
  { id: '1m', label: '1 min', sub: 'Bullet', ms: 60 * 1000, inc: 0 },
  { id: '3m', label: '3 min', sub: 'Blitz', ms: 3 * 60 * 1000, inc: 0 },
  { id: '5m', label: '5 min', sub: 'Rapid', ms: 5 * 60 * 1000, inc: 0 },
  { id: '10m', label: '10 min', sub: 'Classical', ms: 10 * 60 * 1000, inc: 0 },
];

export default function LobbyPage() {
  const router = useRouter();

  // Creation options
  const [selectedTime, setSelectedTime] = useState(TIME_CONTROLS[2]!); // 5 min default
  const [wagerEnabled, setWagerEnabled] = useState(false);
  const [wagerAmount, setWagerAmount] = useState('10');
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [isConnectingWallet, setIsConnectingWallet] = useState(false);

  // Join options
  const [joinCode, setJoinCode] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [joinError, setJoinError] = useState('');

  // Toast feedback state
  const [toast, setToast] = useState<{
    title: string;
    description?: string;
    type: 'loading' | 'success' | 'error';
  } | null>(null);

  // Auto-connect wallet handler
  const handleConnectWallet = async () => {
    setIsConnectingWallet(true);
    try {
      const pubkey = await getFreighterPublicKey();
      if (pubkey) {
        setWalletAddress(pubkey);
      }
    } finally {
      setIsConnectingWallet(false);
    }
  };

  const handleCreateRoom = () => {
    if (isCreating) return; // Strictly prevent multiple clicks
    setIsCreating(true);

    setToast({
      title: 'Creating match room...',
      description: 'Connecting to arbiter server and allocating 6-character room code.',
      type: 'loading',
    });

    const socket = connectSocket();

    // Timeout safety fallback
    const timeout = setTimeout(() => {
      setIsCreating(false);
      setToast({
        title: 'Connection timeout',
        description: 'Server took too long to respond. Please ensure the backend is running.',
        type: 'error',
      });
      setTimeout(() => setToast(null), 4000);
    }, 8000);

    socket.emit('create_room', {
      timeControlMs: selectedTime.ms,
      incrementMs: selectedTime.inc,
      wager: {
        enabled: wagerEnabled,
        amount: wagerAmount,
        playerAddress: walletAddress || undefined,
      },
    });

    socket.once('room_created', (data: RoomCreatedPayload) => {
      clearTimeout(timeout);
      setToast({
        title: 'Match created!',
        description: `Room code ${data.roomId} allocated. Redirecting to board...`,
        type: 'success',
      });
      setTimeout(() => {
        setIsCreating(false);
        router.push(`/game/${data.roomId}`);
      }, 400);
    });

    socket.once('error_message', (err: { message: string }) => {
      clearTimeout(timeout);
      setIsCreating(false);
      setToast({
        title: 'Failed to create room',
        description: err.message || 'An unexpected error occurred.',
        type: 'error',
      });
      setTimeout(() => setToast(null), 4000);
    });
  };

  const handleJoinRoom = (e: React.FormEvent) => {
    e.preventDefault();
    setJoinError('');
    const clean = joinCode.trim().toUpperCase();
    if (clean.length !== 6) {
      setJoinError('Room code must be exactly 6 characters');
      return;
    }
    router.push(`/game/${clean}`);
  };

  return (
    <div className="flex-1 flex flex-col min-h-screen bg-zinc-950 text-zinc-100">
      {/* Top Navigation */}
      <header className="border-b border-zinc-800/80 bg-zinc-900/40 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500/20 to-zinc-900 border border-amber-500/40 flex items-center justify-center shadow-lg shadow-amber-500/10">
              <Crown className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <span className="font-bold text-lg tracking-wider text-zinc-100 flex items-center gap-1.5">
                CASTLE <span className="text-amber-400 font-extrabold">BLACK</span>
              </span>
              <p className="text-[10px] text-zinc-400 uppercase tracking-widest -mt-0.5">
                Stellar Real-Time Chess
              </p>
            </div>
          </div>

          {/* Freighter Wallet Connect */}
          <div>
            {walletAddress ? (
              <div className="flex items-center gap-2 bg-zinc-900 border border-zinc-700/60 rounded-full px-3.5 py-1.5 text-xs">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span className="font-mono text-zinc-300">{truncateAddress(walletAddress)}</span>
                <span className="text-[10px] bg-amber-500/10 text-amber-400 border border-amber-500/30 px-1.5 py-0.5 rounded uppercase font-semibold">
                  Testnet
                </span>
              </div>
            ) : (
              <button
                onClick={handleConnectWallet}
                disabled={isConnectingWallet}
                className="flex items-center gap-2 bg-zinc-900 hover:bg-zinc-800 text-zinc-200 border border-zinc-700 rounded-full px-4 py-1.5 text-xs font-medium transition-all shadow-sm active:scale-95 cursor-pointer"
              >
                <Wallet className="w-3.5 h-3.5 text-amber-400" />
                <span>{isConnectingWallet ? 'Connecting...' : 'Connect Freighter'}</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 py-8 sm:py-12 flex flex-col items-center">
        <div className="text-center max-w-2xl mb-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-zinc-900 border border-zinc-800 text-xs text-zinc-400 mb-4 shadow-inner">
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            <span>Zero accounts required. Peer-to-peer 6-character room codes.</span>
          </div>

          <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-zinc-50 mb-3">
            Chess first. <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-400 via-amber-200 to-amber-500">
              Blockchain where it adds value.
            </span>
          </h1>

          <p className="text-zinc-400 text-sm sm:text-base leading-relaxed">
            Jump into zero-friction real-time chess with friends in seconds.
            Optionally enable a testnet XLM escrow wager verified on-chain by the authoritative arbiter.
          </p>
        </div>

        {/* Action Grid: Create vs Join */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 w-full">
          {/* Create Match Column */}
          <div className="lg:col-span-7 bg-zinc-900/60 border border-zinc-800 rounded-2xl p-6 sm:p-8 backdrop-blur-sm shadow-xl flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 rounded-lg bg-amber-500/10 border border-amber-500/30">
                    <Crown className="w-5 h-5 text-amber-400" />
                  </div>
                  <div>
                    <h2 className="font-semibold text-lg text-zinc-100">Create New Match</h2>
                    <p className="text-xs text-zinc-400">Generate a custom room and invite an opponent</p>
                  </div>
                </div>
              </div>

              {/* Time Control Selection */}
              <div className="mb-6">
                <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2.5">
                  Select Time Control
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  {TIME_CONTROLS.map((tc) => {
                    const isSelected = selectedTime.id === tc.id;
                    return (
                      <button
                        key={tc.id}
                        type="button"
                        onClick={() => setSelectedTime(tc)}
                        className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                          isSelected
                            ? 'bg-amber-500/15 border-amber-500/80 text-amber-200 shadow-md shadow-amber-500/10'
                            : 'bg-zinc-950/60 border-zinc-800 hover:border-zinc-700 text-zinc-300'
                        }`}
                      >
                        <div className="font-bold text-sm">{tc.label}</div>
                        <div className="text-[11px] text-zinc-400">{tc.sub}</div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Optional Stellar Escrow Wager */}
              <div className="mb-6 bg-zinc-950/70 border border-zinc-800/90 rounded-xl p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <Coins className="w-4 h-4 text-amber-400" />
                    <div>
                      <div className="font-medium text-sm text-zinc-200 flex items-center gap-2">
                        <span>Stellar Soroban Escrow</span>
                        <span className="text-[10px] bg-zinc-800 text-zinc-400 px-1.5 py-0.5 rounded uppercase font-mono">
                          Optional
                        </span>
                      </div>
                      <p className="text-xs text-zinc-400 mt-0.5">
                        Both players stake XLM. Winner takes the pot on checkmate or timeout.
                      </p>
                    </div>
                  </div>

                  {/* Toggle Switch */}
                  <button
                    type="button"
                    onClick={() => {
                      const next = !wagerEnabled;
                      setWagerEnabled(next);
                      if (next && !walletAddress) {
                        handleConnectWallet();
                      }
                    }}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer ${
                      wagerEnabled ? 'bg-amber-500' : 'bg-zinc-700'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        wagerEnabled ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>

                {/* Expanded Wager Details */}
                {wagerEnabled && (
                  <div className="mt-4 pt-4 border-t border-zinc-800 flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
                    <div>
                      <label className="text-xs text-zinc-400 block mb-1">Stake Amount per Player</label>
                      <div className="flex items-center gap-2">
                        {['5', '10', '25', '50'].map((amt) => (
                          <button
                            key={amt}
                            type="button"
                            onClick={() => setWagerAmount(amt)}
                            className={`px-3 py-1 rounded-lg text-xs font-mono font-semibold border cursor-pointer ${
                              wagerAmount === amt
                                ? 'bg-amber-500/20 border-amber-500 text-amber-300'
                                : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:border-zinc-700'
                            }`}
                          >
                            {amt} XLM
                          </button>
                        ))}
                      </div>
                    </div>

                    {!walletAddress && (
                      <button
                        type="button"
                        onClick={handleConnectWallet}
                        className="mt-2 sm:mt-0 text-xs bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold px-3 py-1.5 rounded-lg flex items-center gap-1.5 cursor-pointer"
                      >
                        <Wallet className="w-3.5 h-3.5" />
                        <span>Connect Freighter</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Create Room Button */}
            <button
              onClick={handleCreateRoom}
              disabled={isCreating}
              className="w-full mt-4 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-zinc-950 font-bold py-3.5 px-6 rounded-xl flex items-center justify-center gap-2 transition-all shadow-lg shadow-amber-500/20 active:scale-[0.99] cursor-pointer disabled:cursor-not-allowed disabled:pointer-events-none disabled:opacity-60"
            >
              {isCreating ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-zinc-950" />
                  <span>Creating Match...</span>
                </>
              ) : (
                <>
                  <Zap className="w-4 h-4 fill-zinc-950" />
                  <span>Create Match & Get Code</span>
                </>
              )}
            </button>
          </div>

          {/* Join Match Column */}
          <div className="lg:col-span-5 flex flex-col gap-6">
            <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-6 sm:p-8 backdrop-blur-sm shadow-xl flex-1 flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-2.5 mb-6">
                  <div className="p-2 rounded-lg bg-zinc-800 border border-zinc-700">
                    <Shield className="w-5 h-5 text-zinc-300" />
                  </div>
                  <div>
                    <h2 className="font-semibold text-lg text-zinc-100">Join Match</h2>
                    <p className="text-xs text-zinc-400">Enter a 6-character room code from your friend</p>
                  </div>
                </div>

                <form onSubmit={handleJoinRoom} className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2">
                      Room Code
                    </label>
                    <input
                      type="text"
                      maxLength={6}
                      value={joinCode}
                      onChange={(e) => {
                        setJoinCode(e.target.value.toUpperCase());
                        setJoinError('');
                      }}
                      placeholder="e.g. KN7X9P"
                      className="w-full bg-zinc-950 border border-zinc-800 focus:border-amber-500 focus:outline-none rounded-xl px-4 py-3.5 text-center font-mono text-xl tracking-[0.3em] uppercase text-amber-400 placeholder:text-zinc-600 transition-colors"
                    />
                    {joinError && <p className="text-xs text-rose-400 mt-1.5">{joinError}</p>}
                  </div>

                  <button
                    type="submit"
                    className="w-full bg-zinc-100 hover:bg-white text-zinc-950 font-bold py-3.5 px-6 rounded-xl flex items-center justify-center gap-2 transition-all shadow-md active:scale-[0.99] cursor-pointer"
                  >
                    <span>Join Game</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </form>
              </div>

              {/* Informational callout */}
              <div className="mt-6 pt-6 border-t border-zinc-800 text-xs text-zinc-400 space-y-2">
                <div className="flex items-center gap-2 text-zinc-300">
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Authoritative server-side chess.js anti-cheat</span>
                </div>
                <div className="flex items-center gap-2 text-zinc-300">
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Synchronized millisecond dual clocks</span>
                </div>
                <div className="flex items-center gap-2 text-zinc-300">
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Automatic escrow payout to winner address</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer info banner */}
        <div className="mt-12 text-center text-xs text-zinc-500 flex flex-wrap items-center justify-center gap-6">
          <span>Castle Black • Drips Wave Hackathon Submission</span>
          <span>•</span>
          <span>Stellar Testnet Soroban Escrow</span>
          <span>•</span>
          <a
            href="https://stellar.org"
            target="_blank"
            rel="noreferrer"
            className="hover:text-zinc-400 underline underline-offset-4 flex items-center gap-1"
          >
            <span>Stellar Network</span>
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </main>

      {/* Real-time Toast Feedback */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3 bg-zinc-900/95 border border-zinc-700/80 text-zinc-100 px-4 py-3 rounded-2xl shadow-2xl backdrop-blur-md transition-all animate-in fade-in slide-in-from-bottom-4 duration-300 max-w-sm">
          <div
            className={`p-2 rounded-xl shrink-0 ${
              toast.type === 'loading'
                ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                : toast.type === 'success'
                ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                : 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
            }`}
          >
            {toast.type === 'loading' ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : toast.type === 'success' ? (
              <Check className="w-4 h-4" />
            ) : (
              <AlertCircle className="w-4 h-4" />
            )}
          </div>
          <div>
            <div className="text-xs font-semibold text-zinc-100">{toast.title}</div>
            {toast.description && (
              <div className="text-[11px] text-zinc-400 mt-0.5 leading-snug">{toast.description}</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
