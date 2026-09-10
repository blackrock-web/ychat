import React, { useState } from 'react';
import {
  X,
  Palette,
  EyeOff,
  Bell,
  Shield,
  User,
  Moon,
  Sun,
  Monitor,
  Check,
  Volume2,
  VolumeX,
  AlertTriangle,
  Loader2,
  Lock,
  Smartphone,
  FileCheck,
  ShieldCheck,
  Trash2,
  Clock,
  UserX
} from 'lucide-react';
import { useChat } from '../context/ChatContext';
import { ThemeMode, BubbleColor, ChatWallpaper, TimestampFormat } from '../types/settings';
import { SecurityAuditModal } from './SecurityAuditModal';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenDevices?: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  onOpenDevices
}) => {
  const {
    user,
    settings,
    updateSettings,
    conversations,
    toggleMuteConversation,
    isConversationMuted,
    blockedUsers,
    blockUser,
    unblockUser,
    changePassword,
    deleteAccount,
    deviceId
  } = useChat();

  const [activeTab, setActiveTab] = useState<
    'appearance' | 'privacy' | 'notifications' | 'security' | 'account'
  >('appearance');

  // Password change state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [passwordSuccess, setPasswordSuccess] = useState(false);
  const [passwordError, setPasswordError] = useState('');

  // Delete account state
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [showSecurityAudit, setShowSecurityAudit] = useState(false);

  // Block user input
  const [blockUsernameInput, setBlockUsernameInput] = useState('');
  const [isBlocking, setIsBlocking] = useState(false);

  if (!isOpen) return null;

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError('');
    setPasswordSuccess(false);

    if (newPassword !== confirmPassword) {
      setPasswordError('New passwords do not match');
      return;
    }
    if (newPassword.length < 8) {
      setPasswordError('New password must be at least 8 characters');
      return;
    }

    setIsChangingPassword(true);
    try {
      await changePassword(currentPassword, newPassword);
      setPasswordSuccess(true);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setTimeout(() => setPasswordSuccess(false), 3000);
    } catch (err: any) {
      setPasswordError(err.message || 'Failed to update password');
    } finally {
      setIsChangingPassword(false);
    }
  };

  const handleDeleteAccountSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (deleteConfirmText !== user?.username) {
      alert(`Please type "${user?.username}" to confirm deletion.`);
      return;
    }

    if (!confirm('Permanently delete your account and all associated cryptographic credentials? This cannot be undone.')) {
      return;
    }

    setIsDeletingAccount(true);
    try {
      await deleteAccount();
      onClose();
    } catch (err: any) {
      alert(err.message || 'Failed to delete account');
      setIsDeletingAccount(false);
    }
  };

  const handleRequestDesktopNotifications = async () => {
    if ('Notification' in window) {
      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        updateSettings({ desktopNotificationsEnabled: true });
      } else {
        updateSettings({ desktopNotificationsEnabled: false });
      }
    } else {
      alert('Desktop notifications are not supported in this browser.');
    }
  };

  const handleBlockUser = async () => {
    if (!blockUsernameInput.trim()) return;
    setIsBlocking(true);
    try {
      // Find user by username
      const res = await fetch(`/api/v1/users/search?q=${encodeURIComponent(blockUsernameInput.trim())}`);
      if (res.ok) {
        const results = await res.json();
        const target = results.users?.find(
          (u: any) => u.username.toLowerCase() === blockUsernameInput.trim().toLowerCase()
        );
        if (target) {
          await blockUser(target.uuid);
          setBlockUsernameInput('');
        } else {
          alert('User not found');
        }
      }
    } catch (err: any) {
      alert(err.message || 'Failed to block user');
    } finally {
      setIsBlocking(false);
    }
  };

  const bubbleOptions: { id: BubbleColor; label: string; class: string }[] = [
    { id: 'violet', label: 'Violet', class: 'bg-violet-600' },
    { id: 'indigo', label: 'Indigo', class: 'bg-indigo-600' },
    { id: 'emerald', label: 'Emerald', class: 'bg-emerald-600' },
    { id: 'cyan', label: 'Cyan', class: 'bg-cyan-600' },
    { id: 'rose', label: 'Rose', class: 'bg-rose-600' },
    { id: 'amber', label: 'Amber', class: 'bg-amber-600' }
  ];

  const wallpaperOptions: { id: ChatWallpaper; label: string }[] = [
    { id: 'default', label: 'Classic Dark' },
    { id: 'subtle-grid', label: 'Blueprint Grid' },
    { id: 'dots', label: 'Quantum Dots' },
    { id: 'minimal', label: 'Pure Minimal' }
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
      <div
        id="settings-modal"
        className="w-full max-w-xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[88vh] animate-in fade-in zoom-in-95 duration-150"
      >
        {/* Header */}
        <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/80">
          <div>
            <h2 className="text-sm font-semibold text-slate-100">Application Settings</h2>
            <p className="text-xs text-slate-400">Personalize your privacy, theme, and security</p>
          </div>
          <button
            id="settings-modal-close-btn"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-md transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-slate-800 bg-slate-950/40 px-3 overflow-x-auto">
          {[
            { id: 'appearance', label: 'Appearance', icon: Palette },
            { id: 'privacy', label: 'Privacy', icon: EyeOff },
            { id: 'notifications', label: 'Notifications', icon: Bell },
            { id: 'security', label: 'Security', icon: Shield },
            { id: 'account', label: 'Account', icon: User }
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                id={`settings-tab-${tab.id}`}
                onClick={() => setActiveTab(tab.id as any)}
                className={`py-3 px-3 text-xs font-medium border-b-2 whitespace-nowrap transition-colors flex items-center gap-1.5 ${
                  isActive
                    ? 'border-violet-500 text-violet-400'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-5">
          {/* ================= APPEARANCE TAB ================= */}
          {activeTab === 'appearance' && (
            <div className="space-y-5">
              {/* Theme Mode */}
              <div>
                <label className="block text-xs font-semibold text-slate-200 mb-2">
                  Color Theme (Phase D)
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: 'dark', label: 'Dark', icon: Moon },
                    { id: 'light', label: 'Light', icon: Sun },
                    { id: 'system', label: 'System', icon: Monitor }
                  ].map((item) => {
                    const Icon = item.icon;
                    const isSelected = settings.theme === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        id={`theme-select-${item.id}`}
                        onClick={() => updateSettings({ theme: item.id as ThemeMode })}
                        className={`p-3 rounded-xl border flex flex-col items-center gap-1.5 transition-all ${
                          isSelected
                            ? 'bg-violet-950/30 border-violet-500 text-violet-300'
                            : 'bg-slate-950/40 border-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                        }`}
                      >
                        <Icon className="w-4 h-4" />
                        <span className="text-xs font-medium">{item.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Chat Bubble Accent Color */}
              <div>
                <label className="block text-xs font-semibold text-slate-200 mb-2">
                  Chat Bubble Accent Color
                </label>
                <div className="flex flex-wrap gap-2.5">
                  {bubbleOptions.map((opt) => {
                    const isSelected = settings.bubbleColor === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => updateSettings({ bubbleColor: opt.id })}
                        className={`group flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-all ${
                          isSelected
                            ? 'bg-slate-800 border-slate-600 text-slate-100'
                            : 'bg-slate-950/40 border-slate-800/80 text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        <span className={`w-3 h-3 rounded-full ${opt.class} flex-shrink-0`} />
                        <span className="text-xs">{opt.label}</span>
                        {isSelected && <Check className="w-3 h-3 text-violet-400 ml-1" />}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Chat Wallpaper */}
              <div>
                <label className="block text-xs font-semibold text-slate-200 mb-2">
                  Chat Area Wallpaper
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {wallpaperOptions.map((opt) => {
                    const isSelected = settings.chatWallpaper === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => updateSettings({ chatWallpaper: opt.id })}
                        className={`p-2.5 rounded-xl border text-left transition-all ${
                          isSelected
                            ? 'bg-violet-950/30 border-violet-500/80 text-violet-300'
                            : 'bg-slate-950/40 border-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium">{opt.label}</span>
                          {isSelected && <Check className="w-3.5 h-3.5 text-violet-400" />}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Timestamp format toggle */}
              <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800 flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-violet-400" />
                    <span className="text-xs font-semibold text-slate-200">
                      Message Timestamp Format
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Toggle between absolute timestamps (10:20 AM) and relative timestamps (5m ago)
                  </p>
                </div>
                <div className="flex items-center bg-slate-900 p-1 rounded-lg border border-slate-800">
                  <button
                    type="button"
                    onClick={() => updateSettings({ timestampFormat: 'absolute' })}
                    className={`px-2.5 py-1 text-xs rounded-md font-medium transition-colors ${
                      settings.timestampFormat === 'absolute'
                        ? 'bg-violet-600 text-white'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Absolute
                  </button>
                  <button
                    type="button"
                    onClick={() => updateSettings({ timestampFormat: 'relative' })}
                    className={`px-2.5 py-1 text-xs rounded-md font-medium transition-colors ${
                      settings.timestampFormat === 'relative'
                        ? 'bg-violet-600 text-white'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Relative
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ================= PRIVACY TAB ================= */}
          {activeTab === 'privacy' && (
            <div className="space-y-4">
              {/* Read Receipts */}
              <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800 flex items-center justify-between">
                <div>
                  <span className="text-xs font-semibold text-slate-200">Read Receipts</span>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Send double-tick read confirmations when you view messages
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.readReceiptsEnabled}
                    onChange={(e) => updateSettings({ readReceiptsEnabled: e.target.checked })}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-slate-800 peer-focus:outline-hidden rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-violet-600"></div>
                </label>
              </div>

              {/* Incognito Preference */}
              <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800 flex items-center justify-between">
                <div>
                  <span className="text-xs font-semibold text-slate-200">Default Incognito Mode</span>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Automatically prefer RAM-only ephemeral storage for new chat sessions
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.defaultIncognito}
                    onChange={(e) => updateSettings({ defaultIncognito: e.target.checked })}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-slate-800 peer-focus:outline-hidden rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-violet-600"></div>
                </label>
              </div>

              {/* Last Seen Visibility */}
              <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800 flex items-center justify-between">
                <div>
                  <span className="text-xs font-semibold text-slate-200">Online & Last Seen Status</span>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Allow verified contacts to see when you are active on GhostChat
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.lastSeenVisibility}
                    onChange={(e) => updateSettings({ lastSeenVisibility: e.target.checked })}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-slate-800 peer-focus:outline-hidden rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-violet-600"></div>
                </label>
              </div>

              {/* Blocked Users Section */}
              <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-xs font-semibold text-slate-200">Blocked Users</span>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      Blocked accounts cannot initiate conversations or send encrypted packets
                    </p>
                  </div>
                  <span className="text-xs text-slate-500 font-mono">
                    {blockedUsers.length} blocked
                  </span>
                </div>

                {/* Add Block input */}
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={blockUsernameInput}
                    onChange={(e) => setBlockUsernameInput(e.target.value)}
                    placeholder="Username to block (e.g. charlie)"
                    className="flex-1 px-3 py-1.5 text-xs bg-slate-900 border border-slate-800 rounded-lg text-slate-200 placeholder-slate-500 focus:outline-hidden focus:border-violet-500"
                  />
                  <button
                    type="button"
                    onClick={handleBlockUser}
                    disabled={isBlocking || !blockUsernameInput.trim()}
                    className="px-3 py-1.5 text-xs font-medium bg-rose-600/80 hover:bg-rose-600 text-white rounded-lg transition-colors disabled:opacity-50"
                  >
                    Block
                  </button>
                </div>

                {/* Blocked List */}
                {blockedUsers.length === 0 ? (
                  <p className="text-[11px] text-slate-500 italic">No blocked users.</p>
                ) : (
                  <div className="space-y-1.5 pt-1">
                    {blockedUsers.map((u) => (
                      <div
                        key={u.uuid}
                        className="flex items-center justify-between p-2 rounded-lg bg-slate-900 border border-slate-800 text-xs"
                      >
                        <div className="flex items-center gap-2">
                          <UserX className="w-3.5 h-3.5 text-rose-400" />
                          <span className="text-slate-300 font-medium">@{u.username}</span>
                          <span className="text-slate-500 text-[10px]">({u.displayName})</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => unblockUser(u.uuid)}
                          className="text-[11px] text-violet-400 hover:text-violet-300"
                        >
                          Unblock
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ================= NOTIFICATIONS TAB ================= */}
          {activeTab === 'notifications' && (
            <div className="space-y-4">
              {/* Sound Notifications */}
              <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  {settings.soundEnabled ? (
                    <Volume2 className="w-4 h-4 text-violet-400" />
                  ) : (
                    <VolumeX className="w-4 h-4 text-slate-500" />
                  )}
                  <div>
                    <span className="text-xs font-semibold text-slate-200">Sound Alerts</span>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      Play acoustic chime on incoming messages & notifications
                    </p>
                  </div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.soundEnabled}
                    onChange={(e) => updateSettings({ soundEnabled: e.target.checked })}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-slate-800 peer-focus:outline-hidden rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-violet-600"></div>
                </label>
              </div>

              {/* Desktop Push Notifications */}
              <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800 flex items-center justify-between">
                <div>
                  <span className="text-xs font-semibold text-slate-200">
                    Desktop System Notifications
                  </span>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Receive background alerts when browser tab is inactive
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleRequestDesktopNotifications}
                  className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-colors ${
                    settings.desktopNotificationsEnabled
                      ? 'bg-emerald-600/20 text-emerald-300 border border-emerald-500/30'
                      : 'bg-violet-600 hover:bg-violet-500 text-white'
                  }`}
                >
                  {settings.desktopNotificationsEnabled ? 'Enabled' : 'Request Permission'}
                </button>
              </div>

              {/* Per-Conversation Muting */}
              <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-200">
                    Conversation Mute Settings
                  </span>
                  <span className="text-[10px] text-slate-500">
                    {settings.mutedConversations.length} muted
                  </span>
                </div>
                <p className="text-[11px] text-slate-400">
                  Silence sound and push notifications for specific conversation threads.
                </p>

                {conversations.length === 0 ? (
                  <p className="text-[11px] text-slate-500 italic pt-1">
                    No active conversations.
                  </p>
                ) : (
                  <div className="space-y-1.5 pt-2">
                    {conversations.map((c) => {
                      const muted = isConversationMuted(c.id);
                      return (
                        <div
                          key={c.id}
                          className="flex items-center justify-between p-2 rounded-lg bg-slate-900 border border-slate-800 text-xs"
                        >
                          <span className="text-slate-200 font-medium">
                            @{c.recipientUsername} ({c.recipientDisplayName})
                          </span>
                          <button
                            type="button"
                            onClick={() => toggleMuteConversation(c.id)}
                            className={`px-2.5 py-1 text-[11px] rounded-md transition-colors ${
                              muted
                                ? 'bg-amber-600/20 text-amber-300 border border-amber-500/30'
                                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                            }`}
                          >
                            {muted ? 'Muted' : 'Mute'}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ================= SECURITY TAB ================= */}
          {activeTab === 'security' && (
            <div className="space-y-4">
              {/* Surfaced Security Audit Modal */}
              <div className="p-4 rounded-xl bg-violet-950/20 border border-violet-500/30 space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="w-5 h-5 text-violet-400" />
                    <div>
                      <h4 className="text-xs font-bold text-slate-100">
                        Cryptographic Audit & Diagnostics
                      </h4>
                      <p className="text-[10px] text-slate-400">
                        Zero-Knowledge proof validation, BLAKE3 chain inspection & ML-DSA signatures
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowSecurityAudit(true)}
                    className="px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium shadow-sm transition-colors"
                  >
                    Open Audit
                  </button>
                </div>
              </div>

              {/* Linked Devices Summary */}
              <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <Smartphone className="w-4 h-4 text-cyan-400" />
                  <div>
                    <span className="text-xs font-semibold text-slate-200">
                      Multi-Device Keys & Management
                    </span>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      View and revoke linked devices holding cryptographic prekeys
                    </p>
                  </div>
                </div>
                {onOpenDevices && (
                  <button
                    type="button"
                    onClick={onOpenDevices}
                    className="px-3 py-1.5 text-xs rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium transition-colors"
                  >
                    Manage Devices
                  </button>
                )}
              </div>

              {/* AES-256-GCM Storage status */}
              <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800 space-y-1.5">
                <div className="flex items-center gap-2 text-xs font-semibold text-emerald-400">
                  <Lock className="w-4 h-4" />
                  <span>At-Rest Storage Encryption: AES-256-GCM Active</span>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  All local ratchet sessions, prekeys, and messages stored in IndexedDB are
                  wrapped and encrypted under Domain 2 authenticated encryption with WebCrypto PBKDF2 key derivation.
                </p>
              </div>
            </div>
          )}

          {/* ================= ACCOUNT TAB ================= */}
          {activeTab === 'account' && (
            <div className="space-y-5">
              {/* Change Password */}
              <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-3">
                <div className="flex items-center gap-2">
                  <Lock className="w-4 h-4 text-violet-400" />
                  <span className="text-xs font-semibold text-slate-200">
                    Change Password (Argon2id Hash)
                  </span>
                </div>
                <p className="text-[11px] text-slate-400">
                  Updates your Supabase Auth credentials re-hashed with memory-hard Argon2id.
                </p>

                <form onSubmit={handlePasswordSubmit} className="space-y-3 pt-1">
                  <div>
                    <label className="block text-[11px] text-slate-300 mb-1">
                      Current Password
                    </label>
                    <input
                      type="password"
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      placeholder="••••••••"
                      required
                      className="w-full px-3 py-1.5 text-xs bg-slate-900 border border-slate-800 rounded-lg text-slate-100 placeholder-slate-500 focus:outline-hidden focus:border-violet-500"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] text-slate-300 mb-1">
                        New Password (min 8 chars)
                      </label>
                      <input
                        type="password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="••••••••"
                        required
                        minLength={8}
                        className="w-full px-3 py-1.5 text-xs bg-slate-900 border border-slate-800 rounded-lg text-slate-100 placeholder-slate-500 focus:outline-hidden focus:border-violet-500"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-300 mb-1">
                        Confirm New Password
                      </label>
                      <input
                        type="password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="••••••••"
                        required
                        minLength={8}
                        className="w-full px-3 py-1.5 text-xs bg-slate-900 border border-slate-800 rounded-lg text-slate-100 placeholder-slate-500 focus:outline-hidden focus:border-violet-500"
                      />
                    </div>
                  </div>

                  {passwordError && (
                    <p className="text-xs text-rose-400">{passwordError}</p>
                  )}
                  {passwordSuccess && (
                    <p className="text-xs text-emerald-400 flex items-center gap-1">
                      <Check className="w-3.5 h-3.5" /> Password updated successfully
                    </p>
                  )}

                  <div className="flex justify-end pt-1">
                    <button
                      type="submit"
                      disabled={isChangingPassword}
                      className="px-3 py-1.5 text-xs font-medium bg-violet-600 hover:bg-violet-500 text-white rounded-lg transition-colors disabled:opacity-50 flex items-center gap-1.5"
                    >
                      {isChangingPassword && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                      Update Password
                    </button>
                  </div>
                </form>
              </div>

              {/* Delete Account (Danger Zone) */}
              <div className="p-4 rounded-xl bg-rose-950/20 border border-rose-900/50 space-y-3">
                <div className="flex items-center gap-2 text-rose-400">
                  <AlertTriangle className="w-4 h-4" />
                  <span className="text-xs font-semibold">Danger Zone: Delete Account</span>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Permanently revokes all cryptographic key bundles, wipes your user record,
                  and deletes your account from the authentication service.
                </p>

                <form onSubmit={handleDeleteAccountSubmit} className="space-y-2.5 pt-1">
                  <div>
                    <label className="block text-[11px] text-slate-300 mb-1">
                      Type your username <span className="font-mono text-rose-400">"{user?.username}"</span> to confirm:
                    </label>
                    <input
                      type="text"
                      value={deleteConfirmText}
                      onChange={(e) => setDeleteConfirmText(e.target.value)}
                      placeholder={user?.username}
                      className="w-full px-3 py-1.5 text-xs bg-slate-900 border border-rose-900/50 rounded-lg text-rose-200 placeholder-slate-600 focus:outline-hidden focus:border-rose-500"
                    />
                  </div>

                  <div className="flex justify-end">
                    <button
                      type="submit"
                      disabled={isDeletingAccount || deleteConfirmText !== user?.username}
                      className="px-3 py-1.5 text-xs font-medium bg-rose-600 hover:bg-rose-500 text-white rounded-lg transition-colors disabled:opacity-40 flex items-center gap-1.5"
                    >
                      {isDeletingAccount ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="w-3.5 h-3.5" />
                      )}
                      Delete Account Permanently
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-slate-800 bg-slate-900/60 flex items-center justify-between">
          <span className="text-[10px] text-slate-500 font-mono">
            User: {user?.username}
          </span>
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs text-slate-300 hover:text-slate-100 hover:bg-slate-800 rounded-lg transition-colors"
          >
            Done
          </button>
        </div>
      </div>

      {showSecurityAudit && (
        <SecurityAuditModal onClose={() => setShowSecurityAudit(false)} />
      )}
    </div>
  );
};
