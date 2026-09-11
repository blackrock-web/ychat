import React, { useState, useRef, useEffect, useCallback } from 'react';
import { AnimatePresence } from 'framer-motion';
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
  Sparkles,
  Paperclip,
  FileText,
  Download,
  Smile,
  SmilePlus,
  X,
  Search,
  MoreVertical,
  Trash2,
  Bell,
  BellOff,
  Image as ImageIcon,
  ChevronDown
} from 'lucide-react';
import { DeliveryStatus, FileAttachment } from '../crypto/types';
import { Avatar } from './Avatar';
import { BubbleColor } from '../types/settings';
import { EmojiPicker, FAVORITE_EMOJIS } from './EmojiPicker';
import { MessageBubble } from './MessageBubble';

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatLastSeen(lastSeen?: number): string {
  if (!lastSeen) return 'offline';
  const now = Date.now();
  const diffMs = now - lastSeen;
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return 'last seen just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `last seen ${diffMin}m ago`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) {
    const timeStr = new Date(lastSeen).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit'
    });
    return `last seen today at ${timeStr}`;
  }
  const dateStr = new Date(lastSeen).toLocaleDateString([], {
    month: 'short',
    day: 'numeric'
  });
  const timeStr = new Date(lastSeen).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit'
  });
  return `last seen ${dateStr} at ${timeStr}`;
}

interface ChatAreaProps {
  onOpenSafetyNumber: () => void;
}

