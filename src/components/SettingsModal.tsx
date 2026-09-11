import React, { useState, useEffect, useRef } from 'react';
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
  ShieldCheck,
  Trash2,
  Clock,
  UserX,
  Copy,
  CheckCheck,
  Camera,
  Play,
  Type,
  Image as ImageIcon,
  Sparkles,
  Link,
  ChevronRight,
  MessageSquare,
  HardDrive,
  Send,
  Layers
} from 'lucide-react';
import { useChat, playNotificationChime } from '../context/ChatContext';
import { useTheme } from '../context/ThemeContext';
import {
  ThemeMode,
  BubbleColor,
  ChatWallpaper,
  FontSize,
  TimestampFormat,
  MessageThemeStyle,
  MessageGradientType,
  IncomingMessageStyle,
  RetentionPeriodOption
} from '../types/settings';
import { SecurityAuditModal } from './SecurityAuditModal';
import { Avatar } from './Avatar';

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
    updateUserProfile,
    changePassword,
    deleteAccount,
    deviceId
  } = useChat();

  const { theme, setTheme, resolvedTheme } = useTheme();

  const [activeTab, setActiveTab] = useState<
    'profile' | 'messages' | 'appearance' | 'privacy' | 'notifications' | 'security' | 'account'
  >('appearance');

  // Profile Form state
  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [about, setAbout] = useState(user?.about || 'Available on YChat');
  const [avatarUrl, setAvatarUrl] = useState(user?.avatarUrl || '');
  const [backgroundImageUrl, setBackgroundImageUrl] = useState(user?.backgroundImage || settings.customWallpaperUrl || '');
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [profileSuccess, setProfileSuccess] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [copiedUuid, setCopiedUuid] = useState(false);
  const [copiedUsername, setCopiedUsername] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const wallpaperFileInputRef = useRef<HTMLInputElement | null>(null);
  const profileBackgroundFileRef = useRef<HTMLInputElement | null>(null);

  // Sync profile fields when modal opens or user updates
  useEffect(() => {
    if (user) {
      setDisplayName(user.displayName || '');
      setAbout(user.about || 'Available on YChat');
      setAvatarUrl(user.avatarUrl || '');
      setBackgroundImageUrl(user.backgroundImage || settings.customWallpaperUrl || '');
    }
  }, [user, isOpen, settings.customWallpaperUrl]);

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

  // Custom wallpaper URL input
  const [customWallpaperInput, setCustomWallpaperInput] = useState(settings.customWallpaperUrl || user?.backgroundImage || '');

  if (!isOpen) return null;

  const handleProfileSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileError('');
    setProfileSuccess(false);
    setIsSavingProfile(true);

    try {
      const cleanAvatar = avatarUrl.trim();
      const cleanBackground = backgroundImageUrl.trim();
      await updateUserProfile({
        displayName: displayName.trim(),
        about: about.trim(),
        avatarUrl: cleanAvatar,
        backgroundImage: cleanBackground
      });
      if (cleanBackground) {
        updateSettings({
          chatWallpaper: 'custom',
          customWallpaperUrl: cleanBackground
        });
      }
      setProfileSuccess(true);
      setTimeout(() => setProfileSuccess(false), 2500);
    } catch (err: any) {
      setProfileError(err.message || 'Failed to update profile');
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handleProfileBackgroundFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 3 * 1024 * 1024) {
      alert('Wallpaper image size must be under 3MB');
      return;
    }

    const reader = new FileReader();
    reader.onload = async (event) => {
      const base64 = event.target?.result as string;
      setBackgroundImageUrl(base64);
      setCustomWallpaperInput(base64);
      updateSettings({ chatWallpaper: 'custom', customWallpaperUrl: base64 });
      try {
        await updateUserProfile({ backgroundImage: base64 });
        setProfileSuccess(true);
        setTimeout(() => setProfileSuccess(false), 2000);
      } catch (_) {}
    };
    reader.readAsDataURL(file);
  };

  const handleAvatarFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      alert('Avatar image size must be under 2MB');
      return;
    }

    const reader = new FileReader();
    reader.onload = async (event) => {
      const base64 = event.target?.result as string;
      setAvatarUrl(base64);
      try {
        await updateUserProfile({ avatarUrl: base64 });
        setProfileSuccess(true);
        setTimeout(() => setProfileSuccess(false), 2000);
      } catch (err: any) {
        setProfileError(err.message || 'Failed to update avatar');
      }
    };
    reader.readAsDataURL(file);
  };

  const handleWallpaperFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 3 * 1024 * 1024) {
      alert('Wallpaper image size must be under 3MB');
      return;
    }

    const reader = new FileReader();
    reader.onload = async (event) => {
      const base64 = event.target?.result as string;
      setCustomWallpaperInput(base64);
      setBackgroundImageUrl(base64);
      updateSettings({ chatWallpaper: 'custom', customWallpaperUrl: base64 });
      try {
        await updateUserProfile({ backgroundImage: base64 });
      } catch (_) {}
    };
    reader.readAsDataURL(file);
  };

  const handleCopy = (text: string, type: 'uuid' | 'username') => {
    navigator.clipboard.writeText(text);
    if (type === 'uuid') {
      setCopiedUuid(true);
      setTimeout(() => setCopiedUuid(false), 2000);
    } else {
      setCopiedUsername(true);
      setTimeout(() => setCopiedUsername(false), 2000);
    }
  };

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
      const res = await fetch(`/api/v1/users/search?username=${encodeURIComponent(blockUsernameInput.trim())}`);
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

  const bubbleOptions: { id: BubbleColor; label: string; class: string; hex: string }[] = [
    { id: 'violet', label: 'Violet', class: 'bg-violet-600', hex: '#7c3aed' },
    { id: 'indigo', label: 'Indigo', class: 'bg-indigo-600', hex: '#4f46e5' },
    { id: 'emerald', label: 'Emerald', class: 'bg-emerald-600', hex: '#059669' },
    { id: 'cyan', label: 'Cyan', class: 'bg-cyan-600', hex: '#0891b2' },
    { id: 'rose', label: 'Rose', class: 'bg-rose-600', hex: '#e11d48' },
    { id: 'amber', label: 'Amber', class: 'bg-amber-600', hex: '#d97706' }
  ];

  const wallpaperOptions: { id: ChatWallpaper; label: string; description: string }[] = [
    { id: 'ychat-theme', label: 'YChat Signature', description: 'Deep obsidian & violet wallpaper' },
    { id: 'default', label: 'Classic Dark', description: 'Clean solid dark surface' },
    { id: 'clean-light', label: 'Clean Light', description: 'Crisp, high-contrast light slate' },
    { id: 'subtle-grid', label: 'Blueprint Grid', description: 'Technical isometric grid pattern' },
    { id: 'dots', label: 'Telegram Dots', description: 'Subtle ambient dot matrix' },
    { id: 'minimal', label: 'Pure Minimal', description: 'Flat borderless background' },
    { id: 'custom', label: 'Custom Image', description: 'Personal URL or uploaded image' }
  ];

  const navItems = [
    { id: 'profile', label: 'Profile', icon: User, desc: 'Display name, bio & avatar' },
    { id: 'messages', label: 'Messages', icon: MessageSquare, desc: 'Retention & bubble themes' },
    { id: 'appearance', label: 'Appearance', icon: Palette, desc: 'Themes, wallpaper & bubbles' },
    { id: 'privacy', label: 'Privacy', icon: EyeOff, desc: 'Read receipts, presence & blocks' },
    { id: 'notifications', label: 'Notifications', icon: Bell, desc: 'Sound, alerts & conversation mutes' },
    { id: 'security', label: 'Security', icon: ShieldCheck, desc: 'Keys, audit & devices' },
    { id: 'account', label: 'Account', icon: Lock, desc: 'Password & account settings' }
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/70 backdrop-blur-xs animate-in fade-in duration-150">
      <div
        id="settings-modal"
        className="w-full max-w-4xl bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden flex flex-col md:flex-row h-[620px] max-h-[92vh] transition-all"
      >
        {/* ================= LEFT SIDEBAR NAVIGATION ================= */}
        <div className="w-full md:w-64 bg-slate-950/80 border-b md:border-b-0 md:border-r border-slate-800/80 flex flex-col shrink-0">
          {/* Sidebar User Header */}
          <div className="p-4 border-b border-slate-800/80 flex items-center space-x-3 bg-slate-900/40">
            <img
              src="/1.jpg"
              alt="YChat Logo"
              className="w-10 h-10 rounded-xl object-cover shadow-md border border-violet-500/30 shrink-0"
            />
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-bold text-white tracking-tight truncate">YChat Settings</h2>
              <p className="text-[11px] text-slate-400 truncate">@{user?.username || 'user'}</p>
            </div>
            {/* Mobile Close Button */}
            <button
              id="settings-modal-close-mobile-btn"
              onClick={onClose}
              className="md:hidden p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Navigation Items */}
          <nav className="flex-1 overflow-x-auto md:overflow-y-auto p-2 md:p-3 flex md:flex-col gap-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  id={`settings-nav-${item.id}`}
                  onClick={() => setActiveTab(item.id as any)}
                  className={`flex items-center space-x-3 px-3 py-2.5 rounded-xl text-left transition-all shrink-0 cursor-pointer ${
                    isActive
                      ? 'bg-violet-600 text-white shadow-md shadow-violet-600/30'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                  }`}
                >
                  <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                  <div className="min-w-0 flex-1 hidden md:block">
                    <div className="text-xs font-semibold leading-tight">{item.label}</div>
                    <div className={`text-[10px] truncate ${isActive ? 'text-violet-200' : 'text-slate-500'}`}>
                      {item.desc}
                    </div>
                  </div>
                  <span className="md:hidden text-xs font-medium">{item.label}</span>
                </button>
              );
            })}
          </nav>

          {/* Sidebar Footer info */}
          <div className="p-3 border-t border-slate-800/80 hidden md:flex items-center justify-between text-[11px] text-slate-500">
            <span>YChat v1.2.0</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-emerald-950/60 text-emerald-400 border border-emerald-800/40">
              End-to-End Encrypted
            </span>
          </div>
        </div>

        {/* ================= RIGHT CONTENT AREA ================= */}
        <div className="flex-1 flex flex-col overflow-hidden bg-slate-900">
          {/* Header Bar */}
          <div className="p-4 border-b border-slate-800/80 flex items-center justify-between bg-slate-900/90 backdrop-blur-xs">
            <div>
              <h3 className="text-sm font-bold text-white capitalize flex items-center gap-2">
                {activeTab} Settings
              </h3>
              <p className="text-[11px] text-slate-400">
                {navItems.find((n) => n.id === activeTab)?.desc}
              </p>
            </div>
            <button
              id="settings-modal-close-btn"
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
              title="Close Settings"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Content Pane */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
            {/* ================= PROFILE TAB ================= */}
            {activeTab === 'profile' && (
              <form onSubmit={handleProfileSave} className="space-y-5 max-w-xl">
                {/* Avatar Section */}
                <div className="flex items-center space-x-4 p-4 rounded-2xl bg-slate-950/50 border border-slate-800/80">
                  <div className="relative group">
                    <Avatar
                      name={displayName || user?.username || 'User'}
                      avatarUrl={avatarUrl}
                      size="lg"
                    />
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="absolute inset-0 rounded-full bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity text-white"
                      title="Upload Avatar Image"
                    >
                      <Camera className="w-5 h-5" />
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleAvatarFileChange}
                      className="hidden"
                    />
                  </div>

                  <div className="flex-1 space-y-1">
                    <h4 className="text-xs font-semibold text-slate-200">Profile Picture</h4>
                    <p className="text-[11px] text-slate-400">
                      Upload a square image (PNG, JPG, max 2MB) or specify an image URL below.
                    </p>
                    <div className="flex gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="px-2.5 py-1 text-xs rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium transition-colors cursor-pointer"
                      >
                        Upload Photo
                      </button>
                      {avatarUrl && (
                        <button
                          type="button"
                          onClick={async () => {
                            setAvatarUrl('');
                            try {
                              await updateUserProfile({ avatarUrl: '' });
                            } catch (_) {}
                          }}
                          className="px-2.5 py-1 text-xs rounded-lg text-rose-400 hover:bg-rose-950/20 transition-colors cursor-pointer"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                    <div className="pt-2">
                      <input
                        type="url"
                        value={avatarUrl.startsWith('data:') ? '(Uploaded Image File)' : avatarUrl}
                        onChange={(e) => setAvatarUrl(e.target.value)}
                        placeholder="Paste image URL (e.g. https://...)"
                        className="w-full px-3 py-1.5 text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-200 placeholder-slate-500 focus:outline-hidden focus:border-violet-500"
                      />
                    </div>
                  </div>
                </div>

                {/* Display Name */}
                <div>
                  <label className="block text-xs font-semibold text-slate-200 mb-1.5">
                    Display Name
                  </label>
                  <input
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="e.g. Alex Morgan"
                    maxLength={50}
                    required
                    className="w-full px-3.5 py-2 text-xs bg-slate-950 border border-slate-800 rounded-xl text-slate-100 placeholder-slate-500 focus:outline-hidden focus:border-violet-500 focus:ring-1 focus:ring-violet-500/30 transition-all"
                  />
                  <p className="text-[11px] text-slate-500 mt-1">
                    This is the name other contacts will see in chats and conversation lists.
                  </p>
                </div>

                {/* Username (Read Only with Copy) */}
                <div>
                  <label className="block text-xs font-semibold text-slate-200 mb-1.5">
                    Username (Unique Handle)
                  </label>
                  <div className="flex items-center space-x-2">
                    <div className="flex-1 px-3.5 py-2 text-xs bg-slate-950/60 border border-slate-800/80 rounded-xl text-slate-400 font-mono flex items-center justify-between">
                      <span>@{user?.username}</span>
                      <span className="text-[10px] text-slate-500">Permanent handle</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleCopy(user?.username || '', 'username')}
                      className="px-3 py-2 text-xs font-medium rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 flex items-center space-x-1.5 transition-colors"
                    >
                      {copiedUsername ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copiedUsername ? 'Copied' : 'Copy'}</span>
                    </button>
                  </div>
                </div>

                {/* About / Bio */}
                <div>
                  <label className="block text-xs font-semibold text-slate-200 mb-1.5">
                    About / Bio
                  </label>
                  <textarea
                    rows={2}
                    value={about}
                    onChange={(e) => setAbout(e.target.value)}
                    placeholder="Hey there! I am using YChat."
                    maxLength={140}
                    className="w-full px-3.5 py-2 text-xs bg-slate-950 border border-slate-800 rounded-xl text-slate-100 placeholder-slate-500 focus:outline-hidden focus:border-violet-500 focus:ring-1 focus:ring-violet-500/30 transition-all"
                  />
                  <div className="flex justify-between text-[11px] text-slate-500 mt-0.5">
                    <span>A brief status displayed to your conversation partners.</span>
                    <span>{about.length}/140</span>
                  </div>
                </div>

                {/* Chat Background / Wallpaper URL */}
                <div>
                  <label className="block text-xs font-semibold text-slate-200 mb-1.5">
                    Chat Background Image / Wallpaper URL
                  </label>
                  <p className="text-[11px] text-slate-400 mb-2">
                    Set a personal wallpaper URL or upload a custom image. It syncs to your profile and applies to all chats.
                  </p>
                  <div className="flex gap-2 items-center mb-2">
                    <input
                      type="url"
                      value={backgroundImageUrl.startsWith('data:') ? '(Uploaded Image File)' : backgroundImageUrl}
                      onChange={(e) => setBackgroundImageUrl(e.target.value)}
                      placeholder="Paste image URL (e.g. https://images.unsplash.com/...)"
                      className="flex-1 px-3.5 py-2 text-xs bg-slate-950 border border-slate-800 rounded-xl text-slate-100 placeholder-slate-500 focus:outline-hidden focus:border-violet-500 focus:ring-1 focus:ring-violet-500/30 transition-all"
                    />
                    <button
                      type="button"
                      onClick={() => profileBackgroundFileRef.current?.click()}
                      className="px-3 py-2 text-xs font-medium rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 flex items-center space-x-1.5 transition-colors cursor-pointer shrink-0"
                    >
                      <ImageIcon className="w-3.5 h-3.5" />
                      <span>Upload</span>
                    </button>
                    <input
                      ref={profileBackgroundFileRef}
                      type="file"
                      accept="image/*"
                      onChange={handleProfileBackgroundFileChange}
                      className="hidden"
                    />
                    {backgroundImageUrl && (
                      <button
                        type="button"
                        onClick={async () => {
                          setBackgroundImageUrl('');
                          setCustomWallpaperInput('');
                          updateSettings({ chatWallpaper: 'default', customWallpaperUrl: '' });
                          try {
                            await updateUserProfile({ backgroundImage: '' });
                          } catch (_) {}
                        }}
                        className="px-2.5 py-2 text-xs font-medium rounded-xl text-rose-400 hover:bg-rose-950/20 transition-colors cursor-pointer shrink-0"
                        title="Remove Wallpaper"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  {backgroundImageUrl && (
                    <div className="flex items-center space-x-3 p-2 rounded-xl bg-slate-950/60 border border-slate-800/80">
                      <img
                        src={backgroundImageUrl}
                        alt="Background Preview"
                        className="w-16 h-10 rounded-lg object-cover border border-slate-700 shadow-xs"
                      />
                      <span className="text-[11px] text-emerald-400 font-medium">
                        Background preview active
                      </span>
                    </div>
                  )}
                </div>

                {/* User UUID for Safety / Verification */}
                <div>
                  <label className="block text-xs font-semibold text-slate-200 mb-1.5">
                    Cryptographic User UUID
                  </label>
                  <div className="flex items-center space-x-2">
                    <span className="flex-1 px-3 py-1.5 bg-slate-950/60 border border-slate-800/80 rounded-xl text-[11px] font-mono text-slate-400 truncate">
                      {user?.uuid}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleCopy(user?.uuid || '', 'uuid')}
                      className="p-2 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-xl"
                      title="Copy User UUID"
                    >
                      {copiedUuid ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Feedback */}
                {profileError && <p className="text-xs text-rose-400">{profileError}</p>}
                {profileSuccess && (
                  <p className="text-xs text-emerald-400 flex items-center gap-1.5">
                    <CheckCheck className="w-4 h-4" /> Profile updated successfully
                  </p>
                )}

                <div className="flex justify-end pt-2">
                  <button
                    type="submit"
                    disabled={isSavingProfile}
                    className="px-5 py-2 rounded-xl text-xs font-semibold bg-violet-600 hover:bg-violet-500 text-white shadow-md shadow-violet-600/30 transition-all flex items-center space-x-2 disabled:opacity-50"
                  >
                    {isSavingProfile && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    <span>Save Changes</span>
                  </button>
                </div>
              </form>
            )}

            {/* ================= MESSAGES TAB ================= */}
            {activeTab === 'messages' && (
              <div className="space-y-6 max-w-2xl">
                {/* Section Header */}
                <div className="border-b border-slate-800 pb-3">
                  <h3 className="text-sm font-bold text-white flex items-center space-x-2">
                    <MessageSquare className="w-4 h-4 text-violet-400" />
                    <span>Message Storage & Appearance</span>
                  </h3>
                  <p className="text-xs text-slate-400 mt-1">
                    Manage offline encrypted storage retention periods, visual bubble themes, and delivery preferences.
                  </p>
                </div>

                {/* 1. Offline Encrypted Retention Period */}
                <div className="p-4 rounded-2xl bg-slate-950/60 border border-slate-800 space-y-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <label className="text-xs font-bold text-slate-200 flex items-center space-x-2">
                        <HardDrive className="w-3.5 h-3.5 text-violet-400" />
                        <span>Offline Encrypted Retention Period</span>
                      </label>
                      <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                        Undelivered messages are encrypted with <strong>AES-256-GCM</strong> before writing to local IndexedDB. Choose how long messages are retained offline before expiring.
                      </p>
                    </div>
                    <span className="px-2 py-0.5 rounded-md text-[10px] font-mono bg-violet-950/60 border border-violet-800/40 text-violet-300 shrink-0">
                      AES-256-GCM
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
                    {[
                      { value: 15, label: '15 Minutes', badge: 'Ephemeral' },
                      { value: 60, label: '1 Hour' },
                      { value: 360, label: '6 Hours' },
                      { value: 720, label: '12 Hours' },
                      { value: 1440, label: '24 Hours', badge: 'Recommended' },
                      { value: 4320, label: '3 Days' },
                      { value: 10080, label: '7 Days' }
                    ].map((opt) => {
                      const isSelected = (settings.offlineRetentionMinutes || 1440) === opt.value;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          id={`retention-opt-${opt.value}`}
                          onClick={() => {
                            updateSettings({ offlineRetentionMinutes: opt.value as RetentionPeriodOption });
                          }}
                          className={`p-2.5 rounded-xl border text-left flex flex-col justify-between transition-all cursor-pointer ${
                            isSelected
                              ? 'bg-violet-950/40 border-violet-500 text-white ring-1 ring-violet-500 shadow-xs'
                              : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                          }`}
                        >
                          <div className="flex items-center justify-between w-full">
                            <span className="text-xs font-semibold">{opt.label}</span>
                            {isSelected && <Check className="w-3.5 h-3.5 text-violet-400" />}
                          </div>
                          {opt.badge && (
                            <span className="mt-1 text-[9px] font-medium text-violet-300">
                              {opt.badge}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>

                  {/* Auto-Retry Toggle */}
                  <div className="pt-3 border-t border-slate-800/60 flex items-center justify-between">
                    <div>
                      <span className="text-xs font-semibold text-slate-200 block">
                        Auto-Retry Failed Messages
                      </span>
                      <span className="text-[11px] text-slate-400">
                        Automatically attempt re-transmission when network connection is restored.
                      </span>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        id="setting-auto-retry"
                        checked={settings.autoRetryFailedMessages ?? true}
                        onChange={(e) => updateSettings({ autoRetryFailedMessages: e.target.checked })}
                        className="sr-only peer"
                      />
                      <div className="w-9 h-5 bg-slate-800 peer-focus:outline-hidden rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-violet-600"></div>
                    </label>
                  </div>

                  {/* Enter to Send Toggle */}
                  <div className="pt-3 border-t border-slate-800/60 flex items-center justify-between">
                    <div>
                      <span className="text-xs font-semibold text-slate-200 block">
                        Press Enter to Send
                      </span>
                      <span className="text-[11px] text-slate-400">
                        Use Enter to transmit messages and Shift+Enter for new lines.
                      </span>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        id="setting-enter-to-send"
                        checked={settings.enterToSend ?? true}
                        onChange={(e) => updateSettings({ enterToSend: e.target.checked })}
                        className="sr-only peer"
                      />
                      <div className="w-9 h-5 bg-slate-800 peer-focus:outline-hidden rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-violet-600"></div>
                    </label>
                  </div>
                </div>

                {/* 2. Message Appearance Themes */}
                <div className="p-4 rounded-2xl bg-slate-950/60 border border-slate-800 space-y-4">
                  <div>
                    <label className="text-xs font-bold text-slate-200 flex items-center space-x-2">
                      <Palette className="w-3.5 h-3.5 text-violet-400" />
                      <span>Message Appearance Style</span>
                    </label>
                    <p className="text-[11px] text-slate-400 mt-1">
                      Choose how your outgoing and incoming message bubbles are styled.
                    </p>
                  </div>

                  {/* Theme Style Mode Switcher */}
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { id: 'solid' as MessageThemeStyle, label: 'Solid Color', desc: 'Classic clean tint' },
                      { id: 'gradient' as MessageThemeStyle, label: 'Dual Gradient', desc: 'Smooth dual-tone' },
                      { id: 'theme' as MessageThemeStyle, label: 'Obsidian Theme', desc: 'Deep signature look' }
                    ].map((mode) => {
                      const isSelected = (settings.messageThemeStyle || 'solid') === mode.id;
                      return (
                        <button
                          key={mode.id}
                          type="button"
                          id={`msg-theme-mode-${mode.id}`}
                          onClick={() => updateSettings({ messageThemeStyle: mode.id })}
                          className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                            isSelected
                              ? 'bg-violet-950/40 border-violet-500 text-white ring-1 ring-violet-500 shadow-xs'
                              : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                          }`}
                        >
                          <div className="text-xs font-bold text-slate-100 flex items-center justify-between">
                            <span>{mode.label}</span>
                            {isSelected && <Check className="w-3.5 h-3.5 text-violet-400" />}
                          </div>
                          <span className="text-[10px] text-slate-400 mt-0.5 block">{mode.desc}</span>
                        </button>
                      );
                    })}
                  </div>

                  {/* Gradient Presets (shown if gradient or as option) */}
                  {settings.messageThemeStyle === 'gradient' && (
                    <div className="pt-2 space-y-2">
                      <label className="text-xs font-bold text-slate-300">
                        Gradient Palette
                      </label>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {[
                          { id: 'violet-indigo' as MessageGradientType, label: 'Violet & Indigo', classes: 'from-violet-600 to-indigo-700' },
                          { id: 'cyan-blue' as MessageGradientType, label: 'Cyan & Blue', classes: 'from-cyan-500 to-blue-600' },
                          { id: 'emerald-teal' as MessageGradientType, label: 'Emerald & Teal', classes: 'from-emerald-500 to-teal-700' },
                          { id: 'rose-pink' as MessageGradientType, label: 'Rose & Pink', classes: 'from-rose-500 to-pink-600' },
                          { id: 'amber-orange' as MessageGradientType, label: 'Amber & Orange', classes: 'from-amber-500 to-orange-600' }
                        ].map((grad) => {
                          const isSelected = (settings.messageGradient || 'violet-indigo') === grad.id;
                          return (
                            <button
                              key={grad.id}
                              type="button"
                              id={`gradient-preset-${grad.id}`}
                              onClick={() => updateSettings({ messageGradient: grad.id })}
                              className={`p-2 rounded-xl border flex items-center space-x-2 transition-all cursor-pointer ${
                                isSelected
                                  ? 'bg-slate-800/90 border-violet-500 ring-1 ring-violet-500 text-white'
                                  : 'bg-slate-900/50 border-slate-800 text-slate-300 hover:bg-slate-800/50'
                              }`}
                            >
                              <div className={`w-5 h-5 rounded-lg bg-gradient-to-br ${grad.classes} shrink-0 shadow-xs`} />
                              <span className="text-xs font-medium truncate">{grad.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Bubble Color (Solid Mode) */}
                  {settings.messageThemeStyle === 'solid' && (
                    <div className="pt-2 space-y-2">
                      <label className="text-xs font-bold text-slate-300">
                        Bubble Tint
                      </label>
                      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                        {bubbleOptions.map((opt) => {
                          const isSelected = (settings.bubbleColor || 'violet') === opt.id;
                          return (
                            <button
                              key={opt.id}
                              type="button"
                              id={`bubble-color-opt-${opt.id}`}
                              onClick={() => updateSettings({ bubbleColor: opt.id })}
                              className={`p-2 rounded-xl border flex flex-col items-center justify-center space-y-1.5 transition-all cursor-pointer ${
                                isSelected
                                  ? 'bg-slate-800 border-violet-500 ring-1 ring-violet-500 shadow-xs'
                                  : 'bg-slate-900/50 border-slate-800 hover:bg-slate-800/40'
                              }`}
                            >
                              <div className={`w-5 h-5 rounded-full ${opt.class} shadow-sm`} />
                              <span className="text-[10px] text-slate-300 font-medium">{opt.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Incoming Bubble Style */}
                  <div className="pt-2 space-y-2">
                    <label className="text-xs font-bold text-slate-300">
                      Incoming Bubble Style
                    </label>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {[
                        { id: 'default' as IncomingMessageStyle, label: 'Charcoal' },
                        { id: 'slate' as IncomingMessageStyle, label: 'Deep Slate' },
                        { id: 'high-contrast' as IncomingMessageStyle, label: 'High Contrast' },
                        { id: 'subdued' as IncomingMessageStyle, label: 'Subdued' }
                      ].map((inc) => {
                        const isSelected = (settings.incomingBubbleStyle || 'default') === inc.id;
                        return (
                          <button
                            key={inc.id}
                            type="button"
                            id={`incoming-bubble-opt-${inc.id}`}
                            onClick={() => updateSettings({ incomingBubbleStyle: inc.id })}
                            className={`p-2 rounded-xl border text-center text-xs font-semibold transition-all cursor-pointer ${
                              isSelected
                                ? 'bg-violet-950/40 border-violet-500 text-white ring-1 ring-violet-500'
                                : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:text-slate-200'
                            }`}
                          >
                            {inc.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Live Interactive Bubble Preview */}
                  <div className="pt-3 border-t border-slate-800/60 space-y-2">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                      Live Preview
                    </span>
                    <div className="p-4 rounded-xl bg-slate-950 border border-slate-800/80 space-y-2.5">
                      {/* Simulated incoming bubble */}
                      <div className="flex justify-start">
                        <div
                          className={`rounded-2xl rounded-bl-xs px-3.5 py-2 text-xs max-w-[80%] ${
                            settings.incomingBubbleStyle === 'high-contrast'
                              ? 'bg-slate-950 border-2 border-slate-600 text-white'
                              : settings.incomingBubbleStyle === 'subdued'
                              ? 'bg-slate-800/60 border border-slate-700/40 text-slate-300'
                              : settings.incomingBubbleStyle === 'slate'
                              ? 'bg-slate-900 border border-slate-800 text-slate-200'
                              : 'bg-slate-800 border border-slate-700/60 text-slate-100'
                          }`}
                        >
                          <span>Hey there! How is the encrypted offline queue functioning?</span>
                          <div className="text-[10px] text-slate-400 text-right mt-1">10:42 AM</div>
                        </div>
                      </div>

                      {/* Simulated outgoing bubble */}
                      <div className="flex justify-end">
                        <div
                          className={`rounded-2xl rounded-br-xs px-3.5 py-2 text-xs max-w-[80%] shadow-sm ${
                            settings.messageThemeStyle === 'gradient'
                              ? settings.messageGradient === 'cyan-blue'
                                ? 'bg-gradient-to-br from-cyan-500 to-blue-600 text-white'
                                : settings.messageGradient === 'emerald-teal'
                                ? 'bg-gradient-to-br from-emerald-500 to-teal-700 text-white'
                                : settings.messageGradient === 'rose-pink'
                                ? 'bg-gradient-to-br from-rose-500 to-pink-600 text-white'
                                : settings.messageGradient === 'amber-orange'
                                ? 'bg-gradient-to-br from-amber-500 to-orange-600 text-slate-950 font-medium'
                                : 'bg-gradient-to-br from-violet-600 to-indigo-700 text-white'
                              : settings.messageThemeStyle === 'theme'
                              ? 'bg-gradient-to-br from-slate-900 to-violet-950 border border-violet-500/40 text-violet-100'
                              : settings.bubbleColor === 'indigo'
                              ? 'bg-indigo-600 text-white'
                              : settings.bubbleColor === 'emerald'
                              ? 'bg-emerald-600 text-white'
                              : settings.bubbleColor === 'cyan'
                              ? 'bg-cyan-600 text-white'
                              : settings.bubbleColor === 'rose'
                              ? 'bg-rose-600 text-white'
                              : settings.bubbleColor === 'amber'
                              ? 'bg-amber-500 text-slate-950 font-medium'
                              : settings.bubbleColor === 'slate'
                              ? 'bg-slate-700 text-white'
                              : settings.bubbleColor === 'midnight'
                              ? 'bg-slate-950 border border-slate-700 text-slate-100'
                              : 'bg-violet-600 text-white'
                          }`}
                        >
                          <span>Undelivered messages are protected with AES-256-GCM encryption before writing to disk.</span>
                          <div className="flex items-center justify-end space-x-1 text-[10px] mt-1 opacity-90">
                            <span>10:43 AM</span>
                            <CheckCheck className="w-3.5 h-3.5 text-cyan-400 drop-shadow-[0_0_4px_rgba(34,211,238,0.8)]" />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Cloud persistence notification */}
                  <div className="flex items-center space-x-2 text-[11px] text-emerald-400 pt-1">
                    <CheckCheck className="w-4 h-4" />
                    <span>Preferences automatically synced to secure profile API.</span>
                  </div>
                </div>
              </div>
            )}

            {/* ================= PRIVACY TAB ================= */}
            {activeTab === 'privacy' && (
              <div className="space-y-4 max-w-xl">
                {/* Read Receipts */}
                <div className="p-4 rounded-2xl bg-slate-950/60 border border-slate-800/80 flex items-center justify-between">
                  <div>
                    <span className="text-xs font-semibold text-slate-200">Read Receipts (Double Checkmarks)</span>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      Send blue double-check confirmations when you view incoming messages.
                    </p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settings.readReceiptsEnabled}
                      onChange={(e) => updateSettings({ readReceiptsEnabled: e.target.checked })}
                      className="sr-only peer"
                    />
                    <div className="w-10 h-5 bg-slate-800 peer-focus:outline-hidden rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-violet-600"></div>
                  </label>
                </div>

                {/* Online & Last Seen Status */}
                <div className="p-4 rounded-2xl bg-slate-950/60 border border-slate-800/80 flex items-center justify-between">
                  <div>
                    <span className="text-xs font-semibold text-slate-200">Online & Last Seen Visibility</span>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      Allow active chat partners to see your real-time online status and when you were last active.
                    </p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settings.lastSeenVisibility}
                      onChange={(e) => updateSettings({ lastSeenVisibility: e.target.checked })}
                      className="sr-only peer"
                    />
                    <div className="w-10 h-5 bg-slate-800 peer-focus:outline-hidden rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-violet-600"></div>
                  </label>
                </div>

                {/* Incognito Ephemeral Storage */}
                <div className="p-4 rounded-2xl bg-slate-950/60 border border-slate-800/80 flex items-center justify-between">
                  <div>
                    <span className="text-xs font-semibold text-slate-200">Default Incognito Mode</span>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      Automatically prefer RAM-only ephemeral storage for new conversations (wipes on tab close).
                    </p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settings.defaultIncognito}
                      onChange={(e) => updateSettings({ defaultIncognito: e.target.checked })}
                      className="sr-only peer"
                    />
                    <div className="w-10 h-5 bg-slate-800 peer-focus:outline-hidden rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-violet-600"></div>
                  </label>
                </div>

                {/* Blocked Users Section */}
                <div className="p-4 rounded-2xl bg-slate-950/60 border border-slate-800/80 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-xs font-semibold text-slate-200">Blocked Contacts</span>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        Blocked accounts cannot message you or see your online presence.
                      </p>
                    </div>
                    <span className="text-xs text-slate-500 font-mono">{blockedUsers.length} blocked</span>
                  </div>

                  {/* Block by username input */}
                  <div className="flex gap-2 pt-1">
                    <input
                      type="text"
                      value={blockUsernameInput}
                      onChange={(e) => setBlockUsernameInput(e.target.value)}
                      placeholder="Username to block (e.g. charlie)"
                      className="flex-1 px-3.5 py-1.5 text-xs bg-slate-900 border border-slate-800 rounded-xl text-slate-200 placeholder-slate-500 focus:outline-hidden focus:border-violet-500"
                    />
                    <button
                      type="button"
                      onClick={handleBlockUser}
                      disabled={isBlocking || !blockUsernameInput.trim()}
                      className="px-4 py-1.5 text-xs font-semibold bg-rose-600/80 hover:bg-rose-600 text-white rounded-xl transition-colors disabled:opacity-50 flex items-center space-x-1"
                    >
                      {isBlocking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <span>Block</span>}
                    </button>
                  </div>

                  {/* Blocked List */}
                  {blockedUsers.length === 0 ? (
                    <p className="text-[11px] text-slate-500 italic py-1">No contacts currently blocked.</p>
                  ) : (
                    <div className="space-y-2 pt-2">
                      {blockedUsers.map((u) => (
                        <div
                          key={u.uuid}
                          className="flex items-center justify-between p-2.5 rounded-xl bg-slate-900/90 border border-slate-800 text-xs"
                        >
                          <div className="flex items-center space-x-2.5">
                            <Avatar name={u.displayName || u.username} avatarUrl={u.avatarUrl} size="sm" />
                            <div>
                              <div className="font-semibold text-slate-200">{u.displayName}</div>
                              <div className="text-[10px] text-slate-500 font-mono">@{u.username}</div>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => unblockUser(u.uuid)}
                            className="px-2.5 py-1 text-xs text-violet-400 hover:text-violet-300 hover:bg-violet-950/30 rounded-lg transition-colors"
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
              <div className="space-y-4 max-w-xl">
                {/* Sound Alerts */}
                <div className="p-4 rounded-2xl bg-slate-950/60 border border-slate-800/80 flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    {settings.soundEnabled ? (
                      <Volume2 className="w-5 h-5 text-violet-400" />
                    ) : (
                      <VolumeX className="w-5 h-5 text-slate-500" />
                    )}
                    <div>
                      <span className="text-xs font-semibold text-slate-200">Message Audio Chimes</span>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        Play sound notifications on incoming messages and delivery receipts.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-3">
                    <button
                      type="button"
                      onClick={() => playNotificationChime()}
                      className="px-2.5 py-1 text-[11px] rounded-lg bg-slate-800 hover:bg-slate-700 text-violet-300 font-medium flex items-center space-x-1"
                      title="Play test chime"
                    >
                      <Play className="w-3 h-3" />
                      <span>Test</span>
                    </button>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={settings.soundEnabled}
                        onChange={(e) => updateSettings({ soundEnabled: e.target.checked })}
                        className="sr-only peer"
                      />
                      <div className="w-10 h-5 bg-slate-800 peer-focus:outline-hidden rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-violet-600"></div>
                    </label>
                  </div>
                </div>

                {/* Desktop Push Notifications */}
                <div className="p-4 rounded-2xl bg-slate-950/60 border border-slate-800/80 flex items-center justify-between">
                  <div>
                    <span className="text-xs font-semibold text-slate-200">System Desktop Notifications</span>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      Receive alerts on your operating system when YChat is running in background.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleRequestDesktopNotifications}
                    className={`px-3.5 py-1.5 text-xs rounded-xl font-semibold transition-colors ${
                      settings.desktopNotificationsEnabled
                        ? 'bg-emerald-600/20 text-emerald-300 border border-emerald-500/30'
                        : 'bg-violet-600 hover:bg-violet-500 text-white shadow-md shadow-violet-600/20'
                    }`}
                  >
                    {settings.desktopNotificationsEnabled ? 'Permission Granted' : 'Enable Desktop Alerts'}
                  </button>
                </div>

                {/* Muted Conversations */}
                <div className="p-4 rounded-2xl bg-slate-950/60 border border-slate-800/80 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-xs font-semibold text-slate-200">Conversation Notification Mutes</span>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        Silence alerts for individual chat threads.
                      </p>
                    </div>
                    <span className="text-[10px] text-slate-500 font-mono">
                      {settings.mutedConversations.length} muted
                    </span>
                  </div>

                  {conversations.length === 0 ? (
                    <p className="text-[11px] text-slate-500 italic py-1">No active conversations.</p>
                  ) : (
                    <div className="space-y-1.5 pt-1">
                      {conversations.map((c) => {
                        const muted = isConversationMuted(c.id);
                        return (
                          <div
                            key={c.id}
                            className="flex items-center justify-between p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-xs"
                          >
                            <div className="flex items-center space-x-2">
                              <span className="font-semibold text-slate-200">{c.recipientDisplayName}</span>
                              <span className="text-[10px] text-slate-500 font-mono">@{c.recipientUsername}</span>
                            </div>
                            <button
                              type="button"
                              onClick={() => toggleMuteConversation(c.id)}
                              className={`px-3 py-1 text-xs rounded-lg font-medium transition-colors ${
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

            {/* ================= APPEARANCE TAB ================= */}
            {activeTab === 'appearance' && (
              <div className="space-y-6 max-w-2xl">
                {/* Theme Selector (YChat Theme, Light Theme, System) */}
                <div>
                  <label className="block text-xs font-bold text-slate-200 mb-2">
                    Application Color Theme
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {/* YChat Theme */}
                    <button
                      type="button"
                      id="theme-select-ychat"
                      onClick={() => {
                        setTheme('ychat');
                        updateSettings({ theme: 'ychat' });
                      }}
                      className={`p-3.5 rounded-2xl border text-left flex flex-col space-y-2 transition-all cursor-pointer ${
                        theme === 'ychat'
                          ? 'bg-violet-950/40 border-violet-500 shadow-md shadow-violet-500/10 text-white ring-1 ring-violet-500'
                          : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="w-8 h-8 rounded-xl bg-[#111224] border border-violet-500/40 flex items-center justify-center text-violet-400">
                          <Sparkles className="w-4 h-4" />
                        </div>
                        {theme === 'ychat' && <Check className="w-4 h-4 text-violet-400" />}
                      </div>
                      <div>
                        <div className="text-xs font-bold text-slate-100">YChat Theme</div>
                        <div className="text-[11px] text-slate-400 mt-0.5">
                          Signature dark theme with deep violet & indigo surfaces
                        </div>
                      </div>
                    </button>

                    {/* Light Theme */}
                    <button
                      type="button"
                      id="theme-select-light"
                      onClick={() => {
                        setTheme('light');
                        updateSettings({ theme: 'light' });
                      }}
                      className={`p-3.5 rounded-2xl border text-left flex flex-col space-y-2 transition-all cursor-pointer ${
                        theme === 'light'
                          ? 'bg-violet-950/40 border-violet-500 shadow-md shadow-violet-500/10 text-white ring-1 ring-violet-500'
                          : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="w-8 h-8 rounded-xl bg-slate-100 border border-slate-300 flex items-center justify-center text-amber-500">
                          <Sun className="w-4 h-4" />
                        </div>
                        {theme === 'light' && <Check className="w-4 h-4 text-violet-400" />}
                      </div>
                      <div>
                        <div className="text-xs font-bold text-slate-100">Light Theme</div>
                        <div className="text-[11px] text-slate-400 mt-0.5">
                          Clean WhatsApp & Telegram inspired high-contrast palette
                        </div>
                      </div>
                    </button>

                    {/* System Theme */}
                    <button
                      type="button"
                      id="theme-select-system"
                      onClick={() => {
                        setTheme('system');
                        updateSettings({ theme: 'system' });
                      }}
                      className={`p-3.5 rounded-2xl border text-left flex flex-col space-y-2 transition-all cursor-pointer ${
                        theme === 'system'
                          ? 'bg-violet-950/40 border-violet-500 shadow-md shadow-violet-500/10 text-white ring-1 ring-violet-500'
                          : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="w-8 h-8 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center text-cyan-400">
                          <Monitor className="w-4 h-4" />
                        </div>
                        {theme === 'system' && <Check className="w-4 h-4 text-violet-400" />}
                      </div>
                      <div>
                        <div className="text-xs font-bold text-slate-100">System Sync</div>
                        <div className="text-[11px] text-slate-400 mt-0.5">
                          Automatically follows your OS dark/light preferences
                        </div>
                      </div>
                    </button>
                  </div>
                </div>

                {/* Chat Bubble Accent Color */}
                <div>
                  <label className="block text-xs font-bold text-slate-200 mb-2">
                    Outgoing Bubble Accent Color
                  </label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                    {bubbleOptions.map((opt) => {
                      const isSelected = settings.bubbleColor === opt.id;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => updateSettings({ bubbleColor: opt.id })}
                          className={`flex items-center space-x-2.5 p-2.5 rounded-xl border transition-all cursor-pointer ${
                            isSelected
                              ? 'bg-slate-800 border-slate-600 text-white shadow-xs'
                              : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          <span
                            className="w-4 h-4 rounded-full flex-shrink-0 shadow-xs"
                            style={{ backgroundColor: opt.hex }}
                          />
                          <span className="text-xs font-medium flex-1 text-left">{opt.label}</span>
                          {isSelected && <Check className="w-3.5 h-3.5 text-violet-400" />}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Chat Area Wallpaper */}
                <div>
                  <label className="block text-xs font-bold text-slate-200 mb-2">
                    Chat Area Wallpaper & Background
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {wallpaperOptions.map((opt) => {
                      const isSelected = settings.chatWallpaper === opt.id;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => updateSettings({ chatWallpaper: opt.id })}
                          className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                            isSelected
                              ? 'bg-violet-950/30 border-violet-500 text-white'
                              : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-slate-200">{opt.label}</span>
                            {isSelected && <Check className="w-3.5 h-3.5 text-violet-400" />}
                          </div>
                          <p className="text-[11px] text-slate-400 mt-0.5">{opt.description}</p>
                        </button>
                      );
                    })}
                  </div>

                  {/* Custom Wallpaper URL Input if 'custom' is selected */}
                  {settings.chatWallpaper === 'custom' && (
                    <div className="mt-3 p-3.5 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-3">
                      <div className="flex items-center justify-between">
                        <label className="block text-xs font-semibold text-slate-200">
                          Custom Wallpaper Image
                        </label>
                        <button
                          type="button"
                          onClick={() => wallpaperFileInputRef.current?.click()}
                          className="px-2.5 py-1 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg transition-colors cursor-pointer"
                        >
                          Upload File
                        </button>
                        <input
                          ref={wallpaperFileInputRef}
                          type="file"
                          accept="image/*"
                          onChange={handleWallpaperFileChange}
                          className="hidden"
                        />
                      </div>

                      <div className="flex gap-2">
                        <input
                          type="url"
                          value={customWallpaperInput.startsWith('data:') ? '(Uploaded Image File)' : customWallpaperInput}
                          onChange={(e) => {
                            setCustomWallpaperInput(e.target.value);
                            updateSettings({ chatWallpaper: 'custom', customWallpaperUrl: e.target.value.trim() });
                          }}
                          placeholder="Paste image URL (e.g. https://images.unsplash.com/...)"
                          className="flex-1 px-3 py-1.5 text-xs bg-slate-900 border border-slate-800 rounded-lg text-slate-200 placeholder-slate-500 focus:outline-hidden focus:border-violet-500"
                        />
                        <button
                          type="button"
                          onClick={async () => {
                            const trimmed = customWallpaperInput.trim();
                            updateSettings({ chatWallpaper: 'custom', customWallpaperUrl: trimmed });
                            setBackgroundImageUrl(trimmed);
                            try {
                              await updateUserProfile({ backgroundImage: trimmed });
                            } catch (_) {}
                          }}
                          className="px-3.5 py-1.5 text-xs font-semibold bg-violet-600 hover:bg-violet-500 text-white rounded-lg transition-colors cursor-pointer"
                        >
                          Apply
                        </button>
                      </div>

                      {settings.customWallpaperUrl && (
                        <div className="flex items-center justify-between pt-1">
                          <div className="flex items-center space-x-2.5">
                            <img
                              src={settings.customWallpaperUrl}
                              alt="Wallpaper Preview"
                              className="w-16 h-10 rounded-lg object-cover border border-slate-700 shadow-sm"
                            />
                            <span className="text-[11px] text-emerald-400 font-medium">
                              Wallpaper active
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setCustomWallpaperInput('');
                              updateSettings({ chatWallpaper: 'default', customWallpaperUrl: '' });
                            }}
                            className="text-xs text-rose-400 hover:underline cursor-pointer"
                          >
                            Remove
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Font Size & Timestamp Format */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Timestamp Format */}
                  <div className="p-3.5 rounded-2xl bg-slate-950/60 border border-slate-800/80 space-y-2">
                    <div className="flex items-center space-x-2">
                      <Clock className="w-4 h-4 text-violet-400" />
                      <span className="text-xs font-semibold text-slate-200">Timestamp Format</span>
                    </div>
                    <div className="grid grid-cols-2 gap-1.5 pt-1">
                      <button
                        type="button"
                        onClick={() => updateSettings({ timestampFormat: 'absolute' })}
                        className={`py-1.5 px-2 text-xs rounded-lg font-medium transition-colors ${
                          settings.timestampFormat === 'absolute'
                            ? 'bg-violet-600 text-white'
                            : 'bg-slate-900 text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        Absolute (10:45 AM)
                      </button>
                      <button
                        type="button"
                        onClick={() => updateSettings({ timestampFormat: 'relative' })}
                        className={`py-1.5 px-2 text-xs rounded-lg font-medium transition-colors ${
                          settings.timestampFormat === 'relative'
                            ? 'bg-violet-600 text-white'
                            : 'bg-slate-900 text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        Relative (2m ago)
                      </button>
                    </div>
                  </div>

                  {/* Font Size */}
                  <div className="p-3.5 rounded-2xl bg-slate-950/60 border border-slate-800/80 space-y-2">
                    <div className="flex items-center space-x-2">
                      <Type className="w-4 h-4 text-violet-400" />
                      <span className="text-xs font-semibold text-slate-200">Chat Text Size</span>
                    </div>
                    <div className="grid grid-cols-3 gap-1.5 pt-1">
                      {(['small', 'medium', 'large'] as FontSize[]).map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => updateSettings({ fontSize: s })}
                          className={`py-1.5 px-2 text-xs rounded-lg font-medium capitalize transition-colors ${
                            (settings.fontSize || 'medium') === s
                              ? 'bg-violet-600 text-white'
                              : 'bg-slate-900 text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ================= SECURITY TAB ================= */}
            {activeTab === 'security' && (
              <div className="space-y-4 max-w-xl">
                {/* Security Audit Diagnostic */}
                <div className="p-4 rounded-2xl bg-violet-950/20 border border-violet-500/30 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <div className="w-9 h-9 rounded-xl bg-violet-900/50 border border-violet-500/40 flex items-center justify-center text-violet-300">
                        <ShieldCheck className="w-5 h-5" />
                      </div>
                      <div>
                        <h4 className="text-xs font-bold text-white">Cryptographic Security Verification</h4>
                        <p className="text-[11px] text-slate-400">
                          Verify zero-knowledge proof, post-quantum ratchet keys, and safety numbers.
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowSecurityAudit(true)}
                      className="px-3.5 py-1.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold shadow-md transition-colors"
                    >
                      Audit Session
                    </button>
                  </div>
                </div>

                {/* Linked Devices */}
                <div className="p-4 rounded-2xl bg-slate-950/60 border border-slate-800/80 flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <Smartphone className="w-5 h-5 text-cyan-400" />
                    <div>
                      <span className="text-xs font-semibold text-slate-200">Linked Device Management</span>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        Current active device: <span className="font-mono text-slate-300">{deviceId || 'Web Client'}</span>
                      </p>
                    </div>
                  </div>
                  {onOpenDevices && (
                    <button
                      type="button"
                      onClick={onOpenDevices}
                      className="px-3 py-1.5 text-xs rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium transition-colors"
                    >
                      Manage Devices
                    </button>
                  )}
                </div>

                {/* At-Rest Storage */}
                <div className="p-4 rounded-2xl bg-slate-950/60 border border-slate-800/80 space-y-1.5">
                  <div className="flex items-center space-x-2 text-xs font-semibold text-emerald-400">
                    <Lock className="w-4 h-4" />
                    <span>At-Rest Storage Encryption Active (AES-256-GCM)</span>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Local messages, cryptographic sessions, and ratchet chains stored in your browser
                    are secured using authenticated AES-256-GCM encryption with local WebCrypto key derivation.
                  </p>
                </div>
              </div>
            )}

            {/* ================= ACCOUNT TAB ================= */}
            {activeTab === 'account' && (
              <div className="space-y-6 max-w-xl">
                {/* Change Password Form */}
                <div className="p-4 rounded-2xl bg-slate-950/60 border border-slate-800/80 space-y-3">
                  <div className="flex items-center space-x-2">
                    <Lock className="w-4 h-4 text-violet-400" />
                    <span className="text-xs font-bold text-slate-200">Change Account Password</span>
                  </div>
                  <p className="text-[11px] text-slate-400">
                    Update your account credentials. Securely re-hashed with memory-hard Argon2id.
                  </p>

                  <form onSubmit={handlePasswordSubmit} className="space-y-3 pt-1">
                    <div>
                      <label className="block text-[11px] font-medium text-slate-300 mb-1">
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

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[11px] font-medium text-slate-300 mb-1">
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
                        <label className="block text-[11px] font-medium text-slate-300 mb-1">
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

                    {passwordError && <p className="text-xs text-rose-400">{passwordError}</p>}
                    {passwordSuccess && (
                      <p className="text-xs text-emerald-400 flex items-center gap-1">
                        <Check className="w-3.5 h-3.5" /> Password updated successfully
                      </p>
                    )}

                    <div className="flex justify-end pt-1">
                      <button
                        type="submit"
                        disabled={isChangingPassword}
                        className="px-4 py-1.5 text-xs font-semibold bg-violet-600 hover:bg-violet-500 text-white rounded-lg transition-colors disabled:opacity-50 flex items-center space-x-1.5"
                      >
                        {isChangingPassword && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                        <span>Update Password</span>
                      </button>
                    </div>
                  </form>
                </div>

                {/* Danger Zone: Delete Account */}
                <div className="p-4 rounded-2xl bg-rose-950/20 border border-rose-900/40 space-y-3">
                  <div className="flex items-center space-x-2 text-rose-400">
                    <AlertTriangle className="w-4 h-4" />
                    <span className="text-xs font-bold">Danger Zone: Delete Account</span>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Permanently revokes all cryptographic key bundles, wipes your user record,
                    and deletes your account from the authentication service.
                  </p>

                  <form onSubmit={handleDeleteAccountSubmit} className="space-y-2.5 pt-1">
                    <div>
                      <label className="block text-[11px] text-slate-300 mb-1">
                        Type your username <span className="font-mono text-rose-400 font-bold">"{user?.username}"</span> to confirm:
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
                        className="px-4 py-1.5 text-xs font-semibold bg-rose-600 hover:bg-rose-500 text-white rounded-lg transition-colors disabled:opacity-40 flex items-center space-x-1.5 cursor-pointer shadow-md"
                      >
                        {isDeletingAccount ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="w-3.5 h-3.5" />
                        )}
                        <span>Delete Account Permanently</span>
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            )}
          </div>

          {/* Modal Bottom Footer */}
          <div className="p-3.5 border-t border-slate-800/80 bg-slate-900/90 flex items-center justify-between">
            <span className="text-[11px] text-slate-500 font-mono">
              Signed in as: <strong className="text-slate-300">{user?.displayName || user?.username}</strong>
            </span>
            <button
              onClick={onClose}
              className="px-4 py-1.5 text-xs font-semibold text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-xl transition-colors cursor-pointer"
            >
              Done
            </button>
          </div>
        </div>
      </div>

      {showSecurityAudit && (
        <SecurityAuditModal onClose={() => setShowSecurityAudit(false)} />
      )}
    </div>
  );
};
