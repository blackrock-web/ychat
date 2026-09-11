export type ThemeMode = 'ychat' | 'dark' | 'light' | 'system';
export type BubbleColor = 'violet' | 'indigo' | 'emerald' | 'cyan' | 'rose' | 'amber' | 'slate' | 'midnight' | 'custom';
export type ChatWallpaper = 'ychat-theme' | 'default' | 'subtle-grid' | 'dots' | 'minimal' | 'clean-light' | 'geometric' | 'custom';
export type TimestampFormat = 'relative' | 'absolute';
export type FontSize = 'small' | 'medium' | 'large';

export type MessageThemeStyle = 'solid' | 'gradient' | 'theme';
export type MessageGradientType = 'violet-indigo' | 'cyan-blue' | 'emerald-teal' | 'rose-pink' | 'amber-orange' | 'custom';
export type IncomingMessageStyle = 'default' | 'slate' | 'high-contrast' | 'subdued';
export type RetentionPeriodOption = 5 | 15 | 30 | 60 | 360 | 720 | 1440 | 4320 | 10080; // in minutes (1440 = 24h, 10080 = 7d)

export interface BlockedUser {
  uuid: string;
  username: string;
  displayName: string;
  avatarUrl?: string;
}

export interface CustomGradientConfig {
  from: string;
  to: string;
  direction: 'to-r' | 'to-br' | 'to-b' | 'to-tr';
}

export interface PerChatCustomization {
  chatWallpaper?: ChatWallpaper;
  customWallpaperUrl?: string;
  wallpaperOpacity?: number;
  bubbleColor?: BubbleColor;
  messageThemeStyle?: MessageThemeStyle;
  messageGradient?: MessageGradientType;
  customGradientColors?: CustomGradientConfig;
  incomingBubbleStyle?: IncomingMessageStyle;
  customOutgoingColor?: string;
}

export interface AppSettings {
  theme: ThemeMode;
  bubbleColor: BubbleColor;
  chatWallpaper: ChatWallpaper;
  customWallpaperUrl?: string;
  wallpaperOpacity?: number;
  fontSize?: FontSize;
  timestampFormat: TimestampFormat;
  defaultIncognito: boolean;
  readReceiptsEnabled: boolean;
  lastSeenVisibility: boolean;
  soundEnabled: boolean;
  desktopNotificationsEnabled: boolean;
  mutedConversations: string[];
  // Message settings & retention
  offlineRetentionMinutes: RetentionPeriodOption;
  autoRetryFailedMessages: boolean;
  enterToSend: boolean;
  showTypingIndicators: boolean;
  // Message styling & themes
  messageThemeStyle: MessageThemeStyle;
  messageGradient: MessageGradientType;
  customGradientColors?: CustomGradientConfig;
  incomingBubbleStyle: IncomingMessageStyle;
  customOutgoingColor?: string;
  // Per-chat overrides: conversationId -> customization
  perChatSettings: Record<string, PerChatCustomization>;
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
  theme: 'ychat',
  bubbleColor: 'violet',
  chatWallpaper: 'ychat-theme',
  wallpaperOpacity: 85,
  fontSize: 'medium',
  timestampFormat: 'relative',
  defaultIncognito: false,
  readReceiptsEnabled: true,
  lastSeenVisibility: true,
  soundEnabled: true,
  desktopNotificationsEnabled: false,
  mutedConversations: [],
  offlineRetentionMinutes: 1440, // 24 hours default
  autoRetryFailedMessages: true,
  enterToSend: true,
  showTypingIndicators: true,
  messageThemeStyle: 'solid',
  messageGradient: 'violet-indigo',
  customGradientColors: {
    from: '#7c3aed',
    to: '#4f46e5',
    direction: 'to-br'
  },
  incomingBubbleStyle: 'default',
  customOutgoingColor: '#7c3aed',
  perChatSettings: {}
};
