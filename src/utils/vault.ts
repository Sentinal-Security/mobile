import * as SecureStore from "expo-secure-store";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

export interface TotpAccount {
  id: string;
  name: string;
  secret: string;
  issuer?: string;
  createdAt?: number;
  status?: "ACTIVE" | "UNLINKED" | "REVOKED";
}

export interface VaultSettings {
  requireBiometrics: boolean;
}

export interface PinLockoutState {
  failedAttempts: number;
  lockoutUntil: number;
}

const SECURE_STORE_KEY = "sentinel_vault_accounts";
const LEGACY_STORAGE_KEY = "@sentinel_totp_accounts";
const SETTINGS_SECURE_KEY = "sentinel_vault_settings";
const SETTINGS_LEGACY_KEY = "@sentinel_vault_settings";
const DEVICE_UUID_KEY = "sentinel_device_uuid";
const LEGACY_DEVICE_UUID_KEY = "@sentinel_device_uuid";
const PIN_LOCKOUT_KEY = "sentinel_pin_lockout";
const AUDIT_LOGS_SECURE_KEY = "sentinel_audit_logs";

function getSecureStoreWriteOptions(): SecureStore.SecureStoreOptions {
  if (Platform.OS === "ios") {
    return { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
  }
  return {};
}

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
 * Generates or retrieves a persistent, hardware-bound device UUID for this app installation.
 */
export async function getOrCreateDeviceUuid(): Promise<string> {
  try {
    const isSecure = await isHardwareVaultAvailable();
    if (isSecure) {
      const existing = await SecureStore.getItemAsync(DEVICE_UUID_KEY);
      if (existing) return existing;
      const legacy = await AsyncStorage.getItem(LEGACY_DEVICE_UUID_KEY);
      if (legacy) {
        await SecureStore.setItemAsync(DEVICE_UUID_KEY, legacy, getSecureStoreWriteOptions());
        await AsyncStorage.removeItem(LEGACY_DEVICE_UUID_KEY);
        return legacy;
      }
      const generated = `dev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
      await SecureStore.setItemAsync(DEVICE_UUID_KEY, generated, getSecureStoreWriteOptions());
      return generated;
    }
    const existingWeb = await AsyncStorage.getItem(LEGACY_DEVICE_UUID_KEY);
    if (existingWeb) return existingWeb;
    const generated = `dev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    await AsyncStorage.setItem(LEGACY_DEVICE_UUID_KEY, generated);
    return generated;
  } catch {
    return `dev_fallback_${Math.random().toString(36).slice(2, 10)}`;
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

      const legacyData = await AsyncStorage.getItem(LEGACY_STORAGE_KEY);
      if (legacyData) {
        const parsedLegacy = JSON.parse(legacyData);
        if (Array.isArray(parsedLegacy) && parsedLegacy.length > 0) {
          await SecureStore.setItemAsync(
            SECURE_STORE_KEY,
            JSON.stringify(parsedLegacy),
            getSecureStoreWriteOptions()
          );
          await AsyncStorage.removeItem(LEGACY_STORAGE_KEY);
          return parsedLegacy;
        }
      }
    } else {
      const fallbackData = await AsyncStorage.getItem(LEGACY_STORAGE_KEY);
      if (fallbackData) {
        const parsed = JSON.parse(fallbackData);
        if (Array.isArray(parsed)) {
          return parsed;
        }
      }
    }
  } catch {
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
      await SecureStore.setItemAsync(SECURE_STORE_KEY, serialized, getSecureStoreWriteOptions());
      return true;
    } else {
      await AsyncStorage.setItem(LEGACY_STORAGE_KEY, serialized);
      return true;
    }
  } catch {
    try {
      await AsyncStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(accounts));
      return true;
    } catch {
      return false;
    }
  }
}

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
  } catch {
  }
  return defaultSettings;
}

export async function saveVaultSettings(settings: VaultSettings): Promise<boolean> {
  try {
    const serialized = JSON.stringify(settings);
    const isSecureAvailable = await isHardwareVaultAvailable();
    if (isSecureAvailable) {
      await SecureStore.setItemAsync(SETTINGS_SECURE_KEY, serialized, getSecureStoreWriteOptions());
      return true;
    } else {
      await AsyncStorage.setItem(SETTINGS_LEGACY_KEY, serialized);
      return true;
    }
  } catch {
    try {
      await AsyncStorage.setItem(SETTINGS_LEGACY_KEY, JSON.stringify(settings));
      return true;
    } catch {
      return false;
    }
  }
}

export interface AuditLogEntry {
  id: string;
  timestamp: number;
  eventType:
    | "LOGIN_APPROVED"
    | "LOGIN_DENIED"
    | "ACCOUNT_PAIRED"
    | "ACCOUNT_DELETED"
    | "DEVICE_UNBOUND"
    | "VAULT_UNLOCKED"
    | "VAULT_LOCKED"
    | "PIN_CONFIGURED";
  title: string;
  details: string;
  origin?: string;
  account?: string;
}

const AUDIT_LOGS_KEY = "@sentinel_audit_logs";
const MASTER_PIN_KEY = "sentinel_master_pin";
const LEGACY_MASTER_PIN_KEY = "@sentinel_master_pin";

