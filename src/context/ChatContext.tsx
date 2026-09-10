import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { syncEngine, ConnectionState } from '../storage/syncEngine';
import { clientDb, StoredConversation } from '../storage/db';
import { generateDeviceKeys, generateDeterministicDeviceKeys, getPublicBundlePayload, DeviceKeyBundle } from '../crypto/keys';
import { DecryptedMessage, PrekeyBundle } from '../crypto/types';
import { AppSettings, DEFAULT_SETTINGS, AppNotification, BlockedUser } from '../types/settings';

export interface UserSession {
  uuid: string;
  username: string;
  displayName: string;
  avatarUrl?: string;
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
  updateUserProfile: (updates: { displayName?: string; about?: string; avatarUrl?: string }) => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  deleteAccount: () => Promise<void>;
  revokeDevice: (targetDeviceId: string) => Promise<void>;
  blockedUsers: BlockedUser[];
  blockUser: (targetUuid: string) => Promise<void>;
  unblockUser: (targetUuid: string) => Promise<void>;
  toggleMuteConversation: (convId: string) => void;
  isConversationMuted: (convId: string) => boolean;
  searchStoredMessages: (keyword: string) => Promise<Array<{ message: DecryptedMessage; conversation: StoredConversation }>>;
  markMessagesAsRead: (conversationId: string) => void;
  login: (username: string, password: string, customDeviceId?: string, deterministicSeed?: string) => Promise<void>;
  register: (username: string, email: string, password: string, displayName: string, customDeviceId?: string, deterministicSeed?: string) => Promise<void>;
  demoLogin: (role: 'alice' | 'bob' | 'charlie') => Promise<void>;
  logout: () => void;
  selectConversation: (conv: StoredConversation) => Promise<void>;
  startConversationWithUser: (recipientUuid: string, recipientUsername: string, recipientDisplayName: string) => Promise<StoredConversation>;
  sendMessage: (text: string) => Promise<void>;
  toggleSimulatedOffline: () => void;
  refreshConversations: () => Promise<void>;
  verifyConversationSafety: (convId: string, verified: boolean) => Promise<void>;
}

function playNotificationChime() {
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

  // Application Settings
  const [settings, setSettings] = useState<AppSettings>(() => {
    const saved = localStorage.getItem('ychat_settings');
    return saved ? { ...DEFAULT_SETTINGS, ...JSON.parse(saved) } : DEFAULT_SETTINGS;
  });

  const updateSettings = useCallback((partial: Partial<AppSettings>) => {
    setSettings((prev) => {
      const updated = { ...prev, ...partial };
      localStorage.setItem('ychat_settings', JSON.stringify(updated));
      return updated;
    });
  }, []);

  // Sync theme mode, bubble color, and wallpaper to DOM
  useEffect(() => {
    const root = document.documentElement;
    const isDark =
      settings.theme === 'dark' ||
      (settings.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

    if (isDark) {
      root.classList.add('dark');
      root.classList.remove('light');
    } else {
      root.classList.remove('dark');
      root.classList.add('light');
    }
    root.setAttribute('data-bubble-color', settings.bubbleColor);
    root.setAttribute('data-wallpaper', settings.chatWallpaper);
  }, [settings.theme, settings.bubbleColor, settings.chatWallpaper]);

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

  const fetchBlockedUsers = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch('/api/v1/users/blocked', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setBlockedUsers(data.blocked || []);
      }
    } catch {}
  }, [token]);

  useEffect(() => {
    if (token) fetchBlockedUsers();
  }, [token, fetchBlockedUsers]);

  const blockUser = async (targetUuid: string) => {
    if (!token) return;
    await fetch('/api/v1/users/block', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ targetUuid })
    });
    await fetchBlockedUsers();
  };

  const unblockUser = async (targetUuid: string) => {
    if (!token) return;
    await fetch('/api/v1/users/unblock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
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
        msgs.forEach((m) => {
          if (m.senderUserUuid !== user?.uuid && m.status !== 'read') {
            syncEngine.sendReceipt(m.id, m.clientMessageId, 'read');
          }
        });
      });
    },
    [settings.readReceiptsEnabled, user?.uuid]
  );

  // Initialize or restore device keys from user-scoped storage
  const initDeviceKeys = useCallback(async (devId: string, deterministicSeed?: string): Promise<DeviceKeyBundle> => {
    let keys = await clientDb.getDeviceKeys(devId);
    if (!keys && deterministicSeed) {
      keys = generateDeterministicDeviceKeys(devId, deterministicSeed, 25);
      await clientDb.saveDeviceKeys(keys);
    }
    if (!keys) {
      keys = generateDeviceKeys(devId, 25);
      await clientDb.saveDeviceKeys(keys);
    }
    setDeviceKeys(keys);
    return keys;
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
          members: Array<{ uuid: string; username: string; displayName: string }>;
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
    const unsubscribe = syncEngine.onReceipt((clientMsgId, status) => {
      setMessages((prev) =>
        prev.map((m) => (m.clientMessageId === clientMsgId ? { ...m, status } : m))
      );
      updateQueueCount();
    });
    return unsubscribe;
  }, [updateQueueCount]);

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
    setActiveConversation(conv);
    syncEngine.setActiveConversation(conv.id);
  };

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

  const sendMessage = async (text: string) => {
    if (!activeConversation || !token || !deviceKeys || !user) {
      throw new Error('No active conversation or session');
    }

    // 1. Fetch recipient's device prekeys for cryptographic handshake
    const devRes = await fetch(`/api/v1/devices/user/${activeConversation.recipientUuid}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!devRes.ok) throw new Error('Failed to fetch recipient device info');
    const devData = await devRes.json();
    const recipientDevices = devData.devices || [];

    if (recipientDevices.length === 0) {
      throw new Error('Recipient has no registered devices yet');
    }

    // Authoritative single-device destination: direct UUID-to-UUID messaging (no multi-device fan-out)
    const primaryDevice = recipientDevices[0];
    const prekeyRes = await fetch(`/api/v1/devices/${primaryDevice.id}/prekeys`, {
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
      activeConversation.recipientUuid,
      true
    );

    // 4. Update UI state immediately
    setMessages((prev) => [...prev, sentMsg!]);

    // 5. Update conversation last message metadata
    const updatedConv: StoredConversation = {
      ...activeConversation,
      ownerUserId: user.uuid,
      lastMessageText: text,
      lastMessageTimestamp: Date.now()
    };
    await clientDb.saveConversation(updatedConv);
    setActiveConversation(updatedConv);
    await refreshConversations();
    await updateQueueCount();
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

  const updateUserProfile = async (updates: { displayName?: string; about?: string; avatarUrl?: string }) => {
    if (!token || !user) throw new Error('Not logged in');
    const res = await fetch('/api/v1/users/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(updates)
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to update profile');
    }
    const data = await res.json();
    const updatedUser: UserSession = {
      ...user,
      displayName: data.user.displayName,
      about: data.user.about,
      avatarUrl: data.user.avatarUrl
    };
    setUser(updatedUser);
    localStorage.setItem('ychat_user', JSON.stringify(updatedUser));
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
        markMessagesAsRead,
        login,
        register,
        demoLogin,
        logout,
        selectConversation,
        startConversationWithUser,
        sendMessage,
        toggleSimulatedOffline,
        refreshConversations,
        verifyConversationSafety
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

