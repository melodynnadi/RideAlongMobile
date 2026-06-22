/**
 * Settings Service for RideAlong Driver App
 * Manages user preferences and settings storage using AsyncStorage
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const SETTINGS_KEY = '@ridealong_driver_settings';

export interface UserSettings {
  pushNotificationsEnabled: boolean;
  soundEffectsEnabled: boolean;
  darkModeEnabled: boolean;
}

const DEFAULT_SETTINGS: UserSettings = {
  pushNotificationsEnabled: true,
  soundEffectsEnabled: true,
  darkModeEnabled: false,
};

class SettingsService {
  private settings: UserSettings = DEFAULT_SETTINGS;
  private isInitialized = false;

  /**
   * Initialize settings by loading from storage
   */
  async initialize(): Promise<void> {
    try {
      const stored = await AsyncStorage.getItem(SETTINGS_KEY);
      if (stored) {
        this.settings = { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };
      } else {
        this.settings = DEFAULT_SETTINGS;
      }
      this.isInitialized = true;
      console.log('Settings initialized:', this.settings);
    } catch (error) {
      console.error('Error initializing settings:', error);
      this.settings = DEFAULT_SETTINGS;
      this.isInitialized = true;
    }
  }

  /**
   * Get all settings
   */
  async getSettings(): Promise<UserSettings> {
    if (!this.isInitialized) {
      await this.initialize();
    }
    return { ...this.settings };
  }

  /**
   * Update settings and persist to storage
   */
  async updateSettings(updates: Partial<UserSettings>): Promise<void> {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }
      
      this.settings = { ...this.settings, ...updates };
      await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
      console.log('Settings updated:', this.settings);
    } catch (error) {
      console.error('Error updating settings:', error);
      throw error;
    }
  }

  /**
   * Get push notifications enabled state
   */
  async isPushNotificationsEnabled(): Promise<boolean> {
    if (!this.isInitialized) {
      await this.initialize();
    }
    return this.settings.pushNotificationsEnabled;
  }

  /**
   * Get sound effects enabled state
   */
  async isSoundEffectsEnabled(): Promise<boolean> {
    if (!this.isInitialized) {
      await this.initialize();
    }
    return this.settings.soundEffectsEnabled;
  }

  /**
   * Get dark mode enabled state
   */
  async isDarkModeEnabled(): Promise<boolean> {
    if (!this.isInitialized) {
      await this.initialize();
    }
    return this.settings.darkModeEnabled;
  }

  /**
   * Reset settings to defaults
   */
  async resetSettings(): Promise<void> {
    try {
      this.settings = DEFAULT_SETTINGS;
      await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
      console.log('Settings reset to defaults');
    } catch (error) {
      console.error('Error resetting settings:', error);
      throw error;
    }
  }

  /**
   * Clear all settings from storage
   */
  async clearSettings(): Promise<void> {
    try {
      await AsyncStorage.removeItem(SETTINGS_KEY);
      this.settings = DEFAULT_SETTINGS;
      this.isInitialized = false;
      console.log('Settings cleared');
    } catch (error) {
      console.error('Error clearing settings:', error);
      throw error;
    }
  }
}

// Export singleton instance
export const settingsService = new SettingsService();
