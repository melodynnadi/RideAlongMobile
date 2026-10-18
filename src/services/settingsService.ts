import AsyncStorage from '@react-native-async-storage/async-storage';

const SETTINGS_KEY = '@ridealong_driver_settings';

/** 'system' follows the phone's light/dark setting (and updates live when it changes). */
export type ThemeMode = 'system' | 'light' | 'dark';

export interface UserSettings {
  pushNotificationsEnabled: boolean;
  soundEffectsEnabled: boolean;
  /** @deprecated superseded by themeMode; kept so older stored settings still parse. */
  darkModeEnabled: boolean;
  themeMode: ThemeMode;
}

const DEFAULT_SETTINGS: UserSettings = {
  pushNotificationsEnabled: true,
  soundEffectsEnabled: true,
  darkModeEnabled: false,
  // Settings saved before themeMode existed have no value here, so everyone starts on
  // 'system' — the old darkModeEnabled default of false can't be told apart from a choice.
  themeMode: 'system',
};

class SettingsService {
  private settings: UserSettings = DEFAULT_SETTINGS;
  private isInitialized = false;

  async initialize(): Promise<void> {
    try {
      const stored = await AsyncStorage.getItem(SETTINGS_KEY);

      this.settings = stored
        ? { ...DEFAULT_SETTINGS, ...JSON.parse(stored) }
        : DEFAULT_SETTINGS;

      this.isInitialized = true;
    } catch (error) {
      console.error('Error initializing settings:', error);
      this.settings = DEFAULT_SETTINGS;
      this.isInitialized = true;
    }
  }

  async getSettings(): Promise<UserSettings> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    return { ...this.settings };
  }

  async updateSettings(updates: Partial<UserSettings>): Promise<void> {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      this.settings = { ...this.settings, ...updates };
      await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
    } catch (error) {
      console.error('Error updating settings:', error);
      throw error;
    }
  }

  async isPushNotificationsEnabled(): Promise<boolean> {
    const settings = await this.getSettings();
    return settings.pushNotificationsEnabled;
  }

  async isSoundEffectsEnabled(): Promise<boolean> {
    const settings = await this.getSettings();
    return settings.soundEffectsEnabled;
  }

  async isDarkModeEnabled(): Promise<boolean> {
    const settings = await this.getSettings();
    return settings.darkModeEnabled;
  }

  async resetSettings(): Promise<void> {
    this.settings = DEFAULT_SETTINGS;
    this.isInitialized = true;
    await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
  }

  async clearSettings(): Promise<void> {
    await AsyncStorage.removeItem(SETTINGS_KEY);
    this.settings = DEFAULT_SETTINGS;
    this.isInitialized = false;
  }
}

export const settingsService = new SettingsService();