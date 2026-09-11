import React from 'react';
import { motion } from 'framer-motion';
import {
  Check,
  CheckCheck,
  Clock,
  CloudOff,
  AlertCircle,
  RefreshCw,
  Lock,
  Download,
  FileText,
  SmilePlus
} from 'lucide-react';
import { DecryptedMessage, DeliveryStatus } from '../crypto/types';
import { AppSettings, BubbleColor, MessageThemeStyle, MessageGradientType, IncomingMessageStyle } from '../types/settings';
import { EmojiPicker } from './EmojiPicker';

interface MessageBubbleProps {
  msg: DecryptedMessage;
  isSender: boolean;
  userUuid?: string;
  settings: AppSettings;
  searchKeyword?: string;
  onRetry: (clientMessageId: string) => void;
  onToggleReaction: (clientMessageId: string, emoji: string, messageId?: string) => void;
  onToggleTimestampFormat: (msgKey: string) => void;
  formatTimestamp: (msgKey: string, timestamp: number) => string;
  highlightKeyword: (text: string, keyword: string) => React.ReactNode;
  activePickerMsgId: string | null;
  expandedPickerMsgId: string | null;
  setActivePickerMsgId: (id: string | null) => void;
  setExpandedPickerMsgId: (id: string | null) => void;
  favoriteEmojis: string[];
}

