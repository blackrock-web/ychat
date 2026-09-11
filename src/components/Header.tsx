import React, { useState, useRef, useEffect } from 'react';
import { useChat } from '../context/ChatContext';
import {
  ShieldCheck,
  Wifi,
  WifiOff,
  LogOut,
  Bell,
  Settings,
  Search,
  X,
  MoreVertical,
  User,
  Sliders
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
    activeConversation,
    searchKeyword,
    setSearchKeyword,
    isSimulatedOffline,
    toggleSimulatedOffline,
    pendingQueueCount,
    unreadNotificationsCount,
    logout
  } = useChat();

  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close dropdown on click outside or Escape key
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsMenuOpen(false);
      }
    };

    if (isMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isMenuOpen]);

  return (
    <header className="h-16 bg-slate-900/90 backdrop-blur-md border-b border-slate-800 px-4 md:px-6 flex items-center justify-between z-30 gap-2 relative">
      {/* Brand & App Info */}
      <div className="flex items-center space-x-3 shrink-0">
        <img
          src="/1.jpg"
          alt="YChat Logo"
          className="w-9 h-9 rounded-xl object-cover shadow-md shadow-violet-500/20 border border-violet-500/30"
        />
        <div>
          <div className="flex items-center space-x-2">
            <h1 className="text-base font-bold text-white tracking-tight">ychat</h1>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-violet-950 text-violet-300 border border-violet-800/60">
              Encrypted
            </span>
          </div>
          <p className="text-[11px] text-slate-400 hidden lg:block">
            Private & Secure Messaging
          </p>
        </div>
      </div>

      {/* Search Bar for filtering messages in current conversation */}
      <div className="flex-1 max-w-xs md:max-w-sm mx-1 sm:mx-3">
        <div className="relative flex items-center">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 pointer-events-none" />
          <input
            id="header-message-search-input"
            type="text"
            placeholder={activeConversation ? "Search messages in chat..." : "Search messages..."}
            value={searchKeyword}
            onChange={(e) => setSearchKeyword(e.target.value)}
            className="w-full pl-8 pr-8 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-hidden focus:border-violet-500 focus:ring-1 focus:ring-violet-500/30 transition-all"
          />
          {searchKeyword && (
            <button
              id="header-clear-search-btn"
              onClick={() => setSearchKeyword('')}
              className="absolute right-2 text-slate-400 hover:text-slate-200 p-0.5 rounded-sm cursor-pointer"
              title="Clear search"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Controls & Connection Status + 3-Dots Menu */}
      <div className="flex items-center space-x-2 sm:space-x-3 shrink-0">
        {/* Offline Simulation / Connection Badge */}
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

        {/* 3-Dots More Options Menu Button (Consolidates all Profile & Account Actions) */}
        <div className="relative" ref={menuRef}>
          <button
            id="header-menu-btn"
            onClick={() => setIsMenuOpen((prev) => !prev)}
            aria-expanded={isMenuOpen}
            aria-label="More options and profile menu"
            className={`p-2 rounded-lg transition-all cursor-pointer relative flex items-center justify-center ${
              isMenuOpen
                ? 'bg-violet-600 text-white shadow-md shadow-violet-600/30 ring-2 ring-violet-500/40'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700/80 hover:text-white'
            }`}
            title="Profile, Settings, Security & Notifications"
          >
            <MoreVertical className="w-4 h-4" />
            {/* Notification indicator dot */}
            {unreadNotificationsCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-violet-500 text-white text-[9px] font-bold flex items-center justify-center shadow-xs">
                {unreadNotificationsCount > 9 ? '9+' : unreadNotificationsCount}
              </span>
            )}
          </button>

          {/* Dropdown Menu */}
          {isMenuOpen && (
            <div
              id="header-more-menu"
              className="absolute right-0 mt-2 w-72 sm:w-80 rounded-xl bg-slate-900 border border-slate-800 shadow-2xl shadow-black/80 py-2 z-50 animate-in fade-in slide-in-from-top-2 duration-150 divide-y divide-slate-800/60"
            >
              {/* Profile Card Header */}
              {user && (
                <div
                  id="header-profile-trigger"
                  onClick={() => {
                    setIsMenuOpen(false);
                    onOpenProfile?.();
                  }}
                  className="p-3 hover:bg-slate-800/60 cursor-pointer transition-colors flex items-center space-x-3 group"
                  title="Click to view & edit profile"
                >
                  <Avatar
                    name={user.displayName || user.username}
                    avatarUrl={user.avatarUrl}
                    size="md"
                    presenceStatus="online"
                  />
                  <div className="flex-1 min-w-0 text-left">
                    <div className="text-xs font-semibold text-slate-100 truncate group-hover:text-violet-300 transition-colors">
                      {user.displayName}
                    </div>
                    <div className="text-[11px] text-slate-400 font-mono truncate">
                      @{user.username}
                    </div>
                    <div className="text-[10px] text-violet-400 mt-0.5 flex items-center space-x-1">
                      <span>Edit profile & key identity &rarr;</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Main Menu Actions */}
              <div className="py-1">
                {/* My Profile */}
                {onOpenProfile && (
                  <button
                    id="header-profile-menu-item"
                    onClick={() => {
                      setIsMenuOpen(false);
                      onOpenProfile();
                    }}
                    className="w-full px-3.5 py-2 text-left text-xs text-slate-200 hover:bg-slate-800/70 hover:text-white flex items-center space-x-3 transition-colors cursor-pointer"
                  >
                    <div className="p-1.5 rounded-md bg-slate-800 text-slate-300">
                      <User className="w-3.5 h-3.5" />
                    </div>
                    <div>
                      <div className="font-medium">My Profile</div>
                      <div className="text-[10px] text-slate-400">Account identity & paired devices</div>
                    </div>
                  </button>
                )}

                {/* Settings */}
                {onOpenSettings && (
                  <button
                    id="header-settings-menu-item"
                    onClick={() => {
                      setIsMenuOpen(false);
                      onOpenSettings();
                    }}
                    className="w-full px-3.5 py-2 text-left text-xs text-slate-200 hover:bg-slate-800/70 hover:text-white flex items-center space-x-3 transition-colors cursor-pointer"
                  >
                    <div className="p-1.5 rounded-md bg-slate-800 text-slate-300">
                      <Settings className="w-3.5 h-3.5" />
                    </div>
                    <div>
                      <div className="font-medium">Settings & Themes</div>
                      <div className="text-[10px] text-slate-400">Themes, retry policies & preferences</div>
                    </div>
                  </button>
                )}

                {/* Notifications */}
                {onOpenNotifications && (
                  <button
                    id="header-notifications-menu-item"
                    onClick={() => {
                      setIsMenuOpen(false);
                      onOpenNotifications();
                    }}
                    className="w-full px-3.5 py-2 text-left text-xs text-slate-200 hover:bg-slate-800/70 hover:text-white flex items-center justify-between transition-colors cursor-pointer"
                  >
                    <div className="flex items-center space-x-3">
                      <div className="p-1.5 rounded-md bg-slate-800 text-slate-300">
                        <Bell className="w-3.5 h-3.5" />
                      </div>
                      <div>
                        <div className="font-medium">Notifications</div>
                        <div className="text-[10px] text-slate-400">Security alerts & delivery receipts</div>
                      </div>
                    </div>
                    {unreadNotificationsCount > 0 && (
                      <span className="px-1.5 py-0.5 rounded-full bg-violet-600 text-white text-[10px] font-bold">
                        {unreadNotificationsCount} new
                      </span>
                    )}
                  </button>
                )}

                {/* Security Audit */}
                <button
                  id="header-audit-menu-item"
                  onClick={() => {
                    setIsMenuOpen(false);
                    onOpenAudit();
                  }}
                  className="w-full px-3.5 py-2 text-left text-xs text-slate-200 hover:bg-slate-800/70 hover:text-white flex items-center space-x-3 transition-colors cursor-pointer"
                >
                  <div className="p-1.5 rounded-md bg-violet-950/60 text-violet-300 border border-violet-800/50">
                    <ShieldCheck className="w-3.5 h-3.5" />
                  </div>
                  <div>
                    <div className="font-medium text-violet-300">Security & Cryptography Audit</div>
                    <div className="text-[10px] text-slate-400">Zero-knowledge, post-quantum ML-KEM & DSA</div>
                  </div>
                </button>
              </div>

              {/* Logout Action */}
              <div className="py-1">
                <button
                  id="header-logout-menu-item"
                  onClick={() => {
                    setIsMenuOpen(false);
                    logout();
                  }}
                  className="w-full px-3.5 py-2 text-left text-xs text-rose-300 hover:bg-rose-950/20 hover:text-rose-200 flex items-center space-x-3 transition-colors cursor-pointer"
                >
                  <div className="p-1.5 rounded-md bg-rose-950/40 text-rose-400">
                    <LogOut className="w-3.5 h-3.5" />
                  </div>
                  <div>
                    <div className="font-medium">Sign Out</div>
                    <div className="text-[10px] text-rose-400/80">Lock vault & purge local session keys</div>
                  </div>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
