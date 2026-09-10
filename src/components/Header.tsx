import React from 'react';
import { useChat } from '../context/ChatContext';
import { ShieldCheck, Wifi, WifiOff, RefreshCw, Lock, User, LogOut, Activity } from 'lucide-react';

interface HeaderProps {
  onOpenAudit: () => void;
}

export const Header: React.FC<HeaderProps> = ({ onOpenAudit }) => {
  const {
    user,
    deviceId,
    connectionState,
    isSimulatedOffline,
    toggleSimulatedOffline,
    pendingQueueCount,
    logout
  } = useChat();

  return (
    <header className="h-16 bg-slate-900/90 backdrop-blur-md border-b border-slate-800 px-4 md:px-6 flex items-center justify-between z-20">
      {/* Brand & App Info */}
      <div className="flex items-center space-x-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-violet-600 to-indigo-500 flex items-center justify-center shadow-lg shadow-violet-500/20">
          <Lock className="w-5 h-5 text-white" />
        </div>
        <div>
          <div className="flex items-center space-x-2">
            <h1 className="text-lg font-bold text-white tracking-tight">YChat</h1>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-violet-950 text-violet-300 border border-violet-800/60">
              E2EE Post-Quantum
            </span>
          </div>
          <p className="text-xs text-slate-400 hidden sm:block">
            Zero-Knowledge • ML-KEM-1024 • ChaCha20-Poly1305
          </p>
        </div>
      </div>

      {/* Controls & Connection Status */}
      <div className="flex items-center space-x-2 sm:space-x-3">
        {/* Offline Simulation Button */}
        <button
          onClick={toggleSimulatedOffline}
          className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
            isSimulatedOffline
              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
              : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700'
          }`}
          title="Toggle network state to test offline queueing and sync"
        >
          {isSimulatedOffline ? (
            <>
              <WifiOff className="w-3.5 h-3.5 text-amber-400" />
              <span>Simulated Offline</span>
            </>
          ) : (
            <>
              <Wifi className="w-3.5 h-3.5 text-emerald-400" />
              <span>Network Normal</span>
            </>
          )}
          {pendingQueueCount > 0 && (
            <span className="ml-1 px-1.5 py-0.2 rounded-full bg-amber-500 text-slate-950 text-[10px] font-bold">
              {pendingQueueCount} queued
            </span>
          )}
        </button>

        {/* Zero-Knowledge Security Audit Button */}
        <button
          onClick={onOpenAudit}
          className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-violet-950/40 text-violet-300 border border-violet-800/50 hover:border-violet-600 transition-all shadow-sm"
          title="Inspect cryptographic zero-knowledge guarantee"
        >
          <ShieldCheck className="w-4 h-4 text-violet-400" />
          <span className="hidden md:inline">Security Audit</span>
        </button>

        {/* User profile & Logout */}
        {user && (
          <div className="flex items-center space-x-2 pl-2 border-l border-slate-800">
            <div className="text-right hidden sm:block">
              <div className="text-xs font-semibold text-slate-200">{user.displayName}</div>
              <div className="text-[10px] text-slate-400 font-mono">@{user.username}</div>
            </div>
            <button
              onClick={logout}
              className="p-2 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-950/20 transition-all"
              title="Sign Out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </header>
  );
};