export async function loadAuditLogs(): Promise<AuditLogEntry[]> {
  try {
    const isSecure = await isHardwareVaultAvailable();
    if (isSecure) {
      const secureRaw = await SecureStore.getItemAsync(AUDIT_LOGS_SECURE_KEY);
      if (secureRaw) {
        const parsed = JSON.parse(secureRaw);
        if (Array.isArray(parsed)) return parsed;
      }
      const legacyRaw = await AsyncStorage.getItem(AUDIT_LOGS_KEY);
      if (legacyRaw) {
        const parsed = JSON.parse(legacyRaw);
        if (Array.isArray(parsed)) {
          await SecureStore.setItemAsync(
            AUDIT_LOGS_SECURE_KEY,
            JSON.stringify(parsed.slice(0, 40)),
            getSecureStoreWriteOptions()
          ).catch(() => {});
          await AsyncStorage.removeItem(AUDIT_LOGS_KEY).catch(() => {});
          return parsed;
        }
      }
    }
    const raw = await AsyncStorage.getItem(AUDIT_LOGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {}
  return [];
}

export async function recordAuditLog(
  entry: Omit<AuditLogEntry, "id" | "timestamp">
): Promise<AuditLogEntry> {
  const newLog: AuditLogEntry = {
    ...entry,
    id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    timestamp: Date.now(),
  };

  try {
    const existing = await loadAuditLogs();
    const updated = [newLog, ...existing].slice(0, 40);
    const serialized = JSON.stringify(updated);
    const isSecure = await isHardwareVaultAvailable();
    if (isSecure) {
      await SecureStore.setItemAsync(AUDIT_LOGS_SECURE_KEY, serialized, getSecureStoreWriteOptions());
    } else {
      await AsyncStorage.setItem(AUDIT_LOGS_KEY, serialized);
    }
  } catch {}
  return newLog;
}

/**
 * Deterministic salted hash for on-device PIN verification (no plaintext PIN storage).
 */
export function hashPinWithSalt(pin: string, salt: string): string {
  const input = `${salt}:${pin}:sentinel_pin_v1`;
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let round = 0; round < 1000; round++) {
    for (let i = 0; i < input.length; i++) {
      const ch = input.charCodeAt(i);
      h1 ^= ch ^ (round & 0xff);
      h1 = Math.imul(h1, 0x01000193);
      h2 ^= (ch << 3) ^ round;
      h2 = Math.imul(h2, 0x85ebca6b);
    }
  }
  return `v1$${salt}$${(h1 >>> 0).toString(16).padStart(8, "0")}${(h2 >>> 0).toString(16).padStart(8, "0")}`;
}

export function verifyHashedPin(enteredPin: string, storedValue: string): boolean {
  if (!storedValue.startsWith("v1$")) {
    return enteredPin === storedValue;
  }
  const parts = storedValue.split("$");
  if (parts.length !== 4) return false;
  const salt = parts[1];
  return hashPinWithSalt(enteredPin, salt) === storedValue;
}

export async function loadMasterPin(): Promise<string | null> {
  try {
    const isSecure = await isHardwareVaultAvailable();
    if (isSecure) {
      const pin = await SecureStore.getItemAsync(MASTER_PIN_KEY);
      if (pin) return pin;
      const legacy = await AsyncStorage.getItem(LEGACY_MASTER_PIN_KEY);
      if (legacy) {
        await SecureStore.setItemAsync(MASTER_PIN_KEY, legacy, getSecureStoreWriteOptions());
        await AsyncStorage.removeItem(LEGACY_MASTER_PIN_KEY);
        return legacy;
      }
      return null;
    }
    return await AsyncStorage.getItem(LEGACY_MASTER_PIN_KEY);
  } catch {
    return null;
  }
}

export async function saveMasterPin(pin: string): Promise<string | null> {
  try {
    const salt = Math.random().toString(36).slice(2, 10);
    const hashed = hashPinWithSalt(pin, salt);
    const isSecure = await isHardwareVaultAvailable();
    if (isSecure) {
      await SecureStore.setItemAsync(MASTER_PIN_KEY, hashed, getSecureStoreWriteOptions());
      await AsyncStorage.removeItem(LEGACY_MASTER_PIN_KEY).catch(() => {});
      return hashed;
    }
    await AsyncStorage.setItem(LEGACY_MASTER_PIN_KEY, hashed);
    return hashed;
  } catch {
    return null;
  }
}

export async function loadPinLockoutState(): Promise<PinLockoutState> {
  try {
    const raw = await AsyncStorage.getItem(PIN_LOCKOUT_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (typeof parsed.failedAttempts === "number" && typeof parsed.lockoutUntil === "number") {
        return parsed;
      }
    }
  } catch {}
  return { failedAttempts: 0, lockoutUntil: 0 };
}

export async function recordPinFailure(): Promise<PinLockoutState> {
  const current = await loadPinLockoutState();
  const nextAttempts = current.failedAttempts + 1;
  let cooldownMs = 0;
  if (nextAttempts >= 10) {
    cooldownMs = 300_000;
  } else if (nextAttempts >= 5) {
    cooldownMs = 30_000;
  }
  const nextState: PinLockoutState = {
    failedAttempts: nextAttempts,
    lockoutUntil: cooldownMs > 0 ? Date.now() + cooldownMs : 0,
  };
  await AsyncStorage.setItem(PIN_LOCKOUT_KEY, JSON.stringify(nextState)).catch(() => {});
  return nextState;
}

export async function resetPinFailures(): Promise<void> {
  await AsyncStorage.removeItem(PIN_LOCKOUT_KEY).catch(() => {});
}
