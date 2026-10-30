import * as SecureStore from "expo-secure-store";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

export interface TotpAccount {
  id: string;
  name: string;
  secret: string;
  issuer?: string;
  createdAt?: number;
}

export interface VaultSettings {
  requireBiometrics: boolean;
}

const SECURE_STORE_KEY = "sentinel_vault_accounts";
const LEGACY_STORAGE_KEY = "@sentinel_totp_accounts";
const SETTINGS_SECURE_KEY = "sentinel_vault_settings";
const SETTINGS_LEGACY_KEY = "@sentinel_vault_settings";

/**
 * Checks whether hardware-backed SecureStore (Android KeyStore / iOS Keychain)
 * is available on the current device runtime.
 */
export async function isHardwareVaultAvailable(): Promise<boolean> {
  try {
    if (Platform.OS === "web") return false;
    return await SecureStore.isAvailableAsync();
  } catch {
    return false;
  }
}

/**
 * Loads enrolled TOTP accounts defensively.
 * Checks hardware KeyStore first, then migrates any legacy unencrypted AsyncStorage
 * entries into the secure enclave on first launch.
 */
export async function loadAccountsFromVault(): Promise<TotpAccount[]> {
  try {
    const isSecureAvailable = await isHardwareVaultAvailable();

    if (isSecureAvailable) {
      const secureData = await SecureStore.getItemAsync(SECURE_STORE_KEY);
      if (secureData) {
        const parsed = JSON.parse(secureData);
        if (Array.isArray(parsed)) {
          return parsed;
        }
      }

      // Check for legacy unencrypted accounts to migrate
      const legacyData = await AsyncStorage.getItem(LEGACY_STORAGE_KEY);
      if (legacyData) {
        const parsedLegacy = JSON.parse(legacyData);
        if (Array.isArray(parsedLegacy) && parsedLegacy.length > 0) {
          // Encrypt and store into Android KeyStore
          await SecureStore.setItemAsync(SECURE_STORE_KEY, JSON.stringify(parsedLegacy), {
            keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
          });
          // Delete legacy unencrypted copy to prevent storage leakage
          await AsyncStorage.removeItem(LEGACY_STORAGE_KEY);
          return parsedLegacy;
        }
      }
    } else {
      // Fallback for Web/simulator without KeyStore
      const fallbackData = await AsyncStorage.getItem(LEGACY_STORAGE_KEY);
      if (fallbackData) {
        const parsed = JSON.parse(fallbackData);
        if (Array.isArray(parsed)) {
          return parsed;
        }
      }
    }
  } catch (err) {
    console.warn("Notice loading accounts from security vault:", err);
  }
  return [];
}

/**
 * Persists enrolled TOTP accounts into hardware KeyStore with fallback.
 */
export async function saveAccountsToVault(accounts: TotpAccount[]): Promise<boolean> {
  try {
    const isSecureAvailable = await isHardwareVaultAvailable();
    const serialized = JSON.stringify(accounts);

    if (isSecureAvailable) {
      await SecureStore.setItemAsync(SECURE_STORE_KEY, serialized, {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
      return true;
    } else {
      await AsyncStorage.setItem(LEGACY_STORAGE_KEY, serialized);
      return true;
    }
  } catch (err) {
    console.error("Failed to persist accounts to security vault:", err);
    // Secondary fallback
    try {
      await AsyncStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(accounts));
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Loads vault security configuration settings.
 */
export async function loadVaultSettings(): Promise<VaultSettings> {
  const defaultSettings: VaultSettings = { requireBiometrics: true };
  try {
    const isSecureAvailable = await isHardwareVaultAvailable();
    if (isSecureAvailable) {
      const data = await SecureStore.getItemAsync(SETTINGS_SECURE_KEY);
      if (data) {
        return JSON.parse(data);
      }
    }
    const legacy = await AsyncStorage.getItem(SETTINGS_LEGACY_KEY);
    if (legacy) {
      return JSON.parse(legacy);
    }
  } catch (err) {
    console.warn("Notice loading vault settings:", err);
  }
  return defaultSettings;
}

/**
 * Saves vault security configuration settings.
 */
export async function saveVaultSettings(settings: VaultSettings): Promise<boolean> {
  try {
    const serialized = JSON.stringify(settings);
    const isSecureAvailable = await isHardwareVaultAvailable();
    if (isSecureAvailable) {
      await SecureStore.setItemAsync(SETTINGS_SECURE_KEY, serialized, {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
      return true;
    } else {
      await AsyncStorage.setItem(SETTINGS_LEGACY_KEY, serialized);
      return true;
    }
  } catch (err) {
    console.warn("Notice saving vault settings:", err);
    try {
      await AsyncStorage.setItem(SETTINGS_LEGACY_KEY, JSON.stringify(settings));
      return true;
    } catch {
      return false;
    }
  }
}
