import React, { useState, useEffect } from 'react';
import { useChat } from '../context/ChatContext';
import {
  X,
  Search,
  UserPlus,
  QrCode,
  Key,
  Copy,
  Check,
  RefreshCw,
  Clock,
  Shield,
  ArrowRight,
  AlertCircle,
  Binary
} from 'lucide-react';
import QRCode from 'qrcode';
import { ClientInviteService } from '../crypto/inviteCodeService';

interface NewChatModalProps {
  onClose: () => void;
}

type TabType = 'search' | 'my-invite' | 'enter-code';

export const NewChatModal: React.FC<NewChatModalProps> = ({ onClose }) => {
  const { token, user, deviceKeys, startConversationWithUser } = useChat();
  const [activeTab, setActiveTab] = useState<TabType>('search');

  // Tab 1: Username Search
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchPerformed, setSearchPerformed] = useState(false);
  const [starting, setStarting] = useState(false);

  // Tab 2: My Invite QR & Short Code
  const [myInvite, setMyInvite] = useState<{
    token: string;
    pairingCode: string;
    formattedCode?: string;
    expiresAt: string;
    entropyBits?: number;
    qrPayload: string;
  } | null>(null);
  const [myQrUrl, setMyQrUrl] = useState<string | null>(null);
  const [generatingInvite, setGeneratingInvite] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

  // Tab 3: Resolve & Accept Code/QR
  const [codeInput, setCodeInput] = useState('');
  const [resolving, setResolving] = useState(false);
  const [resolvedCreator, setResolvedCreator] = useState<{
    inviteId: string;
    creator: { uuid: string; username: string; displayName: string };
    expiresAt: string;
    entropyBits?: number;
  } | null>(null);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);

  // Handle Search by Username
  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim() || !token) return;

    setSearching(true);
    setSearchPerformed(true);
    try {
      const res = await fetch(`/api/v1/users/search?username=${encodeURIComponent(query.trim())}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setResults(data.users || []);
      } else {
        setResults([]);
      }
    } catch (err) {
      console.error('Search failed:', err);
      setResults([]);
    } finally {
      setSearching(false);
    }
  };

  const handleStartChat = async (targetUser: any) => {
    setStarting(true);
    try {
      await startConversationWithUser(targetUser.uuid, targetUser.username, targetUser.displayName);
      onClose();
    } catch (err: any) {
      alert(`Could not start chat: ${err.message}`);
    } finally {
      setStarting(false);
    }
  };

  // Generate My Invite
  const handleGenerateMyInvite = async () => {
    if (!token) return;
    setGeneratingInvite(true);
    try {
      const res = await fetch('/api/v1/invites/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          deviceId: deviceKeys?.deviceId,
          ttlMinutes: 15
        })
      });

      if (res.ok) {
        const data = await res.json();
        setMyInvite(data);

        // Generate real ISO/IEC 18004 QR code
        const qrUrl = await QRCode.toDataURL(data.qrPayload, {
          errorCorrectionLevel: 'H',
          margin: 1,
          width: 280,
          color: { dark: '#000000', light: '#FFFFFF' }
        });
        setMyQrUrl(qrUrl);
      }
    } catch (err) {
      console.error('Invite generation error:', err);
    } finally {
      setGeneratingInvite(false);
    }
  };

  // Load invite on switching to 'my-invite' tab
  useEffect(() => {
    if (activeTab === 'my-invite' && !myInvite) {
      handleGenerateMyInvite();
    }
  }, [activeTab]);

  const handleCopyPairingCode = () => {
    if (!myInvite) return;
    const textToCopy = myInvite.formattedCode || myInvite.pairingCode;
    navigator.clipboard.writeText(textToCopy);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  // Resolve invite
  const handleResolveInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!codeInput.trim() || !token) return;

    setResolving(true);
    setResolveError(null);
    setResolvedCreator(null);

    // Validate on client before submitting
    const validation = ClientInviteService.validate(codeInput.trim());
    if (!validation.isValid && !codeInput.trim().startsWith('ychat:invite?')) {
      setResolveError(validation.error || 'Invalid 60-bit code format');
      setResolving(false);
      return;
    }

    try {
      const res = await fetch('/api/v1/invites/resolve', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ codeOrToken: codeInput.trim() })
      });

      const data = await res.json();
      if (!res.ok) {
        setResolveError(data.error || 'Failed to verify invite code');
      } else {
        setResolvedCreator(data);
      }
    } catch (err: any) {
      setResolveError(err.message || 'Network error verifying invite code');
    } finally {
      setResolving(false);
    }
  };

  // Accept invite
  const handleAcceptInvite = async () => {
    if (!resolvedCreator || !token) return;
    setAccepting(true);
    try {
      const res = await fetch('/api/v1/invites/accept', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ inviteId: resolvedCreator.inviteId })
      });

      const data = await res.json();
      if (!res.ok) {
        alert(`Error: ${data.error || 'Could not accept invite'}`);
        return;
      }

      await startConversationWithUser(
        data.creator.uuid,
        data.creator.username,
        data.creator.displayName
      );
      onClose();
    } catch (err: any) {
      alert(`Accept failed: ${err.message}`);
    } finally {
      setAccepting(false);
    }
  };

  return (
    <div
      id="new-chat-modal-backdrop"
      className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
    >
      <div
        id="new-chat-modal-card"
        className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
      >
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-800 flex items-center justify-between bg-slate-950/40">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-violet-600/20 text-violet-400 border border-violet-800/40 flex items-center justify-center">
              <UserPlus className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white tracking-tight">Add Contact / New Chat</h3>
              <p className="text-xs text-slate-400">Search by username, share invite QR, or enter pairing code</p>
            </div>
          </div>
          <button
            id="close-new-chat-btn"
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Selector */}
        <div className="flex border-b border-slate-800 bg-slate-950/30 px-4 pt-2 gap-2">
          <button
            id="tab-search-username-btn"
            onClick={() => setActiveTab('search')}
            className={`flex items-center space-x-2 px-3 py-2 text-xs font-semibold border-b-2 transition-all ${
              activeTab === 'search'
                ? 'border-violet-500 text-violet-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Search className="w-3.5 h-3.5" />
            <span>Search Username</span>
          </button>

          <button
            id="tab-my-invite-btn"
            onClick={() => setActiveTab('my-invite')}
            className={`flex items-center space-x-2 px-3 py-2 text-xs font-semibold border-b-2 transition-all ${
              activeTab === 'my-invite'
                ? 'border-violet-500 text-violet-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <QrCode className="w-3.5 h-3.5" />
            <span>My Invite QR & Code</span>
          </button>

          <button
            id="tab-enter-code-btn"
            onClick={() => setActiveTab('enter-code')}
            className={`flex items-center space-x-2 px-3 py-2 text-xs font-semibold border-b-2 transition-all ${
              activeTab === 'enter-code'
                ? 'border-violet-500 text-violet-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Key className="w-3.5 h-3.5" />
            <span>Join via 60-Bit Code/QR</span>
          </button>
        </div>

        {/* Tab Content */}
        <div className="p-4 sm:p-5 overflow-y-auto flex-1">
          {/* TAB 1: Search by Username */}
          {activeTab === 'search' && (
            <div className="space-y-4">
              <form onSubmit={handleSearch} className="flex gap-2">
                <div className="relative flex-1">
                  <span className="absolute left-3.5 top-2.5 text-slate-500 font-mono text-sm">@</span>
                  <input
                    id="search-username-input"
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Enter exact username..."
                    className="w-full pl-8 pr-4 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-violet-500 transition-colors"
                  />
                </div>
                <button
                  id="search-user-submit-btn"
                  type="submit"
                  disabled={searching || !query.trim()}
                  className="px-4 py-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-xs font-semibold rounded-xl transition-colors flex items-center space-x-1.5 shadow-sm"
                >
                  {searching ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Search className="w-3.5 h-3.5" />
                  )}
                  <span>Search</span>
                </button>
              </form>

              <div className="space-y-2">
                {results.length > 0 && (
                  <div className="space-y-2">
                    <span className="text-[11px] text-slate-400 font-semibold uppercase tracking-wider">
                      User Match
                    </span>
                    {results.map((u) => (
                      <div
                        key={u.uuid}
                        className="p-3 bg-slate-950/60 border border-slate-800 rounded-2xl flex items-center justify-between hover:border-violet-800/40 transition-colors"
                      >
                        <div className="flex items-center space-x-3">
                          <div className="w-10 h-10 rounded-full bg-violet-600/20 text-violet-300 font-bold text-sm flex items-center justify-center border border-violet-700/50">
                            {u.displayName[0].toUpperCase()}
                          </div>
                          <div>
                            <h4 className="text-xs font-bold text-white">{u.displayName}</h4>
                            <p className="text-[11px] text-slate-400 font-mono">@{u.username}</p>
                          </div>
                        </div>

                        <button
                          id={`start-chat-with-${u.username}-btn`}
                          onClick={() => handleStartChat(u)}
                          disabled={starting}
                          className="px-3.5 py-1.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-xs font-semibold rounded-xl transition-colors flex items-center space-x-1.5 shadow-sm"
                        >
                          <UserPlus className="w-3.5 h-3.5" />
                          <span>Start Chat</span>
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {searchPerformed && results.length === 0 && !searching && (
                  <div className="text-center py-8 text-slate-400 text-xs space-y-1">
                    <p className="font-semibold text-slate-300">No User Found</p>
                    <p className="text-[11px] text-slate-500">
                      No user found matching &quot;@{query}&quot;. Verify the spelling or use a QR invite code.
                    </p>
                  </div>
                )}

                {!searchPerformed && (
                  <div className="p-4 rounded-2xl bg-slate-950/40 border border-slate-800/80 text-xs text-slate-400 space-y-2">
                    <div className="flex items-center space-x-2 text-violet-300 font-semibold">
                      <Shield className="w-4 h-4" />
                      <span>Privacy-First Discovery</span>
                    </div>
                    <p className="text-[11px] leading-relaxed text-slate-400">
                      YChat never suggests contacts, scrapes your address book, or lists global users. Only exact username matches or cryptographic invite codes are allowed.
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 2: My Secure Invite QR & Short Pairing Code */}
          {activeTab === 'my-invite' && (
            <div className="flex flex-col items-center text-center space-y-4">
              <div className="p-3 bg-white rounded-2xl shadow-xl inline-block border-4 border-violet-500/20">
                {myQrUrl ? (
                  <img
                    id="my-invite-qr-image"
                    src={myQrUrl}
                    alt="Secure YChat User Invite QR"
                    className="w-48 h-48 sm:w-56 sm:h-56 object-contain rounded-lg"
                  />
                ) : (
                  <div className="w-48 h-48 sm:w-56 sm:h-56 flex items-center justify-center bg-slate-100 text-slate-400 text-xs">
                    Generating Invite QR...
                  </div>
                )}
              </div>

              {myInvite && (
                <div className="w-full bg-slate-950/60 p-3.5 rounded-2xl border border-slate-800 space-y-2">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-slate-400 font-semibold uppercase tracking-wider">
                      60-Bit Random Pairing Code
                    </span>
                    <span className="px-2 py-0.5 rounded-full bg-violet-950 text-violet-300 border border-violet-800/60 font-mono text-[10px]">
                      60 bits entropy
                    </span>
                  </div>
                  <div className="flex items-center justify-center space-x-2">
                    <span
                      id="my-pairing-code-display"
                      className="text-lg sm:text-xl font-mono font-extrabold tracking-widest text-violet-300 bg-slate-900 px-4 py-1.5 rounded-xl border border-violet-800/60"
                    >
                      {myInvite.formattedCode || myInvite.pairingCode}
                    </span>
                    <button
                      id="copy-my-pairing-code-btn"
                      onClick={handleCopyPairingCode}
                      className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors"
                      title="Copy code"
                    >
                      {copiedCode ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                    </button>
                  </div>
                  <div className="flex items-center justify-center space-x-1.5 text-[11px] text-slate-400 pt-1">
                    <Clock className="w-3 h-3 text-amber-400" />
                    <span>Expires in 15 minutes • Single-use & Rate-limited</span>
                  </div>
                </div>
              )}

              <button
                id="refresh-invite-code-btn"
                onClick={handleGenerateMyInvite}
                disabled={generatingInvite}
                className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${generatingInvite ? 'animate-spin' : ''}`} />
                <span>Generate Fresh Code & QR</span>
              </button>
            </div>
          )}

          {/* TAB 3: Enter Friend's Code or Scan QR */}
          {activeTab === 'enter-code' && (
            <div className="space-y-4">
              <form onSubmit={handleResolveInvite} className="space-y-3">
                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1">
                    Enter 60-Bit Pairing Code or Paste Scanned Invite URI
                  </label>
                  <input
                    id="join-code-input"
                    type="text"
                    value={codeInput}
                    onChange={(e) => setCodeInput(e.target.value)}
                    placeholder="e.g. 9W4K-2H7M-QP5Z or ychat:invite?v=1..."
                    className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-violet-500 font-mono transition-colors"
                  />
                  <span className="text-[10px] text-slate-500 block mt-1">
                    Accepts 60-bit alphanumeric code (e.g. XXXX-XXXX-XXXX), legacy tokens, or QR URI
                  </span>
                </div>

                <button
                  id="resolve-invite-code-btn"
                  type="submit"
                  disabled={resolving || !codeInput.trim()}
                  className="w-full py-2.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-xs font-semibold rounded-xl transition-colors flex items-center justify-center space-x-1.5 shadow-sm"
                >
                  {resolving ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Key className="w-3.5 h-3.5" />
                  )}
                  <span>Verify 60-Bit Invite Code</span>
                </button>
              </form>

              {resolveError && (
                <div className="p-3 bg-rose-950/40 border border-rose-800/80 rounded-2xl flex items-center space-x-2 text-xs text-rose-300">
                  <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />
                  <span>{resolveError}</span>
                </div>
              )}

              {resolvedCreator && (
                <div
                  id="resolved-creator-card"
                  className="p-4 bg-slate-950/60 border border-violet-800/40 rounded-2xl space-y-3"
                >
                  <div className="flex items-center space-x-3">
                    <div className="w-12 h-12 rounded-full bg-violet-600/20 text-violet-300 font-bold text-base flex items-center justify-center border border-violet-700/50">
                      {resolvedCreator.creator.displayName[0].toUpperCase()}
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-white">{resolvedCreator.creator.displayName}</h4>
                      <p className="text-xs text-slate-400 font-mono">@{resolvedCreator.creator.username}</p>
                      <span className="text-[10px] text-slate-500 font-mono">UUID: {resolvedCreator.creator.uuid.slice(0, 12)}...</span>
                    </div>
                  </div>

                  <div className="p-2.5 rounded-xl bg-emerald-950/30 border border-emerald-800/40 text-[11px] text-emerald-300 flex items-center space-x-2">
                    <Shield className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                    <span>Cryptographic 60-bit invite verified! Single-use code is valid.</span>
                  </div>

                  <button
                    id="accept-invite-btn"
                    onClick={handleAcceptInvite}
                    disabled={accepting}
                    className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-semibold rounded-xl transition-colors flex items-center justify-center space-x-1.5 shadow-sm"
                  >
                    {accepting ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <ArrowRight className="w-3.5 h-3.5" />
                    )}
                    <span>Accept Invite & Start Secure Chat</span>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
