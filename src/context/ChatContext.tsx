import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { syncEngine, ConnectionState } from '../storage/syncEngine';
import { clientDb, StoredConversation } from '../storage/db';
import { generateDeviceKeys, generateDeterministicDeviceKeys, getPublicBundlePayload, DeviceKeyBundle } from '../crypto/keys';
import { DecryptedMessage, PrekeyBundle } from '../crypto/types';

export interface UserSession {
  uuid: string;
  username: string;
  displayName: string;
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

  // Initialize or restore device keys from user-scoped storage
  const initDeviceKeys = useCallback(async (devId: string, deterministicSeed?: string): Promise<DeviceKeyBundle> => {
    let keys = await clientDb.getDeviceKeys(devId);
    if (!keys && deterministicSeed) {
      keys = generateDeterministicDeviceKeys(devId, deterministicSeed, 25);
      await clientDb.saveDeviceKeys(keys);
    }
    if (!keys) {
      keys = await clientDb.getAnySavedDeviceKeys();
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
      }
      refreshConversations();
      updateQueueCount();
    });
    return unsubscribe;
  }, [activeConversation, refreshConversations, updateQueueCount]);

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
        initDeviceKeys(deviceId, seed).then((keys) => {
          if (!isMounted) return;
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
      });
    } else {
      syncEngine.setActiveConversation(null);
      setMessages([]);
    }
  }, [activeConversation?.id, user?.uuid, refreshConversations]);

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

    // 1. Fetch recipient's devices
    const devRes = await fetch(`/api/v1/devices/user/${activeConversation.recipientUuid}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!devRes.ok) throw new Error('Failed to fetch recipient devices');
    const devData = await devRes.json();
    const recipientDevices = devData.devices || [];

    if (recipientDevices.length === 0) {
      throw new Error('Recipient has no registered devices yet');
    }

    let sentMsg: DecryptedMessage | null = null;

    for (const recipientDevice of recipientDevices) {
      // 2. Fetch prekey bundle for recipient device
      const prekeyRes = await fetch(`/api/v1/devices/${recipientDevice.id}/prekeys`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!prekeyRes.ok) continue;
      const recipientBundle: PrekeyBundle = await prekeyRes.json();

      // 3. Dispatch encrypted message through sync engine
      const msg = await syncEngine.sendTextMessage(
        activeConversation.id,
        recipientDevice.id,
        recipientBundle,
        text
      );
      if (!sentMsg) sentMsg = msg;
    }

    if (!sentMsg) {
      throw new Error('Failed to establish encrypted delivery channel to recipient devices');
    }

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