export const ChatArea: React.FC<ChatAreaProps> = ({ onOpenSafetyNumber }) => {
  const {
    activeConversation,
    messages,
    sendMessage,
    toggleReaction,
    user,
    settings,
    markMessagesAsRead,
    getUserPresence,
    typingMap,
    sendTyping,
    clearChatHistory,
    toggleMuteConversation,
    isConversationMuted,
    retryMessage
  } = useChat();

  const [inputText, setInputText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [selectedAttachment, setSelectedAttachment] = useState<FileAttachment | null>(null);

  // Message reaction picker states
  const [activePickerMsgId, setActivePickerMsgId] = useState<string | null>(null);
  const [expandedPickerMsgId, setExpandedPickerMsgId] = useState<string | null>(null);

  // Input bar emoji picker
  const [showInputEmojiPicker, setShowInputEmojiPicker] = useState(false);

  // Header 3-dots menu
  const [showMenu, setShowMenu] = useState(false);

  // In-chat search state (individual per conversation)
  const [showInChatSearch, setShowInChatSearch] = useState(false);
  const [inChatSearchTerm, setInChatSearchTerm] = useState('');

  // Clear chat confirm dialog
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  // Timestamp format override per bubble
  const [localTimestampOverride, setLocalTimestampOverride] = useState<Record<string, boolean>>({});

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputEmojiPickerRef = useRef<HTMLDivElement>(null);
  const typingTimerRef = useRef<any>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
    if (activeConversation) {
      markMessagesAsRead(activeConversation.id);
    }
  }, [messages, activeConversation?.id, markMessagesAsRead]);

  // Reset in-chat search and menus when active conversation changes
  useEffect(() => {
    setShowInChatSearch(false);
    setInChatSearchTerm('');
    setShowMenu(false);
    setActivePickerMsgId(null);
    setExpandedPickerMsgId(null);
    setShowInputEmojiPicker(false);
    setShowClearConfirm(false);
  }, [activeConversation?.id]);

  // Close menus and pickers on click outside
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (menuRef.current && !menuRef.current.contains(target)) {
        setShowMenu(false);
      }
      if (inputEmojiPickerRef.current && !inputEmojiPickerRef.current.contains(target)) {
        setShowInputEmojiPicker(false);
      }
      if (!target.closest('.reaction-picker-container')) {
        setActivePickerMsgId(null);
        setExpandedPickerMsgId(null);
      }
    };
    window.addEventListener('click', handleOutsideClick);
    return () => window.removeEventListener('click', handleOutsideClick);
  }, []);

  // Handle typing events with debounce
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const text = e.target.value;
    setInputText(text);

    if (!activeConversation) return;

    // Send typing: true
    sendTyping(activeConversation.id, true);

    // Debounce typing: false after 2 seconds
    if (typingTimerRef.current) {
      clearTimeout(typingTimerRef.current);
    }
    typingTimerRef.current = setTimeout(() => {
      if (activeConversation) {
        sendTyping(activeConversation.id, false);
      }
    }, 2000);
  };

  if (!activeConversation) {
    return (
      <main className="flex-1 flex flex-col items-center justify-center p-8 bg-slate-950 text-center select-none">
        <img
          src="/1.jpg"
          alt="YChat Logo"
          className="w-20 h-20 rounded-3xl object-cover mb-5 shadow-2xl shadow-violet-950/40 border border-violet-500/30"
        />
        <h2 className="text-xl font-bold text-white mb-2">YChat Messenger</h2>
        <p className="text-xs text-slate-400 max-w-sm mb-6 leading-relaxed">
          Select a conversation from the sidebar or start a new chat. Your personal messages and media are end-to-end encrypted. No one outside of this chat can read them.
        </p>
        <div className="flex flex-wrap gap-2 justify-center max-w-md">
          <div className="flex items-center space-x-1.5 px-3 py-1.5 rounded-full bg-slate-900 border border-slate-800 text-[11px] text-slate-300">
            <Lock className="w-3.5 h-3.5 text-violet-400" />
            <span>End-to-End Encrypted</span>
          </div>
          <div className="flex items-center space-x-1.5 px-3 py-1.5 rounded-full bg-slate-900 border border-slate-800 text-[11px] text-slate-300">
            <CheckCheck className="w-3.5 h-3.5 text-cyan-400" />
            <span>Real-time Delivery & Read Receipts</span>
          </div>
        </div>
      </main>
    );
  }

  const partnerPresence = getUserPresence(activeConversation.recipientUuid);
  const isPartnerTyping = !!typingMap[activeConversation.id];
  const isMuted = isConversationMuted(activeConversation.id);

  // Presence status text below username
  let presenceText = '';
  let presenceColor = 'text-slate-400';

  if (isPartnerTyping) {
    presenceText = 'typing...';
    presenceColor = 'text-emerald-400 font-medium animate-pulse';
  } else if (partnerPresence.status === 'online') {
    presenceText = 'online';
    presenceColor = 'text-emerald-400 font-medium';
  } else if (partnerPresence.status === 'away') {
    presenceText = 'away';
    presenceColor = 'text-amber-400';
  } else {
    presenceText = formatLastSeen(partnerPresence.lastSeen);
    presenceColor = 'text-slate-400';
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
      alert('File is too large. Maximum size is 10 MB.');
      e.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setSelectedAttachment({
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type || 'application/octet-stream',
        dataUrl: reader.result as string
      });
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = inputText.trim();
    if ((!text && !selectedAttachment) || isSending) return;

    if (typingTimerRef.current) {
      clearTimeout(typingTimerRef.current);
    }
    sendTyping(activeConversation.id, false);

    try {
      setIsSending(true);
      const attachmentToSend = selectedAttachment || undefined;
      setInputText('');
      setSelectedAttachment(null);
      setShowInputEmojiPicker(false);
      await sendMessage(text, attachmentToSend);
    } catch (err: any) {
      console.error('Send error:', err);
      alert(`Message error: ${err.message || 'Failed to dispatch encrypted message'}`);
    } finally {
      setIsSending(false);
    }
  };

  const handleInsertEmoji = (emoji: string) => {
    setInputText((prev) => prev + emoji);
  };

  const handleClearChatHistory = async () => {
    try {
      await clearChatHistory(activeConversation.id);
      setShowClearConfirm(false);
      setShowMenu(false);
    } catch (err) {
      console.error('Failed to clear chat history:', err);
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

  // WhatsApp-style message readiness indicators:
  // - single tick: sent to server
  // - double tick (slate): delivered to recipient device
  // - double tick (cyan/sky colored): read by recipient
  const renderStatusIcon = (status: DeliveryStatus) => {
    switch (status) {
      case 'queued_offline':
        return (
          <span
            className="flex items-center space-x-0.5 text-amber-400 text-[10px]"
            title="Queued locally (offline)"
          >
            <CloudOff className="w-3 h-3" />
          </span>
        );
      case 'sending':
        return (
          <span title="Encrypting & sending...">
            <Clock className="w-3 h-3 text-slate-400 animate-spin" />
          </span>
        );
      case 'sent':
        return (
          <span title="Sent (Single check: reached server)" className="text-slate-400 inline-flex items-center">
            <Check className="w-3.5 h-3.5" />
          </span>
        );
      case 'delivered':
        return (
          <span title="Delivered (Double check: reached recipient device)" className="text-slate-400 inline-flex items-center">
            <CheckCheck className="w-3.5 h-3.5" />
          </span>
        );
      case 'read':
        return (
          <span title="Read (Blue/Cyan double check: opened by recipient)" className="text-cyan-400 inline-flex items-center">
            <CheckCheck className="w-3.5 h-3.5 drop-shadow-[0_0_5px_rgba(34,211,238,0.75)]" />
          </span>
        );
      default:
        return null;
    }
  };

  // Wallpaper styling
  const getWallpaperClasses = () => {
    switch (settings.chatWallpaper) {
      case 'ychat-theme':
        return 'wallpaper-ychat';
      case 'clean-light':
        return 'wallpaper-clean-light';
      case 'subtle-grid':
        return 'wallpaper-grid';
      case 'dots':
        return 'wallpaper-dots';
      case 'minimal':
        return 'wallpaper-minimal';
      case 'custom':
        return 'wallpaper-custom';
      case 'default':
      default:
        return 'bg-slate-950/95';
    }
  };

  // Filter messages by in-chat search term (scoped to THIS active conversation only)
  const normalizedSearch = inChatSearchTerm.trim().toLowerCase();
  const displayedMessages = normalizedSearch
    ? messages.filter(
        (m) =>
          (m.text && m.text.toLowerCase().includes(normalizedSearch)) ||
          (m.attachment?.fileName && m.attachment.fileName.toLowerCase().includes(normalizedSearch))
      )
    : messages;

  const highlightKeyword = (text: string, keyword: string) => {
    if (!keyword) return text;
    const parts = text.split(new RegExp(`(${keyword})`, 'gi'));
    return parts.map((part, i) =>
      part.toLowerCase() === keyword.toLowerCase() ? (
        <mark key={i} className="bg-cyan-500/40 text-cyan-200 rounded-xs px-0.5 font-medium">
          {part}
        </mark>
      ) : (
        part
      )
    );
  };

  return (
    <main className="flex-1 flex flex-col h-full bg-slate-950 overflow-hidden relative">
      {/* Top Recipient Header */}
      <div className="h-16 px-4 md:px-6 bg-slate-900/90 backdrop-blur-md border-b border-slate-800 flex items-center justify-between z-20">
        <div className="flex items-center space-x-3 min-w-0">
          {/* Profile pic of the receiver with real-time presence dot */}
          <Avatar
            name={activeConversation.recipientDisplayName}
            avatarUrl={activeConversation.recipientAvatarUrl}
            size="md"
            presenceStatus={partnerPresence.status}
            verified={activeConversation.isVerifiedSafetyNumber}
          />

          {/* Receiver name and status / last online time */}
          <div className="min-w-0">
            <div className="flex items-center space-x-1.5 truncate">
              <span className="text-sm font-bold text-white truncate">
                {activeConversation.recipientDisplayName}
              </span>
              <span className="text-xs text-slate-400 font-mono truncate hidden sm:inline">
                @{activeConversation.recipientUsername}
              </span>
              {isMuted && (
                <span className="text-slate-500 text-xs" title="Notifications muted">
                  🔕
                </span>
              )}
            </div>

            {/* Online / Last seen / Typing indicator */}
            <div className={`text-xs truncate ${presenceColor}`}>
              {presenceText}
            </div>
          </div>
        </div>

        {/* Header Right Actions */}
        <div className="flex items-center space-x-1 sm:space-x-2 shrink-0">
          {/* In-chat Search Toggle Button */}
          <button
            type="button"
            id="chat-search-toggle-btn"
            onClick={() => {
              setShowInChatSearch((prev) => !prev);
              if (showInChatSearch) setInChatSearchTerm('');
            }}
            className={`p-2 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors cursor-pointer ${
              showInChatSearch ? 'bg-slate-800 text-violet-400' : ''
            }`}
            title="Search inside this chat"
          >
            <Search className="w-4 h-4" />
          </button>

          {/* Safety Number & Verification Button */}
          <button
            onClick={onOpenSafetyNumber}
            className={`flex items-center space-x-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-all cursor-pointer ${
              activeConversation.isVerifiedSafetyNumber
                ? 'bg-emerald-950/30 text-emerald-300 border-emerald-700/50 hover:bg-emerald-900/40'
                : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700 hover:border-violet-600'
            }`}
            title="Verify Safety Number"
          >
            {activeConversation.isVerifiedSafetyNumber ? (
              <>
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <span className="hidden md:inline">Verified</span>
              </>
            ) : (
              <>
                <ShieldAlert className="w-4 h-4 text-amber-400" />
                <span className="hidden md:inline">Verify Safety</span>
              </>
            )}
          </button>

          {/* 3-Dots Menu Dropdown */}
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              id="chat-options-menu-btn"
              onClick={(e) => {
                e.stopPropagation();
                setShowMenu((prev) => !prev);
              }}
              className={`p-2 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors cursor-pointer ${
                showMenu ? 'bg-slate-800 text-slate-200' : ''
              }`}
              title="More options"
            >
              <MoreVertical className="w-4 h-4" />
            </button>

            {showMenu && (
              <div
                className="absolute right-0 top-full mt-1.5 w-56 rounded-xl bg-slate-900 border border-slate-800 shadow-2xl py-1 z-50 text-xs text-slate-200 animate-in fade-in zoom-in-95 duration-100"
                onClick={(e) => e.stopPropagation()}
              >
                {/* 1. Search in chat */}
                <button
                  type="button"
                  id="menu-search-in-chat-btn"
                  onClick={() => {
                    setShowInChatSearch(true);
                    setShowMenu(false);
                  }}
                  className="w-full px-3.5 py-2 flex items-center space-x-2.5 hover:bg-slate-800 transition-colors text-left cursor-pointer"
                >
                  <Search className="w-4 h-4 text-slate-400" />
                  <span>Search in chat</span>
                </button>

                {/* 2. Verify Safety Number */}
                <button
                  type="button"
                  id="menu-verify-safety-btn"
                  onClick={() => {
                    setShowMenu(false);
                    onOpenSafetyNumber();
                  }}
                  className="w-full px-3.5 py-2 flex items-center space-x-2.5 hover:bg-slate-800 transition-colors text-left cursor-pointer"
                >
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  <span>Verify safety number</span>
                </button>

                {/* 3. Mute / Unmute chat */}
                <button
                  type="button"
                  id="menu-toggle-mute-btn"
                  onClick={() => {
                    toggleMuteConversation(activeConversation.id);
                    setShowMenu(false);
                  }}
                  className="w-full px-3.5 py-2 flex items-center space-x-2.5 hover:bg-slate-800 transition-colors text-left cursor-pointer"
                >
                  {isMuted ? (
                    <>
                      <Bell className="w-4 h-4 text-slate-400" />
                      <span>Unmute notifications</span>
                    </>
                  ) : (
                    <>
                      <BellOff className="w-4 h-4 text-slate-400" />
                      <span>Mute notifications</span>
                    </>
                  )}
                </button>

                <div className="my-1 border-t border-slate-800" />

                {/* 4. Clear chat history */}
                <button
                  type="button"
                  id="menu-clear-chat-btn"
                  onClick={() => {
                    setShowMenu(false);
                    setShowClearConfirm(true);
                  }}
                  className="w-full px-3.5 py-2 flex items-center space-x-2.5 hover:bg-rose-950/40 text-rose-400 hover:text-rose-300 transition-colors text-left cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" />
                  <span>Clear chat history</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* In-Chat Search Bar (filtered strictly inside this conversation) */}
      {showInChatSearch && (
        <div className="px-4 py-2 bg-slate-900 border-b border-slate-800 flex items-center space-x-2 z-10 animate-in slide-in-from-top duration-150">
          <Search className="w-4 h-4 text-violet-400 shrink-0" />
          <input
            type="text"
            id="in-chat-search-input"
            autoFocus
            placeholder={`Search messages in chat with ${activeConversation.recipientDisplayName}...`}
            value={inChatSearchTerm}
            onChange={(e) => setInChatSearchTerm(e.target.value)}
            className="flex-1 bg-transparent border-none text-xs text-slate-100 placeholder:text-slate-500 focus:outline-hidden"
          />
          {inChatSearchTerm && (
            <span className="text-[11px] text-slate-400 whitespace-nowrap">
              {displayedMessages.length} {displayedMessages.length === 1 ? 'match' : 'matches'}
            </span>
          )}
          {inChatSearchTerm && (
            <button
              type="button"
              onClick={() => setInChatSearchTerm('')}
              className="p-1 text-slate-400 hover:text-slate-200 rounded-md"
              title="Clear search"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setShowInChatSearch(false);
              setInChatSearchTerm('');
            }}
            className="px-2 py-1 text-xs rounded-md bg-slate-800 text-slate-300 hover:bg-slate-700 transition-colors cursor-pointer"
          >
            Done
          </button>
        </div>
      )}

      {/* Clear Chat Confirmation Modal */}
      {showClearConfirm && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-2xl space-y-4">
            <div className="flex items-center space-x-3 text-rose-400">
              <div className="p-2 rounded-xl bg-rose-950/60 border border-rose-800/40">
                <Trash2 className="w-5 h-5" />
              </div>
              <h3 className="text-sm font-bold text-white">Clear Chat History?</h3>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              This will permanently delete all encrypted messages in this chat with{' '}
              <strong className="text-slate-200">{activeConversation.recipientDisplayName}</strong> from your local device. This action cannot be undone.
            </p>
            <div className="flex items-center justify-end space-x-2 pt-2">
              <button
                type="button"
                onClick={() => setShowClearConfirm(false)}
                className="px-3.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleClearChatHistory}
                className="px-3.5 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-xs font-semibold text-white transition-colors cursor-pointer shadow-md"
              >
                Clear History
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Message History Container */}
      <div
        className={`flex-1 overflow-y-auto p-4 md:p-6 space-y-3 ${getWallpaperClasses()}`}
        style={
          settings.chatWallpaper === 'custom' && settings.customWallpaperUrl
            ? {
                backgroundImage: `url(${settings.customWallpaperUrl})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center'
              }
            : undefined
        }
      >
        {/* Encryption Banner */}
        <div className="mx-auto max-w-md p-3 rounded-2xl bg-violet-950/20 border border-violet-800/30 text-center text-xs text-violet-300/90 space-y-1">
          <div className="flex items-center justify-center space-x-1.5 text-violet-300 font-medium">
            <Lock className="w-3.5 h-3.5 text-violet-400" />
            <span>End-to-End Encrypted</span>
          </div>
          <p className="text-[11px] text-slate-400">
            Messages and media are end-to-end encrypted. No one outside of this chat can read them.
          </p>
        </div>

        {/* No Results Fallback */}
        {normalizedSearch && displayedMessages.length === 0 && (
          <div className="text-center py-12 text-slate-400 text-xs">
            <Search className="w-8 h-8 text-slate-600 mx-auto mb-2" />
            <p className="font-medium text-slate-300">No messages match &ldquo;{inChatSearchTerm}&rdquo;</p>
            <p className="text-[11px] text-slate-500 mt-1">Try another search keyword.</p>
          </div>
        )}

        <AnimatePresence initial={false}>
          {displayedMessages.map((msg) => {
            const isSender = msg.senderUserUuid === user?.uuid;
            const msgKey = msg.clientMessageId || msg.id;

            return (
              <MessageBubble
                key={msgKey}
                msg={msg}
                isSender={isSender}
                userUuid={user?.uuid}
                settings={settings}
                searchKeyword={inChatSearchTerm}
                onRetry={(clientMsgId) => retryMessage(clientMsgId)}
                onToggleReaction={toggleReaction}
                onToggleTimestampFormat={toggleTimestampFormat}
                formatTimestamp={formatMessageTimestamp}
                highlightKeyword={highlightKeyword}
                activePickerMsgId={activePickerMsgId}
                expandedPickerMsgId={expandedPickerMsgId}
                setActivePickerMsgId={setActivePickerMsgId}
                setExpandedPickerMsgId={setExpandedPickerMsgId}
                favoriteEmojis={FAVORITE_EMOJIS}
              />
            );
          })}
        </AnimatePresence>
        <div ref={messagesEndRef} />
      </div>

      {/* Input Message Form */}
      <div className="p-3 md:p-4 bg-slate-900 border-t border-slate-800 relative">
        {/* Selected Attachment Preview Card */}
        {selectedAttachment && (
          <div className="mb-2 flex items-center justify-between p-2.5 rounded-xl bg-slate-950 border border-violet-800/40 text-xs shadow-md">
            <div className="flex items-center space-x-2.5 truncate">
              <div className="p-1.5 rounded-lg bg-violet-950/60 text-violet-300 shrink-0">
                {selectedAttachment.mimeType.startsWith('image/') ? (
                  <ImageIcon className="w-4 h-4" />
                ) : (
                  <FileText className="w-4 h-4" />
                )}
              </div>
              <div className="truncate">
                <div className="text-slate-200 truncate font-medium">{selectedAttachment.fileName}</div>
                <div className="text-[10px] text-slate-400">
                  {formatFileSize(selectedAttachment.fileSize)} • E2EE Encrypted
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setSelectedAttachment(null)}
              className="p-1.5 text-slate-400 hover:text-rose-400 rounded-md transition-colors cursor-pointer"
              title="Remove attachment"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Input Bar Emoji Picker Popover */}
        {showInputEmojiPicker && (
          <div
            ref={inputEmojiPickerRef}
            className="absolute bottom-full left-4 mb-2 z-50 animate-in fade-in slide-in-from-bottom-2 duration-150"
          >
            <EmojiPicker
              className="w-72 sm:w-80"
              onSelect={handleInsertEmoji}
              onClose={() => setShowInputEmojiPicker(false)}
            />
          </div>
        )}

        <form onSubmit={handleSend} className="flex items-center space-x-2">
          {/* Hidden File Input */}
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileSelect}
            className="hidden"
            id="chat-file-input"
          />

          {/* Emoji Picker Button for message typing */}
          <button
            type="button"
            id="chat-emoji-picker-btn"
            onClick={(e) => {
              e.stopPropagation();
              setShowInputEmojiPicker((prev) => !prev);
            }}
            className={`p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 transition-all cursor-pointer ${
              showInputEmojiPicker ? 'text-violet-400 bg-slate-700' : 'text-slate-300 hover:text-white'
            }`}
            title="Insert emoji (Keyboard & Favorites)"
          >
            <Smile className="w-4 h-4" />
          </button>

          {/* Attachment Button */}
          <button
            type="button"
            id="chat-attachment-btn"
            onClick={() => fileInputRef.current?.click()}
            disabled={isSending}
            className="p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-all cursor-pointer disabled:opacity-40"
            title="Attach file (Client encrypted with ChaCha20-Poly1305)"
          >
            <Paperclip className="w-4 h-4" />
          </button>

          <input
            id="chat-message-input"
            type="text"
            placeholder={
              selectedAttachment
                ? 'Add a caption (optional)...'
                : `Message ${activeConversation.recipientDisplayName} (E2EE Encrypted)...`
            }
            value={inputText}
            onChange={handleInputChange}
            disabled={isSending}
            className="flex-1 px-4 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 text-sm focus:outline-hidden focus:border-violet-500 transition-colors placeholder:text-slate-500 disabled:opacity-50"
          />

          <button
            id="chat-send-btn"
            type="submit"
            disabled={(!inputText.trim() && !selectedAttachment) || isSending}
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