export const MessageBubble: React.FC<MessageBubbleProps> = ({
  msg,
  isSender,
  userUuid,
  settings,
  searchKeyword = '',
  onRetry,
  onToggleReaction,
  onToggleTimestampFormat,
  formatTimestamp,
  highlightKeyword,
  activePickerMsgId,
  expandedPickerMsgId,
  setActivePickerMsgId,
  setExpandedPickerMsgId,
  favoriteEmojis
}) => {
  const msgKey = msg.clientMessageId || msg.id;
  const isPickerOpen = activePickerMsgId === msgKey;
  const isFullPickerOpen = expandedPickerMsgId === msgKey;
  const isFailed = msg.status === 'failed';

  // Format file size
  const formatFileSize = (bytes?: number) => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // Get sender bubble appearance according to messageThemeStyle and gradient/color settings
  const getSenderBubbleStyle = () => {
    const style = settings.messageThemeStyle || 'solid';
    const color = settings.bubbleColor || 'violet';
    const gradient = settings.messageGradient || 'violet-indigo';

    if (style === 'gradient') {
      switch (gradient) {
        case 'cyan-blue':
          return 'bg-gradient-to-br from-cyan-500 to-blue-600 text-white shadow-md shadow-cyan-900/20';
        case 'emerald-teal':
          return 'bg-gradient-to-br from-emerald-500 to-teal-700 text-white shadow-md shadow-emerald-900/20';
        case 'rose-pink':
          return 'bg-gradient-to-br from-rose-500 to-pink-600 text-white shadow-md shadow-rose-900/20';
        case 'amber-orange':
          return 'bg-gradient-to-br from-amber-500 to-orange-600 text-slate-950 font-medium shadow-md shadow-amber-900/20';
        case 'custom':
          if (settings.customGradientColors) {
            return 'text-white shadow-md';
          }
          return 'bg-gradient-to-br from-violet-600 to-indigo-700 text-white';
        case 'violet-indigo':
        default:
          return 'bg-gradient-to-br from-violet-600 to-indigo-700 text-white shadow-md shadow-violet-900/20';
      }
    }

    if (style === 'theme') {
      return 'bg-gradient-to-br from-slate-900 to-violet-950 border border-violet-500/40 text-violet-100 shadow-md';
    }

    // Default: 'solid'
    switch (color) {
      case 'indigo':
        return 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm';
      case 'emerald':
        return 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm';
      case 'cyan':
        return 'bg-cyan-600 hover:bg-cyan-500 text-white shadow-sm';
      case 'rose':
        return 'bg-rose-600 hover:bg-rose-500 text-white shadow-sm';
      case 'amber':
        return 'bg-amber-500 hover:bg-amber-400 text-slate-950 font-medium shadow-sm';
      case 'slate':
        return 'bg-slate-700 hover:bg-slate-600 text-white shadow-sm';
      case 'midnight':
        return 'bg-slate-950 border border-slate-700 text-slate-100 shadow-sm';
      case 'violet':
      default:
        return 'bg-violet-600 hover:bg-violet-500 text-white shadow-sm';
    }
  };

  // Get incoming bubble appearance
  const getIncomingBubbleStyle = () => {
    const style = settings.incomingBubbleStyle || 'default';
    switch (style) {
      case 'slate':
        return 'bg-slate-900/95 border border-slate-800 text-slate-200';
      case 'high-contrast':
        return 'bg-slate-950 border-2 border-slate-600 text-white font-medium';
      case 'subdued':
        return 'bg-slate-800/60 border border-slate-700/40 text-slate-300';
      case 'default':
      default:
        return 'bg-slate-800 border border-slate-700/60 text-slate-100';
    }
  };

  // Delivery State Machine Visual Indicator
  const renderDeliveryStateMachine = (status: DeliveryStatus) => {
    switch (status) {
      case 'queued_offline':
        return (
          <span
            className="flex items-center space-x-1 text-amber-400 text-[10px] select-none"
            title="Queued locally in encrypted storage (will deliver when online)"
          >
            <CloudOff className="w-3 h-3" />
            <span className="hidden sm:inline">Offline</span>
          </span>
        );
      case 'sending':
        return (
          <span
            className="flex items-center space-x-1 text-slate-300 text-[10px] select-none"
            title="Encrypting with Double Ratchet & delivering..."
          >
            <Clock className="w-3 h-3 animate-spin text-slate-300" />
            <span className="hidden sm:inline">Sending</span>
          </span>
        );
      case 'retrying':
        return (
          <span
            className="flex items-center space-x-1 text-amber-300 text-[10px] select-none"
            title="Retrying delivery..."
          >
            <RefreshCw className="w-3 h-3 animate-spin text-amber-300" />
            <span className="hidden sm:inline">Retrying</span>
          </span>
        );
      case 'sent':
        return (
          <span
            className="flex items-center space-x-0.5 text-slate-300 select-none"
            title="Sent to server (Single check)"
          >
            <Check className="w-3.5 h-3.5" />
          </span>
        );
      case 'delivered':
        return (
          <span
            className="flex items-center space-x-0.5 text-slate-300 select-none"
            title="Delivered to recipient device (Double check)"
          >
            <CheckCheck className="w-3.5 h-3.5" />
          </span>
        );
      case 'read':
        return (
          <span
            className="flex items-center space-x-0.5 text-cyan-400 select-none"
            title={
              msg.readAt
                ? `Read at ${new Date(msg.readAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                : 'Read by recipient (Cyan checkmarks)'
            }
          >
            <CheckCheck className="w-3.5 h-3.5 drop-shadow-[0_0_5px_rgba(34,211,238,0.85)]" />
          </span>
        );
      case 'failed':
        return (
          <span
            className="flex items-center space-x-1 text-rose-400 select-none"
            title={msg.errorMessage || 'Failed to deliver'}
          >
            <AlertCircle className="w-3.5 h-3.5 text-rose-400" />
            <span className="text-[10px] font-semibold">Failed</span>
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <motion.div
      id={`chat-bubble-${msgKey}`}
      initial={{ opacity: 0, y: 14, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
      layout="position"
      className={`flex flex-col group relative ${isSender ? 'items-end' : 'items-start'}`}
    >
      <div className="relative max-w-[85%] md:max-w-[70%]">
        {/* Floating Reaction Picker Popup */}
        {isPickerOpen && (
          <div
            className={`reaction-picker-container absolute z-30 bottom-full mb-1 flex items-center space-x-1 p-1.5 rounded-2xl bg-slate-900/95 backdrop-blur-md border border-slate-700 shadow-xl ${
              isSender ? 'right-0' : 'left-0'
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            {favoriteEmojis.map((emoji) => {
              const isSelected = msg.reactions?.[emoji]?.includes(userUuid || '');
              return (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => {
                    onToggleReaction(msg.clientMessageId || msg.id, emoji, msg.id);
                    setActivePickerMsgId(null);
                    setExpandedPickerMsgId(null);
                  }}
                  className={`w-8 h-8 rounded-xl flex items-center justify-center text-base hover:scale-125 transition-transform cursor-pointer ${
                    isSelected ? 'bg-violet-600/40 ring-1 ring-violet-500' : 'hover:bg-slate-800'
                  }`}
                  title={`React with ${emoji}`}
                >
                  {emoji}
                </button>
              );
            })}

            <button
              type="button"
              onClick={() => {
                setExpandedPickerMsgId(isFullPickerOpen ? null : msgKey);
              }}
              className="w-8 h-8 rounded-xl flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-800 text-sm font-bold transition-all cursor-pointer"
              title="All emojis"
            >
              +
            </button>
          </div>
        )}

        {/* Expanded Full Unicode Emoji Picker */}
        {isFullPickerOpen && (
          <div
            className={`reaction-picker-container absolute z-40 bottom-full mb-2 ${
              isSender ? 'right-0' : 'left-0'
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            <EmojiPicker
              className="w-72 sm:w-80"
              onSelect={(emoji) => {
                onToggleReaction(msg.clientMessageId || msg.id, emoji, msg.id);
                setActivePickerMsgId(null);
                setExpandedPickerMsgId(null);
              }}
              onClose={() => {
                setExpandedPickerMsgId(null);
                setActivePickerMsgId(null);
              }}
            />
          </div>
        )}

        {/* Main Bubble Container */}
        <div
          className={`rounded-2xl px-4 py-2.5 shadow-sm text-sm break-words relative transition-all ${
            isSender
              ? `${getSenderBubbleStyle()} rounded-br-xs`
              : `${getIncomingBubbleStyle()} rounded-bl-xs incoming-message-bubble`
          } ${isFailed ? 'ring-1 ring-rose-500/50 bg-slate-900/90' : ''}`}
          style={
            isSender &&
            settings.messageThemeStyle === 'gradient' &&
            settings.messageGradient === 'custom' &&
            settings.customGradientColors
              ? {
                  backgroundImage: `linear-gradient(to bottom right, ${settings.customGradientColors.from}, ${settings.customGradientColors.to})`
                }
              : undefined
          }
        >
          {/* Quick Action Button for Reactions */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setActivePickerMsgId(isPickerOpen ? null : msgKey);
              setExpandedPickerMsgId(null);
            }}
            className={`absolute top-1 p-1 rounded-full text-slate-400 hover:text-slate-100 hover:bg-black/30 transition-all opacity-0 group-hover:opacity-100 focus:opacity-100 cursor-pointer ${
              isSender ? '-left-7' : '-right-7'
            }`}
            title="Add reaction"
          >
            <SmilePlus className="w-3.5 h-3.5" />
          </button>

          {/* Attachment Preview if present */}
          {msg.attachment && (
            <div className="mb-2">
              {msg.attachment.mimeType.startsWith('image/') ? (
                <div className="relative group/img overflow-hidden rounded-xl border border-white/10 bg-black/20">
                  <img
                    src={msg.attachment.dataUrl}
                    alt={msg.attachment.fileName}
                    className="max-w-full max-h-72 object-contain rounded-xl"
                  />
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/img:opacity-100 transition-opacity flex items-center justify-end p-2">
                    <a
                      href={msg.attachment.dataUrl}
                      download={msg.attachment.fileName}
                      className="p-2 rounded-lg bg-black/60 hover:bg-black/80 text-white transition-colors cursor-pointer shadow-md"
                      title={`Download ${msg.attachment.fileName}`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Download className="w-4 h-4" />
                    </a>
                  </div>
                </div>
              ) : (
                <div className="flex items-center space-x-3 p-2.5 rounded-xl bg-black/20 border border-white/10">
                  <div className="p-2 rounded-lg bg-white/10 text-violet-300">
                    <FileText className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-white truncate" title={msg.attachment.fileName}>
                      {msg.attachment.fileName}
                    </div>
                    <div className="text-[10px] text-slate-400">
                      {formatFileSize(msg.attachment.fileSize)}
                    </div>
                  </div>
                  <a
                    href={msg.attachment.dataUrl}
                    download={msg.attachment.fileName}
                    className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors cursor-pointer"
                    title="Download file"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Download className="w-4 h-4" />
                  </a>
                </div>
              )}
            </div>
          )}

          {/* Message Text */}
          {msg.text && (
            <div className="leading-relaxed whitespace-pre-wrap">
              {searchKeyword ? highlightKeyword(msg.text, searchKeyword) : msg.text}
            </div>
          )}

          {/* Failed State Details and Action */}
          {isFailed && (
            <div className="mt-2 pt-2 border-t border-rose-500/20 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center space-x-1.5 text-xs text-rose-300">
                <AlertCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                <span className="text-[11px] leading-tight">
                  {msg.errorMessage || 'Delivery failed (transport or security check)'}
                </span>
              </div>
              <button
                type="button"
                id={`btn-retry-msg-${msgKey}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onRetry(msg.clientMessageId || msg.id);
                }}
                className="flex items-center space-x-1 px-2.5 py-1 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 border border-rose-500/40 text-xs font-semibold transition-all hover:scale-105 active:scale-95 cursor-pointer shadow-xs"
                title="Retry sending this message"
              >
                <RefreshCw className="w-3 h-3" />
                <span>Retry</span>
              </button>
            </div>
          )}

          {/* Message Meta: Tamper status, timestamp, and visual delivery state machine */}
          <div
            className={`mt-1 flex items-center justify-end space-x-1.5 text-[10px] select-none ${
              isSender ? 'opacity-90' : 'text-slate-400'
            }`}
          >
            {msg.tamperVerified && (
              <span title="BLAKE3 hash chain verified">
                <Lock className="w-2.5 h-2.5 inline mr-0.5 opacity-70" />
              </span>
            )}
            <span
              onClick={() => onToggleTimestampFormat(msgKey)}
              className="cursor-pointer hover:underline opacity-80"
              title="Click to toggle timestamp format"
            >
              {formatTimestamp(msgKey, msg.timestamp)}
            </span>
            {/* Sender Visual Delivery State Machine */}
            {isSender && renderDeliveryStateMachine(msg.status)}
          </div>
        </div>

        {/* Message Reactions Pills */}
        {msg.reactions && Object.keys(msg.reactions).length > 0 && (
          <div className={`flex flex-wrap gap-1 mt-1 ${isSender ? 'justify-end' : 'justify-start'}`}>
            {Object.entries(msg.reactions).map(([emoji, users]) => {
              if (!users || users.length === 0) return null;
              const userReacted = userUuid ? users.includes(userUuid) : false;
              return (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => onToggleReaction(msg.clientMessageId || msg.id, emoji, msg.id)}
                  className={`flex items-center space-x-1 px-2 py-0.5 rounded-full text-xs transition-all cursor-pointer ${
                    userReacted
                      ? 'bg-violet-600/30 border border-violet-500/60 text-violet-200 shadow-xs'
                      : 'bg-slate-800/90 border border-slate-700/80 text-slate-300 hover:bg-slate-700/90'
                  }`}
                  title={`${users.length} reaction${users.length > 1 ? 's' : ''}${
                    userReacted ? ' (Click to remove)' : ' (Click to add)'
                  }`}
                >
                  <span>{emoji}</span>
                  <span className="text-[10px] font-semibold opacity-90">{users.length}</span>
                </button>
              );
            })}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setActivePickerMsgId(isPickerOpen ? null : msgKey);
                setExpandedPickerMsgId(null);
              }}
              className="px-1.5 py-0.5 rounded-full bg-slate-800/80 border border-slate-700/70 text-slate-400 hover:text-slate-200 text-xs transition-all cursor-pointer"
              title="Add reaction"
            >
              +
            </button>
          </div>
        )}
      </div>
    </motion.div>
  );
};
