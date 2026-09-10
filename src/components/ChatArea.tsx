import React, { useState, useRef, useEffect } from 'react';
import { useChat } from '../context/ChatContext';
import {
  Send,
  Lock,
  ShieldCheck,
  ShieldAlert,
  Check,
  CheckCheck,
  Clock,
  CloudOff,
  Sparkles
} from 'lucide-react';
import { DeliveryStatus } from '../crypto/types';
import { Avatar } from './Avatar';
import { BubbleColor } from '../types/settings';

interface ChatAreaProps {
  onOpenSafetyNumber: () => void;
}

export const ChatArea: React.FC<ChatAreaProps> = ({ onOpenSafetyNumber }) => {
  const {
    activeConversation,
    messages,
    sendMessage,
    user,
    settings,
    markMessagesAsRead
  } = useChat();

  const [inputText, setInputText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [localTimestampOverride, setLocalTimestampOverride] = useState<Record<string, boolean>>({});
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
    if (activeConversation) {
      markMessagesAsRead(activeConversation.id);
    }
  }, [messages, activeConversation?.id, markMessagesAsRead]);

  if (!activeConversation) {
    return (
      <main className="flex-1 flex flex-col items-center justify-center p-8 bg-slate-950 text-center select-none">
        <div className="w-16 h-16 rounded-2xl bg-violet-950/40 border border-violet-800/40 flex items-center justify-center mb-4 text-violet-400 shadow-xl shadow-violet-950/20">
          <Lock className="w-8 h-8" />
        </div>
        <h2 className="text-xl font-bold text-white mb-2">Private Post-Quantum Messaging</h2>
        <p className="text-xs text-slate-400 max-w-sm mb-6 leading-relaxed">
          Select a conversation from the sidebar or start a new encrypted chat. All messages are encrypted directly on your device with ML-KEM-1024 and ChaCha20-Poly1305. The server never sees plaintext.
        </p>
        <div className="flex flex-wrap gap-2 justify-center max-w-md">
          <div className="flex items-center space-x-1.5 px-3 py-1 rounded-full bg-slate-900 border border-slate-800 text-[11px] text-slate-300">
            <Sparkles className="w-3.5 h-3.5 text-violet-400" />
            <span>Hybrid X25519 + ML-KEM-1024</span>
          </div>
          <div className="flex items-center space-x-1.5 px-3 py-1 rounded-full bg-slate-900 border border-slate-800 text-[11px] text-slate-300">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            <span>BLAKE3 Tamper-Evident Chain</span>
          </div>
        </div>
      </main>
    );
  }

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = inputText.trim();
    if (!text || isSending) return;

    try {
      setIsSending(true);
      setInputText('');
      await sendMessage(text);
    } catch (err: any) {
      console.error('Send error:', err);
      alert(`Message error: ${err.message || 'Failed to dispatch encrypted message'}`);
    } finally {
      setIsSending(false);
    }
  };

  const getSenderBubbleGradient = (color: BubbleColor) => {
    switch (color) {
      case 'indigo':
        return 'bg-gradient-to-br from-indigo-600 to-indigo-700 text-white';
      case 'emerald':
        return 'bg-gradient-to-br from-emerald-600 to-emerald-700 text-white';
      case 'cyan':
        return 'bg-gradient-to-br from-cyan-600 to-cyan-700 text-white';
      case 'rose':
        return 'bg-gradient-to-br from-rose-600 to-rose-700 text-white';
      case 'amber':
        return 'bg-gradient-to-br from-amber-600 to-amber-700 text-slate-950 font-medium';
      case 'violet':
      default:
        return 'bg-gradient-to-br from-violet-600 to-violet-700 text-white';
    }
  };

  const formatMessageTimestamp = (msgId: string, timestamp: number) => {
    const isOverridden = localTimestampOverride[msgId];
    // Invert format if user clicked this timestamp
    const useRelative = isOverridden
      ? settings.timestampFormat === 'absolute'
      : settings.timestampFormat === 'relative';

    if (useRelative) {
      const diff = Math.floor((Date.now() - timestamp) / 1000);
      if (diff < 60) return 'Just now';
      if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
      if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
      return `${Math.floor(diff / 86400)}d ago`;
    }

    return new Date(timestamp).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const toggleTimestampFormat = (msgId: string) => {
    setLocalTimestampOverride((prev) => ({
      ...prev,
      [msgId]: !prev[msgId]
    }));
  };

  const renderStatusIcon = (status: DeliveryStatus) => {
    switch (status) {
      case 'queued_offline':
        return (
          <span
            className="flex items-center space-x-0.5 text-amber-400 text-[10px]"
            title="Queued locally in IndexedDB (device is offline)"
          >
            <CloudOff className="w-3 h-3" />
          </span>
        );
      case 'sending':
        return (
          <span title="Encrypting & dispatching">
            <Clock className="w-3 h-3 text-slate-400 animate-spin" />
          </span>
        );
      case 'sent':
        return (
          <span title="Sent to server envelope relay" className="text-slate-400">
            <Check className="w-3 h-3" />
          </span>
        );
      case 'delivered':
        return (
          <span title="Delivered to peer recipient device" className="text-slate-300">
            <CheckCheck className="w-3.5 h-3.5" />
          </span>
        );
      case 'read':
        return (
          <span title="Read by recipient" className="text-cyan-300 flex items-center">
            <CheckCheck className="w-3.5 h-3.5 drop-shadow-[0_0_4px_rgba(6,182,212,0.6)]" />
          </span>
        );
      default:
        return null;
    }
  };

  // Wallpaper styling
  const getWallpaperClasses = () => {
    switch (settings.chatWallpaper) {
      case 'subtle-grid':
        return 'bg-[linear-gradient(to_right,#1e293b_1px,transparent_1px),linear-gradient(to_bottom,#1e293b_1px,transparent_1px)] bg-[size:24px_24px]';
      case 'dots':
        return 'bg-[radial-gradient(#334155_1px,transparent_1px)] [background-size:16px_16px]';
      case 'minimal':
        return 'bg-slate-950';
      case 'default':
      default:
        return 'bg-slate-950/95';
    }
  };

  return (
    <main className="flex-1 flex flex-col h-full bg-slate-950 overflow-hidden relative">
      {/* Top Recipient Header */}
      <div className="h-16 px-4 md:px-6 bg-slate-900/80 backdrop-blur-md border-b border-slate-800 flex items-center justify-between z-10">
        <div className="flex items-center space-x-3">
          <Avatar
            name={activeConversation.recipientDisplayName}
            size="md"
            verified={activeConversation.isVerifiedSafetyNumber}
          />
          <div>
            <div className="flex items-center space-x-2">
              <span className="text-sm font-bold text-white">
                {activeConversation.recipientDisplayName}
              </span>
              <span className="text-xs text-slate-400 font-mono">
                @{activeConversation.recipientUsername}
              </span>
            </div>
            <div className="flex items-center space-x-1.5 text-[10px] text-emerald-400">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span>E2EE Active • Ratchet Rekey: 50 msgs / 5 mins</span>
            </div>
          </div>
        </div>

        {/* Safety Number & Verification Button */}
        <div className="flex items-center space-x-2">
          <button
            onClick={onOpenSafetyNumber}
            className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
              activeConversation.isVerifiedSafetyNumber
                ? 'bg-emerald-950/30 text-emerald-300 border-emerald-700/50 hover:bg-emerald-900/40'
                : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700 hover:border-violet-600'
            }`}
            title="Verify Safety Number with peer"
          >
            {activeConversation.isVerifiedSafetyNumber ? (
              <>
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <span className="hidden sm:inline">Safety Verified</span>
              </>
            ) : (
              <>
                <ShieldAlert className="w-4 h-4 text-amber-400" />
                <span className="hidden sm:inline">Verify Safety</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Message History Container */}
      <div className={`flex-1 overflow-y-auto p-4 md:p-6 space-y-3 ${getWallpaperClasses()}`}>
        {/* Encryption Banner */}
        <div className="mx-auto max-w-md p-3 rounded-xl bg-violet-950/20 border border-violet-900/30 text-center text-xs text-violet-300/80 space-y-1">
          <div className="flex items-center justify-center space-x-1.5 text-violet-300 font-medium">
            <Lock className="w-3.5 h-3.5" />
            <span>End-to-End Encrypted Session</span>
          </div>
          <p className="text-[11px] text-slate-400">
            Messages are post-quantum encrypted with ML-KEM-1024, signed with ML-DSA-87, and chained with BLAKE3. No server or intermediate party can read them.
          </p>
        </div>

        {messages.map((msg) => {
          const isSender = msg.senderUserUuid === user?.uuid;
          const msgKey = msg.clientMessageId || msg.id;
          return (
            <div
              key={msgKey}
              id={`chat-bubble-${msgKey}`}
              className={`flex flex-col ${isSender ? 'items-end' : 'items-start'}`}
            >
              <div
                className={`max-w-[85%] md:max-w-[70%] rounded-2xl px-4 py-2.5 shadow-sm text-sm break-words relative transition-all ${
                  isSender
                    ? `${getSenderBubbleGradient(settings.bubbleColor)} rounded-br-xs`
                    : 'bg-slate-800 border border-slate-700/60 text-slate-100 rounded-bl-xs'
                }`}
              >
                <div className="leading-relaxed whitespace-pre-wrap">{msg.text}</div>
                <div
                  className={`mt-1 flex items-center justify-end space-x-1 text-[10px] select-none ${
                    isSender ? 'opacity-90' : 'text-slate-400'
                  }`}
                >
                  {msg.tamperVerified && (
                    <span title="BLAKE3 hash chain verified">
                      <Lock className="w-2.5 h-2.5 inline mr-0.5 opacity-70" />
                    </span>
                  )}
                  {/* Clickable timestamp to toggle absolute / relative */}
                  <span
                    onClick={() => toggleTimestampFormat(msgKey)}
                    className="cursor-pointer hover:underline opacity-80"
                    title="Click to toggle timestamp format"
                  >
                    {formatMessageTimestamp(msgKey, msg.timestamp)}
                  </span>
                  {isSender && renderStatusIcon(msg.status)}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Message Form */}
      <div className="p-3 md:p-4 bg-slate-900 border-t border-slate-800">
        <form onSubmit={handleSend} className="flex items-center space-x-2">
          <input
            id="chat-message-input"
            type="text"
            placeholder={`Message ${activeConversation.recipientDisplayName} (E2EE Encrypted)...`}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            disabled={isSending}
            className="flex-1 px-4 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 text-sm focus:outline-hidden focus:border-violet-500 transition-colors placeholder:text-slate-500 disabled:opacity-50"
          />
          <button
            id="chat-send-btn"
            type="submit"
            disabled={!inputText.trim() || isSending}
            className="p-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:hover:bg-violet-600 text-white transition-all shadow-md shadow-violet-600/20 cursor-pointer"
            title="Send encrypted message"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
        <div className="mt-1.5 flex items-center justify-between text-[10px] text-slate-500 px-1">
          <span className="flex items-center space-x-1">
            <Lock className="w-3 h-3 text-violet-400" />
            <span>Client Encrypted • Zero Plaintext Storage</span>
          </span>
          <span>Press Enter to Send</span>
        </div>
      </div>
    </main>
  );
};
