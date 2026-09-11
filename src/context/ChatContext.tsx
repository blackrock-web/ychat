import React, { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import { syncEngine, ConnectionState } from '../storage/syncEngine';
import { clientDb, StoredConversation } from '../storage/db';
import { generateDeviceKeys, generateDeterministicDeviceKeys, getPublicBundlePayload, DeviceKeyBundle } from '../crypto/keys';
import { DecryptedMessage, PrekeyBundle, FileAttachment } from '../crypto/types';
import { AppSettings, DEFAULT_SETTINGS, AppNotification, BlockedUser } from '../types/settings';
import { useTheme } from './ThemeContext';
import { userPreferencesService } from '../services/userPreferencesService';

export interface UserSession {
  uuid: string;
  username: string;
  displayName: string;
  avatarUrl?: string;
  backgroundImage?: string;
  about?: string;
}

interface ChatContextType {
  user: UserSession | null;
  token: string | null;
  deviceId: string | null;
  deviceKeys: DeviceKeyBundle | null;
  connectionState: ConnectionState;
  isSimulatedOffline: boolean;
  conversations: StoredConversation[];
  activeConversation: StoredConversation | null;
  messages: DecryptedMessage[];
  pendingQueueCount: number;
  settings: AppSettings;
  updateSettings: (partial: Partial<AppSettings>) => void;
  notifications: AppNotification[];
  unreadNotificationsCount: number;
  markNotificationAsRead: (id: string) => void;
  markAllNotificationsAsRead: () => void;
  clearAllNotifications: () => void;
  addNotification: (notif: Omit<AppNotification, 'id' | 'timestamp' | 'read'>) => void;
  updateUserProfile: (updates: { displayName?: string; about?: string; avatarUrl?: string; backgroundImage?: string }) => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  deleteAccount: () => Promise<void>;
  revokeDevice: (targetDeviceId: string) => Promise<void>;
  blockedUsers: BlockedUser[];
  blockUser: (targetUuid: string) => Promise<void>;
  unblockUser: (targetUuid: string) => Promise<void>;
  toggleMuteConversation: (convId: string) => void;
  isConversationMuted: (convId: string) => boolean;
  searchStoredMessages: (keyword: string) => Promise<Array<{ message: DecryptedMessage; conversation: StoredConversation }>>;
  searchKeyword: string;
  setSearchKeyword: (keyword: string) => void;
  toggleReaction: (clientMessageId: string, emoji: string, messageId?: string) => Promise<void>;
  markMessagesAsRead: (conversationId: string) => void;
  login: (username: string, password: string, customDeviceId?: string, deterministicSeed?: string) => Promise<void>;
  register: (username: string, email: string, password: string, displayName: string, customDeviceId?: string, deterministicSeed?: string) => Promise<void>;
  demoLogin: (role: 'alice' | 'bob' | 'charlie') => Promise<void>;
  logout: () => void;
  selectConversation: (conv: StoredConversation) => Promise<void>;
  startConversationWithUser: (recipientUuid: string, recipientUsername: string, recipientDisplayName: string) => Promise<StoredConversation>;
  sendMessage: (text: string, attachment?: FileAttachment) => Promise<void>;
  retryMessage: (clientMessageId: string) => Promise<boolean>;
  retryAllFailedMessages: (conversationId?: string) => Promise<void>;
  reconnect: () => Promise<void>;
  toggleSimulatedOffline: () => void;
  refreshConversations: () => Promise<void>;
  verifyConversationSafety: (convId: string, verified: boolean) => Promise<void>;
  presenceMap: Record<string, { status: 'online' | 'away' | 'offline'; lastSeen?: number }>;
  typingMap: Record<string, boolean>;
  sendTyping: (conversationId: string, isTyping: boolean) => void;
  getUserPresence: (userUuid: string) => { status: 'online' | 'away' | 'offline'; lastSeen?: number };
  clearChatHistory: (conversationId: string) => Promise<void>;
  setPresence: (status: 'online' | 'away' | 'offline') => void;
}

export function playNotificationChime() {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.1); // A5
    gain.gain.setValueAtTime(0.06, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.22);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.22);
  } catch {}
}

const ChatContext = createContext<ChatContextType | null>(null);

