import React, { useState } from 'react';
import { useChat } from '../context/ChatContext';
import { StoredConversation } from '../storage/db';
import { Plus, Search, ShieldCheck, MessageSquare, Clock } from 'lucide-react';

interface SidebarProps {
  onOpenNewChat: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ onOpenNewChat }) => {
  const { conversations, activeConversation, selectConversation, deviceId, user } = useChat();
  const [searchTerm, setSearchTerm] = useState('');

  const filteredConversations = conversations.filter(
    (c) =>
      c.recipientUsername.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.recipientDisplayName.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const formatTimestamp = (timestamp?: number) => {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    const now = new Date();
    if (date.toDateString() === now.toDateString()) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  return (
    <aside className="w-full md:w-80 lg:w-96 bg-slate-900 border-r border-slate-800 flex flex-col h-full select-none">
      {/* Search & New Chat Action */}
      <div className="p-4 border-b border-slate-800 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">Conversations</h2>
          <button
            onClick={onOpenNewChat}
            className="flex items-center space-x-1 px-2.5 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium shadow-sm transition-all"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Chat</span>
          </button>
        </div>

        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder="Search conversations..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-200 text-xs focus:outline-none focus:border-violet-500 transition-colors placeholder:text-slate-500"
          />
        </div>
      </div>

      {/* Conversations List */}
      <div className="flex-1 overflow-y-auto divide-y divide-slate-800/50">
        {filteredConversations.length === 0 ? (
          <div className="p-8 text-center text-slate-500 text-xs flex flex-col items-center justify-center space-y-2">
            <MessageSquare className="w-8 h-8 text-slate-600 mb-1" />
            <p className="font-medium text-slate-400">No conversations yet</p>
            <p className="max-w-[200px]">Click "New Chat" to search users and start a post-quantum encrypted chat.</p>
          </div>
        ) : (
          filteredConversations.map((conv) => {
            const isActive = activeConversation?.id === conv.id;
            return (
              <div
                key={conv.id}
                onClick={() => selectConversation(conv)}
                className={`p-3.5 flex items-center space-x-3 cursor-pointer transition-all ${
                  isActive
                    ? 'bg-violet-950/40 border-l-2 border-violet-500'
                    : 'hover:bg-slate-800/60'
                }`}
              >
                {/* Avatar with status indicator */}
                <div className="relative">
                  <div className="w-11 h-11 rounded-full bg-gradient-to-tr from-violet-700 to-slate-700 flex items-center justify-center text-white font-bold text-sm shadow-inner">
                    {conv.recipientDisplayName.charAt(0).toUpperCase()}
                  </div>
                  {conv.isVerifiedSafetyNumber && (
                    <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-emerald-500 border-2 border-slate-900 flex items-center justify-center">
                      <ShieldCheck className="w-2.5 h-2.5 text-slate-950" />
                    </div>
                  )}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-xs font-semibold text-slate-200 truncate">
                      {conv.recipientDisplayName}
                    </span>
                    <span className="text-[10px] text-slate-500 whitespace-nowrap ml-2">
                      {formatTimestamp(conv.lastMessageTimestamp)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <p className="text-[11px] text-slate-400 truncate pr-2">
                      {conv.lastMessageText || <span className="italic text-slate-500">Encrypted handshake ready</span>}
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
        )}
      </div>

      {/* Device Info Footer */}
      <div className="p-3 bg-slate-950/80 border-t border-slate-800 text-[10px] text-slate-400 flex items-center justify-between">
        <div className="flex items-center space-x-1.5 truncate">
          <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
          <span className="truncate font-mono">Device: {deviceId}</span>
        </div>
        <span className="text-slate-500 font-medium">Zero-Knowledge</span>
      </div>
    </aside>
  );
};
