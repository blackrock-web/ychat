import React from 'react';
import {
  Bell,
  X,
  CheckCheck,
  Trash2,
  MessageSquare,
  Smartphone,
  ShieldAlert,
  UserPlus
} from 'lucide-react';
import { useChat } from '../context/ChatContext';
import { AppNotification } from '../types/settings';

interface NotificationsPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export const NotificationsPanel: React.FC<NotificationsPanelProps> = ({ isOpen, onClose }) => {
  const {
    notifications,
    markNotificationAsRead,
    markAllNotificationsAsRead,
    clearAllNotifications,
    conversations,
    selectConversation
  } = useChat();

  if (!isOpen) return null;

  const getIcon = (type: AppNotification['type']) => {
    switch (type) {
      case 'message':
        return <MessageSquare className="w-4 h-4 text-violet-400" />;
      case 'device_linked':
        return <Smartphone className="w-4 h-4 text-cyan-400" />;
      case 'safety_changed':
        return <ShieldAlert className="w-4 h-4 text-amber-400" />;
      case 'conversation_request':
        return <UserPlus className="w-4 h-4 text-emerald-400" />;
      default:
        return <Bell className="w-4 h-4 text-slate-400" />;
    }
  };

  const formatTime = (timestamp: number) => {
    const diff = Math.floor((Date.now() - timestamp) / 1000);
    if (diff < 60) return 'Just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };

  const handleNotificationClick = (n: AppNotification) => {
    markNotificationAsRead(n.id);
    if (n.data?.conversationId) {
      const conv = conversations.find(c => c.id === n.data.conversationId);
      if (conv) {
        selectConversation(conv);
        onClose();
      }
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-xs transition-opacity animate-in fade-in duration-200">
      {/* Click outside to close backdrop */}
      <div className="flex-1" onClick={onClose} />

      {/* Slide-in panel */}
      <aside
        id="notifications-panel"
        className="relative w-full max-w-sm sm:max-w-md h-full bg-slate-900 border-l border-slate-800 shadow-2xl flex flex-col z-10"
      >
        {/* Header */}
        <div className="p-4 border-b border-slate-800/80 flex items-center justify-between bg-slate-900/90 backdrop-blur-md">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-violet-600/20 text-violet-400 flex items-center justify-center border border-violet-500/20">
              <Bell className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-100">Notifications</h2>
              <p className="text-xs text-slate-400">
                {notifications.filter(n => !n.read).length} unread alerts
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1">
            {notifications.length > 0 && (
              <>
                <button
                  id="notifications-mark-all-read-btn"
                  onClick={markAllNotificationsAsRead}
                  title="Mark all as read"
                  className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-md transition-colors"
                >
                  <CheckCheck className="w-4 h-4" />
                </button>
                <button
                  id="notifications-clear-all-btn"
                  onClick={clearAllNotifications}
                  title="Clear all notifications"
                  className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-slate-800 rounded-md transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </>
            )}
            <button
              id="notifications-close-btn"
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-md transition-colors ml-1"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Notification List */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {notifications.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-500">
              <div className="w-12 h-12 rounded-full bg-slate-800/80 flex items-center justify-center mb-3">
                <Bell className="w-5 h-5 text-slate-500" />
              </div>
              <p className="text-sm font-medium text-slate-300">No notifications yet</p>
              <p className="text-xs text-slate-500 mt-1 max-w-xs">
                Real-time alerts for incoming messages, safety number updates, and linked devices will appear here.
              </p>
            </div>
          ) : (
            notifications.map((n) => (
              <div
                key={n.id}
                id={`notification-item-${n.id}`}
                onClick={() => handleNotificationClick(n)}
                className={`p-3 rounded-xl border transition-all cursor-pointer relative group ${
                  n.read
                    ? 'bg-slate-900/50 border-slate-800/60 opacity-75 hover:opacity-100 hover:bg-slate-800/50'
                    : 'bg-slate-800/80 border-violet-500/30 hover:bg-slate-800 shadow-xs'
                }`}
              >
                {!n.read && (
                  <span className="absolute top-3 right-3 w-2 h-2 rounded-full bg-violet-500" />
                )}
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-lg bg-slate-900/90 border border-slate-800 flex-shrink-0 mt-0.5">
                    {getIcon(n.type)}
                  </div>
                  <div className="flex-1 min-w-0 pr-4">
                    <div className="flex items-baseline justify-between gap-2">
                      <h4 className="text-xs font-semibold text-slate-200 truncate">
                        {n.title}
                      </h4>
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5 line-clamp-2 leading-relaxed">
                      {n.description}
                    </p>
                    <span className="text-[10px] text-slate-500 mt-1.5 inline-block">
                      {formatTime(n.timestamp)}
                    </span>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer info */}
        <div className="p-3 border-t border-slate-800/80 text-center bg-slate-900/60">
          <span className="text-[11px] text-slate-500">
            Push alerts delivered via secure WebSocket channel
          </span>
        </div>
      </aside>
    </div>
  );
};