export const ChatProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserSession | null>(() => {
    const saved = localStorage.getItem('ychat_user');
    return saved ? JSON.parse(saved) : null;
  });
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('ychat_token'));
  const [deviceId, setDeviceId] = useState<string | null>(() => localStorage.getItem('ychat_device_id'));
  const [deviceKeys, setDeviceKeys] = useState<DeviceKeyBundle | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>('offline');
  const [isSimulatedOffline, setIsSimulatedOffline] = useState(false);
  const [conversations, setConversations] = useState<StoredConversation[]>([]);
  const [activeConversation, setActiveConversation] = useState<StoredConversation | null>(null);
  const [messages, setMessages] = useState<DecryptedMessage[]>([]);
  const [pendingQueueCount, setPendingQueueCount] = useState(0);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [presenceMap, setPresenceMap] = useState<
    Record<string, { status: 'online' | 'away' | 'offline'; lastSeen?: number }>
  >({});
  const [typingMap, setTypingMap] = useState<Record<string, boolean>>({});
  const typingTimeoutRef = useRef<Record<string, any>>({});

  const { theme: themeFromProvider, setTheme } = useTheme();

  // Application Settings
  const [settings, setSettings] = useState<AppSettings>(() => {
    const saved = localStorage.getItem('ychat_settings');
    const base = saved ? { ...DEFAULT_SETTINGS, ...JSON.parse(saved) } : DEFAULT_SETTINGS;
    if (themeFromProvider) {
      base.theme = themeFromProvider;
    }
    return base;
  });

  const updateSettings = useCallback((partial: Partial<AppSettings>) => {
    if (partial.theme) {
      setTheme(partial.theme);
    }
    setSettings((prev) => {
      const updated = { ...prev, ...partial };
      localStorage.setItem('ychat_settings', JSON.stringify(updated));
      return updated;
    });

    // Asynchronously persist to backend/Supabase database
    if (token) {
      userPreferencesService.saveUserPreferences(token, partial).catch(() => {});
    }
  }, [setTheme, token]);

  // Keep settings.theme synchronized with ThemeProvider
  useEffect(() => {
    if (themeFromProvider && settings.theme !== themeFromProvider) {
      setSettings((prev) => ({ ...prev, theme: themeFromProvider }));
    }
  }, [themeFromProvider, settings.theme]);

  // Fetch user profile and preferences from database on initial load
  useEffect(() => {
    if (!token || !user?.uuid) return;
    let isMounted = true;

    userPreferencesService
      .fetchUserProfileAndPreferences(token)
      .then(({ profile, preferences }) => {
        if (!isMounted) return;

        // Apply updated user profile attributes
        setUser((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            displayName: profile.displayName || prev.displayName,
            avatarUrl: profile.avatarUrl !== undefined ? profile.avatarUrl : prev.avatarUrl,
            backgroundImage: profile.backgroundImage !== undefined ? profile.backgroundImage : prev.backgroundImage,
            about: profile.about !== undefined ? profile.about : prev.about
          };
        });

        // Apply preferences to settings state
        if (preferences) {
          setSettings((prev) => ({
            ...prev,
            ...preferences
          }));
          if (preferences.theme) {
            setTheme(preferences.theme);
          }
        }
      })
      .catch((err) => {
        console.warn('Initial preferences fetch warning:', err);
      });

    return () => {
      isMounted = false;
    };
  }, [token, user?.uuid, setTheme]);

  // Sync bubble color, wallpaper, and font-size to DOM (Theme is handled by ThemeProvider)
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-bubble-color', settings.bubbleColor);
    root.setAttribute('data-wallpaper', settings.chatWallpaper);
    if (settings.fontSize) {
      root.setAttribute('data-font-size', settings.fontSize);
    }
  }, [settings.bubbleColor, settings.chatWallpaper, settings.fontSize]);

  // Notifications State
  const [notifications, setNotifications] = useState<AppNotification[]>(() => {
    if (!user) return [];
    const saved = localStorage.getItem(`ychat_notifications_${user.uuid}`);
    return saved ? JSON.parse(saved) : [];
  });

  useEffect(() => {
    if (user) {
      const saved = localStorage.getItem(`ychat_notifications_${user.uuid}`);
      setNotifications(saved ? JSON.parse(saved) : []);
    } else {
      setNotifications([]);
    }
  }, [user?.uuid]);

  const addNotification = useCallback(
    (notif: Omit<AppNotification, 'id' | 'timestamp' | 'read'>) => {
      const newItem: AppNotification = {
        ...notif,
        id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        timestamp: Date.now(),
        read: false
      };
      setNotifications((prev) => {
        const updated = [newItem, ...prev].slice(0, 50);
        if (user) {
          localStorage.setItem(`ychat_notifications_${user.uuid}`, JSON.stringify(updated));
        }
        return updated;
      });
      if (settings.soundEnabled) {
        playNotificationChime();
      }
      if (
        settings.desktopNotificationsEnabled &&
        typeof Notification !== 'undefined' &&
        Notification.permission === 'granted'
      ) {
        try {
          new Notification(newItem.title, { body: newItem.description });
        } catch {}
      }
    },
    [user?.uuid, settings.soundEnabled, settings.desktopNotificationsEnabled]
  );

  const markNotificationAsRead = useCallback(
    (id: string) => {
      setNotifications((prev) => {
        const updated = prev.map((n) => (n.id === id ? { ...n, read: true } : n));
        if (user) {
          localStorage.setItem(`ychat_notifications_${user.uuid}`, JSON.stringify(updated));
        }
        return updated;
      });
    },
    [user?.uuid]
  );

  const markAllNotificationsAsRead = useCallback(() => {
    setNotifications((prev) => {
      const updated = prev.map((n) => ({ ...n, read: true }));
      if (user) {
        localStorage.setItem(`ychat_notifications_${user.uuid}`, JSON.stringify(updated));
      }
      return updated;
    });
  }, [user?.uuid]);

  const clearAllNotifications = useCallback(() => {
    setNotifications([]);
    if (user) {
      localStorage.setItem(`ychat_notifications_${user.uuid}`, JSON.stringify([]));
    }
  }, [user?.uuid]);

  const unreadNotificationsCount = notifications.filter((n) => !n.read).length;

  // Blocked users
  const [blockedUsers, setBlockedUsers] = useState<BlockedUser[]>([]);

  // Resilient authenticated fetch with automatic token rotation and recovery
  const authenticatedFetch = useCallback(
    async (url: string, init: RequestInit = {}): Promise<Response> => {
      let currentToken = token || localStorage.getItem('ychat_token');
      const headers = new Headers(init.headers || {});
      if (currentToken) {
        headers.set('Authorization', `Bearer ${currentToken}`);
      }

      let res = await fetch(url, { ...init, headers });

      // Proactively adopt refreshed tokens
      const refreshedToken = res.headers.get('x-refreshed-token');
      if (refreshedToken) {
        localStorage.setItem('ychat_token', refreshedToken);
        setToken(refreshedToken);
        currentToken = refreshedToken;
        if (deviceKeys && user) {
          syncEngine.setCredentials(refreshedToken, deviceKeys, user.uuid);
        }
      }

      // If unauthorized, attempt seamless session recovery
      if (res.status === 401) {
        const savedRefreshToken = localStorage.getItem('ychat_refresh_token');
        const savedUser = user || (localStorage.getItem('ychat_user') ? JSON.parse(localStorage.getItem('ychat_user')!) : null);

        let newToken: string | null = null;

        // Try /api/v1/auth/refresh
        if (savedRefreshToken) {
          try {
            const refreshRes = await fetch('/api/v1/auth/refresh', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ refreshToken: savedRefreshToken, userId: savedUser?.uuid })
            });
            if (refreshRes.ok) {
              const refreshData = await refreshRes.json();
              newToken = refreshData.tokens?.accessToken;
              if (refreshData.tokens?.refreshToken) {
                localStorage.setItem('ychat_refresh_token', refreshData.tokens.refreshToken);
              }
            }
          } catch (e) {
            console.warn('[Auth] Token refresh attempt failed:', e);
          }
        }

        // Auto-heal for demo users
        if (!newToken && savedUser?.username && ['alice', 'bob', 'charlie'].includes(savedUser.username)) {
          try {
            const loginRes = await fetch('/api/v1/auth/login', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                username: savedUser.username,
                password: `${savedUser.username}Password123!`
              })
            });
            if (loginRes.ok) {
              const lData = await loginRes.json();
              newToken = lData.tokens?.accessToken;
              if (lData.tokens?.refreshToken) {
                localStorage.setItem('ychat_refresh_token', lData.tokens.refreshToken);
              }
            }
          } catch (e) {
            console.warn('[Auth] Demo re-auth failed:', e);
          }
        }

        if (newToken) {
          localStorage.setItem('ychat_token', newToken);
          setToken(newToken);
          if (deviceKeys && savedUser) {
            syncEngine.setCredentials(newToken, deviceKeys, savedUser.uuid);
          }
          headers.set('Authorization', `Bearer ${newToken}`);
          res = await fetch(url, { ...init, headers });
        }
      }

      return res;
    },
    [token, user, deviceKeys]
  );

  const fetchBlockedUsers = useCallback(async () => {
    if (!token && !localStorage.getItem('ychat_token')) return;
    try {
      const res = await authenticatedFetch('/api/v1/users/blocked');
      if (res.ok) {
        const data = await res.json();
        setBlockedUsers(data.blocked || []);
      }
    } catch {}
  }, [token, authenticatedFetch]);

  useEffect(() => {
    if (token) fetchBlockedUsers();
  }, [token, fetchBlockedUsers]);

  const blockUser = async (targetUuid: string) => {
    if (!token && !localStorage.getItem('ychat_token')) return;
    await authenticatedFetch('/api/v1/users/block', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetUuid })
    });
    await fetchBlockedUsers();
  };

  const unblockUser = async (targetUuid: string) => {
    if (!token && !localStorage.getItem('ychat_token')) return;
    await authenticatedFetch('/api/v1/users/unblock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetUuid })
    });
    await fetchBlockedUsers();
  };

  const isConversationMuted = useCallback(
    (convId: string) => {
      return settings.mutedConversations.includes(convId);
    },
    [settings.mutedConversations]
  );

  const toggleMuteConversation = useCallback(
    (convId: string) => {
      updateSettings({
        mutedConversations: settings.mutedConversations.includes(convId)
          ? settings.mutedConversations.filter((id) => id !== convId)
          : [...settings.mutedConversations, convId]
      });
    },
    [settings.mutedConversations, updateSettings]
  );

  const searchStoredMessages = useCallback(
    async (keyword: string) => {
      const q = keyword.toLowerCase().trim();
      if (!q) return [];
      const results: Array<{ message: DecryptedMessage; conversation: StoredConversation }> = [];
      for (const conv of conversations) {
        const msgs = await clientDb.getMessagesForConversation(conv.id);
        for (const m of msgs) {
          if (m.text && m.text.toLowerCase().includes(q)) {
            results.push({ message: m, conversation: conv });
          }
        }
      }
      return results.sort((a, b) => b.message.timestamp - a.message.timestamp);
    },
    [conversations]
  );

  const markMessagesAsRead = useCallback(
    (conversationId: string) => {
      if (!settings.readReceiptsEnabled) return;
      clientDb.getMessagesForConversation(conversationId).then((msgs) => {
        let changed = false;
        msgs.forEach((m) => {
          if (m.senderUserUuid !== user?.uuid && m.status !== 'read') {
            syncEngine.sendReceipt(m.id, m.clientMessageId, 'read');
            clientDb.updateMessageStatus(m.clientMessageId, 'read');
            changed = true;
          }
        });
        if (changed) {
          setMessages((prev) =>
            prev.map((m) =>
              m.conversationId === conversationId && m.senderUserUuid !== user?.uuid && m.status !== 'read'
                ? { ...m, status: 'read' }
                : m
            )
          );
        }
      });
    },
    [settings.readReceiptsEnabled, user?.uuid]
  );

  // Initialize or restore device keys from user-scoped storage
  const initDeviceKeys = useCallback(async (devId: string, deterministicSeed?: string): Promise<DeviceKeyBundle> => {
    let keys = await clientDb.getDeviceKeys(devId);
    let needsRegen = !keys || !keys.privateKeys || !keys.publicKeys;

    if (deterministicSeed) {
      const expectedKeys = generateDeterministicDeviceKeys(devId, deterministicSeed, 25);
      if (!keys || !keys.publicKeys || keys.publicKeys.signingKey !== expectedKeys.publicKeys.signingKey) {
        keys = expectedKeys;
        await clientDb.saveDeviceKeys(keys);
        needsRegen = false;
      }
    }

    if (needsRegen) {
      keys = generateDeviceKeys(devId, 25);
      await clientDb.saveDeviceKeys(keys);
    }
    setDeviceKeys(keys!);
    return keys!;
  }, []);

  // Update pending queue count
  const updateQueueCount = useCallback(async () => {
    const queue = await clientDb.getSyncQueue();
    setPendingQueueCount(queue.length);
  }, []);

  // SyncEngine connection listener
  useEffect(() => {
    const unsubscribe = syncEngine.onConnectionChange((state) => {
      setConnectionState(state);
      updateQueueCount();
    });
    return unsubscribe;
  }, [updateQueueCount]);

  // Load conversations strictly isolated to the authenticated user
  const refreshConversations = useCallback(async () => {
    if (!token || !user) {
      setConversations([]);
      return;
    }
    try {
      // 1. Fetch participant-isolated conversations from backend
      const res = await fetch('/api/v1/conversations', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        const serverConvs: Array<{
          id: string;
          conversationType: string;
          members: Array<{ uuid: string; username: string; displayName: string; avatarUrl?: string }>;
          createdAt: string;
        }> = data.conversations || [];

        const validConvIds = new Set(serverConvs.map(c => c.id));
        const updatedList: StoredConversation[] = [];

        for (const sConv of serverConvs) {
          const recipient = sConv.members.find(m => m.uuid !== user.uuid);
          if (!recipient) continue;

          // Merge with locally stored metadata
          const local = await clientDb.getConversation(sConv.id);
          const merged: StoredConversation = {
            id: sConv.id,
            ownerUserId: user.uuid,
            recipientUuid: recipient.uuid,
            recipientUsername: recipient.username,
            recipientDisplayName: recipient.displayName,
            recipientAvatarUrl: recipient.avatarUrl || local?.recipientAvatarUrl,
            lastMessageText: local?.lastMessageText,
            lastMessageTimestamp: local?.lastMessageTimestamp,
            unreadCount: local?.unreadCount || 0,
            isVerifiedSafetyNumber: local?.isVerifiedSafetyNumber || false
          };
          await clientDb.saveConversation(merged);
          updatedList.push(merged);
        }

        // Prune any cached conversations that do NOT belong to this user or are no longer valid
        await clientDb.pruneUnauthorizedConversations(user.uuid, validConvIds);
        setConversations(updatedList);
      } else {
        const list = await clientDb.getAllConversations(user.uuid);
        setConversations(list);
      }
    } catch {
      const list = await clientDb.getAllConversations(user.uuid);
      setConversations(list);
    }
  }, [token, user?.uuid]);

  // SyncEngine message listener
  useEffect(() => {
    const unsubscribe = syncEngine.onMessage((newMsg) => {
      if (activeConversation && newMsg.conversationId === activeConversation.id) {
        setMessages((prev) => {
          if (prev.some((m) => m.clientMessageId === newMsg.clientMessageId)) return prev;
          return [...prev, newMsg];
        });
        if (settings.readReceiptsEnabled && newMsg.senderUserUuid !== user?.uuid) {
          syncEngine.sendReceipt(newMsg.id, newMsg.clientMessageId, 'read');
        }
      } else {
        if (!settings.mutedConversations.includes(newMsg.conversationId)) {
          addNotification({
            type: 'message',
            title: 'New Encrypted Message',
            description:
              newMsg.text && newMsg.text.length > 50
                ? newMsg.text.slice(0, 50) + '...'
                : newMsg.text,
            data: { conversationId: newMsg.conversationId, messageId: newMsg.id }
          });
        }
      }
      refreshConversations();
      updateQueueCount();
    });
    return unsubscribe;
  }, [
    activeConversation,
    refreshConversations,
    updateQueueCount,
    settings.readReceiptsEnabled,
    settings.mutedConversations,
    user?.uuid,
    addNotification
  ]);

  // SyncEngine notification listener (for WebSocket pushes: device linked, safety number changed, conversation request)
  useEffect(() => {
    const unsubscribe = syncEngine.onNotification((notif) => {
      addNotification({
        type: notif.type,
        title: notif.title,
        description: notif.description,
        data: notif.data
      });
    });
    return unsubscribe;
  }, [addNotification]);

  // SyncEngine receipt listener
  useEffect(() => {
    const unsubscribe = syncEngine.onReceipt((clientMsgId, status, failureCategory, reason, readAt) => {
      setMessages((prev) =>
        prev.map((m) => {
          if (m.clientMessageId === clientMsgId) {
            const nowIso = new Date().toISOString();
            return {
              ...m,
              status,
              readAt: readAt || (status === 'read' ? (m.readAt || nowIso) : m.readAt),
              deliveredAt: status === 'delivered' || status === 'read' ? (m.deliveredAt || nowIso) : m.deliveredAt,
              failureReason: failureCategory as any,
              errorMessage: reason || (status === 'failed' ? "Message couldn't be delivered" : m.errorMessage)
            };
          }
          return m;
        })
      );
      updateQueueCount();
    });
    return unsubscribe;
  }, [updateQueueCount]);

  // SyncEngine reaction listener
  useEffect(() => {
    const unsubscribe = syncEngine.onReaction((data) => {
      setMessages((prev) =>
        prev.map((m) => {
          if (m.clientMessageId === data.clientMessageId) {
            const reactions = { ...(m.reactions || {}) };
            const users = new Set(reactions[data.emoji] || []);
            if (users.has(data.userUuid)) {
              users.delete(data.userUuid);
            } else {
              users.add(data.userUuid);
            }
            if (users.size === 0) {
              delete reactions[data.emoji];
            } else {
              reactions[data.emoji] = Array.from(users);
            }
            return { ...m, reactions };
          }
          return m;
        })
      );
    });
    return unsubscribe;
  }, []);

  // SyncEngine presence listener (real-time connection status & lastSeen from server)
  useEffect(() => {
    const unsubscribe = syncEngine.onPresence((userUuid, status, lastSeen) => {
      setPresenceMap((prev) => ({
        ...prev,
        [userUuid]: { status, lastSeen }
      }));
    });
    return unsubscribe;
  }, []);

  // Batch-sync presence states for all conversation partners whenever conversations update
  useEffect(() => {
    if (!token || conversations.length === 0) return;
    const partnerUuids = Array.from(
      new Set(conversations.map((c) => c.recipientUuid).filter(Boolean))
    );
    if (partnerUuids.length === 0) return;

    fetch('/api/v1/users/presence/batch', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ userUuids: partnerUuids })
    })
      .then((res) => {
        if (!res.ok) return null;
        return res.json();
      })
      .then((data) => {
        if (data && Array.isArray(data.presences)) {
          setPresenceMap((prev) => {
            const next = { ...prev };
            data.presences.forEach((p: any) => {
              next[p.userUuid] = { status: p.status, lastSeen: p.lastSeen };
            });
            return next;
          });
        }
      })
      .catch(() => {});
  }, [conversations, token]);

  // SyncEngine typing listener (isolated per conversation)
  useEffect(() => {
    const unsubscribe = syncEngine.onTyping((data) => {
      if (data.userUuid === user?.uuid) return;

      setTypingMap((prev) => ({
        ...prev,
        [data.conversationId]: data.isTyping
      }));

      // Auto-clear typing indicator after 3.5 seconds if no stop event was received
      if (data.isTyping) {
        if (typingTimeoutRef.current[data.conversationId]) {
          clearTimeout(typingTimeoutRef.current[data.conversationId]);
        }
        typingTimeoutRef.current[data.conversationId] = setTimeout(() => {
          setTypingMap((prev) => ({
            ...prev,
            [data.conversationId]: false
          }));
        }, 3500);
      }
    });
    return unsubscribe;
  }, [user?.uuid]);

  // Initialize active session on mount if credentials exist
  useEffect(() => {
    let isMounted = true;
    if (token && user && deviceId) {
      clientDb.initUserScope(user.uuid).then(() => {
        if (!isMounted) return;
        const seed = (user.username === 'alice' || user.username === 'bob' || user.username === 'charlie')
          ? `${user.username}-device-seed-v1`
          : undefined;
        initDeviceKeys(deviceId, seed).then(async (keys) => {
          if (!isMounted) return;
          try {
            await registerDeviceOnServer(token, keys);
          } catch (e) {
            console.warn('Device registration sync:', e);
          }
          syncEngine.setCredentials(token, keys, user.uuid);
          refreshConversations();
          updateQueueCount();
        });
      });
    } else if (clientDb.getActiveUserId()) {
      clientDb.clearUserScope();
    }
    return () => {
      isMounted = false;
    };
  }, [token, user?.uuid, deviceId, initDeviceKeys, refreshConversations, updateQueueCount]);

  // Load messages when active conversation changes
  useEffect(() => {
    if (activeConversation && user) {
      // Security guard: verify conversation belongs to active user
      if (activeConversation.ownerUserId && activeConversation.ownerUserId !== user.uuid) {
        setMessages([]);
        return;
      }

      syncEngine.setActiveConversation(activeConversation.id);

      clientDb.getMessagesForConversation(activeConversation.id).then((msgs) => {
        setMessages(msgs);
        // Reset unread count
        if (activeConversation.unreadCount > 0) {
          const updated = { ...activeConversation, unreadCount: 0 };
          clientDb.saveConversation(updated);
          setActiveConversation(updated);
          refreshConversations();
        }
        if (settings.readReceiptsEnabled) {
          msgs.forEach((m) => {
            if (m.senderUserUuid !== user.uuid && m.status !== 'read') {
              syncEngine.sendReceipt(m.id, m.clientMessageId, 'read');
            }
          });
        }
      });
    } else {
      syncEngine.setActiveConversation(null);
      setMessages([]);
    }
  }, [activeConversation?.id, user?.uuid, refreshConversations, settings.readReceiptsEnabled]);

  const registerDeviceOnServer = async (authToken: string, bundle: DeviceKeyBundle) => {
    const payload = getPublicBundlePayload(bundle, 'YChat Web App (Vite/React)', 'web');
    await fetch('/api/v1/devices/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`
      },
      body: JSON.stringify(payload)
    });
  };

  const login = async (
    username: string,
    password: string,
    customDeviceId?: string,
    deterministicSeed?: string
  ) => {
    const res = await fetch('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to sign in');
    }

    const data = await res.json();
    const devId = customDeviceId ||
      (data.user.username === 'alice' || data.user.username === 'bob' || data.user.username === 'charlie'
        ? `dev-${data.user.username}-primary`
        : localStorage.getItem(`ychat_device_id_${data.user.uuid}`) || `dev-${data.user.uuid.slice(0, 8)}-primary`);

    const seed = deterministicSeed ||
      (data.user.username === 'alice' || data.user.username === 'bob' || data.user.username === 'charlie'
        ? `${data.user.username}-device-seed-v1`
        : undefined);

    // 1. Initialize user-scoped isolated storage
    await clientDb.initUserScope(data.user.uuid);

    // 2. Persist session
    localStorage.setItem('ychat_token', data.tokens.accessToken);
    localStorage.setItem('ychat_user', JSON.stringify(data.user));
    localStorage.setItem('ychat_device_id', devId);
    localStorage.setItem(`ychat_device_id_${data.user.uuid}`, devId);

    setToken(data.tokens.accessToken);
    setUser(data.user);
    setDeviceId(devId);
    setActiveConversation(null);
    setMessages([]);

    // 3. Provision keys and sync
    const keys = await initDeviceKeys(devId, seed);
    await registerDeviceOnServer(data.tokens.accessToken, keys);
    syncEngine.setCredentials(data.tokens.accessToken, keys, data.user.uuid);

    // 4. Fetch strictly isolated conversations
    await refreshConversations();
  };

  const register = async (
    username: string,
    email: string,
    password: string,
    displayName: string,
    customDeviceId?: string,
    deterministicSeed?: string
  ) => {
    const res = await fetch('/api/v1/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, email, password, displayName })
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Registration failed');
    }

    const data = await res.json();
    const devId = customDeviceId || `dev-${data.user.uuid.slice(0, 8)}-primary`;

    // 1. Initialize user-scoped isolated storage
    await clientDb.initUserScope(data.user.uuid);

    // 2. Persist session
    localStorage.setItem('ychat_token', data.tokens.accessToken);
    localStorage.setItem('ychat_user', JSON.stringify(data.user));
    localStorage.setItem('ychat_device_id', devId);
    localStorage.setItem(`ychat_device_id_${data.user.uuid}`, devId);

    setToken(data.tokens.accessToken);
    setUser(data.user);
    setDeviceId(devId);
    setActiveConversation(null);
    setMessages([]);

    // 3. Provision keys and sync
    const keys = await initDeviceKeys(devId, deterministicSeed);
    await registerDeviceOnServer(data.tokens.accessToken, keys);
    syncEngine.setCredentials(data.tokens.accessToken, keys, data.user.uuid);

    // 4. Fetch strictly isolated conversations
    await refreshConversations();
  };

  const demoLogin = async (role: 'alice' | 'bob' | 'charlie') => {
    const username = role;
    const password = `${role}Password123!`;
    const email = `${role}@ychat.local`;
    const displayName =
      role === 'alice' ? 'Alice Sterling' :
      role === 'bob' ? 'Bob Vance' :
      'Charlie Davis';

    const devId = `dev-${role}-primary`;
    const seed = `${role}-device-seed-v1`;

    try {
      await login(username, password, devId, seed);
    } catch {
      await register(username, email, password, displayName, devId, seed);
    }
  };

  const logout = () => {
    syncEngine.clearCredentials();
    clientDb.clearUserScope();
    localStorage.removeItem('ychat_token');
    localStorage.removeItem('ychat_user');
    localStorage.removeItem('ychat_device_id');
    setToken(null);
    setUser(null);
    setDeviceId(null);
    setDeviceKeys(null);
    setConversations([]);
    setActiveConversation(null);
    setMessages([]);
  };

  const selectConversation = async (conv: StoredConversation) => {
    // Individual participant isolation check: verify that this conversation belongs to the active user
    if (!user || (conv.ownerUserId && conv.ownerUserId !== user.uuid)) {
      console.error('Forbidden: Cannot access conversation of another user');
      return;
    }
    setSearchKeyword('');
    setActiveConversation(conv);
    syncEngine.setActiveConversation(conv.id);

    // Fetch conversation history from local database
    const localMsgs = await clientDb.getMessagesForConversation(conv.id);
    setMessages(localMsgs);

    if (conv.unreadCount > 0) {
      const updated = { ...conv, unreadCount: 0 };
      await clientDb.saveConversation(updated);
      setActiveConversation(updated);
      refreshConversations();
    }

    if (settings.readReceiptsEnabled) {
      localMsgs.forEach((m) => {
        if (m.senderUserUuid !== user.uuid && m.status !== 'read') {
          syncEngine.sendReceipt(m.id, m.clientMessageId, 'read');
        }
      });
    }

    // Pull authoritative messages for this conversation from the server
    await syncEngine.syncConversationMessages(conv.id);
    const refreshedMsgs = await clientDb.getMessagesForConversation(conv.id);
    setMessages(refreshedMsgs);
  };

  const toggleReaction = useCallback(
    async (clientMessageId: string, emoji: string, messageId?: string) => {
      if (!user || !activeConversation) return;

      // Optimistically update local message state
      setMessages((prev) =>
        prev.map((m) => {
          if (m.clientMessageId === clientMessageId) {
            const reactions = { ...(m.reactions || {}) };
            const users = new Set(reactions[emoji] || []);
            if (users.has(user.uuid)) {
              users.delete(user.uuid);
            } else {
              users.add(user.uuid);
            }
            if (users.size === 0) {
              delete reactions[emoji];
            } else {
              reactions[emoji] = Array.from(users);
            }
            return { ...m, reactions };
          }
          return m;
        })
      );

      // Persist in client IndexedDB
      await clientDb.updateMessageReactions(clientMessageId, emoji, user.uuid);

      // Emit to peer via WebSocket/REST
      syncEngine.sendReaction(activeConversation.id, clientMessageId, emoji, messageId);
    },
    [user, activeConversation]
  );

  const startConversationWithUser = async (
    recipientUuid: string,
    recipientUsername: string,
    recipientDisplayName: string
  ): Promise<StoredConversation> => {
    if (!token || !user) throw new Error('Not logged in');

    // Call server to create or retrieve 1:1 conversation
    const res = await fetch('/api/v1/conversations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ recipientUuid })
    });

    if (!res.ok) {
      throw new Error('Failed to initiate conversation');
    }

    const data = await res.json();
    const convId = data.conversationId;

    const existing = conversations.find((c) => c.id === convId);
    if (existing) {
      setActiveConversation(existing);
      syncEngine.setActiveConversation(existing.id);
      return existing;
    }

    const newConv: StoredConversation = {
      id: convId,
      ownerUserId: user.uuid,
      recipientUuid,
      recipientUsername,
      recipientDisplayName,
      unreadCount: 0,
      isVerifiedSafetyNumber: false
    };

    await clientDb.saveConversation(newConv);
    await refreshConversations();
    setActiveConversation(newConv);
    syncEngine.setActiveConversation(newConv.id);
    return newConv;
  };

  const sendMessage = async (text: string, attachment?: FileAttachment) => {
    if (!activeConversation || !token || !deviceKeys || !user) {
      throw new Error('No active conversation or session');
    }
    if (!text.trim() && !attachment) return;

    // 1. Resolve recipient UUID if missing
    let recipientUuid = activeConversation.recipientUuid;
    if (!recipientUuid) {
      try {
        const cRes = await fetch(`/api/v1/conversations/${activeConversation.id}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (cRes.ok) {
          const cData = await cRes.json();
          const other = (cData.members || []).find((m: any) => m.uuid !== user.uuid);
          if (other) {
            recipientUuid = other.uuid;
            activeConversation.recipientUuid = other.uuid;
            activeConversation.recipientUsername = other.username;
            activeConversation.recipientDisplayName = other.displayName;
            await clientDb.saveConversation(activeConversation);
          }
        }
      } catch {}
    }

    if (!recipientUuid) {
      throw new Error('Recipient information missing from conversation');
    }

    // Fetch recipient's device prekeys for cryptographic handshake
    const devRes = await fetch(`/api/v1/devices/user/${encodeURIComponent(recipientUuid)}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!devRes.ok) {
      const errBody = await devRes.json().catch(() => ({ error: devRes.statusText }));
      throw new Error(errBody.error || `Failed to fetch recipient device info (${devRes.status})`);
    }
    const devData = await devRes.json();
    const recipientDevices = devData.devices || [];

    if (recipientDevices.length === 0) {
      throw new Error('Recipient has no registered devices yet');
    }

    // Authoritative single-device destination: direct UUID-to-UUID messaging (no multi-device fan-out)
    const primaryDevice = recipientDevices[0];
    const prekeyRes = await fetch(`/api/v1/devices/${encodeURIComponent(primaryDevice.id)}/prekeys`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!prekeyRes.ok) {
      throw new Error('Failed to fetch recipient prekey bundle');
    }
    const recipientBundle: PrekeyBundle = await prekeyRes.json();

    // Dispatch encrypted envelope directly to recipient UUID
    const sentMsg = await syncEngine.sendTextMessage(
      activeConversation.id,
      primaryDevice.id,
      recipientBundle,
      text,
      recipientUuid,
      true,
      attachment,
      settings.offlineRetentionMinutes
    );

    // 4. Update UI state immediately
    setMessages((prev) => [...prev, sentMsg!]);

    // 5. Update conversation last message metadata
    const summaryText = text || (attachment ? `📎 ${attachment.fileName}` : '');
    const updatedConv: StoredConversation = {
      ...activeConversation,
      ownerUserId: user.uuid,
      lastMessageText: summaryText,
      lastMessageTimestamp: Date.now()
    };
    await clientDb.saveConversation(updatedConv);
    setActiveConversation(updatedConv);
    await refreshConversations();
    await updateQueueCount();
  };

  const retryMessage = async (clientMessageId: string): Promise<boolean> => {
    const success = await syncEngine.retryMessage(clientMessageId);
    if (activeConversation) {
      const refreshed = await clientDb.getMessages(activeConversation.id);
      setMessages(refreshed);
    }
    await updateQueueCount();
    return success;
  };

  const retryAllFailedMessages = async (conversationId?: string): Promise<void> => {
    await syncEngine.retryAllFailedMessages(conversationId || activeConversation?.id);
    if (activeConversation) {
      const refreshed = await clientDb.getMessages(activeConversation.id);
      setMessages(refreshed);
    }
    await updateQueueCount();
  };

  const reconnect = async (): Promise<void> => {
    await syncEngine.reconnect();
  };

  const toggleSimulatedOffline = () => {
    setIsSimulatedOffline((prev) => {
      const next = !prev;
      if (next) {
        // Disconnect WebSocket and simulate offline mode
        (syncEngine as any).ws?.close();
        (syncEngine as any).setConnectionState('offline');
      } else {
        // Reconnect
        if (token && deviceKeys && user) {
          syncEngine.setCredentials(token, deviceKeys, user.uuid);
        }
      }
      return next;
    });
  };

  const verifyConversationSafety = async (convId: string, verified: boolean) => {
    const conv = conversations.find((c) => c.id === convId);
    if (conv && user) {
      const updated = { ...conv, ownerUserId: user.uuid, isVerifiedSafetyNumber: verified };
      await clientDb.saveConversation(updated);
      setConversations((prev) => prev.map((c) => (c.id === convId ? updated : c)));
      if (activeConversation?.id === convId) {
        setActiveConversation(updated);
      }
    }
  };

  const updateUserProfile = async (updates: { displayName?: string; about?: string; avatarUrl?: string; backgroundImage?: string }) => {
    if (!token || !user) throw new Error('Not logged in');
    const updatedUser = await userPreferencesService.saveUserProfile(token, updates);
    const nextUser: UserSession = {
      ...user,
      displayName: updatedUser.displayName,
      about: updatedUser.about,
      avatarUrl: updatedUser.avatarUrl,
      backgroundImage: updatedUser.backgroundImage
    };
    setUser(nextUser);
    localStorage.setItem('ychat_user', JSON.stringify(nextUser));

    if (updates.backgroundImage) {
      updateSettings({ chatWallpaper: 'custom', customWallpaperUrl: updates.backgroundImage });
    }
  };

  const changePassword = async (curr: string, next: string) => {
    if (!token) throw new Error('Not logged in');
    const res = await fetch('/api/v1/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ currentPassword: curr, newPassword: next })
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to change password');
    }
  };

  const deleteAccount = async () => {
    if (!token) throw new Error('Not logged in');
    const res = await fetch('/api/v1/auth/delete-account', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to delete account');
    }
    logout();
  };

  const revokeDevice = async (targetDeviceId: string) => {
    if (!token) throw new Error('Not logged in');
    const res = await fetch(`/api/v1/devices/${encodeURIComponent(targetDeviceId)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to revoke device');
    }
    if (targetDeviceId === deviceId) {
      logout();
    }
  };

  const sendTyping = useCallback((conversationId: string, isTyping: boolean) => {
    syncEngine.sendTyping(conversationId, isTyping);
  }, []);

  const setPresence = useCallback((status: 'online' | 'away' | 'offline') => {
    syncEngine.sendPresence(status);
  }, []);

  const getUserPresence = useCallback(
    (userUuid: string) => {
      return presenceMap[userUuid] || { status: 'offline' };
    },
    [presenceMap]
  );

  const clearChatHistory = useCallback(
    async (conversationId: string) => {
      await clientDb.clearMessagesForConversation(conversationId);
      if (activeConversation?.id === conversationId) {
        setMessages([]);
      }
      const conv = await clientDb.getConversation(conversationId);
      if (conv) {
        conv.lastMessageText = undefined;
        conv.unreadCount = 0;
        await clientDb.saveConversation(conv);
        refreshConversations();
      }
    },
    [activeConversation?.id, refreshConversations]
  );

  return (
    <ChatContext.Provider
      value={{
        user,
        token,
        deviceId,
        deviceKeys,
        connectionState,
        isSimulatedOffline,
        conversations,
        activeConversation,
        messages,
        pendingQueueCount,
        settings,
        updateSettings,
        notifications,
        unreadNotificationsCount,
        markNotificationAsRead,
        markAllNotificationsAsRead,
        clearAllNotifications,
        addNotification,
        updateUserProfile,
        changePassword,
        deleteAccount,
        revokeDevice,
        blockedUsers,
        blockUser,
        unblockUser,
        toggleMuteConversation,
        isConversationMuted,
        searchStoredMessages,
        searchKeyword,
        setSearchKeyword,
        toggleReaction,
        markMessagesAsRead,
        login,
        register,
        demoLogin,
        logout,
        selectConversation,
        startConversationWithUser,
        sendMessage,
        retryMessage,
        retryAllFailedMessages,
        reconnect,
        toggleSimulatedOffline,
        refreshConversations,
        verifyConversationSafety,
        presenceMap,
        typingMap,
        sendTyping,
        getUserPresence,
        clearChatHistory,
        setPresence
      }}
    >
      {children}
    </ChatContext.Provider>
  );
};

export const useChat = () => {
  const context = useContext(ChatContext);
  if (!context) {
    throw new Error('useChat must be used within a ChatProvider');
  }
  return context;
};

