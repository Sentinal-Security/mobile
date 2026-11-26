import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  ScrollView,
  StyleSheet,
  Alert,
  Image,
  Modal,
  Platform,
  AppState,
  Linking,
  Vibration,
  useWindowDimensions,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
} from "react-native";
import * as WebBrowser from "expo-web-browser";
import * as Clipboard from "expo-clipboard";
import { SafeAreaView } from "react-native-safe-area-context";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Notifications from "expo-notifications";
import * as LocalAuthentication from "expo-local-authentication";
import * as SplashScreen from "expo-splash-screen";
import * as Device from "expo-device";
import * as SecureStore from "expo-secure-store";
import {
  generateTotp,
  getSecondsRemaining,
  parseOtpAuthUri,
  buildChallengeOptions,
  normalizeBase32Secret,
} from "@/utils/totp";
import {
  recordMobileTelemetry,
  bindDevice,
  unbindDevice,
  fetchAccountActivity,
  loginMobileAccount,
  fetchPersonalAuditLogs,
  WEB_PORTAL_URL,
  type MobileSessionUser,
  type ServerAuditLogEntry,
} from "../../services/api";
import {
  TotpAccount,
  AuditLogEntry,
  isHardwareVaultAvailable,
  getOrCreateDeviceUuid,
  loadAccountsFromVault,
  saveAccountsToVault,
  loadVaultSettings,
  saveVaultSettings,
  loadAuditLogs,
  recordAuditLog,
  loadMasterPin,
  saveMasterPin,
  verifyHashedPin,
  loadPinLockoutState,
  recordPinFailure,
  resetPinFailures,
} from "@/utils/vault";

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const safePromise = promise.catch(() => null as unknown as T);
  try {
    return await Promise.race([
      safePromise,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}



const PORTAL_URL = "https://web-beta-orcin-33.vercel.app/";
const API_BASE_URL = "https://backend-pi68.onrender.com";

interface PendingChallenge {
  id: number;
  userId: number;
  email: string;
  matchCode: string;
  clientOrigin: string;
  options: string[];
}

export default function AuthenticatorScreen() {
  const { width: windowWidth } = useWindowDimensions();
  const effectiveContainerWidth = Math.min(windowWidth, 480);
  const pageWidth = effectiveContainerWidth - 32;

  const [accounts, setAccounts] = useState<TotpAccount[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isStartupComplete, setIsStartupComplete] = useState(false);
  const [isHardwareVault, setIsHardwareVault] = useState<boolean | null>(null);
  const [activeTab, setActiveTab] = useState<"CODES" | "PAIR" | "SECURITY">("CODES");
  const [copiedCodeId, setCopiedCodeId] = useState<string | null>(null);
  const [accountToDelete, setAccountToDelete] = useState<TotpAccount | null>(null);
  const pagerRef = useRef<ScrollView>(null);

  // Biometric Inherence Factor State
  const [hasBiometricHardware, setHasBiometricHardware] = useState(false);
  const [biometricEnrolled, setBiometricEnrolled] = useState(false);
  const [biometricTypeLabel, setBiometricTypeLabel] = useState<string>("BIOMETRIC");
  const [requireBiometrics, setRequireBiometrics] = useState(true);
  const [isVaultUnlocked, setIsVaultUnlocked] = useState(false);

  // Enrollment State (Camera vs Manual Segmented Mode)
  const [enrollmentTab, setEnrollmentTab] = useState<"SCAN" | "MANUAL">("SCAN");
  const [accountName, setAccountName] = useState("");
  const [accountIssuer, setAccountIssuer] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [manualValidationError, setManualValidationError] = useState<string | null>(null);
  const [isResolvingSecret, setIsResolvingSecret] = useState(false);
  const [resolvedIdentity, setResolvedIdentity] = useState<string | null>(null);

  // TOTP Clock and Scanner
  const [remainingSeconds, setRemainingSeconds] = useState(getSecondsRemaining());
  const [showScanner, setShowScanner] = useState(false);
  const [permission, requestPermission, getCameraPermission] = useCameraPermissions();

  // Out-of-band Push Challenge
  const [pendingChallenge, setPendingChallenge] = useState<PendingChallenge | null>(null);
  const [isChallengeMinimized, setIsChallengeMinimized] = useState(false);
  const [respondingChallenge, setRespondingChallenge] = useState(false);
  const [pushToken, setPushToken] = useState<string | null>(null);
  const [notificationPermissionGranted, setNotificationPermissionGranted] = useState(false);
  const [deviceUuid, setDeviceUuid] = useState<string | null>(null);
  const deviceLabel = Device.modelName || Device.deviceName || `Sentinel ${Platform.OS.toUpperCase()}`;

  // Clock Skew & Per-Account Server Activity
  const [clockDriftSeconds, setClockDriftSeconds] = useState<number>(0);
  const [activityAccount, setActivityAccount] = useState<TotpAccount | null>(null);
  const [serverActivityLogs, setServerActivityLogs] = useState<ServerAuditLogEntry[]>([]);
  const [loadingActivity, setLoadingActivity] = useState(false);
  const [activityError, setActivityError] = useState<string | null>(null);

  // Per-Account Mobile Login, Account Switcher & Personal Audit Logs
  const MOBILE_SESSIONS_KEY = "sentinel_mobile_sessions_v1";
  const [signedInAccounts, setSignedInAccounts] = useState<MobileSessionUser[]>([]);
  const [activeAccountEmail, setActiveAccountEmail] = useState<string | null>(null);
  const [showAccountLoginModal, setShowAccountLoginModal] = useState(false);
  const [showAccountSwitcherModal, setShowAccountSwitcherModal] = useState(false);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [personalLogs, setPersonalLogs] = useState<ServerAuditLogEntry[]>([]);
  const [personalLogsLoading, setPersonalLogsLoading] = useState(false);
  const [personalLogsError, setPersonalLogsError] = useState<string | null>(null);

  const activeSessionUser =
    signedInAccounts.find((a) => a.email === activeAccountEmail) || signedInAccounts[0] || null;
  const visibleAccounts = activeSessionUser
    ? accounts.filter((a) => a.name?.trim().toLowerCase() === activeSessionUser.email.toLowerCase())
    : [];

  // Audit Logs & Master PIN State
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [masterPin, setMasterPin] = useState<string | null>(null);
  const [pinLockoutUntil, setPinLockoutUntil] = useState<number>(0);
  const [isPinSetupMode, setIsPinSetupMode] = useState(false);
  const [enteredPin, setEnteredPin] = useState("");
  const [setupPin, setSetupPin] = useState("");
  const [setupPinConfirm, setSetupPinConfirm] = useState("");
  const [pinErrorMessage, setPinErrorMessage] = useState<string | null>(null);

  // Native dialog and scanner concurrency guards
  const authInFlightRef = useRef(false);
  const scanLockRef = useRef(false);
  const resolveDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const getCameraPermissionRef = useRef(getCameraPermission);
  getCameraPermissionRef.current = getCameraPermission;

  // Non-blocking, defensive startup initialization lifecycle
  useEffect(() => {
    let isMounted = true;

    const initializeStartup = async () => {
      let hasHw = false;
      let isEnr = false;
      let enforceBio = true;

      try {
        // Phase 1: Hydrate hardware vault capability, biometric state, and stored accounts
        const isHwAvailable = (await withTimeout(isHardwareVaultAvailable(), 1500)) ?? false;
        if (!isMounted) return;
        setIsHardwareVault(isHwAvailable);

        hasHw = (await withTimeout(LocalAuthentication.hasHardwareAsync(), 1500)) ?? false;
        isEnr = (await withTimeout(LocalAuthentication.isEnrolledAsync(), 1500)) ?? false;
        if (!isMounted) return;
        setHasBiometricHardware(hasHw);
        setBiometricEnrolled(isEnr);

        const authTypes: LocalAuthentication.AuthenticationType[] =
          (await withTimeout(LocalAuthentication.supportedAuthenticationTypesAsync(), 1500)) ?? [];
        if (isMounted) {
          if (authTypes.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) {
            setBiometricTypeLabel("FINGERPRINT");
          } else if (authTypes.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
            setBiometricTypeLabel("FACE ID");
          } else if (authTypes.includes(LocalAuthentication.AuthenticationType.IRIS)) {
            setBiometricTypeLabel("IRIS");
          } else if (hasHw) {
            setBiometricTypeLabel("BIOMETRIC");
          } else {
            setBiometricTypeLabel("DEVICE PIN");
          }
        }

        const [storedUuid, lockoutState] = await Promise.all([
          withTimeout(getOrCreateDeviceUuid(), 1500),
          withTimeout(loadPinLockoutState(), 1500),
        ]);
        if (isMounted && storedUuid) {
          setDeviceUuid(storedUuid);
        }
        if (isMounted && lockoutState && lockoutState.lockoutUntil > Date.now()) {
          setPinLockoutUntil(lockoutState.lockoutUntil);
        }

        const storedLogs = (await withTimeout(loadAuditLogs(), 2000)) ?? [];
        if (isMounted) {
          setAuditLogs(storedLogs);
        }

        const storedPin = (await withTimeout(loadMasterPin(), 2000)) ?? null;
        if (isMounted) {
          setMasterPin(storedPin);
        }

        const settings = (await withTimeout(loadVaultSettings(), 2000)) ?? {
          requireBiometrics: true,
        };
        enforceBio = settings.requireBiometrics;
        if (isMounted) {
          setRequireBiometrics(enforceBio);
          if (!enforceBio) {
            setIsVaultUnlocked(true);
          } else if (hasHw && isEnr) {
            setIsVaultUnlocked(false);
          } else if (storedPin) {
            setIsVaultUnlocked(false);
          } else {
            // Mandatory fallback PIN setup for non-biometric devices / web
            setIsPinSetupMode(true);
            setIsVaultUnlocked(false);
          }
        }

        const storedAccounts = (await withTimeout(loadAccountsFromVault(), 2000)) ?? [];
        if (isMounted) {
          setAccounts(storedAccounts);
        }
      } catch {
      } finally {
        if (isMounted) {
          setIsLoaded(true);
          setIsStartupComplete(true);
        }
        try {
          SplashScreen.hideAsync().catch(() => {});
        } catch {
          // Ignore splash screen lifecycle notice
        }
      }

      // Phase 2: Setup push notification channel and acquire token quietly without blocking the UI
      try {
        Notifications.setNotificationHandler({
          handleNotification: async () => ({
            shouldShowAlert: true,
            shouldPlaySound: true,
            shouldSetBadge: true,
            shouldShowBanner: true,
            shouldShowList: true,
          }),
        });

        if (Platform.OS === "android") {
          await withTimeout(
            Notifications.setNotificationChannelAsync("mfa-alerts", {
              name: "MFA Security Challenges",
              importance: Notifications.AndroidImportance.MAX,
              vibrationPattern: [0, 250, 250, 250],
              lightColor: "#54f4fc",
              sound: "default",
            }),
            1500
          );
        }

        const permStatus = await withTimeout(Notifications.getPermissionsAsync(), 1500);
        let granted = permStatus?.status === "granted";
        if (!granted) {
          const reqRes = await withTimeout(Notifications.requestPermissionsAsync(), 2500);
          granted = reqRes?.status === "granted";
        }
        if (isMounted) {
          setNotificationPermissionGranted(granted);
        }

        if (granted && isMounted) {
          const deviceTokenRes = await withTimeout(Notifications.getDevicePushTokenAsync(), 2500);
          if (deviceTokenRes?.data && isMounted) {
            setPushToken(String(deviceTokenRes.data));
          }
        }
      } catch (pushErr) {
        console.warn("Background notification registration notice:", pushErr);
      }
    };

    initializeStartup();

    return () => {
      isMounted = false;
    };
  }, []);

  // Hydrate multi-account mobile sessions from SecureStore
  useEffect(() => {
    const loadSessions = async () => {
      try {
        const raw =
          Platform.OS === "web"
            ? window.localStorage.getItem(MOBILE_SESSIONS_KEY)
            : await SecureStore.getItemAsync(MOBILE_SESSIONS_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed?.accounts)) {
            setSignedInAccounts(parsed.accounts);
          }
          if (parsed?.activeEmail) {
            setActiveAccountEmail(String(parsed.activeEmail));
          }
        }
      } catch {
        // Ignore storage read notice
      }
    };
    loadSessions();
  }, []);

  const persistMobileSessions = async (nextAccounts: MobileSessionUser[], nextActiveEmail: string | null) => {
    try {
      const payload = JSON.stringify({ accounts: nextAccounts, activeEmail: nextActiveEmail });
      if (Platform.OS === "web") {
        window.localStorage.setItem(MOBILE_SESSIONS_KEY, payload);
      } else {
        await SecureStore.setItemAsync(MOBILE_SESSIONS_KEY, payload);
      }
    } catch {
      // Ignore storage write notice
    }
  };

  const loadPersonalLogsForAccount = async (account: MobileSessionUser | null) => {
    if (!account?.userId) {
      setPersonalLogs([]);
      return;
    }
    setPersonalLogsLoading(true);
    setPersonalLogsError(null);
    const res = await fetchPersonalAuditLogs(account.userId, 30);
    setPersonalLogsLoading(false);
    if (res.success && Array.isArray(res.data)) {
      setPersonalLogs(res.data);
    } else {
      setPersonalLogsError(res.message || "Could not load account activity logs.");
    }
  };

  useEffect(() => {
    if (activeSessionUser?.userId) {
      loadPersonalLogsForAccount(activeSessionUser);
    } else {
      setPersonalLogs([]);
    }
  }, [activeSessionUser?.userId]);

  const handleMobileSignIn = async () => {
    if (!loginEmail.trim() || !loginPassword) {
      setLoginError("Please enter your email and password.");
      return;
    }
    setLoginLoading(true);
    setLoginError(null);
    const res = await loginMobileAccount(loginEmail, loginPassword);
    setLoginLoading(false);

    if (!res.success || !res.user) {
      setLoginError(res.message || "Invalid email or password.");
      return;
    }

    const signedUser = res.user;
    const merged = [
      signedUser,
      ...signedInAccounts.filter((a) => a.email.toLowerCase() !== signedUser.email.toLowerCase()),
    ];
    setSignedInAccounts(merged);
    setActiveAccountEmail(signedUser.email);
    await persistMobileSessions(merged, signedUser.email);
    setShowAccountLoginModal(false);
    setShowAccountSwitcherModal(false);
    setLoginEmail("");
    setLoginPassword("");
  };

  const handleSwitchAccount = async (email: string) => {
    setActiveAccountEmail(email);
    setPendingChallenge(null);
    await persistMobileSessions(signedInAccounts, email);
    setShowAccountSwitcherModal(false);
  };

  const handleSignOutActive = async () => {
    if (!activeSessionUser) return;
    const remaining = signedInAccounts.filter(
      (a) => a.email.toLowerCase() !== activeSessionUser.email.toLowerCase()
    );
    const nextEmail = remaining[0]?.email || null;
    setSignedInAccounts(remaining);
    setActiveAccountEmail(nextEmail);
    setPendingChallenge(null);
    await persistMobileSessions(remaining, nextEmail);
    setShowAccountSwitcherModal(false);
  };

  // Bind this physical device to enrolled Sentinel accounts with proof of possession
  useEffect(() => {
    if (!deviceUuid || !isStartupComplete) return;

    accounts.forEach((acc) => {
      if (acc.status === "REVOKED" || acc.status === "UNLINKED") return;
      if (acc.name && acc.name.includes("@") && acc.secret) {
        try {
          const totpCode = generateTotp(acc.secret);
          bindDevice({
            email: acc.name.trim().toLowerCase(),
            deviceUuid,
            deviceName: deviceLabel,
            platform: Platform.OS,
            pushToken,
            totpCode,
          })
            .then((res) => {
              if (res?.data?.serverEpochMs) {
                const drift = Math.round(Math.abs(Date.now() - res.data.serverEpochMs) / 1000);
                setClockDriftSeconds(drift);
              }
            })
            .catch(() => {});
        } catch {
          // Ignore transient TOTP calculation notice during mount
        }
      }
    });
  }, [pushToken, deviceUuid, accounts, isStartupComplete]);

  // Handle tap on system push notification banner
  useEffect(() => {
    let responseSubscription: Notifications.Subscription | null = null;
    try {
      responseSubscription = Notifications.addNotificationResponseReceivedListener((response) => {
        const data = response?.notification?.request?.content?.data;
        if (data?.challengeId) {
          const chId = Number(data.challengeId);
          const matchCode = String(data.matchCode || "42");
          const opts = buildChallengeOptions(matchCode);

          setPendingChallenge({
            id: chId,
            userId: Number(data.userId || 0),
            email: String(data.email || ""),
            matchCode,
            clientOrigin: String(data.clientOrigin || "Sentinel Web Portal"),
            options: opts,
          });
        }
      });
    } catch {
    }

    return () => {
      responseSubscription?.remove();
    };
  }, []);

  // Foreground-only 1-second TOTP clock tick to avoid background UI thread commits
  useEffect(() => {
    const timer = setInterval(() => {
      if (AppState.currentState === "active") {
        setRemainingSeconds(getSecondsRemaining());
      }
    }, 1000);

    const appStateSub = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") {
        setRemainingSeconds(getSecondsRemaining());
      } else if (nextState === "background" && (requireBiometrics || masterPin)) {
        setIsVaultUnlocked(false);
        setEnteredPin("");
        setPinErrorMessage(null);
      }
    });

    return () => {
      clearInterval(timer);
      appStateSub.remove();
    };
  }, [requireBiometrics, masterPin]);

  // Poll for active push verification challenges strictly after startup settles
  useEffect(() => {
    if (!isLoaded || !isStartupComplete) return;

    let isMounted = true;
    let pollInterval: ReturnType<typeof setInterval> | null = null;

    const checkPendingChallenges = async () => {
      if (
        !isMounted ||
        AppState.currentState !== "active" ||
        authInFlightRef.current ||
        showScanner
      ) {
        return;
      }

      const emailsToCheck = new Set<string>();
      if (activeSessionUser?.email) {
        emailsToCheck.add(activeSessionUser.email.trim().toLowerCase());
      }

      if (emailsToCheck.size === 0) return;

      for (const email of emailsToCheck) {
        if (!isMounted || AppState.currentState !== "active" || authInFlightRef.current) return;
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 4000);
          const devParam = deviceUuid ? `&deviceUuid=${encodeURIComponent(deviceUuid)}` : "";
          const res = await fetch(
            `${API_BASE_URL}/api/mfa/challenge/pending?email=${encodeURIComponent(email)}${devParam}`,
            { signal: controller.signal }
          );
          clearTimeout(timer);
          if (!res.ok) continue;
          const json = await res.json();
          if (json.data?.serverEpochMs) {
            const drift = Math.round(Math.abs(Date.now() - json.data.serverEpochMs) / 1000);
            setClockDriftSeconds(drift);
          }
          if (json.data?.deviceRevoked || json.data?.mfaDisabled) {
            const nextStatus: TotpAccount["status"] = json.data.deviceRevoked ? "REVOKED" : "UNLINKED";
            setAccounts((prev) => {
              let changed = false;
              const updated = prev.map((a) => {
                if (a.name?.trim().toLowerCase() === email && a.status !== nextStatus) {
                  changed = true;
                  return { ...a, status: nextStatus };
                }
                return a;
              });
              if (changed) saveAccountsToVault(updated).catch(() => {});
              return changed ? updated : prev;
            });
            continue;
          }
          if (json.success && json.data?.hasPending && json.data.challenge) {
            const ch = json.data.challenge;
            if (!isMounted || authInFlightRef.current) return;

            setPendingChallenge((prev) => {
              if (prev && prev.id === ch.id) return prev;
              setIsChallengeMinimized(false);
              const opts = buildChallengeOptions(String(ch.matchCode || "42"));

              // Schedule native Android system notification banner safely with sound + vibration
              try {
                Vibration.vibrate([0, 250, 150, 250]);
                Notifications.scheduleNotificationAsync({
                  content: {
                    title: "Sentinel Security Sign-In Request",
                    body: `Sign-in attempt for ${ch.email}. Select number ${ch.matchCode} on device.`,
                    data: {
                      challengeId: ch.id,
                      matchCode: ch.matchCode,
                      clientOrigin: ch.clientOrigin,
                      email: ch.email,
                    },
                    sound: "default",
                  },
                  trigger: Platform.OS === "android" ? { channelId: "mfa-alerts" } : null,
                }).catch(() => {});
              } catch {
                // Ignore notification trigger notice
              }

              return {
                id: ch.id,
                userId: ch.userId,
                email: ch.email,
                matchCode: ch.matchCode,
                clientOrigin: ch.clientOrigin || "Sentinel Web Portal",
                options: opts,
              };
            });
            break;
          }
        } catch {
          // Ignore network errors or aborted requests during polling
        }
      }
    };

    const initialTimer = setTimeout(() => {
      if (!isMounted) return;
      checkPendingChallenges();
      pollInterval = setInterval(checkPendingChallenges, 4000);
    }, 1000);

    return () => {
      isMounted = false;
      clearTimeout(initialTimer);
      if (pollInterval) {
        clearInterval(pollInterval);
      }
    };
  }, [accounts, isLoaded, isStartupComplete, showScanner]);



  const handleCopyCode = async (id: string, codeToCopy: string) => {
    try {
      await Clipboard.setStringAsync(codeToCopy.replace(/\s/g, ""));
      setCopiedCodeId(id);
      setTimeout(() => {
        setCopiedCodeId((prev) => (prev === id ? null : prev));
      }, 2000);
    } catch {
      Alert.alert("Copied", `Passcode ${codeToCopy} copied.`);
    }
  };

  const handleSelectTab = (tab: "CODES" | "PAIR" | "SECURITY") => {
    setActiveTab(tab);
    if (Platform.OS !== "web") {
      const index = tab === "CODES" ? 0 : tab === "PAIR" ? 1 : 2;
      pagerRef.current?.scrollTo({ x: index * pageWidth, animated: true });
    }
  };

  const handleScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offsetX = e.nativeEvent.contentOffset.x;
    const pageIndex = Math.round(offsetX / pageWidth);
    if (pageIndex === 0 && activeTab !== "CODES") setActiveTab("CODES");
    else if (pageIndex === 1 && activeTab !== "PAIR") setActiveTab("PAIR");
    else if (pageIndex === 2 && activeTab !== "SECURITY") setActiveTab("SECURITY");
  };

  // Re-align horizontal pager when viewport resizes dynamically (native mobile)
  useEffect(() => {
    if (Platform.OS !== "web") {
      const index = activeTab === "CODES" ? 0 : activeTab === "PAIR" ? 1 : 2;
      pagerRef.current?.scrollTo({ x: index * pageWidth, animated: false });
    }
  }, [pageWidth]);

  const openPortalUrl = async (url: string = PORTAL_URL) => {
    try {
      await WebBrowser.openBrowserAsync(url);
    } catch {
      Linking.openURL(url).catch(() => {
        Alert.alert("Link Notice", `Please visit ${url} in your browser.`);
      });
    }
  };

  // Master Security PIN Handlers
  const handleSaveMasterPin = async () => {
    const cleanPin = setupPin.trim();
    if (!/^\d{4,8}$/.test(cleanPin)) {
      setPinErrorMessage("PIN must be 4 to 8 numeric digits.");
      return;
    }
    if (cleanPin !== setupPinConfirm.trim()) {
      setPinErrorMessage("PIN confirmation does not match. Please re-enter.");
      return;
    }
    const storedHash = await saveMasterPin(cleanPin);
    await resetPinFailures();
    setPinLockoutUntil(0);
    setMasterPin(storedHash || cleanPin);
    setIsPinSetupMode(false);
    setIsVaultUnlocked(true);
    setPinErrorMessage(null);
    setSetupPin("");
    setSetupPinConfirm("");

    const newLog = await recordAuditLog({
      eventType: "PIN_CONFIGURED",
      title: "Master Security PIN Configured",
      details: "Configured hashed fallback security PIN for authenticator access",
    });
    setAuditLogs((prev) => [newLog, ...prev]);
    Alert.alert("Security PIN Configured", "Your Master PIN is active. Use this PIN whenever unlocking the authenticator.");
  };

  const handleUnlockWithPin = async () => {
    const cleanPin = enteredPin.trim();
    if (!masterPin) {
      setIsVaultUnlocked(true);
      return;
    }
    if (verifyHashedPin(cleanPin, masterPin)) {
      await resetPinFailures();
      setPinLockoutUntil(0);
      if (!masterPin.startsWith("v1$")) {
        const migrated = await saveMasterPin(cleanPin);
        if (migrated) setMasterPin(migrated);
      }
      setIsVaultUnlocked(true);
      setEnteredPin("");
      setPinErrorMessage(null);
      const newLog = await recordAuditLog({
        eventType: "VAULT_UNLOCKED",
        title: "Vault Unlocked",
        details: "Authenticated via Master Security PIN",
      });
      setAuditLogs((prev) => [newLog, ...prev]);
    } else {
      setEnteredPin("");
      setPinErrorMessage("Incorrect PIN. Please try again.");
    }
  };

  const handleStartPinChange = () => {
    setSetupPin("");
    setSetupPinConfirm("");
    setPinErrorMessage(null);
    setIsPinSetupMode(true);
    setIsVaultUnlocked(false);
  };

  // Authenticate with Android system biometrics or device PIN / Pattern
  const handleUnlockApp = async () => {
    if (authInFlightRef.current) return;
    authInFlightRef.current = true;
    try {
      const hasHw = (await withTimeout(LocalAuthentication.hasHardwareAsync(), 2000)) ?? false;
      const isEnr = (await withTimeout(LocalAuthentication.isEnrolledAsync(), 2000)) ?? false;

      if (!hasHw || !isEnr) {
        if (!masterPin) {
          setIsPinSetupMode(true);
        }
        return;
      }

      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: "Unlock Sentinel Security Authenticator",
        cancelLabel: "Cancel",
        fallbackLabel: masterPin ? "Use Master PIN" : "Use Screen Lock",
        disableDeviceFallback: false,
      });

      if (result.success) {
        setIsVaultUnlocked(true);
        const newLog = await recordAuditLog({
          eventType: "VAULT_UNLOCKED",
          title: "Vault Unlocked",
          details: "Authenticated via device biometrics",
        });
        setAuditLogs((prev) => [newLog, ...prev]);
        recordMobileTelemetry({
          actionType: "APP_LOCK_UNLOCK_SUCCESS",
          details: "User authenticated to open Sentinel Authenticator",
        });
      }
    } catch {
      Alert.alert("Authentication Error", "Unable to verify device credentials. Please try again.");
    } finally {
      authInFlightRef.current = false;
    }
  };

  // Lock app
  const handleLockApp = async () => {
    setIsVaultUnlocked(false);
    setEnteredPin("");
    setPinErrorMessage(null);
    const newLog = await recordAuditLog({
      eventType: "VAULT_LOCKED",
      title: "Vault Locked",
      details: "User manually locked authenticator vault",
    });
    setAuditLogs((prev) => [newLog, ...prev]);
  };

  // Toggle biometric enforcement preference
  const handleToggleBiometrics = async () => {
    const nextVal = !requireBiometrics;
    setRequireBiometrics(nextVal);
    if (!nextVal) {
      setIsVaultUnlocked(true);
    } else {
      setIsVaultUnlocked(false);
    }
    await saveVaultSettings({ requireBiometrics: nextVal });
    recordMobileTelemetry({
      actionType: "BIOMETRIC_PREFERENCE_CHANGED",
      details: `Biometric lock policy set to ${nextVal ? "ENFORCED" : "DISABLED"}`,
    });
  };

  // Handle push approval with biometric verification gate
  const handleRespondChallenge = async (action: "APPROVE" | "DENY", selectedCode?: string) => {
    if (!pendingChallenge || respondingChallenge) return;

    if (action === "APPROVE") {
      if (authInFlightRef.current) return;
      authInFlightRef.current = true;
      try {
        const hasHardware = (await withTimeout(LocalAuthentication.hasHardwareAsync(), 2000)) ?? false;
        const isEnrolled = (await withTimeout(LocalAuthentication.isEnrolledAsync(), 2000)) ?? false;
        if (hasHardware && isEnrolled) {
          const authResult = await LocalAuthentication.authenticateAsync({
            promptMessage: "Authenticate to Confirm Sign-In",
            cancelLabel: "Cancel",
            fallbackLabel: "Use Device PIN",
            disableDeviceFallback: false,
          });
          if (!authResult.success) {
            Alert.alert("Authentication Canceled", "Biometric or PIN verification is required to approve access.");
            return;
          }
        } else if (!isVaultUnlocked) {
          Alert.alert("Vault Locked", "Unlock the Sentinel Authenticator vault before approving sign-in requests.");
          return;
        }
      } catch {
        Alert.alert("Authentication Failed", "Could not verify device identity. Sign-in approval aborted.");
        return;
      } finally {
        authInFlightRef.current = false;
      }
    }

    setRespondingChallenge(true);
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(`${API_BASE_URL}/api/mfa/challenge/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          challengeId: pendingChallenge.id,
          action,
          selectedCode,
          deviceUuid,
          deviceName: deviceLabel,
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      const json = await res.json();
      if (json.success) {
        const challengeOrigin = pendingChallenge.clientOrigin;
        const challengeEmail = pendingChallenge.email;
        const challengeId = pendingChallenge.id;
        setPendingChallenge(null);
        if (action === "APPROVE") {
          const log = await recordAuditLog({
            eventType: "LOGIN_APPROVED",
            title: "Login Request Approved",
            details: `Approved challenge #${challengeId} with verification code ${selectedCode || "confirmed"}`,
            origin: challengeOrigin,
            account: challengeEmail,
          });
          setAuditLogs((prev) => [log, ...prev]);
          Alert.alert("Authorization Approved", "Sign-in approved successfully.");
        } else {
          const log = await recordAuditLog({
            eventType: "LOGIN_DENIED",
            title: "Login Request Denied",
            details: `Declined sign-in challenge #${challengeId}`,
            origin: challengeOrigin,
            account: challengeEmail,
          });
          setAuditLogs((prev) => [log, ...prev]);
          Alert.alert("Authorization Denied", "Sign-in request denied.");
        }
      } else {
        Alert.alert("Verification Error", json.message || "Failed to process authorization.");
      }
    } catch {
      Alert.alert("Network Error", "Could not reach Sentinel Security Gateway.");
    } finally {
      setRespondingChallenge(false);
    }
  };

  const resolveSecretIdentity = async (candidateSecret: string) => {
    if (candidateSecret.length < 8) return;
    setIsResolvingSecret(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/mfa/resolve-secret?secret=${encodeURIComponent(candidateSecret)}`);
      const json = await res.json();
      if (json.success && json.data) {
        if (json.data.email) {
          setAccountName(json.data.email);
        }
        if (json.data.issuer) {
          setAccountIssuer(json.data.issuer);
        }
        setResolvedIdentity(`${json.data.email} (${json.data.issuer || "Sentinel IAM"})`);
      } else {
        setResolvedIdentity(null);
      }
    } catch {
      setResolvedIdentity(null);
    } finally {
      setIsResolvingSecret(false);
    }
  };

  // Secret key input validator & URI parser
  const handleSecretKeyChange = (text: string) => {
    // Detect otpauth:// URI pasted in the secret key field
    if (text.trim().toLowerCase().startsWith("otpauth://")) {
      const parsed = parseOtpAuthUri(text);
      if (parsed) {
        setSecretKey(parsed.secret);
        if (parsed.accountName) setAccountName(parsed.accountName);
        if (parsed.issuer) setAccountIssuer(parsed.issuer);
        setManualValidationError(null);
        setResolvedIdentity(
          `${parsed.accountName || "Enrolled Account"}${parsed.issuer ? ` (${parsed.issuer})` : ""}`
        );
        return;
      }
    }

    const clean = normalizeBase32Secret(text);
    setSecretKey(clean);

    if (clean.length > 0) {
      if (!/^[A-Z2-7]+=*$/.test(clean)) {
        setManualValidationError("Base32 keys must only contain letters A-Z and digits 2-7.");
        setResolvedIdentity(null);
      } else if (clean.length < 8) {
        setManualValidationError("Base32 keys must be at least 8 characters long.");
        setResolvedIdentity(null);
      } else {
        setManualValidationError(null);
        if (resolveDebounceRef.current) {
          clearTimeout(resolveDebounceRef.current);
        }
        resolveDebounceRef.current = setTimeout(() => {
          resolveSecretIdentity(clean);
        }, 500);
      }
    } else {
      if (resolveDebounceRef.current) {
        clearTimeout(resolveDebounceRef.current);
      }
      setManualValidationError(null);
      setResolvedIdentity(null);
    }
  };

  const handleAddAccount = async (name?: string, secret?: string, issuer?: string) => {
    const cleanSecret = normalizeBase32Secret(secret || secretKey);
    let cleanName = (name || accountName).trim();
    let cleanIssuer = (issuer || accountIssuer).trim();

    if (!cleanSecret) {
      Alert.alert("Input Error", "Secret Key is required.");
      return;
    }

    if (!/^[A-Z2-7]+=*$/.test(cleanSecret) || cleanSecret.length < 8) {
      Alert.alert("Invalid Key", "Secret Key must be a valid Base32 string (A-Z, 2-7, min 8 characters).");
      return;
    }

    if (accounts.some((acc) => normalizeBase32Secret(acc.secret) === cleanSecret)) {
      Alert.alert("Duplicate Account", "This 2FA secret key is already enrolled in your vault.");
      return;
    }

    // Auto-resolve identity from security gateway if name is not set
    if (!cleanName) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 4000);
        const res = await fetch(
          `${API_BASE_URL}/api/mfa/resolve-secret?secret=${encodeURIComponent(cleanSecret)}`,
          { signal: controller.signal }
        );
        clearTimeout(timer);
        const json = await res.json();
        if (json.success && json.data) {
          if (json.data.email) cleanName = json.data.email;
          if (json.data.issuer && !cleanIssuer) cleanIssuer = json.data.issuer;
        }
      } catch {
      }
    }

    if (!cleanName) {
      cleanName = `Sentinel Account (${cleanSecret.slice(-4)})`;
    }
    if (!cleanIssuer) {
      cleanIssuer = "Sentinel IAM";
    }

    const newAccount: TotpAccount = {
      id: Date.now().toString(),
      name: cleanName,
      secret: cleanSecret,
      issuer: cleanIssuer || undefined,
      createdAt: Date.now(),
    };

    setAccounts((prev) => {
      const updated = [newAccount, ...prev];
      saveAccountsToVault(updated).catch(() => {});
      return updated;
    });
    setAccountName("");
    setAccountIssuer("");
    setSecretKey("");
    setResolvedIdentity(null);
    setManualValidationError(null);
    setShowScanner(false);
    handleSelectTab("CODES");

    recordMobileTelemetry({
      actionType: "ENROLL_KEY_MANUAL",
      details: `User enrolled 2FA key for ${cleanName}${cleanIssuer ? ` (${cleanIssuer})` : ""}`,
      userEmail: cleanName,
    });

    recordAuditLog({
      eventType: "ACCOUNT_PAIRED",
      title: "Account Key Paired",
      details: `Enrolled TOTP secret (${cleanIssuer || "Sentinel IAM"})`,
      account: cleanName,
    }).then((log) => setAuditLogs((prev) => [log, ...prev]));

    Alert.alert("Account Paired", `Successfully enrolled 2FA for ${cleanName}`);
  };

  const handleInitiateDelete = (account: TotpAccount, e?: any) => {
    e?.stopPropagation?.();
    setAccountToDelete(account);
  };

  const handleOpenAccountActivity = async (account: TotpAccount) => {
    setActivityAccount(account);
    setServerActivityLogs([]);
    setActivityError(null);

    if (!account.name || !account.name.includes("@") || !deviceUuid) {
      setActivityError("Server activity is available for Sentinel email-bound accounts.");
      return;
    }

    setLoadingActivity(true);
    try {
      const totpCode = generateTotp(account.secret);
      const res = await fetchAccountActivity({
        email: account.name.trim().toLowerCase(),
        totpCode,
        deviceUuid,
        limit: 25,
      });
      if (res.success && Array.isArray(res.data)) {
        setServerActivityLogs(res.data);
      } else {
        setActivityError(res.message || "Unable to load server account activity.");
      }
    } catch {
      setActivityError("Network error while fetching account activity.");
    } finally {
      setLoadingActivity(false);
    }
  };

  const executeDeleteAccount = async (target: TotpAccount) => {
    const displayName = target.issuer ? `${target.issuer} (${target.name})` : target.name;

    // Unbind this specific physical device on backend if this is a Sentinel email account
    if (target.name && target.name.includes("@") && deviceUuid) {
      unbindDevice({
        email: target.name.trim().toLowerCase(),
        deviceUuid,
      }).catch(() => {});
    }

    // Resilient account deletion matching by ID or name + secret fallback
    setAccounts((prev) => {
      const updated = prev.filter((acc) => {
        if (target.id && acc.id) return acc.id !== target.id;
        return !(acc.name === target.name && acc.secret === target.secret);
      });
      saveAccountsToVault(updated).catch(() => {});
      return updated;
    });

    setAccountToDelete(null);

    try {
      const log = await recordAuditLog({
        eventType: "DEVICE_UNBOUND",
        title: "Device Unbound & Key Removed",
        details: `Unbound ${deviceLabel} and removed local TOTP credential for ${displayName}. Account MFA remains active.`,
        account: target.name,
      });
      setAuditLogs((prev) => [log, ...prev]);
    } catch {
    }

    recordMobileTelemetry({
      actionType: "DEVICE_UNBOUND",
      details: `User unbound ${deviceLabel} and removed enrolled key for ${displayName}`,
      userEmail: target.name,
      severity: "WARN",
    });
  };

  const handleOpenScanner = async () => {
    if (!permission?.granted) {
      const res = await requestPermission();
      if (!res.granted) {
        Alert.alert(
          "Camera Permission Required",
          "Camera access is required to scan QR codes for pairing."
        );
        return;
      }
    }
    scanLockRef.current = false;
    setShowScanner(true);
    recordMobileTelemetry({
      actionType: "OPEN_SCANNER",
      details: "User opened QR code camera scanner",
    });
  };

  const handleBarcodeScanned = ({ data }: { data: string }) => {
    if (!data || scanLockRef.current) return;
    scanLockRef.current = true;

    // Handle otpauth://totp/URI format
    if (data.trim().toLowerCase().startsWith("otpauth://")) {
      const parsed = parseOtpAuthUri(data);
      if (parsed) {
        const displayName = parsed.accountName || parsed.issuer || "Sentinel Account";
        handleAddAccount(displayName, parsed.secret, parsed.issuer);
        return;
      }
    }

    // Direct Base32 key fallback
    const cleanSecret = normalizeBase32Secret(data);
    if (cleanSecret.length >= 8 && /^[A-Z2-7]+$/.test(cleanSecret)) {
      handleAddAccount("Enrolled Account", cleanSecret, "Sentinel IAM");
    } else {
      setShowScanner(false);
      Alert.alert("Invalid QR Code", "Scanned code does not contain a valid Base32 2FA secret.");
    }
  };

  const progressPercent = Math.max(0, Math.min(100, (remainingSeconds / 30) * 100));

  const renderPasscodesTab = () => (
    visibleAccounts.length > 0 ? (
      <FlatList
        data={visibleAccounts}
        keyExtractor={(item, index) => item.id || `${item.name}-${item.secret}-${index}`}
        contentContainerStyle={styles.listContentWithDock}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <>
            {clockDriftSeconds > 15 && (
              <View style={styles.driftWarningBanner}>
                <Text style={styles.driftWarningText}>
                  CLOCK DRIFT DETECTED ({clockDriftSeconds}s): TOTP codes may be rejected. Enable automatic network time in device settings.
                </Text>
              </View>
            )}
            {pendingChallenge && isChallengeMinimized && (
              <TouchableOpacity
                style={styles.minimizedChallengeBanner}
                onPress={() => setIsChallengeMinimized(false)}
              >
                <Text style={styles.minimizedChallengeText}>
                  PENDING SIGN-IN REQUEST FOR {pendingChallenge.email.toUpperCase()} — TAP TO REVIEW
                </Text>
              </TouchableOpacity>
            )}
          </>
        }
        renderItem={({ item }) => {
          let code = "------";
          try {
            code = generateTotp(item.secret);
          } catch {
            code = "------";
          }
          const formattedCode =
            code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
          const isCopied = copiedCodeId === item.id;

          return (
            <TouchableOpacity
              activeOpacity={0.88}
              style={[styles.accountCard, isCopied && styles.accountCardCopied]}
              onPress={() => handleCopyCode(item.id, code)}
            >
              {/* Header: Issuer + Algorithm badge */}
              <View style={styles.accountTopRow}>
                <View style={styles.accountIdentityGroup}>
                  <Text style={styles.accountName} numberOfLines={1}>
                    {item.name}
                  </Text>
                  {item.issuer && (
                    <View style={styles.issuerBadge}>
                      <Text style={styles.issuerBadgeText}>{item.issuer.toUpperCase()}</Text>
                    </View>
                  )}
                  {(item.status === "REVOKED" || item.status === "UNLINKED") && (
                    <View style={styles.revokedBadge}>
                      <Text style={styles.revokedBadgeText}>
                        {item.status === "REVOKED" ? "DEVICE UNBOUND" : "MFA DISABLED"}
                      </Text>
                    </View>
                  )}
                </View>
                <View style={styles.protocolBadge}>
                  <Text style={styles.protocolBadgeText}>SHA-1 / 30S</Text>
                </View>
              </View>

              {/* Middle: Large Monospace Passcode & Quick Action */}
              <View style={styles.tokenRow}>
                <Text style={styles.totpToken}>{formattedCode}</Text>
                <View style={[styles.copyPill, isCopied && styles.copyPillActive]}>
                  <Text style={[styles.copyPillText, isCopied && styles.copyPillTextActive]}>
                    {isCopied ? "COPIED" : "TAP TO COPY"}
                  </Text>
                </View>
              </View>

              {/* Footer: Per-Card Synchronized Progress Line & Remaining Seconds */}
              <View style={styles.cardProgressRow}>
                <View style={styles.cardProgressTrack}>
                  <View style={[styles.cardProgressBar, { width: `${progressPercent}%` }]} />
                </View>
                <Text style={styles.cardSecondsText}>{remainingSeconds}s</Text>
              </View>

              {/* Bottom Utility Row */}
              <View style={styles.cardUtilityRow}>
                <Text style={styles.secretHintText} numberOfLines={1}>
                  KEY: {item.secret.slice(0, 4)}••••••••{item.secret.slice(-4)}
                </Text>
                <View style={styles.cardActionsGroup}>
                  <TouchableOpacity
                    style={styles.cardActivityBtn}
                    onPress={(e) => {
                      e?.stopPropagation?.();
                      handleOpenAccountActivity(item);
                    }}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    accessibilityLabel={`Activity for ${item.name}`}
                  >
                    <Text style={styles.cardActivityBtnText}>ACTIVITY</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.cardDeleteBtn}
                    onPress={(e) => handleInitiateDelete(item, e)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    accessibilityLabel={`Remove ${item.name}`}
                  >
                    <Text style={styles.cardDeleteBtnText}>UNBIND</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </TouchableOpacity>
          );
        }}
      />
    ) : (
      <ScrollView
        style={styles.pageContentFlex}
        contentContainerStyle={styles.onboardingContainer}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.welcomeCard}>
          <View style={styles.welcomeIconShield} />
          <Text style={styles.welcomeTitle}>SENTINEL AUTHENTICATOR</Text>
          <Text style={styles.welcomeDescription}>
            Enterprise-grade Identity and Multi-Factor Authentication. Your device functions as a physical possession factor protected by hardware Keystore cryptography.
          </Text>

          <View style={styles.welcomeActionsGroup}>
            <TouchableOpacity
              style={styles.welcomePrimaryBtn}
              onPress={() => handleSelectTab("PAIR")}
            >
              <Text style={styles.welcomePrimaryBtnText}>+ PAIR ACCOUNT KEY</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.welcomePortalBtn}
              onPress={() => openPortalUrl(PORTAL_URL)}
            >
              <Text style={styles.welcomePortalBtnText}>OPEN SENTINEL WEB PORTAL</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.instructionCard}>
          <Text style={styles.instructionHeading}>SETUP INSTRUCTIONS</Text>
          <Text style={styles.instructionStep}>
            1. Log in to the Sentinel Web Portal at web-beta-orcin-33.vercel.app.
          </Text>
          <Text style={styles.instructionStep}>
            2. Go to your User Dashboard and select "Pair Mobile Authenticator".
          </Text>
          <Text style={styles.instructionStep}>
            3. Tap "+ PAIR KEY" in the bottom dock and scan your enrollment QR code.
          </Text>
        </View>
      </ScrollView>
    )
  );

  const renderPairKeyTab = () => (
    <ScrollView
      style={styles.pageContentFlex}
      contentContainerStyle={styles.scrollPaddingWithDock}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.enrollmentCard}>
        <View style={styles.enrollmentHeader}>
          <Text style={styles.enrollmentTitle}>ENROLL 2FA KEY</Text>
          <View style={styles.segmentContainer}>
            <TouchableOpacity
              style={[styles.segmentTab, enrollmentTab === "SCAN" && styles.segmentTabActive]}
              onPress={() => setEnrollmentTab("SCAN")}
            >
              <Text
                style={[
                  styles.segmentTabText,
                  enrollmentTab === "SCAN" && styles.segmentTabTextActive,
                ]}
              >
                SCAN QR
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.segmentTab, enrollmentTab === "MANUAL" && styles.segmentTabActive]}
              onPress={() => setEnrollmentTab("MANUAL")}
            >
              <Text
                style={[
                  styles.segmentTabText,
                  enrollmentTab === "MANUAL" && styles.segmentTabTextActive,
                ]}
              >
                MANUAL
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {enrollmentTab === "SCAN" ? (
          <View>
            <Text style={styles.modeDescriptionText}>
              Scan an enrollment QR code directly from the Sentinel Web Portal to automatically pair via the otpauth standard.
            </Text>
            <TouchableOpacity style={styles.primaryScanButton} onPress={handleOpenScanner}>
              <Text style={styles.primaryScanButtonText}>LAUNCH CAMERA SCANNER</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View>
            <Text style={styles.modeDescriptionText}>
              Paste your Base32 pairing key from Sentinel IAM. Account identity and company are resolved automatically.
            </Text>

            <TextInput
              style={[
                styles.inputField,
                manualValidationError ? styles.inputFieldError : null,
              ]}
              placeholder="Base32 Secret Key (e.g. IUMWBTWCDVSRBL...)"
              placeholderTextColor="#64748b"
              value={secretKey}
              onChangeText={handleSecretKeyChange}
              autoCapitalize="characters"
              autoCorrect={false}
            />

            {isResolvingSecret && (
              <View style={styles.resolvingBox}>
                <Text style={styles.resolvingText}>Resolving identity from security gateway...</Text>
              </View>
            )}

            {resolvedIdentity && (
              <View style={styles.resolvedIdentityBox}>
                <Text style={styles.resolvedIdentityText}>Account Identified: {resolvedIdentity}</Text>
              </View>
            )}

            {manualValidationError && (
              <View style={styles.validationErrorBox}>
                <Text style={styles.validationErrorText}>{manualValidationError}</Text>
              </View>
            )}

            <TextInput
              style={styles.inputField}
              placeholder="Account Email (Auto-detected)"
              placeholderTextColor="#64748b"
              value={accountName}
              onChangeText={setAccountName}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TextInput
              style={styles.inputField}
              placeholder="Issuer Organization (Auto-detected)"
              placeholderTextColor="#64748b"
              value={accountIssuer}
              onChangeText={setAccountIssuer}
              autoCapitalize="words"
              autoCorrect={false}
            />

            <TouchableOpacity
              style={styles.addKeyButton}
              onPress={() => handleAddAccount()}
            >
              <Text style={styles.addKeyButtonText}>ENROLL ACCOUNT KEY</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </ScrollView>
  );

  const renderSystemTab = () => (
    <ScrollView
      style={styles.pageContentFlex}
      contentContainerStyle={styles.scrollPaddingWithDock}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.securitySectionCard}>
        <Text style={styles.securitySectionTitle}>SECURITY HARDWARE DIAGNOSTICS</Text>

        <View style={styles.securityDetailRow}>
          <Text style={styles.securityDetailLabel}>Hardware Keystore Enclave</Text>
          <Text style={[styles.securityDetailValue, { color: isHardwareVault ? "#54f4fc" : "#94a3b8" }]}>
            {isHardwareVault ? "HARDWARE-BACKED (AES-256)" : "PERSISTENT STORAGE"}
          </Text>
        </View>

        <View style={styles.securityDetailRow}>
          <Text style={styles.securityDetailLabel}>Biometric Sensor</Text>
          <Text style={[styles.securityDetailValue, { color: hasBiometricHardware ? "#10b981" : "#94a3b8" }]}>
            {hasBiometricHardware ? `${biometricTypeLabel} DETECTED` : "NOT AVAILABLE"}
          </Text>
        </View>

        <View style={styles.securityDetailRow}>
          <Text style={styles.securityDetailLabel}>Biometric Enrollment</Text>
          <Text style={[styles.securityDetailValue, { color: biometricEnrolled ? "#10b981" : "#f59e0b" }]}>
            {biometricEnrolled ? "ENROLLED ON OS" : "NOT ENROLLED"}
          </Text>
        </View>

        <View style={styles.securityDetailRow}>
          <Text style={styles.securityDetailLabel}>Push Verification Channel</Text>
          <Text style={[styles.securityDetailValue, { color: pushToken ? "#54f4fc" : "#94a3b8" }]}>
            {pushToken ? "FCM ACTIVE" : "LOCAL MODE"}
          </Text>
        </View>

        <View style={styles.securityDetailRow}>
          <Text style={styles.securityDetailLabel}>Master Security PIN</Text>
          <Text style={[styles.securityDetailValue, { color: masterPin ? "#10b981" : "#f59e0b" }]}>
            {masterPin ? "CONFIGURED (HASHED)" : "MANDATORY SETUP"}
          </Text>
        </View>

        <View style={styles.securityDetailRow}>
          <Text style={styles.securityDetailLabel}>Device Identity</Text>
          <Text style={[styles.securityDetailValue, { color: "#54f4fc" }]} numberOfLines={1}>
            {deviceLabel} ({deviceUuid ? deviceUuid.slice(0, 12) : "INIT"})
          </Text>
        </View>
      </View>

      <View style={styles.securitySectionCard}>
        <Text style={styles.securitySectionTitle}>ACCESS PROTECTION POLICY</Text>
        <Text style={styles.securitySectionSubtitle}>
          Require biometric authentication or device PIN whenever opening the app.
        </Text>

        <TouchableOpacity style={styles.biometricSwitchButton} onPress={handleToggleBiometrics}>
          <View style={styles.switchInfo}>
            <Text style={styles.switchTitle}>
              {requireBiometrics ? `Enforce ${biometricTypeLabel} App Lock` : "Direct App Access"}
            </Text>
            <Text style={styles.switchDesc}>
              {requireBiometrics
                ? "Full-screen device authentication gate is required on app launch."
                : "Application opens directly into passcodes view."}
            </Text>
          </View>
          <View style={[styles.switchPill, requireBiometrics && styles.switchPillActive]}>
            <Text style={[styles.switchPillText, requireBiometrics && styles.switchPillTextActive]}>
              {requireBiometrics ? "ENABLED" : "OFF"}
            </Text>
          </View>
        </TouchableOpacity>

        <View style={styles.policyDivider} />

        <View style={styles.pinConfigRow}>
          <View style={styles.switchInfo}>
            <Text style={styles.switchTitle}>Master Security PIN</Text>
            <Text style={styles.switchDesc}>
              {masterPin
                ? "Configured fallback security PIN for devices without native biometrics."
                : "Required fallback security PIN. Must be set up to use app."}
            </Text>
          </View>
          <TouchableOpacity style={styles.pinChangeButton} onPress={handleStartPinChange}>
            <Text style={styles.pinChangeButtonText}>
              {masterPin ? "CHANGE PIN" : "SET PIN"}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.policyDivider} />

        <View style={styles.pinConfigRow}>
          <View style={styles.switchInfo}>
            <Text style={styles.switchTitle}>Push Alert &amp; Sound Channel</Text>
            <Text style={styles.switchDesc}>
              {notificationPermissionGranted
                ? "Notifications enabled on mfa-alerts channel with default sound."
                : "Tap Test Alert to grant permission and verify notification sound."}
            </Text>
          </View>
          <TouchableOpacity
            style={styles.pinChangeButton}
            onPress={async () => {
              try {
                const perm = await Notifications.getPermissionsAsync();
                let allowed = perm.status === "granted";
                if (!allowed) {
                  const req = await Notifications.requestPermissionsAsync();
                  allowed = req.status === "granted";
                }
                setNotificationPermissionGranted(allowed);
                if (!allowed) {
                  Alert.alert("Permission Required", "Please allow notifications in device settings to hear MFA challenge alerts.");
                  return;
                }
                Vibration.vibrate([0, 250, 150, 250]);
                await Notifications.scheduleNotificationAsync({
                  content: {
                    title: "Sentinel Alert Sound Test",
                    body: "Notifications and sound are active on mfa-alerts.",
                    sound: "default",
                  },
                  trigger: Platform.OS === "android" ? { channelId: "mfa-alerts" } : null,
                });
              } catch {
                Alert.alert("Notification Test", "Unable to trigger test notification on this device.");
              }
            }}
          >
            <Text style={styles.pinChangeButtonText}>TEST ALERT</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Per-Account Server Activity Logs (Password changes, Logins, Device & IP) */}
      <View style={styles.securitySectionCard}>
        <View style={styles.auditHeaderRow}>
          <Text style={styles.securitySectionTitle}>ACCOUNT ACTIVITY LOGS</Text>
          <TouchableOpacity
            style={styles.pinChangeButton}
            onPress={() => loadPersonalLogsForAccount(activeSessionUser)}
          >
            <Text style={styles.pinChangeButtonText}>
              {personalLogsLoading ? "LOADING..." : "REFRESH"}
            </Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.securitySectionSubtitle}>
          {activeSessionUser
            ? `Server activity for ${activeSessionUser.email} — logins, password changes, device info, and IP addresses.`
            : "Sign in to view your account activity logs."}
        </Text>

        {personalLogsError && (
          <Text style={{ color: "#fb7185", fontSize: 11, marginBottom: 8 }}>{personalLogsError}</Text>
        )}

        {personalLogs.length > 0 ? (
          <View style={styles.auditList}>
            {personalLogs.slice(0, 20).map((log) => (
              <View key={log.id} style={styles.auditItem}>
                <View style={styles.auditTopRow}>
                  <View style={styles.auditTypeBadge}>
                    <Text style={styles.auditTypeBadgeText}>{log.actionType}</Text>
                  </View>
                  <Text style={styles.auditTimeText}>{log.createdAt}</Text>
                </View>
                <Text style={styles.auditItemDetails}>{log.details || log.actionType}</Text>
                <Text style={styles.auditItemOrigin}>
                  IP: {log.ipAddress || "N/A"} | Target: {log.targetResource || "N/A"}
                </Text>
                <Text style={styles.auditItemAccount}>
                  Device: {log.userAgent || "Unknown device"}
                </Text>
              </View>
            ))}
          </View>
        ) : (
          <Text style={styles.emptyAuditText}>
            {personalLogsLoading ? "Loading account activity..." : "No server activity records found for this account."}
          </Text>
        )}
      </View>

      {/* Security Audit & Login Logs (Immutable Local Trail) */}
      <View style={styles.securitySectionCard}>
        <View style={styles.auditHeaderRow}>
          <Text style={styles.securitySectionTitle}>SECURITY AUDIT & LOGIN LOGS</Text>
          <Text style={styles.immutableBadgeText}>IMMUTABLE</Text>
        </View>
        <Text style={styles.securitySectionSubtitle}>
          Encrypted local audit timeline of login approvals, device bindings, and security state changes. Tap ACTIVITY on any account card for full server logs.
        </Text>

        {auditLogs.length > 0 ? (
          <View style={styles.auditList}>
            {auditLogs.slice(0, 20).map((log) => {
              const dateStr = new Date(log.timestamp).toLocaleTimeString("en-US", {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
                hour12: true,
              });
              const isApproval = log.eventType === "LOGIN_APPROVED";
              const isDenial = log.eventType === "LOGIN_DENIED";
              const isPair = log.eventType === "ACCOUNT_PAIRED";

              return (
                <View key={log.id} style={styles.auditItem}>
                  <View style={styles.auditTopRow}>
                    <View
                      style={[
                        styles.auditTypeBadge,
                        isApproval && styles.auditTypeBadgeSuccess,
                        isDenial && styles.auditTypeBadgeDanger,
                        isPair && styles.auditTypeBadgeInfo,
                      ]}
                    >
                      <Text
                        style={[
                          styles.auditTypeBadgeText,
                          isApproval && styles.auditTypeBadgeTextSuccess,
                          isDenial && styles.auditTypeBadgeTextDanger,
                          isPair && styles.auditTypeBadgeTextInfo,
                        ]}
                      >
                        {log.eventType.replace(/_/g, " ")}
                      </Text>
                    </View>
                    <Text style={styles.auditTimeText}>{dateStr}</Text>
                  </View>
                  <Text style={styles.auditItemTitle}>{log.title}</Text>
                  <Text style={styles.auditItemDetails}>{log.details}</Text>
                  {log.origin ? (
                    <Text style={styles.auditItemOrigin}>ORIGIN: {log.origin}</Text>
                  ) : null}
                  {log.account ? (
                    <Text style={styles.auditItemAccount}>IDENTITY: {log.account}</Text>
                  ) : null}
                </View>
              );
            })}
          </View>
        ) : (
          <View style={styles.emptyAuditBox}>
            <Text style={styles.emptyAuditText}>No audit activity recorded yet.</Text>
          </View>
        )}
      </View>

      <View style={styles.securitySectionCard}>
        <Text style={styles.securitySectionTitle}>ENTERPRISE RESOURCES</Text>
        <TouchableOpacity
          style={styles.resourceButton}
          onPress={() => openPortalUrl(PORTAL_URL)}
        >
          <Text style={styles.resourceButtonText}>VISIT SENTINEL WEB PORTAL</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );

  // Full-Screen Security Lock Gate
  if (!isVaultUnlocked) {
    if (isPinSetupMode || (!masterPin && (!hasBiometricHardware || !biometricEnrolled))) {
      return (
        <View style={styles.outerRoot}>
          <SafeAreaView style={styles.lockGateContainer}>
            <View style={styles.lockGateCenter}>
              <Image
                source={require("../../assets/images/icon.png")}
                style={styles.lockGateLogo}
                resizeMode="contain"
              />
              <View style={styles.setupBadge}>
                <View style={styles.setupDot} />
                <Text style={styles.setupBadgeText}>MANDATORY SECURITY ENROLLMENT</Text>
              </View>
              <Text style={styles.lockTitle}>Set Master Security PIN</Text>
              <Text style={styles.lockSubtitle}>
                Native biometrics not available. Configure a 4 to 8 digit Master PIN to protect your TOTP credentials and authorization challenges.
              </Text>

              {pinErrorMessage && (
                <View style={styles.pinErrorBanner}>
                  <Text style={styles.pinErrorBannerText}>{pinErrorMessage}</Text>
                </View>
              )}

              <TextInput
                style={styles.pinInputField}
                placeholder="Create Security PIN (4-8 digits)"
                placeholderTextColor="#64748b"
                value={setupPin}
                onChangeText={(t) => {
                  setSetupPin(t.replace(/\D/g, "").slice(0, 8));
                  setPinErrorMessage(null);
                }}
                keyboardType="number-pad"
                secureTextEntry={true}
                maxLength={8}
              />

              <TextInput
                style={styles.pinInputField}
                placeholder="Confirm Security PIN"
                placeholderTextColor="#64748b"
                value={setupPinConfirm}
                onChangeText={(t) => {
                  setSetupPinConfirm(t.replace(/\D/g, "").slice(0, 8));
                  setPinErrorMessage(null);
                }}
                keyboardType="number-pad"
                secureTextEntry={true}
                maxLength={8}
              />

              <TouchableOpacity style={styles.primaryUnlockButton} onPress={handleSaveMasterPin}>
                <Text style={styles.primaryUnlockButtonText}>SAVE PIN & UNLOCK APP</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.portalHelperButton}
                onPress={() => openPortalUrl(PORTAL_URL)}
              >
                <Text style={styles.portalHelperButtonText}>OPEN SENTINEL WEB PORTAL</Text>
              </TouchableOpacity>
            </View>
          </SafeAreaView>
        </View>
      );
    }

    return (
      <View style={styles.outerRoot}>
        <SafeAreaView style={styles.lockGateContainer}>
          <View style={styles.lockGateCenter}>
            <Image
              source={require("../../assets/images/icon.png")}
              style={styles.lockGateLogo}
              resizeMode="contain"
            />
            <View style={styles.lockBadge}>
              <View style={styles.lockDot} />
              <Text style={styles.lockBadgeText}>SECURE DEVICE LOCK</Text>
            </View>
            <Text style={styles.lockTitle}>Sentinel Authenticator</Text>
            <Text style={styles.lockSubtitle}>
              Authentication required to access enterprise TOTP passcodes and verification tools.
            </Text>

            {pendingChallenge && (
              <View style={styles.lockChallengeNotice}>
                <Text style={styles.lockChallengeNoticeText}>
                  INCOMING SIGN-IN REQUEST FOR {pendingChallenge.email.toUpperCase()} — UNLOCK VAULT TO RESPOND
                </Text>
              </View>
            )}

            {hasBiometricHardware && biometricEnrolled && (
              <TouchableOpacity style={styles.primaryUnlockButton} onPress={handleUnlockApp}>
                <Text style={styles.primaryUnlockButtonText}>
                  UNLOCK WITH {biometricTypeLabel}
                </Text>
              </TouchableOpacity>
            )}

            {hasBiometricHardware && biometricEnrolled && masterPin && (
              <Text style={styles.orDividerText}>— OR ENTER MASTER PIN —</Text>
            )}

            {masterPin && (
              <View style={styles.pinUnlockGroup}>
                <TextInput
                  style={styles.pinInputField}
                  placeholder="Enter Master Security PIN"
                  placeholderTextColor="#64748b"
                  value={enteredPin}
                  onChangeText={(t) => {
                    setEnteredPin(t.replace(/\D/g, "").slice(0, 8));
                    setPinErrorMessage(null);
                  }}
                  keyboardType="number-pad"
                  secureTextEntry={true}
                  maxLength={8}
                  onSubmitEditing={handleUnlockWithPin}
                />

                {pinErrorMessage && (
                  <View style={styles.pinErrorBanner}>
                    <Text style={styles.pinErrorBannerText}>{pinErrorMessage}</Text>
                  </View>
                )}

                <TouchableOpacity style={styles.primaryUnlockButton} onPress={handleUnlockWithPin}>
                  <Text style={styles.primaryUnlockButtonText}>UNLOCK WITH PIN</Text>
                </TouchableOpacity>
              </View>
            )}

            <TouchableOpacity
              style={styles.portalHelperButton}
              onPress={() => openPortalUrl(PORTAL_URL)}
            >
              <Text style={styles.portalHelperButtonText}>OPEN SENTINEL WEB PORTAL</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={styles.outerRoot}>
      <SafeAreaView style={styles.container}>
      {/* Top Header Bar */}
      <View style={styles.headerContainer}>
        <View style={styles.headerRow}>
          <Image
            source={require("../../assets/images/icon.png")}
            style={styles.logoImage}
            resizeMode="contain"
          />
          <View style={styles.headerTextGroup}>
            <View style={styles.brandBadgeRow}>
              <View style={styles.statusDot} />
              <Text style={styles.brandBadge}>SENTINEL SECURITY</Text>
            </View>
            <Text style={styles.headerTitle}>Authenticator</Text>
          </View>

          <TouchableOpacity
            style={[styles.quickLockIconBtn, { marginRight: 6 }]}
            onPress={() => setShowAccountSwitcherModal(true)}
          >
            <Text style={styles.quickLockIconText}>
              {activeSessionUser ? activeSessionUser.email.split("@")[0].toUpperCase().slice(0, 10) : "SIGN IN"}
            </Text>
          </TouchableOpacity>

          {requireBiometrics && hasBiometricHardware && (
            <TouchableOpacity style={styles.quickLockIconBtn} onPress={handleLockApp}>
              <Text style={styles.quickLockIconText}>LOCK</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Platform Adaptive Canvas: Direct Tab switching on Web, Swipable Pager on Native Mobile */}
      {Platform.OS === "web" ? (
        <View style={styles.webTabContainer}>
          {activeTab === "CODES" && renderPasscodesTab()}
          {activeTab === "PAIR" && renderPairKeyTab()}
          {activeTab === "SECURITY" && renderSystemTab()}
        </View>
      ) : (
        <ScrollView
          ref={pagerRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={handleScrollEnd}
          style={styles.pagerContainer}
        >
          <View style={[styles.pageItem, { width: pageWidth }]}>
            {renderPasscodesTab()}
          </View>
          <View style={[styles.pageItem, { width: pageWidth }]}>
            {renderPairKeyTab()}
          </View>
          <View style={[styles.pageItem, { width: pageWidth }]}>
            {renderSystemTab()}
          </View>
        </ScrollView>
      )}

      {/* Industry Standard Bottom Floating Dock */}
      <View style={styles.bottomDockContainer}>
        <View style={styles.bottomDock}>
          <TouchableOpacity
            style={[styles.dockTab, activeTab === "CODES" && styles.dockTabActive]}
            onPress={() => handleSelectTab("CODES")}
          >
            <Text style={[styles.dockTabText, activeTab === "CODES" && styles.dockTabTextActive]}>
              PASSCODES
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.dockTab, activeTab === "PAIR" && styles.dockTabActive]}
            onPress={() => handleSelectTab("PAIR")}
          >
            <Text style={[styles.dockTabText, activeTab === "PAIR" && styles.dockTabTextActive]}>
              + PAIR KEY
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.dockTab, activeTab === "SECURITY" && styles.dockTabActive]}
            onPress={() => handleSelectTab("SECURITY")}
          >
            <Text style={[styles.dockTabText, activeTab === "SECURITY" && styles.dockTabTextActive]}>
              SYSTEM
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Full-Screen QR Code Scanner Modal (Mounted only when active) */}
      {showScanner && (
        <Modal
          visible={true}
          animationType="slide"
          onRequestClose={() => setShowScanner(false)}
        >
          <SafeAreaView style={styles.scannerContainer}>
            <View style={styles.scannerNavbar}>
              <View>
                <Text style={styles.scannerNavTitle}>Scan Enrollment QR Code</Text>
                <Text style={styles.scannerNavSubtitle}>Point camera at the Sentinel QR code</Text>
              </View>
              <TouchableOpacity
                onPress={() => setShowScanner(false)}
                style={styles.scannerCloseButton}
              >
                <Text style={styles.scannerCloseButtonText}>CLOSE</Text>
              </TouchableOpacity>
            </View>

            {permission?.granted ? (
              <View style={styles.cameraWrapper}>
                <CameraView
                  style={styles.cameraView}
                  barcodeScannerSettings={{
                    barcodeTypes: ["qr"],
                  }}
                  onBarcodeScanned={handleBarcodeScanned}
                />
                <View style={styles.viewfinderOverlay}>
                  <View style={styles.viewfinderBox}>
                    <View style={[styles.cornerBracket, styles.topLeftBracket]} />
                    <View style={[styles.cornerBracket, styles.topRightBracket]} />
                    <View style={[styles.cornerBracket, styles.bottomLeftBracket]} />
                    <View style={[styles.cornerBracket, styles.bottomRightBracket]} />
                  </View>
                  <Text style={styles.viewfinderHint}>Align QR code within the frame</Text>
                </View>
              </View>
            ) : (
              <View style={styles.cameraFallback}>
                <Text style={styles.cameraFallbackText}>Initializing camera...</Text>
              </View>
            )}
          </SafeAreaView>
        </Modal>
      )}

      {/* In-App Push Authorization Modal (Gate-aware: waits for vault unlock; Back minimizes instead of denying) */}
      {isVaultUnlocked && pendingChallenge !== null && !isChallengeMinimized && (
        <Modal
          visible={true}
          animationType="fade"
          transparent={true}
          onRequestClose={() => setIsChallengeMinimized(true)}
        >
          <View style={styles.pushModalOverlay}>
            <View style={styles.pushModalCard}>
              <View style={styles.pushHeaderRow}>
                <View style={styles.pushStatusDot} />
                <Text style={styles.pushModalTitle}>INCOMING SIGN-IN REQUEST</Text>
              </View>

              <View style={styles.pushDetailsBox}>
                <View style={styles.pushIdentityStatusRow}>
                  <Text style={styles.pushOriginLabel}>APPLICATION</Text>
                  {accounts.some(
                    (a) =>
                      a.name &&
                      pendingChallenge.email &&
                      a.name.trim().toLowerCase() === pendingChallenge.email.trim().toLowerCase()
                  ) ? (
                    <View style={styles.verifiedIdentityBadge}>
                      <View style={styles.verifiedIdentityDot} />
                      <Text style={styles.verifiedIdentityText}>ENROLLED VAULT IDENTITY</Text>
                    </View>
                  ) : (
                    <View style={styles.crossAccountWarningBadge}>
                      <View style={styles.crossAccountWarningDot} />
                      <Text style={styles.crossAccountWarningText}>UNENROLLED ACCOUNT</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.pushOriginValue}>{pendingChallenge.clientOrigin}</Text>

                <Text style={styles.pushEmailLabel}>ACCOUNT IDENTITY</Text>
                <Text style={styles.pushEmailValue}>{pendingChallenge.email}</Text>

                {!accounts.some(
                  (a) =>
                    a.name &&
                    pendingChallenge.email &&
                    a.name.trim().toLowerCase() === pendingChallenge.email.trim().toLowerCase()
                ) && (
                  <Text style={styles.crossAccountNotice}>
                    Notice: This request is for an account not stored in this device vault. Confirm identity before approving.
                  </Text>
                )}
              </View>

              <Text style={styles.pushPromptText}>
                Approve this sign-in request? (Biometrics required to confirm YES)
              </Text>

              <View style={styles.numberOptionsRow}>
                <TouchableOpacity
                  disabled={respondingChallenge}
                  style={[styles.numberOptionButton, { flex: 1, backgroundColor: "rgba(16, 185, 129, 0.16)", borderColor: "#10b981" }]}
                  onPress={() => handleRespondChallenge("APPROVE", "YES")}
                >
                  <Text style={[styles.numberOptionText, { fontSize: 15, color: "#34d399" }]}>
                    {respondingChallenge ? "..." : "YES, APPROVE"}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  disabled={respondingChallenge}
                  style={[styles.numberOptionButton, { flex: 1, backgroundColor: "rgba(244, 63, 94, 0.16)", borderColor: "#f43f5e" }]}
                  onPress={() => handleRespondChallenge("DENY")}
                >
                  <Text style={[styles.numberOptionText, { fontSize: 15, color: "#fb7185" }]}>
                    {respondingChallenge ? "..." : "NO, DENY"}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}

      {/* Account Deletion Confirmation Modal */}
      {accountToDelete !== null && (
        <Modal
          visible={true}
          animationType="fade"
          transparent={true}
          onRequestClose={() => setAccountToDelete(null)}
        >
          <View style={styles.deleteModalOverlay}>
            <View style={styles.deleteModalCard}>
              <View style={styles.deleteHeaderRow}>
                <View style={styles.deleteWarningDot} />
                <Text style={styles.deleteModalTitle}>REMOVE 2FA PASSCODE</Text>
              </View>

              <View style={styles.deleteDetailsBox}>
                <Text style={styles.deleteIdentityLabel}>ACCOUNT IDENTITY</Text>
                <Text style={styles.deleteIdentityValue}>{accountToDelete.name}</Text>
                {accountToDelete.issuer ? (
                  <>
                    <Text style={styles.deleteIssuerLabel}>ISSUER / SYSTEM</Text>
                    <Text style={styles.deleteIssuerValue}>{accountToDelete.issuer}</Text>
                  </>
                ) : null}
                {accountToDelete.secret ? (
                  <Text style={styles.deleteKeyHintText}>
                    KEY: {accountToDelete.secret.slice(0, 4)}••••••••{accountToDelete.secret.slice(-4)}
                  </Text>
                ) : null}
              </View>

              <Text style={styles.deleteWarningNotice}>
                Are you sure you want to unbind this device from {accountToDelete.name}? This removes the TOTP secret from this phone and revokes this device's push binding on Sentinel. Your account MFA remains active via other paired devices, TOTP, or emergency recovery codes.
              </Text>

              <View style={styles.deleteModalActionsRow}>
                <TouchableOpacity
                  style={styles.deleteModalCancelBtn}
                  onPress={() => setAccountToDelete(null)}
                  activeOpacity={0.8}
                >
                  <Text style={styles.deleteModalCancelText}>CANCEL</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.deleteModalConfirmBtn}
                  onPress={() => executeDeleteAccount(accountToDelete)}
                  activeOpacity={0.8}
                >
                  <Text style={styles.deleteModalConfirmText}>UNBIND DEVICE</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}

      {/* Server-Synced Per-Account Security Activity Modal */}
      {activityAccount !== null && (
        <Modal
          visible={true}
          animationType="slide"
          transparent={true}
          onRequestClose={() => setActivityAccount(null)}
        >
          <View style={styles.deleteModalOverlay}>
            <View style={styles.activityModalCard}>
              <View style={styles.auditHeaderRow}>
                <Text style={styles.securitySectionTitle}>ACCOUNT SECURITY ACTIVITY</Text>
                <TouchableOpacity onPress={() => setActivityAccount(null)}>
                  <Text style={styles.scannerCloseButtonText}>CLOSE</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.activityAccountLabel}>{activityAccount.name}</Text>

              {loadingActivity ? (
                <Text style={styles.emptyAuditText}>Syncing server audit trail...</Text>
              ) : activityError ? (
                <View style={styles.validationErrorBox}>
                  <Text style={styles.validationErrorText}>{activityError}</Text>
                </View>
              ) : serverActivityLogs.length === 0 ? (
                <Text style={styles.emptyAuditText}>No server activity recorded for this account.</Text>
              ) : (
                <ScrollView style={styles.activityScrollList} showsVerticalScrollIndicator={false}>
                  {serverActivityLogs.map((item) => (
                    <View key={item.id} style={styles.auditItem}>
                      <View style={styles.auditTopRow}>
                        <View style={styles.auditTypeBadge}>
                          <Text style={styles.auditTypeBadgeText}>
                            {item.actionType.replace(/_/g, " ")}
                          </Text>
                        </View>
                        <Text style={styles.auditTimeText}>{item.createdAt}</Text>
                      </View>
                      <Text style={styles.auditItemDetails}>{item.details}</Text>
                      {item.targetResource ? (
                        <Text style={styles.auditItemOrigin}>TARGET: {item.targetResource}</Text>
                      ) : null}
                      {item.ipAddress ? (
                        <Text style={styles.auditItemAccount}>IP: {item.ipAddress}</Text>
                      ) : null}
                    </View>
                  ))}
                </ScrollView>
              )}
            </View>
          </View>
        </Modal>
      )}

      {/* Account Switcher & Easy Add Account Modal */}
      {showAccountSwitcherModal && (
        <Modal
          visible={true}
          animationType="fade"
          transparent={true}
          onRequestClose={() => setShowAccountSwitcherModal(false)}
        >
          <View style={styles.pushModalOverlay}>
            <View style={styles.pushModalCard}>
              <View style={styles.pushHeaderRow}>
                <View style={styles.pushStatusDot} />
                <Text style={styles.pushModalTitle}>ACCOUNT SWITCHER</Text>
              </View>
              <Text style={styles.pushPromptText}>
                Switch active Sentinel account or sign in another account on this device.
              </Text>

              <ScrollView style={{ maxHeight: 240, marginBottom: 14 }}>
                {signedInAccounts.map((acc) => {
                  const isActive = activeSessionUser?.email.toLowerCase() === acc.email.toLowerCase();
                  return (
                    <TouchableOpacity
                      key={acc.email}
                      onPress={() => handleSwitchAccount(acc.email)}
                      style={{
                        padding: 12,
                        borderRadius: 10,
                        borderWidth: 1,
                        borderColor: isActive ? "#54f4fc" : "rgba(255,255,255,0.12)",
                        backgroundColor: isActive ? "rgba(84,244,252,0.1)" : "#0b1322",
                        marginBottom: 8,
                        flexDirection: "row",
                        alignItems: "center",
                        justifyContent: "space-between",
                      }}
                    >
                      <View style={{ flex: 1, paddingRight: 8 }}>
                        <Text style={{ color: "#ffffff", fontWeight: "700", fontSize: 13 }}>
                          {acc.fullName || acc.email}
                        </Text>
                        <Text style={{ color: "#94a3b8", fontSize: 11 }}>{acc.email}</Text>
                      </View>
                      <Text style={{ color: isActive ? "#54f4fc" : "#64748b", fontSize: 10, fontWeight: "800" }}>
                        {isActive ? "ACTIVE" : "SWITCH"}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              <TouchableOpacity
                style={[styles.primaryUnlockButton, { marginBottom: 8 }]}
                onPress={() => {
                  setShowAccountSwitcherModal(false);
                  setLoginError(null);
                  setShowAccountLoginModal(true);
                }}
              >
                <Text style={styles.primaryUnlockButtonText}>+ ADD ACCOUNT</Text>
              </TouchableOpacity>

              {activeSessionUser && (
                <TouchableOpacity
                  style={[styles.denyButton, { marginBottom: 8 }]}
                  onPress={handleSignOutActive}
                >
                  <Text style={styles.denyButtonText}>SIGN OUT ({activeSessionUser.email})</Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity
                style={styles.portalHelperButton}
                onPress={() => setShowAccountSwitcherModal(false)}
              >
                <Text style={styles.portalHelperButtonText}>CLOSE</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}

      {/* Per-Account Mobile Sign-In Gate / Easy Add Account Modal */}
      {isStartupComplete && (!activeSessionUser || showAccountLoginModal) && (
        <Modal
          visible={true}
          animationType="fade"
          transparent={true}
          onRequestClose={() => {
            if (activeSessionUser) setShowAccountLoginModal(false);
          }}
        >
          <View style={styles.pushModalOverlay}>
            <View style={styles.pushModalCard}>
              <View style={styles.pushHeaderRow}>
                <View style={styles.pushStatusDot} />
                <Text style={styles.pushModalTitle}>
                  {activeSessionUser ? "ADD SENTINEL ACCOUNT" : "SIGN IN TO SENTINEL"}
                </Text>
              </View>
              <Text style={styles.pushPromptText}>
                Sign in with your Sentinel Web account. New users must register on the Web Portal first.
              </Text>

              {loginError && (
                <View style={styles.pinErrorBanner}>
                  <Text style={styles.pinErrorBannerText}>{loginError}</Text>
                </View>
              )}

              <TextInput
                style={[styles.pinInputField, { marginBottom: 10, textAlign: "left" }]}
                placeholder="Email address"
                placeholderTextColor="#64748b"
                autoCapitalize="none"
                keyboardType="email-address"
                value={loginEmail}
                onChangeText={setLoginEmail}
              />

              <TextInput
                style={[styles.pinInputField, { marginBottom: 14, textAlign: "left" }]}
                placeholder="Password"
                placeholderTextColor="#64748b"
                secureTextEntry={true}
                value={loginPassword}
                onChangeText={setLoginPassword}
                onSubmitEditing={handleMobileSignIn}
              />

              <TouchableOpacity
                disabled={loginLoading}
                style={[styles.primaryUnlockButton, { marginBottom: 8 }]}
                onPress={handleMobileSignIn}
              >
                <Text style={styles.primaryUnlockButtonText}>
                  {loginLoading ? "SIGNING IN..." : "SIGN IN"}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.portalHelperButton, { marginBottom: 8 }]}
                onPress={() => Linking.openURL(`${WEB_PORTAL_URL}/register`)}
              >
                <Text style={styles.portalHelperButtonText}>REGISTER ON WEB PORTAL</Text>
              </TouchableOpacity>

              {activeSessionUser && (
                <TouchableOpacity
                  style={styles.portalHelperButton}
                  onPress={() => setShowAccountLoginModal(false)}
                >
                  <Text style={styles.portalHelperButtonText}>CANCEL</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </Modal>
      )}
    </SafeAreaView>
  </View>
  );
}

const styles = StyleSheet.create({
  outerRoot: {
    flex: 1,
    backgroundColor: "#03060c",
    alignItems: "center",
    width: "100%",
  },
  bottomDockContainer: {
    position: "absolute",
    bottom: 16,
    left: 16,
    right: 16,
    alignItems: "center",
  },
  bottomDock: {
    flexDirection: "row",
    backgroundColor: "rgba(7, 12, 22, 0.95)",
    borderWidth: 1,
    borderColor: "rgba(84, 244, 252, 0.3)",
    borderRadius: 30,
    padding: 4,
    width: "100%",
    maxWidth: 420,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.45,
    shadowRadius: 10,
    elevation: 8,
  },
  dockTab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 24,
  },
  dockTabActive: {
    backgroundColor: "#54f4fc",
  },
  dockTabText: {
    fontSize: 10.5,
    fontWeight: "700",
    color: "#94a3b8",
    letterSpacing: 0.6,
  },
  dockTabTextActive: {
    color: "#050811",
    fontWeight: "800",
  },
  listContentWithDock: {
    paddingBottom: 90,
  },
  scrollPaddingWithDock: {
    paddingBottom: 90,
  },
  accountCardCopied: {
    borderColor: "#54f4fc",
    backgroundColor: "rgba(84, 244, 252, 0.08)",
  },
  copyPill: {
    backgroundColor: "rgba(15, 23, 42, 0.8)",
    borderWidth: 1,
    borderColor: "rgba(84, 244, 252, 0.25)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  copyPillActive: {
    backgroundColor: "#54f4fc",
    borderColor: "#54f4fc",
  },
  copyPillText: {
    fontSize: 9,
    fontWeight: "700",
    color: "#54f4fc",
    letterSpacing: 0.6,
  },
  copyPillTextActive: {
    color: "#050811",
    fontWeight: "800",
  },
  cardProgressRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 8,
    marginBottom: 6,
  },
  cardProgressTrack: {
    flex: 1,
    height: 3,
    backgroundColor: "rgba(255, 255, 255, 0.1)",
    borderRadius: 1.5,
    overflow: "hidden",
  },
  cardProgressBar: {
    height: "100%",
    backgroundColor: "#54f4fc",
    borderRadius: 1.5,
  },
  cardSecondsText: {
    fontSize: 9.5,
    fontFamily: "monospace",
    fontWeight: "700",
    color: "#94a3b8",
    width: 24,
    textAlign: "right",
  },
  cardUtilityRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 4,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: "rgba(255, 255, 255, 0.05)",
  },
  cardDeleteBtn: {
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  cardDeleteBtnText: {
    fontSize: 9,
    fontWeight: "700",
    color: "#f43f5e",
    letterSpacing: 0.5,
  },
  lockGateContainer: {
    flex: 1,
    width: "100%",
    maxWidth: 480,
    backgroundColor: "#050811",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
  },
  lockGateCenter: {
    alignItems: "center",
    maxWidth: 380,
    width: "100%",
  },
  lockGateLogo: {
    width: 68,
    height: 68,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: "rgba(84, 244, 252, 0.4)",
    marginBottom: 16,
  },
  lockBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(15, 23, 42, 0.8)",
    borderWidth: 1,
    borderColor: "rgba(84, 244, 252, 0.25)",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 4,
    marginBottom: 12,
  },
  lockDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#54f4fc",
  },
  lockBadgeText: {
    fontSize: 9.5,
    fontWeight: "800",
    color: "#54f4fc",
    letterSpacing: 1.2,
  },
  lockTitle: {
    fontSize: 22,
    fontWeight: "800",
    color: "#ffffff",
    letterSpacing: -0.4,
    marginBottom: 8,
    textAlign: "center",
  },
  lockSubtitle: {
    fontSize: 12.5,
    color: "#94a3b8",
    textAlign: "center",
    lineHeight: 18,
    marginBottom: 24,
  },
  primaryUnlockButton: {
    backgroundColor: "#54f4fc",
    width: "100%",
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  primaryUnlockButtonText: {
    color: "#050811",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1,
  },
  portalHelperButton: {
    borderWidth: 1,
    borderColor: "rgba(84, 244, 252, 0.3)",
    width: "100%",
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  portalHelperButtonText: {
    color: "#cbd5e1",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.8,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  brandBadgeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 2,
  },
  quickLockIconBtn: {
    backgroundColor: "rgba(15, 23, 42, 0.8)",
    borderWidth: 1,
    borderColor: "rgba(244, 63, 94, 0.4)",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  quickLockIconText: {
    fontSize: 10,
    fontWeight: "800",
    color: "#fb7185",
    letterSpacing: 0.8,
  },
  webTabContainer: {
    flex: 1,
    width: "100%",
  },
  pagerContainer: {
    flex: 1,
  },
  pageItem: {
    flex: 1,
  },
  pageContentFlex: {
    flex: 1,
    width: "100%",
  },
  onboardingContainer: {
    paddingVertical: 16,
    alignItems: "center",
    width: "100%",
  },
  welcomeCard: {
    backgroundColor: "rgba(15, 23, 42, 0.85)",
    borderWidth: 1,
    borderColor: "rgba(84, 244, 252, 0.25)",
    borderRadius: 10,
    padding: 20,
    alignItems: "center",
    width: "100%",
    marginBottom: 16,
  },
  welcomeIconShield: {
    width: 32,
    height: 4,
    backgroundColor: "#54f4fc",
    borderRadius: 2,
    marginBottom: 14,
  },
  welcomeTitle: {
    fontSize: 14,
    fontWeight: "800",
    letterSpacing: 1.5,
    color: "#ffffff",
    marginBottom: 8,
    textAlign: "center",
  },
  welcomeDescription: {
    fontSize: 12,
    color: "#94a3b8",
    textAlign: "center",
    lineHeight: 18,
    marginBottom: 20,
  },
  welcomeActionsGroup: {
    width: "100%",
    gap: 10,
  },
  welcomePrimaryBtn: {
    backgroundColor: "#54f4fc",
    paddingVertical: 12,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  welcomePrimaryBtnText: {
    color: "#050811",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.8,
  },
  welcomePortalBtn: {
    borderWidth: 1,
    borderColor: "rgba(84, 244, 252, 0.3)",
    paddingVertical: 11,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  welcomePortalBtnText: {
    color: "#cbd5e1",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.6,
  },
  instructionCard: {
    backgroundColor: "rgba(7, 12, 22, 0.7)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
    borderRadius: 8,
    padding: 16,
    width: "100%",
  },
  instructionHeading: {
    fontSize: 10.5,
    fontWeight: "800",
    color: "#54f4fc",
    letterSpacing: 1,
    marginBottom: 10,
  },
  instructionStep: {
    fontSize: 11.5,
    color: "#94a3b8",
    lineHeight: 18,
    marginBottom: 6,
  },
  resourceButton: {
    backgroundColor: "rgba(5, 8, 17, 0.8)",
    borderWidth: 1,
    borderColor: "rgba(84, 244, 252, 0.25)",
    paddingVertical: 12,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 6,
  },
  resourceButtonText: {
    color: "#54f4fc",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.8,
  },
  navBar: {
    flexDirection: "row",
    backgroundColor: "rgba(15, 23, 42, 0.95)",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(84, 244, 252, 0.2)",
    padding: 3,
    marginTop: 10,
    gap: 4,
  },
  navTab: {
    flex: 1,
    paddingVertical: 8,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 6,
  },
  navTabActive: {
    backgroundColor: "#54f4fc",
  },
  navTabText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#94a3b8",
    letterSpacing: 0.6,
  },
  navTabTextActive: {
    color: "#050811",
    fontWeight: "800",
  },
  tabContentFlex: {
    flex: 1,
  },
  tabContentScroll: {
    flex: 1,
  },
  scrollPadding: {
    paddingBottom: 32,
  },
  accountsFlatList: {
    flex: 1,
  },
  emptyActionButton: {
    backgroundColor: "#54f4fc",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 6,
    marginTop: 14,
  },
  emptyActionButtonText: {
    color: "#000000",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.8,
  },
  securitySectionCard: {
    backgroundColor: "rgba(15, 23, 42, 0.85)",
    borderWidth: 1,
    borderColor: "rgba(84, 244, 252, 0.25)",
    borderRadius: 8,
    padding: 14,
    marginBottom: 14,
  },
  securitySectionTitle: {
    fontSize: 11,
    fontWeight: "800",
    color: "#54f4fc",
    letterSpacing: 1,
    marginBottom: 6,
  },
  securitySectionSubtitle: {
    fontSize: 10.5,
    color: "#94a3b8",
    marginBottom: 12,
    lineHeight: 15,
  },
  securityDetailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255, 255, 255, 0.05)",
  },
  securityDetailLabel: {
    fontSize: 11,
    color: "#cbd5e1",
    fontWeight: "500",
  },
  securityDetailValue: {
    fontSize: 10,
    fontWeight: "800",
    fontFamily: "monospace",
    letterSpacing: 0.5,
  },
  biometricSwitchButton: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "rgba(5, 8, 17, 0.8)",
    borderWidth: 1,
    borderColor: "rgba(84, 244, 252, 0.2)",
    borderRadius: 6,
    padding: 12,
    marginTop: 6,
  },
  switchInfo: {
    flex: 1,
    marginRight: 12,
  },
  switchTitle: {
    fontSize: 11.5,
    fontWeight: "700",
    color: "#ffffff",
    marginBottom: 2,
  },
  switchDesc: {
    fontSize: 9.5,
    color: "#94a3b8",
    lineHeight: 14,
  },
  switchPill: {
    backgroundColor: "rgba(100, 116, 139, 0.3)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "#64748b",
  },
  switchPillActive: {
    backgroundColor: "rgba(16, 185, 129, 0.2)",
    borderColor: "#10b981",
  },
  switchPillText: {
    fontSize: 9,
    fontWeight: "800",
    color: "#94a3b8",
    letterSpacing: 0.8,
  },
  switchPillTextActive: {
    color: "#10b981",
  },
  container: {
    flex: 1,
    width: "100%",
    maxWidth: 480,
    paddingHorizontal: 16,
    paddingTop: 12,
    backgroundColor: "#050811",
    position: "relative",
    overflow: "hidden",
  },
  headerContainer: {
    marginBottom: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(84, 244, 252, 0.15)",
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  logoImage: {
    width: 46,
    height: 46,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(84, 244, 252, 0.35)",
    marginTop: 2,
  },
  headerTextGroup: {
    flex: 1,
  },
  badgeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 2,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#54f4fc",
  },
  brandBadge: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.5,
    color: "#54f4fc",
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: "#ffffff",
    letterSpacing: -0.3,
  },
  headerSubtitle: {
    fontSize: 11,
    color: "#94a3b8",
    fontWeight: "500",
    marginTop: 1,
  },
  systemStatusRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 8,
  },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(15, 23, 42, 0.8)",
    borderWidth: 1,
    borderColor: "rgba(84, 244, 252, 0.2)",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    gap: 4,
  },
  statusDotSmall: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
  dotCyan: {
    backgroundColor: "#54f4fc",
  },
  dotGreen: {
    backgroundColor: "#10b981",
  },
  dotSlate: {
    backgroundColor: "#64748b",
  },
  statusPillText: {
    fontSize: 8.5,
    fontWeight: "700",
    color: "#cbd5e1",
    letterSpacing: 0.6,
    fontFamily: "monospace",
  },
  vaultLockedCard: {
    backgroundColor: "rgba(15, 23, 42, 0.85)",
    borderWidth: 1,
    borderColor: "rgba(245, 158, 11, 0.4)",
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
  },
  vaultUnlockedCard: {
    backgroundColor: "rgba(15, 23, 42, 0.85)",
    borderWidth: 1,
    borderColor: "rgba(16, 185, 129, 0.35)",
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
  },
  vaultCardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  vaultCardInfo: {
    flex: 1,
    marginRight: 8,
  },
  vaultLockedTitle: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1,
    color: "#f59e0b",
  },
  vaultUnlockedTitle: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1,
    color: "#10b981",
  },
  vaultCardSubtitle: {
    fontSize: 9.5,
    color: "#94a3b8",
    marginTop: 2,
  },
  vaultUnlockButton: {
    backgroundColor: "#54f4fc",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 4,
  },
  vaultUnlockButtonText: {
    color: "#000000",
    fontSize: 9.5,
    fontWeight: "800",
    letterSpacing: 0.6,
  },
  vaultLockButton: {
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.4)",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 4,
  },
  vaultLockButtonText: {
    color: "#94a3b8",
    fontSize: 9.5,
    fontWeight: "700",
    letterSpacing: 0.6,
  },
  biometricToggleRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: "rgba(255, 255, 255, 0.08)",
  },
  biometricToggleText: {
    fontSize: 9.5,
    color: "#64748b",
    flexShrink: 1,
    marginRight: 6,
  },
  biometricToggleAction: {
    fontSize: 9.5,
    fontWeight: "700",
    color: "#54f4fc",
    letterSpacing: 0.5,
  },
  timerCard: {
    backgroundColor: "#070c16",
    borderWidth: 1,
    borderColor: "rgba(84, 244, 252, 0.18)",
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
  },
  timerHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6,
  },
  timerLabel: {
    fontSize: 9.5,
    fontWeight: "700",
    letterSpacing: 1,
    color: "#94a3b8",
  },
  timerCountdown: {
    fontSize: 11,
    fontWeight: "700",
    color: "#54f4fc",
    fontFamily: "monospace",
  },
  progressTrack: {
    height: 4,
    backgroundColor: "#0f172a",
    borderRadius: 2,
    overflow: "hidden",
  },
  progressBar: {
    height: "100%",
    backgroundColor: "#54f4fc",
    borderRadius: 2,
  },
  enrollmentCard: {
    backgroundColor: "#070c16",
    borderWidth: 1,
    borderColor: "rgba(84, 244, 252, 0.18)",
    borderRadius: 8,
    padding: 12,
    marginBottom: 14,
  },
  enrollmentHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 10,
  },
  enrollmentTitle: {
    fontSize: 10.5,
    fontWeight: "700",
    letterSpacing: 1.2,
    color: "#54f4fc",
    flexShrink: 1,
  },
  segmentContainer: {
    flexDirection: "row",
    backgroundColor: "#0f172a",
    borderRadius: 6,
    padding: 2,
    borderWidth: 1,
    borderColor: "rgba(84, 244, 252, 0.2)",
  },
  segmentTab: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 4,
  },
  segmentTabActive: {
    backgroundColor: "rgba(84, 244, 252, 0.2)",
  },
  segmentTabText: {
    fontSize: 9,
    fontWeight: "700",
    color: "#64748b",
    letterSpacing: 0.5,
  },
  segmentTabTextActive: {
    color: "#54f4fc",
  },
  modeDescriptionText: {
    fontSize: 10.5,
    color: "#94a3b8",
    lineHeight: 15,
    marginBottom: 10,
  },
  primaryScanButton: {
    backgroundColor: "#54f4fc",
    paddingVertical: 10,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryScanButtonText: {
    color: "#000000",
    fontWeight: "800",
    fontSize: 12,
    letterSpacing: 1,
  },
  inputField: {
    backgroundColor: "#0b1120",
    borderWidth: 1,
    borderColor: "rgba(84, 244, 252, 0.2)",
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 12,
    color: "#ffffff",
    marginBottom: 8,
  },
  inputFieldError: {
    borderColor: "#ef4444",
  },
  validationErrorBox: {
    backgroundColor: "rgba(239, 68, 68, 0.1)",
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.3)",
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 4,
    marginBottom: 8,
  },
  validationErrorText: {
    fontSize: 10,
    color: "#f87171",
  },
  resolvingBox: {
    backgroundColor: "rgba(84, 244, 252, 0.08)",
    borderWidth: 1,
    borderColor: "rgba(84, 244, 252, 0.25)",
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 4,
    marginBottom: 8,
  },
  resolvingText: {
    fontSize: 10,
    color: "#54f4fc",
  },
  resolvedIdentityBox: {
    backgroundColor: "rgba(16, 185, 129, 0.1)",
    borderWidth: 1,
    borderColor: "rgba(16, 185, 129, 0.3)",
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 4,
    marginBottom: 8,
  },
  resolvedIdentityText: {
    fontSize: 10,
    color: "#34d399",
    fontWeight: "600",
  },
  addKeyButton: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: "#54f4fc",
    paddingVertical: 10,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  addKeyButtonText: {
    color: "#54f4fc",
    fontWeight: "800",
    fontSize: 11,
    letterSpacing: 1,
  },
  accountsHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  sectionHeaderTitle: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.1,
    color: "#94a3b8",
  },
  counterBadge: {
    backgroundColor: "rgba(84, 244, 252, 0.15)",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(84, 244, 252, 0.3)",
  },
  counterBadgeText: {
    fontSize: 10.5,
    fontWeight: "700",
    color: "#54f4fc",
    fontFamily: "monospace",
  },
  listContent: {
    paddingBottom: 24,
  },
  accountCard: {
    backgroundColor: "#070c16",
    borderWidth: 1,
    borderColor: "rgba(84, 244, 252, 0.2)",
    borderLeftWidth: 3,
    borderLeftColor: "#54f4fc",
    borderRadius: 8,
    padding: 12,
    marginBottom: 10,
  },
  accountTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6,
  },
  accountIdentityGroup: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginRight: 8,
  },
  accountName: {
    fontSize: 13,
    fontWeight: "700",
    color: "#ffffff",
  },
  issuerBadge: {
    backgroundColor: "rgba(84, 244, 252, 0.1)",
    borderWidth: 1,
    borderColor: "rgba(84, 244, 252, 0.25)",
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 3,
  },
  issuerBadgeText: {
    fontSize: 8,
    fontWeight: "700",
    color: "#54f4fc",
    letterSpacing: 0.6,
  },
  protocolBadge: {
    backgroundColor: "#0f172a",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.1)",
  },
  protocolBadgeText: {
    fontSize: 8.5,
    fontWeight: "700",
    letterSpacing: 0.8,
    color: "#94a3b8",
    fontFamily: "monospace",
  },
  tokenRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginVertical: 4,
  },
  tokenLockedPlaceholder: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.7)",
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "rgba(245, 158, 11, 0.4)",
    borderRadius: 6,
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginRight: 8,
  },
  tokenLockedText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#f59e0b",
    letterSpacing: 1,
  },
  tokenLockedSubtext: {
    fontSize: 9,
    color: "#94a3b8",
    marginTop: 2,
  },
  totpToken: {
    fontSize: 26,
    fontWeight: "800",
    letterSpacing: 3,
    color: "#54f4fc",
    fontFamily: "monospace",
  },
  removeButton: {
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.4)",
    backgroundColor: "rgba(239, 68, 68, 0.05)",
    borderRadius: 6,
  },
  removeButtonText: {
    fontSize: 9.5,
    fontWeight: "700",
    letterSpacing: 0.8,
    color: "#ef4444",
  },
  secretHintText: {
    fontSize: 9.5,
    color: "#64748b",
    fontFamily: "monospace",
    letterSpacing: 0.5,
    marginTop: 4,
  },
  emptyCard: {
    backgroundColor: "#070c16",
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "rgba(84, 244, 252, 0.2)",
    borderRadius: 6,
    padding: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyBracket: {
    width: 28,
    height: 2,
    backgroundColor: "#54f4fc",
    marginBottom: 12,
  },
  emptyTitle: {
    fontSize: 11.5,
    fontWeight: "700",
    letterSpacing: 1.2,
    color: "#e2e8f0",
    marginBottom: 6,
  },
  emptyDescription: {
    fontSize: 11.5,
    color: "#64748b",
    textAlign: "center",
    lineHeight: 17,
  },
  scannerContainer: {
    flex: 1,
    backgroundColor: "#000000",
  },
  scannerNavbar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: "#070c16",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(84, 244, 252, 0.2)",
  },
  scannerNavTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#ffffff",
    letterSpacing: 0.5,
  },
  scannerNavSubtitle: {
    fontSize: 11,
    color: "#94a3b8",
    marginTop: 2,
  },
  scannerCloseButton: {
    borderWidth: 1,
    borderColor: "rgba(84, 244, 252, 0.4)",
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 4,
  },
  scannerCloseButtonText: {
    color: "#54f4fc",
    fontWeight: "700",
    fontSize: 11,
    letterSpacing: 1,
  },
  cameraWrapper: {
    flex: 1,
    position: "relative",
  },
  cameraView: {
    flex: 1,
  },
  viewfinderOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0, 0, 0, 0.35)",
  },
  viewfinderBox: {
    width: 240,
    height: 240,
    position: "relative",
  },
  cornerBracket: {
    position: "absolute",
    width: 24,
    height: 24,
    borderColor: "#54f4fc",
  },
  topLeftBracket: {
    top: 0,
    left: 0,
    borderTopWidth: 3,
    borderLeftWidth: 3,
  },
  topRightBracket: {
    top: 0,
    right: 0,
    borderTopWidth: 3,
    borderRightWidth: 3,
  },
  bottomLeftBracket: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 3,
    borderLeftWidth: 3,
  },
  bottomRightBracket: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 3,
    borderRightWidth: 3,
  },
  viewfinderHint: {
    marginTop: 20,
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "600",
    backgroundColor: "rgba(0, 0, 0, 0.75)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 4,
    letterSpacing: 0.5,
  },
  cameraFallback: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  cameraFallbackText: {
    color: "#94a3b8",
    fontSize: 13,
  },
  pushModalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.85)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  pushModalCard: {
    width: "100%",
    maxWidth: 380,
    backgroundColor: "#070c16",
    borderWidth: 1.5,
    borderColor: "#54f4fc",
    borderRadius: 12,
    padding: 20,
    shadowColor: "#54f4fc",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 10,
  },
  pushHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 16,
  },
  pushStatusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#54f4fc",
  },
  pushModalTitle: {
    fontSize: 12,
    fontWeight: "800",
    color: "#54f4fc",
    letterSpacing: 1.2,
  },
  pushDetailsBox: {
    backgroundColor: "#0b1322",
    borderWidth: 1,
    borderColor: "rgba(84, 244, 252, 0.15)",
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  pushIdentityStatusRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  verifiedIdentityBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(84, 244, 252, 0.1)",
    borderWidth: 1,
    borderColor: "rgba(84, 244, 252, 0.25)",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  verifiedIdentityDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: "#54f4fc",
    marginRight: 4,
  },
  verifiedIdentityText: {
    fontSize: 8,
    fontWeight: "700",
    color: "#54f4fc",
    letterSpacing: 0.6,
  },
  crossAccountWarningBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(245, 158, 11, 0.1)",
    borderWidth: 1,
    borderColor: "rgba(245, 158, 11, 0.3)",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  crossAccountWarningDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: "#f59e0b",
    marginRight: 4,
  },
  crossAccountWarningText: {
    fontSize: 8,
    fontWeight: "700",
    color: "#f59e0b",
    letterSpacing: 0.6,
  },
  crossAccountNotice: {
    marginTop: 8,
    fontSize: 10,
    color: "#fbbf24",
    lineHeight: 14,
    backgroundColor: "rgba(245, 158, 11, 0.08)",
    padding: 6,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "rgba(245, 158, 11, 0.2)",
  },
  pushOriginLabel: {
    fontSize: 9,
    fontWeight: "700",
    color: "#64748b",
    letterSpacing: 1,
    marginBottom: 2,
  },
  pushOriginValue: {
    fontSize: 13,
    fontWeight: "700",
    color: "#ffffff",
    marginBottom: 8,
  },
  pushEmailLabel: {
    fontSize: 9,
    fontWeight: "700",
    color: "#64748b",
    letterSpacing: 1,
    marginBottom: 2,
  },
  pushEmailValue: {
    fontSize: 12,
    fontWeight: "600",
    color: "#94a3b8",
    fontFamily: "monospace",
  },
  pushPromptText: {
    fontSize: 12,
    color: "#cbd5e1",
    textAlign: "center",
    marginBottom: 16,
    lineHeight: 18,
  },
  numberOptionsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 10,
    marginBottom: 16,
  },
  numberOptionButton: {
    flex: 1,
    backgroundColor: "rgba(84, 244, 252, 0.08)",
    borderWidth: 1.5,
    borderColor: "#54f4fc",
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  numberOptionText: {
    fontSize: 22,
    fontWeight: "800",
    color: "#54f4fc",
    fontFamily: "monospace",
  },
  denyButton: {
    borderWidth: 1,
    borderColor: "#ef4444",
    backgroundColor: "rgba(239, 68, 68, 0.08)",
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: "center",
  },
  denyButtonText: {
    color: "#ef4444",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1,
  },
  policyDivider: {
    height: 1,
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    marginVertical: 14,
  },
  pinConfigRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  pinChangeButton: {
    backgroundColor: "rgba(84, 244, 252, 0.12)",
    borderWidth: 1,
    borderColor: "#54f4fc",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
  },
  pinChangeButtonText: {
    color: "#54f4fc",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.6,
  },
  auditHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  auditClearBtn: {
    borderWidth: 1,
    borderColor: "rgba(244, 63, 94, 0.4)",
    backgroundColor: "rgba(244, 63, 94, 0.08)",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 4,
  },
  auditClearBtnText: {
    color: "#fb7185",
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.8,
  },
  auditList: {
    marginTop: 12,
    gap: 10,
  },
  auditItem: {
    backgroundColor: "rgba(7, 12, 22, 0.85)",
    borderWidth: 1,
    borderColor: "rgba(84, 244, 252, 0.15)",
    borderRadius: 6,
    padding: 12,
  },
  auditTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  auditTypeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    backgroundColor: "rgba(148, 163, 184, 0.15)",
  },
  auditTypeBadgeSuccess: {
    backgroundColor: "rgba(16, 185, 129, 0.15)",
    borderWidth: 1,
    borderColor: "rgba(16, 185, 129, 0.4)",
  },
  auditTypeBadgeDanger: {
    backgroundColor: "rgba(239, 68, 68, 0.15)",
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.4)",
  },
  auditTypeBadgeInfo: {
    backgroundColor: "rgba(84, 244, 252, 0.15)",
    borderWidth: 1,
    borderColor: "rgba(84, 244, 252, 0.4)",
  },
  auditTypeBadgeText: {
    fontSize: 9,
    fontWeight: "800",
    color: "#94a3b8",
    letterSpacing: 0.6,
  },
  auditTypeBadgeTextSuccess: {
    color: "#10b981",
  },
  auditTypeBadgeTextDanger: {
    color: "#ef4444",
  },
  auditTypeBadgeTextInfo: {
    color: "#54f4fc",
  },
  auditTimeText: {
    fontSize: 10,
    color: "#64748b",
    fontFamily: "monospace",
  },
  auditItemTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: "#e2e8f0",
    marginBottom: 2,
  },
  auditItemDetails: {
    fontSize: 11,
    color: "#94a3b8",
    lineHeight: 16,
    marginBottom: 4,
  },
  auditItemOrigin: {
    fontSize: 10,
    color: "#54f4fc",
    fontFamily: "monospace",
  },
  auditItemAccount: {
    fontSize: 10,
    color: "#a855f7",
    fontFamily: "monospace",
  },
  emptyAuditBox: {
    paddingVertical: 18,
    alignItems: "center",
  },
  emptyAuditText: {
    color: "#64748b",
    fontSize: 11,
    fontStyle: "italic",
  },
  setupBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(245, 158, 11, 0.15)",
    borderWidth: 1,
    borderColor: "rgba(245, 158, 11, 0.4)",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 16,
    marginBottom: 12,
  },
  setupDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#f59e0b",
    marginRight: 6,
  },
  setupBadgeText: {
    color: "#fbbf24",
    fontSize: 9.5,
    fontWeight: "800",
    letterSpacing: 0.8,
  },
  pinInputField: {
    backgroundColor: "rgba(15, 23, 42, 0.8)",
    borderWidth: 1,
    borderColor: "rgba(84, 244, 252, 0.25)",
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: "#ffffff",
    fontSize: 14,
    width: "100%",
    marginBottom: 10,
    textAlign: "center",
    letterSpacing: 4,
    fontWeight: "700",
  },
  pinErrorBanner: {
    backgroundColor: "rgba(239, 68, 68, 0.15)",
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.4)",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6,
    width: "100%",
    marginBottom: 10,
    alignItems: "center",
  },
  pinErrorBannerText: {
    color: "#ef4444",
    fontSize: 10.5,
    fontWeight: "700",
  },
  orDividerText: {
    color: "#64748b",
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.8,
    marginVertical: 14,
  },
  pinUnlockGroup: {
    width: "100%",
    alignItems: "center",
  },
  deleteModalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.85)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  deleteModalCard: {
    width: "100%",
    maxWidth: 380,
    backgroundColor: "#070c16",
    borderWidth: 1.5,
    borderColor: "rgba(244, 63, 94, 0.6)",
    borderRadius: 12,
    padding: 20,
    shadowColor: "#f43f5e",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 10,
  },
  deleteHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 14,
  },
  deleteWarningDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#f43f5e",
  },
  deleteModalTitle: {
    fontSize: 12,
    fontWeight: "800",
    color: "#f43f5e",
    letterSpacing: 1.2,
  },
  deleteDetailsBox: {
    backgroundColor: "#0b1322",
    borderWidth: 1,
    borderColor: "rgba(244, 63, 94, 0.2)",
    borderRadius: 8,
    padding: 12,
    marginBottom: 14,
  },
  deleteIdentityLabel: {
    fontSize: 9,
    fontWeight: "700",
    color: "#94a3b8",
    letterSpacing: 1,
    marginBottom: 2,
  },
  deleteIdentityValue: {
    fontSize: 13,
    fontWeight: "700",
    color: "#ffffff",
    marginBottom: 8,
  },
  deleteIssuerLabel: {
    fontSize: 9,
    fontWeight: "700",
    color: "#94a3b8",
    letterSpacing: 1,
    marginBottom: 2,
  },
  deleteIssuerValue: {
    fontSize: 11,
    fontWeight: "600",
    color: "#54f4fc",
    marginBottom: 6,
  },
  deleteKeyHintText: {
    fontSize: 9.5,
    fontFamily: "monospace",
    color: "#64748b",
    letterSpacing: 0.5,
  },
  deleteWarningNotice: {
    fontSize: 11,
    color: "#cbd5e1",
    lineHeight: 16,
    marginBottom: 18,
  },
  deleteModalActionsRow: {
    flexDirection: "row",
    gap: 10,
  },
  deleteModalCancelBtn: {
    flex: 1,
    paddingVertical: 11,
    backgroundColor: "rgba(255, 255, 255, 0.05)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.15)",
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  deleteModalCancelText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#94a3b8",
    letterSpacing: 0.8,
  },
  deleteModalConfirmBtn: {
    flex: 1,
    paddingVertical: 11,
    backgroundColor: "#e11d48",
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#e11d48",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
    elevation: 3,
  },
  deleteModalConfirmText: {
    fontSize: 11,
    fontWeight: "800",
    color: "#ffffff",
    letterSpacing: 0.8,
  },
  driftWarningBanner: {
    backgroundColor: "rgba(245, 158, 11, 0.14)",
    borderWidth: 1,
    borderColor: "rgba(245, 158, 11, 0.4)",
    borderRadius: 8,
    padding: 10,
    marginBottom: 10,
  },
  driftWarningText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#fbbf24",
    lineHeight: 14,
  },
  minimizedChallengeBanner: {
    backgroundColor: "rgba(84, 244, 252, 0.14)",
    borderWidth: 1,
    borderColor: "#54f4fc",
    borderRadius: 8,
    padding: 10,
    marginBottom: 10,
  },
  minimizedChallengeText: {
    fontSize: 10,
    fontWeight: "800",
    color: "#54f4fc",
    textAlign: "center",
    letterSpacing: 0.6,
  },
  revokedBadge: {
    backgroundColor: "rgba(244, 63, 94, 0.16)",
    borderWidth: 1,
    borderColor: "rgba(244, 63, 94, 0.45)",
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginTop: 4,
    alignSelf: "flex-start",
  },
  revokedBadgeText: {
    fontSize: 8.5,
    fontWeight: "800",
    color: "#fb7185",
    letterSpacing: 0.5,
  },
  cardActionsGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  cardActivityBtn: {
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  cardActivityBtnText: {
    fontSize: 9,
    fontWeight: "700",
    color: "#54f4fc",
    letterSpacing: 0.5,
  },
  immutableBadgeText: {
    fontSize: 8.5,
    fontWeight: "800",
    color: "#10b981",
    letterSpacing: 0.8,
  },
  lockChallengeNotice: {
    backgroundColor: "rgba(84, 244, 252, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(84, 244, 252, 0.4)",
    borderRadius: 8,
    padding: 10,
    marginBottom: 14,
    width: "100%",
  },
  lockChallengeNoticeText: {
    fontSize: 10,
    fontWeight: "800",
    color: "#54f4fc",
    textAlign: "center",
    letterSpacing: 0.5,
  },
  activityModalCard: {
    width: "100%",
    maxWidth: 420,
    maxHeight: "80%",
    backgroundColor: "#070c16",
    borderWidth: 1,
    borderColor: "rgba(84, 244, 252, 0.35)",
    borderRadius: 12,
    padding: 18,
  },
  activityAccountLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: "#54f4fc",
    marginBottom: 12,
  },
  activityScrollList: {
    maxHeight: 380,
  },
});
