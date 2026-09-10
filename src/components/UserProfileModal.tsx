import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Camera,
  Laptop,
  Smartphone,
  Shield,
  ShieldCheck,
  Trash2,
  Copy,
  Check,
  Loader2,
  Key,
  Calendar,
  AlertCircle
} from 'lucide-react';
import { useChat } from '../context/ChatContext';
import { Avatar } from './Avatar';
import { SafetyNumberModal } from './SafetyNumberModal';

interface UserProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface UserDevice {
  id: string;
  userId: string;
  deviceName: string;
  platform: 'web' | 'desktop' | 'android' | 'ios';
  createdAt: string;
  lastSeen?: string;
}

export const UserProfileModal: React.FC<UserProfileModalProps> = ({ isOpen, onClose }) => {
  const { user, token, deviceId, updateUserProfile, revokeDevice, activeConversation } = useChat();
  const [activeTab, setActiveTab] = useState<'profile' | 'devices' | 'security'>('profile');

  // Form fields
  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [about, setAbout] = useState(user?.about || 'Available on GhostChat');
  const [avatarUrl, setAvatarUrl] = useState(user?.avatarUrl || '');
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [copiedUuid, setCopiedUuid] = useState(false);
  const [devices, setDevices] = useState<UserDevice[]>([]);
  const [isLoadingDevices, setIsLoadingDevices] = useState(false);
  const [revokingDeviceId, setRevokingDeviceId] = useState<string | null>(null);
  const [showSafetyModal, setShowSafetyModal] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Sync state with user context on open
  useEffect(() => {
    if (user) {
      setDisplayName(user.displayName || '');
      setAbout(user.about || 'Available on GhostChat');
      setAvatarUrl(user.avatarUrl || '');
    }
  }, [user, isOpen]);

  // Load user's devices
  const loadDevices = async () => {
    if (!token) return;
    setIsLoadingDevices(true);
    try {
      const res = await fetch('/api/v1/devices', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setDevices(data.devices || []);
      }
    } catch (err) {
      console.error('Failed to load devices:', err);
    } finally {
      setIsLoadingDevices(false);
    }
  };

  useEffect(() => {
    if (isOpen && (activeTab === 'devices' || activeTab === 'profile')) {
      loadDevices();
    }
  }, [isOpen, activeTab, token]);

  if (!isOpen) return null;

  const handleAvatarFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      alert('Avatar image size must be under 2MB');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      setAvatarUrl(dataUrl);
    };
    reader.readAsDataURL(file);
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      await updateUserProfile({
        displayName: displayName.trim(),
        about: about.trim(),
        avatarUrl
      });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2500);
    } catch (err: any) {
      alert(err.message || 'Failed to update profile');
    } finally {
      setIsSaving(false);
    }
  };

  const handleRevokeDevice = async (targetDeviceId: string) => {
    if (targetDeviceId === deviceId) {
      if (!confirm('This is your current device. Revoking it will end your current session. Continue?')) {
        return;
      }
    } else {
      if (!confirm('Are you sure you want to revoke this device? It will be disconnected immediately.')) {
        return;
      }
    }

    setRevokingDeviceId(targetDeviceId);
    try {
      await revokeDevice(targetDeviceId);
      setDevices(prev => prev.filter(d => d.id !== targetDeviceId));
    } catch (err: any) {
      alert(err.message || 'Failed to revoke device');
    } finally {
      setRevokingDeviceId(null);
    }
  };

  const handleCopyUuid = () => {
    if (user?.uuid) {
      navigator.clipboard.writeText(user.uuid);
      setCopiedUuid(true);
      setTimeout(() => setCopiedUuid(false), 2000);
    }
  };

  const getPlatformIcon = (platform: string) => {
    switch (platform) {
      case 'android':
      case 'ios':
        return <Smartphone className="w-4 h-4 text-violet-400" />;
      default:
        return <Laptop className="w-4 h-4 text-cyan-400" />;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
      <div
        id="user-profile-modal"
        className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in zoom-in-95 duration-150"
      >
        {/* Header */}
        <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/80">
          <div className="flex items-center gap-2.5">
            <Avatar name={user?.displayName || user?.username || 'User'} avatarUrl={avatarUrl} size="sm" />
            <div>
              <h2 className="text-sm font-semibold text-slate-100">User Profile & Identity</h2>
              <p className="text-xs text-slate-400">Manage your profile and linked devices</p>
            </div>
          </div>
          <button
            id="profile-modal-close-btn"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-md transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-slate-800 bg-slate-950/40 px-4">
          <button
            id="profile-tab-profile"
            onClick={() => setActiveTab('profile')}
            className={`py-2.5 px-3 text-xs font-medium border-b-2 transition-colors ${
              activeTab === 'profile'
                ? 'border-violet-500 text-violet-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            Profile Info
          </button>
          <button
            id="profile-tab-devices"
            onClick={() => setActiveTab('devices')}
            className={`py-2.5 px-3 text-xs font-medium border-b-2 transition-colors flex items-center gap-1.5 ${
              activeTab === 'devices'
                ? 'border-violet-500 text-violet-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            Linked Devices
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-slate-800 text-slate-300">
              {devices.length}
            </span>
          </button>
          <button
            id="profile-tab-security"
            onClick={() => setActiveTab('security')}
            className={`py-2.5 px-3 text-xs font-medium border-b-2 transition-colors flex items-center gap-1.5 ${
              activeTab === 'security'
                ? 'border-violet-500 text-violet-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            Security & Keys
          </button>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-5">
          {activeTab === 'profile' && (
            <form onSubmit={handleSaveProfile} className="space-y-4">
              {/* Avatar Upload Area */}
              <div className="flex flex-col items-center justify-center p-3 bg-slate-950/40 border border-slate-800/80 rounded-xl">
                <div className="relative group">
                  <Avatar
                    name={displayName || user?.username || 'User'}
                    avatarUrl={avatarUrl}
                    size="2xl"
                    className="ring-4 ring-slate-800"
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="absolute inset-0 rounded-full bg-black/50 text-white flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer backdrop-blur-2xs"
                  >
                    <Camera className="w-5 h-5 mb-0.5" />
                    <span className="text-[10px] font-medium">Upload</span>
                  </button>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleAvatarFileChange}
                  className="hidden"
                />
                <div className="mt-2 text-center">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="text-xs text-violet-400 hover:text-violet-300 font-medium"
                  >
                    Change photo
                  </button>
                  {avatarUrl && (
                    <button
                      type="button"
                      onClick={() => setAvatarUrl('')}
                      className="text-xs text-rose-400 hover:text-rose-300 ml-3"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>

              {/* Display Name */}
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Display Name
                </label>
                <input
                  id="profile-display-name-input"
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Your display name"
                  maxLength={50}
                  className="w-full px-3 py-2 text-sm bg-slate-950 border border-slate-800 rounded-lg text-slate-100 placeholder-slate-500 focus:outline-hidden focus:border-violet-500"
                />
              </div>

              {/* Username (Read-only, UUID-backed) */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium text-slate-300">
                    Username & Unique ID
                  </label>
                  <span className="text-[10px] text-slate-500">Read-only (Permanent)</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 px-3 py-2 text-sm bg-slate-950/60 border border-slate-800/80 rounded-lg text-slate-400 font-mono text-xs truncate">
                    @{user?.username}{' '}
                    <span className="text-slate-600">({user?.uuid.slice(0, 10)}...)</span>
                  </div>
                  <button
                    type="button"
                    onClick={handleCopyUuid}
                    title="Copy full User UUID"
                    className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors flex-shrink-0"
                  >
                    {copiedUuid ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Status / About */}
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Status / About
                </label>
                <textarea
                  id="profile-about-input"
                  value={about}
                  onChange={(e) => setAbout(e.target.value)}
                  rows={2}
                  maxLength={120}
                  placeholder="e.g. Exploring quantum cryptography"
                  className="w-full px-3 py-2 text-sm bg-slate-950 border border-slate-800 rounded-lg text-slate-100 placeholder-slate-500 focus:outline-hidden focus:border-violet-500 resize-none"
                />
                {/* Status Presets */}
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {['Available', 'In a meeting', 'Encrypted only', 'Stealth mode'].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setAbout(preset)}
                      className="px-2 py-1 text-[11px] rounded-md bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition-colors"
                    >
                      {preset}
                    </button>
                  ))}
                </div>
              </div>

              {/* Action buttons */}
              <div className="pt-2 flex items-center justify-end gap-2">
                {saveSuccess && (
                  <span className="text-xs text-emerald-400 flex items-center gap-1 mr-auto">
                    <Check className="w-3.5 h-3.5" /> Profile updated successfully
                  </span>
                )}
                <button
                  type="submit"
                  disabled={isSaving}
                  id="profile-save-btn"
                  className="px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium transition-colors disabled:opacity-50 flex items-center gap-1.5 shadow-sm"
                >
                  {isSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Save Changes
                </button>
              </div>
            </form>
          )}

          {activeTab === 'devices' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <h3 className="text-xs font-semibold text-slate-200">Registered Devices</h3>
                  <p className="text-[11px] text-slate-400">
                    Devices holding cryptographic prekeys for end-to-end encryption.
                  </p>
                </div>
                <button
                  onClick={loadDevices}
                  className="text-xs text-violet-400 hover:text-violet-300 font-medium"
                >
                  Refresh
                </button>
              </div>

              {isLoadingDevices ? (
                <div className="py-8 flex justify-center text-slate-500">
                  <Loader2 className="w-5 h-5 animate-spin" />
                </div>
              ) : devices.length === 0 ? (
                <div className="p-4 text-center text-xs text-slate-500 bg-slate-950/40 rounded-xl border border-slate-800">
                  No devices found.
                </div>
              ) : (
                devices.map((d) => {
                  const isCurrent = d.id === deviceId;
                  return (
                    <div
                      key={d.id}
                      id={`device-item-${d.id}`}
                      className={`p-3 rounded-xl border flex items-center justify-between gap-3 ${
                        isCurrent
                          ? 'bg-violet-950/20 border-violet-500/30'
                          : 'bg-slate-950/60 border-slate-800/80'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="p-2 rounded-lg bg-slate-900 border border-slate-800 flex-shrink-0">
                          {getPlatformIcon(d.platform)}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium text-slate-200 truncate">
                              {d.deviceName}
                            </span>
                            {isCurrent && (
                              <span className="px-1.5 py-0.5 rounded-xs text-[9px] bg-violet-600/30 text-violet-300 border border-violet-500/40 font-semibold">
                                This Device
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 text-[10px] text-slate-500 font-mono mt-0.5">
                            <span>ID: {d.id.slice(0, 16)}...</span>
                            <span>•</span>
                            <span className="capitalize">{d.platform}</span>
                            <span>•</span>
                            <span>
                              {new Date(d.createdAt).toLocaleDateString(undefined, {
                                month: 'short',
                                day: 'numeric'
                              })}
                            </span>
                          </div>
                        </div>
                      </div>

                      <button
                        onClick={() => handleRevokeDevice(d.id)}
                        disabled={revokingDeviceId === d.id}
                        title="Revoke Device"
                        className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-slate-800 rounded-md transition-colors flex-shrink-0 disabled:opacity-50"
                      >
                        {revokingDeviceId === d.id ? (
                          <Loader2 className="w-4 h-4 animate-spin text-rose-400" />
                        ) : (
                          <Trash2 className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {activeTab === 'security' && (
            <div className="space-y-4">
              {/* Identity & Keys overview */}
              <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800 space-y-2">
                <div className="flex items-center gap-2">
                  <Key className="w-4 h-4 text-violet-400" />
                  <span className="text-xs font-semibold text-slate-200">
                    Post-Quantum Cryptographic Suite
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Your identity uses hybrid X25519 + ML-KEM-1024 key encapsulation combined with
                  Ed25519 + ML-DSA-87 digital signatures for quantum-resistant communications.
                </p>
                <div className="pt-1 flex items-center gap-2 text-[10px] font-mono text-emerald-400">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>NIST FIPS 203 & 204 Approved Algorithms</span>
                </div>
              </div>

              {/* Safety Number Verifier */}
              <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Shield className="w-4 h-4 text-cyan-400" />
                    <span className="text-xs font-semibold text-slate-200">
                      Safety Number Verification
                    </span>
                  </div>
                  {activeConversation ? (
                    <button
                      onClick={() => setShowSafetyModal(true)}
                      className="text-xs text-violet-400 hover:text-violet-300 font-medium"
                    >
                      Open Verifier
                    </button>
                  ) : (
                    <span className="text-[10px] text-slate-500">Select chat to verify</span>
                  )}
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Verify the cryptographic fingerprint of your contacts to ensure no
                  man-in-the-middle attack is present on the communications channel.
                </p>
                {activeConversation && (
                  <div className="p-2 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-between text-xs">
                    <span className="text-slate-300">
                      Active: @{activeConversation.recipientUsername}
                    </span>
                    <span
                      className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                        activeConversation.isVerifiedSafetyNumber
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                          : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                      }`}
                    >
                      {activeConversation.isVerifiedSafetyNumber ? 'Verified' : 'Unverified'}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-slate-800 bg-slate-900/60 flex items-center justify-between">
          <span className="text-[10px] text-slate-500">
            Device ID: {deviceId || 'None'}
          </span>
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs text-slate-300 hover:text-slate-100 hover:bg-slate-800 rounded-lg transition-colors"
          >
            Close
          </button>
        </div>
      </div>

      {showSafetyModal && (
        <SafetyNumberModal onClose={() => setShowSafetyModal(false)} />
      )}
    </div>
  );
};
