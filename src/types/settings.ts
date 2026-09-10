export type ThemeMode = 'dark' | 'light' | 'system';
export type BubbleColor = 'violet' | 'indigo' | 'emerald' | 'cyan' | 'rose' | 'amber';
export type ChatWallpaper = 'default' | 'subtle-grid' | 'dots' | 'minimal';
export type TimestampFormat = 'relative' | 'absolute';

export interface BlockedUser {
  uuid: string;
  username: string;
  displayName: string;
  avatarUrl?: string;
}

export interface AppSettings {
  theme: ThemeMode;
  bubbleColor: BubbleColor;
  chatWallpaper: ChatWallpaper;
  timestampFormat: TimestampFormat;
  defaultIncognito: boolean;
  readReceiptsEnabled: boolean;
  lastSeenVisibility: boolean;
  soundEnabled: boolean;
  desktopNotificationsEnabled: boolean;
  mutedConversations: string[];
}

export interface AppNotification {
  id: string;
  type: 'message' | 'device_linked' | 'safety_changed' | 'conversation_request';
  title: string;
  description: string;
  timestamp: number;
  read: boolean;
  data?: any;
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'dark',
  bubbleColor: 'violet',
  chatWallpaper: 'default',
  timestampFormat: 'absolute',
  defaultIncognito: false,
  readReceiptsEnabled: true,
  lastSeenVisibility: true,
  soundEnabled: true,
  desktopNotificationsEnabled: false,
  mutedConversations: []
};
