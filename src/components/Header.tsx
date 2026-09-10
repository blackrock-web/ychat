import React from 'react';
import { useChat } from '../context/ChatContext';
import {
  ShieldCheck,
  Wifi,
  WifiOff,
  Lock,
  LogOut,
  Bell,
  Settings,
  User as UserIcon
} from 'lucide-react';
import { Avatar } from './Avatar';

interface HeaderProps {
  onOpenAudit: () => void;
  onOpenNotifications?: () => void;
  onOpenProfile?: () => void;
  onOpenSettings?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  onOpenAudit,
  onOpenNotifications,
  onOpenProfile,
  onOpenSettings
}) => {
  const {
    user,
    isSimulatedOffline,
    toggleSimulatedOffline,
    pendingQueueCount,
    unreadNotificationsCount,
    logout
  } = useChat();

  return (
    <header className="h-16 bg-slate-900/90 backdrop-blur-md border-b border-slate-800 px-4 md:px-6 flex items-center justify-between z-20">
      {/* Brand & App Info */}
      <div className="flex items-center space-x-3">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-violet-600 to-indigo-500 flex items-center justify-center shadow-lg shadow-violet-500/20">
          <Lock className="w-4 h-4 text-white" />
        </div>
        <div>
          <div className="flex items-center space-x-2">
            <h1 className="text-base font-bold text-white tracking-tight">GhostChat Ultra-X</h1>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-violet-950 text-violet-300 border border-violet-800/60">
              E2EE Post-Quantum
            </span>
          </div>
          <p className="text-[11px] text-slate-400 hidden sm:block">
            Zero-Knowledge • ML-KEM-1024 • ChaCha20-Poly1305 • AES-256-GCM
          </p>
        </div>
      </div>

      {/* Controls & Connection Status */}
      <div className="flex items-center space-x-2 sm:space-x-3">
        {/* Offline Simulation Button */}
        <button
          id="header-offline-toggle-btn"
          onClick={toggleSimulatedOffline}
          className={`flex items-center space-x-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
            isSimulatedOffline
              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
              : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700'
          }`}
          title="Toggle network state to test offline queueing and sync"
        >
          {isSimulatedOffline ? (
            <>
              <WifiOff className="w-3.5 h-3.5 text-amber-400" />
              <span className="hidden sm:inline">Offline Mode</span>
            </>
          ) : (
            <>
              <Wifi className="w-3.5 h-3.5 text-emerald-400" />
              <span className="hidden sm:inline">Connected</span>
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
          id="header-audit-btn"
          onClick={onOpenAudit}
          className="flex items-center space-x-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-violet-950/40 text-violet-300 border border-violet-800/50 hover:border-violet-600 transition-all shadow-xs cursor-pointer"
          title="Inspect cryptographic zero-knowledge guarantee"
        >
          <ShieldCheck className="w-4 h-4 text-violet-400" />
          <span className="hidden md:inline">Security Audit</span>
        </button>

        {/* Notifications Bell Button */}
        {onOpenNotifications && (
          <button
            id="header-notifications-btn"
            onClick={onOpenNotifications}
            className="p-2 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-all relative cursor-pointer"
            title="Notifications"
          >
            <Bell className="w-4 h-4" />
            {unreadNotificationsCount > 0 && (
              <span className="absolute top-1 right-1 px-1 min-w-[16px] h-4 rounded-full bg-violet-600 text-white text-[10px] font-bold flex items-center justify-center shadow-xs">
                {unreadNotificationsCount > 9 ? '9+' : unreadNotificationsCount}
              </span>
            )}
          </button>
        )}

        {/* Settings Button */}
        {onOpenSettings && (
          <button
            id="header-settings-btn"
            onClick={onOpenSettings}
            className="p-2 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-all cursor-pointer"
            title="Settings"
          >
            <Settings className="w-4 h-4" />
          </button>
        )}

        {/* User profile & Logout */}
        {user && (
          <div className="flex items-center space-x-2 pl-2 border-l border-slate-800">
            {/* Clickable Profile Badge */}
            <div
              id="header-profile-trigger"
              onClick={onOpenProfile}
              className="flex items-center space-x-2 cursor-pointer p-1 rounded-lg hover:bg-slate-800/60 transition-colors"
              title="View Profile"
            >
              <Avatar
                name={user.displayName || user.username}
                avatarUrl={user.avatarUrl}
                size="sm"
              />
              <div className="text-left hidden lg:block">
                <div className="text-xs font-semibold text-slate-200 truncate max-w-[110px]">
                  {user.displayName}
                </div>
                <div className="text-[10px] text-slate-400 font-mono truncate max-w-[110px]">
                  @{user.username}
                </div>
              </div>
            </div>

            <button
              id="header-logout-btn"
              onClick={logout}
              className="p-2 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-950/20 transition-all cursor-pointer"
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
