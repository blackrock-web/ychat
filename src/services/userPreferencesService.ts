import { AppSettings, DEFAULT_SETTINGS, ThemeMode } from '../types/settings';
import { UserSession } from '../context/ChatContext';

export interface UserProfileData {
  uuid: string;
  username: string;
  displayName: string;
  avatarUrl?: string;
  backgroundImage?: string;
  about?: string;
  preferences?: Partial<AppSettings>;
  createdAt?: string;
}

class UserPreferencesService {
  /**
   * Fetches user profile and saved preferences from the backend/Supabase database on initial load.
   */
  async fetchUserProfileAndPreferences(token: string): Promise<{
    profile: UserProfileData;
    preferences: AppSettings;
  }> {
    try {
      const res = await fetch('/api/v1/users/me', {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });

      if (!res.ok) {
        throw new Error(`Failed to fetch user profile: ${res.status}`);
      }

      const data = await res.json();
      const profile: UserProfileData = {
        uuid: data.uuid,
        username: data.username,
        displayName: data.displayName || data.username,
        avatarUrl: data.avatarUrl,
        backgroundImage: data.backgroundImage,
        about: data.about,
        preferences: data.preferences || {},
        createdAt: data.createdAt
      };

      // Merge server preferences with local defaults
      const localSettingsStr = localStorage.getItem('ychat_settings');
      const localSettings = localSettingsStr ? JSON.parse(localSettingsStr) : {};
      const mergedPreferences: AppSettings = {
        ...DEFAULT_SETTINGS,
        ...localSettings,
        ...(data.preferences || {})
      };

      // If server has custom backgroundImage, ensure custom wallpaper is mapped
      if (data.backgroundImage) {
        mergedPreferences.customWallpaperUrl = data.backgroundImage;
        if (!mergedPreferences.chatWallpaper || mergedPreferences.chatWallpaper === 'default') {
          mergedPreferences.chatWallpaper = 'custom';
        }
      }

      // Update local storage caches for fast offline startup
      try {
        const savedUser = localStorage.getItem('ychat_user');
        if (savedUser) {
          const userObj = JSON.parse(savedUser);
          const updatedUser = {
            ...userObj,
            displayName: profile.displayName,
            avatarUrl: profile.avatarUrl,
            backgroundImage: profile.backgroundImage,
            about: profile.about
          };
          localStorage.setItem('ychat_user', JSON.stringify(updatedUser));
        }
        localStorage.setItem('ychat_settings', JSON.stringify(mergedPreferences));
        if (mergedPreferences.theme) {
          localStorage.setItem('ychat_theme', mergedPreferences.theme);
        }
      } catch {}

      return { profile, preferences: mergedPreferences };
    } catch (err) {
      console.warn('[UserPreferencesService] Fetch failed, falling back to local storage:', err);
      // Fallback to local storage
      const savedUserStr = localStorage.getItem('ychat_user');
      const savedUser = savedUserStr ? JSON.parse(savedUserStr) : null;
      const savedSettingsStr = localStorage.getItem('ychat_settings');
      const savedSettings = savedSettingsStr ? JSON.parse(savedSettingsStr) : DEFAULT_SETTINGS;

      return {
        profile: savedUser || {
          uuid: '',
          username: '',
          displayName: ''
        },
        preferences: {
          ...DEFAULT_SETTINGS,
          ...savedSettings
        }
      };
    }
  }

  /**
   * Saves user profile updates (displayName, about, avatarUrl, backgroundImage) to the database.
   */
  async saveUserProfile(
    token: string,
    updates: {
      displayName?: string;
      about?: string;
      avatarUrl?: string;
      backgroundImage?: string;
      preferences?: Partial<AppSettings>;
    }
  ): Promise<UserProfileData> {
    const res = await fetch('/api/v1/users/profile', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(updates)
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || 'Failed to update profile in database');
    }

    const data = await res.json();
    const updatedUser = data.user;

    // Cache locally
    try {
      const savedUserStr = localStorage.getItem('ychat_user');
      if (savedUserStr) {
        const userObj = JSON.parse(savedUserStr);
        const nextUser = { ...userObj, ...updatedUser };
        localStorage.setItem('ychat_user', JSON.stringify(nextUser));
      }
    } catch {}

    return updatedUser;
  }

  /**
   * Saves user preferences (theme, chatWallpaper, customWallpaperUrl, bubbleColor, etc.) to the database.
   */
  async saveUserPreferences(
    token: string,
    preferences: Partial<AppSettings>
  ): Promise<AppSettings> {
    const res = await fetch('/api/v1/users/preferences', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ preferences })
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || 'Failed to update preferences in database');
    }

    const data = await res.json();
    const saved = data.preferences;

    // Keep localStorage updated
    try {
      const currentStr = localStorage.getItem('ychat_settings');
      const current = currentStr ? JSON.parse(currentStr) : DEFAULT_SETTINGS;
      const merged = { ...current, ...saved };
      localStorage.setItem('ychat_settings', JSON.stringify(merged));
      if (merged.theme) {
        localStorage.setItem('ychat_theme', merged.theme);
      }
    } catch {}

    return saved;
  }

  /**
   * Helper to persist avatar URL directly.
   */
  async saveAvatarUrl(token: string, avatarUrl: string): Promise<void> {
    await this.saveUserProfile(token, { avatarUrl });
  }

  /**
   * Helper to persist background image directly.
   */
  async saveBackgroundImage(token: string, backgroundImage: string): Promise<void> {
    await Promise.all([
      this.saveUserProfile(token, { backgroundImage }),
      this.saveUserPreferences(token, {
        chatWallpaper: 'custom',
        customWallpaperUrl: backgroundImage
      })
    ]);
  }

  /**
   * Helper to persist theme preference.
   */
  async saveTheme(token: string, theme: ThemeMode): Promise<void> {
    await this.saveUserPreferences(token, { theme });
  }
}

export const userPreferencesService = new UserPreferencesService();
