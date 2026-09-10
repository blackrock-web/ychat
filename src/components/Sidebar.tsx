import React, { useState, useEffect } from 'react';
import { useChat } from '../context/ChatContext';
import { StoredConversation } from '../storage/db';
import { DecryptedMessage } from '../crypto/types';
import {
  Plus,
  Search,
  X,
  MessageSquare,
  Settings,
  Bell,
  CheckCheck,
  User,
  Sliders
} from 'lucide-react';
import { Avatar } from './Avatar';

interface SidebarProps {
  onOpenNewChat: () => void;
  onOpenProfile?: () => void;
  onOpenSettings?: () => void;
  onOpenNotifications?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  onOpenNewChat,
  onOpenProfile,
  onOpenSettings,
  onOpenNotifications
}) => {
  const {
    conversations,
    activeConversation,
    selectConversation,
    user,
    settings,
    searchStoredMessages,
    unreadNotificationsCount
  } = useChat();

  const [searchTerm, setSearchTerm] = useState('');
  const [searchTab, setSearchTab] = useState<'conversations' | 'messages'>('conversations');
  const [matchingMessages, setMatchingMessages] = useState<
    Array<{ message: DecryptedMessage; conversation: StoredConversation }>
  >([]);
  const [isSearchingMessages, setIsSearchingMessages] = useState(false);

  // Debounced search across past decrypted messages
  useEffect(() => {
    if (!searchTerm.trim()) {
      setMatchingMessages([]);
      return;
    }

    const timer = setTimeout(async () => {
      setIsSearchingMessages(true);
      try {
        const results = await searchStoredMessages(searchTerm);
        setMatchingMessages(results);
      } catch (err) {
        console.error('Failed to search messages:', err);
      } finally {
        setIsSearchingMessages(false);
      }
    }, 200);

    return () => clearTimeout(timer);
  }, [searchTerm, searchStoredMessages]);

  const filteredConversations = conversations.filter(
    (c) =>
      c.recipientUsername.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.recipientDisplayName.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const formatTimestamp = (timestamp?: number) => {
    if (!timestamp) return '';
    if (settings.timestampFormat === 'relative') {
      const diff = Math.floor((Date.now() - timestamp) / 1000);
      if (diff < 60) return 'Just now';
      if (diff < 3600) return `${Math.floor(diff / 60)}m`;
      if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
      return `${Math.floor(diff / 86400)}d`;
    }
    const date = new Date(timestamp);
    const now = new Date();
    if (date.toDateString() === now.toDateString()) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  const highlightKeyword = (text: string, keyword: string) => {
    if (!keyword) return text;
    const parts = text.split(new RegExp(`(${keyword})`, 'gi'));
    return parts.map((part, i) =>
      part.toLowerCase() === keyword.toLowerCase() ? (
        <mark key={i} className="bg-violet-500/30 text-violet-200 rounded-xs px-0.5 font-medium">
          {part}
        </mark>
      ) : (
        part
      )
    );
  };

  const handleMessageResultClick = (conv: StoredConversation) => {
    selectConversation(conv);
  };

  return (
    <aside className="w-full md:w-80 lg:w-96 bg-slate-900 border-r border-slate-800 flex flex-col h-full select-none">
      {/* Search & New Chat Action */}
      <div className="p-4 border-b border-slate-800 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400">
            Conversations
          </h2>
          <button
            id="sidebar-new-chat-btn"
            onClick={onOpenNewChat}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold shadow-sm transition-all cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Chat</span>
          </button>
        </div>

        {/* Search Bar */}
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            id="sidebar-search-input"
            type="text"
            placeholder="Search contacts or messages..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-8 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-200 text-xs focus:outline-hidden focus:border-violet-500 transition-colors placeholder:text-slate-500"
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm('')}
              className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-200 p-0.5 rounded-xs"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Search Mode Tabs (shown when search keyword is entered) */}
        {searchTerm.trim() && (
          <div className="flex items-center space-x-1 bg-slate-950 p-1 rounded-lg border border-slate-800 text-xs">
            <button
              type="button"
              id="sidebar-search-tab-chats"
              onClick={() => setSearchTab('conversations')}
              className={`flex-1 py-1 px-2 rounded-md font-medium text-[11px] transition-colors ${
                searchTab === 'conversations'
                  ? 'bg-violet-600 text-white shadow-xs'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Chats ({filteredConversations.length})
            </button>
            <button
              type="button"
              id="sidebar-search-tab-messages"
              onClick={() => setSearchTab('messages')}
              className={`flex-1 py-1 px-2 rounded-md font-medium text-[11px] transition-colors ${
                searchTab === 'messages'
                  ? 'bg-violet-600 text-white shadow-xs'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Messages ({matchingMessages.length})
            </button>
          </div>
        )}
      </div>

      {/* List Container */}
      <div className="flex-1 overflow-y-auto divide-y divide-slate-800/40">
        {searchTerm.trim() && searchTab === 'messages' ? (
          /* ================= MESSAGE SEARCH RESULTS ================= */
          matchingMessages.length === 0 ? (
            <div className="p-8 text-center text-slate-500 text-xs flex flex-col items-center justify-center space-y-2">
              <MessageSquare className="w-8 h-8 text-slate-600 mb-1" />
              <p className="font-medium text-slate-300">No matching messages</p>
              <p className="max-w-[200px] text-[11px]">
                {isSearchingMessages
                  ? 'Searching decrypted storage...'
                  : `No stored messages contained "${searchTerm}".`}
              </p>
            </div>
          ) : (
            matchingMessages.map(({ message, conversation }) => {
              const isSender = message.senderUserUuid === user?.uuid;
              return (
                <div
                  key={`match-${message.clientMessageId || message.id}`}
                  onClick={() => handleMessageResultClick(conversation)}
                  className="p-3.5 hover:bg-slate-800/50 cursor-pointer transition-colors space-y-1 group"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <Avatar
                        name={conversation.recipientDisplayName}
                        size="xs"
                        verified={conversation.isVerifiedSafetyNumber}
                      />
                      <span className="text-xs font-semibold text-slate-200 truncate">
                        {conversation.recipientDisplayName}
                      </span>
                    </div>
                    <span className="text-[10px] text-slate-500">
                      {formatTimestamp(message.timestamp)}
                    </span>
                  </div>
                  <p className="text-xs text-slate-300 line-clamp-2 pl-7 leading-relaxed">
                    <span className="text-slate-500 mr-1 text-[11px]">
                      {isSender ? 'You:' : `${conversation.recipientDisplayName}:`}
                    </span>
                    {highlightKeyword(message.text, searchTerm)}
                  </p>
                </div>
              );
            })
          )
        ) : (
          /* ================= CONVERSATIONS LIST ================= */
          filteredConversations.length === 0 ? (
            <div className="p-8 text-center text-slate-500 text-xs flex flex-col items-center justify-center space-y-2">
              <MessageSquare className="w-8 h-8 text-slate-600 mb-1" />
              <p className="font-medium text-slate-300">
                {searchTerm ? 'No contacts found' : 'No conversations yet'}
              </p>
              <p className="max-w-[220px] text-[11px]">
                {searchTerm
                  ? 'Try searching by a different name or switch to Messages tab.'
                  : 'Click "New Chat" above to start a post-quantum encrypted session.'}
              </p>
            </div>
          ) : (
            filteredConversations.map((conv) => {
              const isActive = activeConversation?.id === conv.id;
              const isMuted = settings.mutedConversations.includes(conv.id);

              return (
                <div
                  key={conv.id}
                  id={`conversation-item-${conv.id}`}
                  onClick={() => selectConversation(conv)}
                  className={`p-3.5 flex items-center space-x-3 cursor-pointer transition-all ${
                    isActive
                      ? 'bg-violet-950/40 border-l-2 border-violet-500'
                      : 'hover:bg-slate-800/60'
                  }`}
                >
                  {/* Avatar component with initials or custom image */}
                  <Avatar
                    name={conv.recipientDisplayName}
                    size="md"
                    verified={conv.isVerifiedSafetyNumber}
                  />

                  {/* Conversation Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-0.5">
                      <div className="flex items-center space-x-1.5 truncate">
                        <span className="text-xs font-semibold text-slate-200 truncate">
                          {conv.recipientDisplayName}
                        </span>
                        {isMuted && (
                          <span className="text-[10px] text-slate-500" title="Muted">
                            🔕
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] text-slate-500 whitespace-nowrap ml-2">
                        {formatTimestamp(conv.lastMessageTimestamp)}
                      </span>
                    </div>

                    <div className="flex items-center justify-between">
                      <p className="text-[11px] text-slate-400 truncate pr-2">
                        {conv.lastMessageText ? (
                          searchTerm && searchTab === 'conversations' ? (
                            highlightKeyword(conv.lastMessageText, searchTerm)
                          ) : (
                            conv.lastMessageText
                          )
                        ) : (
                          <span className="italic text-slate-500">
                            Encrypted handshake ready
                          </span>
                        )}
                      </p>
                      {conv.unreadCount > 0 && (
                        <span className="px-1.5 py-0.2 rounded-full bg-violet-600 text-white text-[10px] font-bold">
                          {conv.unreadCount}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )
        )}
      </div>

      {/* User Profile Bar (Bottom of Sidebar) */}
      {user && (
        <div className="p-3 bg-slate-950 border-t border-slate-800 flex items-center justify-between">
          <div
            onClick={onOpenProfile}
            className="flex items-center space-x-2.5 min-w-0 cursor-pointer p-1 rounded-lg hover:bg-slate-900 transition-colors flex-1 mr-2"
            title="Open Profile"
          >
            <Avatar
              name={user.displayName || user.username}
              avatarUrl={user.avatarUrl}
              size="sm"
            />
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold text-slate-200 truncate">
                {user.displayName}
              </div>
              <div className="text-[10px] text-slate-500 truncate font-mono">
                @{user.username}
              </div>
            </div>
          </div>

          <div className="flex items-center space-x-1">
            {onOpenNotifications && (
              <button
                id="sidebar-notifications-btn"
                onClick={onOpenNotifications}
                className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors relative"
                title="Notifications"
              >
                <Bell className="w-4 h-4" />
                {unreadNotificationsCount > 0 && (
                  <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-violet-500" />
                )}
              </button>
            )}
            {onOpenSettings && (
              <button
                id="sidebar-settings-btn"
                onClick={onOpenSettings}
                className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors"
                title="Settings"
              >
                <Sliders className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      )}
    </aside>
  );
};
