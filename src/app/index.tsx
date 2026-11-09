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
  useWindowDimensions,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
} from "react-native";
import * as WebBrowser from "expo-web-browser";
import * as Clipboard from "expo-clipboard";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { SafeAreaView } from "react-native-safe-area-context";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Notifications from "expo-notifications";
import * as LocalAuthentication from "expo-local-authentication";
import * as SplashScreen from "expo-splash-screen";
import { generateTotp, getSecondsRemaining } from "@/utils/totp";
import { recordMobileTelemetry } from "../../services/api";
import {
  TotpAccount,
  isHardwareVaultAvailable,
  loadAccountsFromVault,
  saveAccountsToVault,
  loadVaultSettings,
  saveVaultSettings,
} from "@/utils/vault";


function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  const safePromise = promise.catch(() => null as unknown as T);
  return Promise.race([
    safePromise,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
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

  // TOTP Clock and Scanner
  const [remainingSeconds, setRemainingSeconds] = useState(getSecondsRemaining());
  const [showScanner, setShowScanner] = useState(false);
  const [permission, requestPermission, getCameraPermission] = useCameraPermissions();

  // Out-of-band Push Challenge
  const [pendingChallenge, setPendingChallenge] = useState<PendingChallenge | null>(null);
  const [respondingChallenge, setRespondingChallenge] = useState(false);
  const [pushToken, setPushToken] = useState<string | null>(null);

  // Native dialog and scanner concurrency guards
  const authInFlightRef = useRef(false);
  const scanLockRef = useRef(false);
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

        const settings = (await withTimeout(loadVaultSettings(), 2000)) ?? {
          requireBiometrics: true,
        };
        enforceBio = settings.requireBiometrics;
        if (isMounted) {
          setRequireBiometrics(enforceBio);
          if (!enforceBio || !hasHw || !isEnr) {
            setIsVaultUnlocked(true);
          } else {
            setIsVaultUnlocked(false);
          }
        }

        const storedAccounts = (await withTimeout(loadAccountsFromVault(), 2000)) ?? [];
        if (isMounted) {
          setAccounts(storedAccounts);
        }
      } catch (err) {
        console.warn("Security vault initialization warning:", err);
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
        if (!granted && Platform.OS !== "android") {
          const reqRes = await withTimeout(Notifications.requestPermissionsAsync(), 2000);
          granted = reqRes?.status === "granted";
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

  // Sync device push token to backend for enrolled accounts with proof of possession
  useEffect(() => {
    if (!pushToken || !isStartupComplete) return;

    accounts.forEach((acc) => {
      if (acc.name && acc.name.includes("@") && acc.secret) {
        try {
          const totpCode = generateTotp(acc.secret);
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 4000);
          fetch(`${API_BASE_URL}/api/mfa/register-device`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              email: acc.name.trim().toLowerCase(),
              pushToken,
              totpCode,
            }),
            signal: controller.signal,
          })
            .then(() => clearTimeout(timer))
            .catch(() => clearTimeout(timer));
        } catch {
          // Ignore transient TOTP calculation notice during mount
        }
      }
    });
  }, [pushToken, accounts, isStartupComplete]);

  // Handle tap on system push notification banner
  useEffect(() => {
    let responseSubscription: Notifications.Subscription | null = null;
    try {
      responseSubscription = Notifications.addNotificationResponseReceivedListener((response) => {
        const data = response?.notification?.request?.content?.data;
        if (data?.challengeId) {
          const chId = Number(data.challengeId);
          const matchCode = String(data.matchCode || "42");
          const matchNum = parseInt(matchCode, 10) || 42;
          const d1 = (((matchNum + 17) % 90) + 10).toString();
          const d2 = (((matchNum + 43) % 90) + 10).toString();
          const opts = [matchCode, d1, d2].sort(() => Math.random() - 0.5);

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
    } catch (err) {
      console.warn("Notification listener registration notice:", err);
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
      }
    });

    return () => {
      clearInterval(timer);
      appStateSub.remove();
    };
  }, []);

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
      accounts.forEach((acc) => {
        if (acc.name && acc.name.includes("@")) {
          emailsToCheck.add(acc.name.trim().toLowerCase());
        }
      });
      if (accountName.trim().includes("@")) {
        emailsToCheck.add(accountName.trim().toLowerCase());
      }

      if (emailsToCheck.size === 0) return;

      for (const email of emailsToCheck) {
        if (!isMounted || AppState.currentState !== "active" || authInFlightRef.current) return;
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 4000);
          const res = await fetch(
            `${API_BASE_URL}/api/mfa/challenge/pending?email=${encodeURIComponent(email)}`,
            { signal: controller.signal }
          );
          clearTimeout(timer);
          if (!res.ok) continue;
          const json = await res.json();
          if (json.success && json.data?.hasPending && json.data.challenge) {
            const ch = json.data.challenge;
            if (!isMounted || authInFlightRef.current) return;

            setPendingChallenge((prev) => {
              if (prev && prev.id === ch.id) return prev;
              const matchNum = parseInt(ch.matchCode, 10) || 42;
              const d1 = (((matchNum + 17) % 90) + 10).toString();
              const d2 = (((matchNum + 43) % 90) + 10).toString();
              const opts = [ch.matchCode, d1, d2].sort(() => Math.random() - 0.5);

              // Schedule native Android system notification banner safely
              try {
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
                  trigger: null,
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
  }, [accounts, accountName, isLoaded, isStartupComplete, showScanner]);



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
    const index = tab === "CODES" ? 0 : tab === "PAIR" ? 1 : 2;
    pagerRef.current?.scrollTo({ x: index * pageWidth, animated: true });
  };

  const handleScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offsetX = e.nativeEvent.contentOffset.x;
    const pageIndex = Math.round(offsetX / pageWidth);
    if (pageIndex === 0 && activeTab !== "CODES") setActiveTab("CODES");
    else if (pageIndex === 1 && activeTab !== "PAIR") setActiveTab("PAIR");
    else if (pageIndex === 2 && activeTab !== "SECURITY") setActiveTab("SECURITY");
  };

  // Re-align horizontal pager when viewport resizes dynamically
  useEffect(() => {
    const index = activeTab === "CODES" ? 0 : activeTab === "PAIR" ? 1 : 2;
    pagerRef.current?.scrollTo({ x: index * pageWidth, animated: false });
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

  // Authenticate with Android system biometrics or device PIN / Pattern
  const handleUnlockApp = async () => {
    if (authInFlightRef.current) return;
    authInFlightRef.current = true;
    try {
      const hasHw = (await withTimeout(LocalAuthentication.hasHardwareAsync(), 2000)) ?? false;
      const isEnr = (await withTimeout(LocalAuthentication.isEnrolledAsync(), 2000)) ?? false;

      if (!hasHw || !isEnr) {
        setIsVaultUnlocked(true);
        return;
      }

      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: "Unlock Sentinel Security Authenticator",
        cancelLabel: "Cancel",
        fallbackLabel: "Use Device Screen Lock",
        disableDeviceFallback: false,
      });

      if (result.success) {
        setIsVaultUnlocked(true);
        recordMobileTelemetry({
          actionType: "APP_LOCK_UNLOCK_SUCCESS",
          details: "User authenticated to open Sentinel Authenticator",
        });
      }
    } catch (err) {
      console.warn("Device authentication notice:", err);
      setIsVaultUnlocked(true);
    } finally {
      authInFlightRef.current = false;
    }
  };

  // Lock app
  const handleLockApp = () => {
    setIsVaultUnlocked(false);
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
        }
      } catch (err) {
        console.warn("Local authentication bypassed or not available:", err);
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
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      const json = await res.json();
      if (json.success) {
        setPendingChallenge(null);
        if (action === "APPROVE") {
          Alert.alert("Authorization Approved", "Sign-in approved successfully.");
        } else {
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

  // Secret key input validator
  const handleSecretKeyChange = (text: string) => {
    const clean = text.toUpperCase().replace(/\s+/g, "");
    setSecretKey(clean);

    if (clean.length > 0) {
      if (!/^[A-Z2-7]+=*$/.test(clean)) {
        setManualValidationError("Base32 keys must only contain letters A-Z and digits 2-7.");
      } else if (clean.length < 8) {
        setManualValidationError("Base32 keys must be at least 8 characters long.");
      } else {
        setManualValidationError(null);
      }
    } else {
      setManualValidationError(null);
    }
  };

  const handleAddAccount = (name?: string, secret?: string, issuer?: string) => {
    const cleanName = (name || accountName).trim();
    const cleanSecret = (secret || secretKey).trim().toUpperCase().replace(/\s+/g, "");
    const cleanIssuer = (issuer || accountIssuer).trim();

    if (!cleanName || !cleanSecret) {
      Alert.alert("Input Error", "Both Account Name and Secret Key are required.");
      return;
    }

    if (!/^[A-Z2-7]+=*$/.test(cleanSecret) || cleanSecret.length < 8) {
      Alert.alert("Invalid Key", "Secret Key must be a valid Base32 string (A-Z, 2-7, min 8 characters).");
      return;
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
      saveAccountsToVault(updated).catch((err) => {
        console.error("Failed to persist enrolled account to vault:", err);
      });
      return updated;
    });
    setAccountName("");
    setAccountIssuer("");
    setSecretKey("");
    setManualValidationError(null);
    setShowScanner(false);

    recordMobileTelemetry({
      actionType: "ENROLL_KEY_MANUAL",
      details: `User enrolled 2FA key for ${cleanName}${cleanIssuer ? ` (${cleanIssuer})` : ""}`,
      userEmail: cleanName,
    });
  };

  const confirmDeleteAccount = (id: string, name: string, issuer?: string) => {
    const displayName = issuer ? `${issuer} (${name})` : name;
    Alert.alert(
      "Remove Account",
      `Are you sure you want to remove ${displayName}? This will delete the 2FA key from the hardware vault.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => {
            setAccounts((prev) => {
              const updated = prev.filter((acc) => acc.id !== id);
              saveAccountsToVault(updated).catch((err) => {
                console.error("Failed to persist account removal to vault:", err);
              });
              return updated;
            });
            recordMobileTelemetry({
              actionType: "REMOVE_KEY",
              details: `User deleted enrolled 2FA key for ${displayName}`,
              userEmail: name,
              severity: "WARN",
            });
          },
        },
      ]
    );
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
    if (data.startsWith("otpauth://")) {
      let secret = "";
      let name = "";
      let issuer = "";

      const secretMatch = data.match(/[?&]secret=([A-Za-z2-7]+)/i);
      if (secretMatch && secretMatch[1]) {
        secret = secretMatch[1].toUpperCase();
      }

      const issuerMatch = data.match(/[?&]issuer=([^&]+)/i);
      if (issuerMatch) {
        issuer = decodeURIComponent(issuerMatch[1]);
      }

      const labelMatch = data.match(/otpauth:\/\/totp\/([^?]+)/i);
      if (labelMatch && labelMatch[1]) {
        const rawLabel = decodeURIComponent(labelMatch[1]);
        if (rawLabel.includes(":")) {
          const parts = rawLabel.split(":");
          if (!issuer) issuer = parts[0];
          name = parts[1] || parts[0];
        } else {
          name = rawLabel;
        }
      }

      if (!name && issuer) {
        name = issuer;
      }

      if (secret) {
        handleAddAccount(name || "Sentinel Account", secret, issuer);
        Alert.alert("Account Paired", `Successfully enrolled 2FA for ${name || "Sentinel Account"}`);
        return;
      }
    }

    // Direct Base32 key fallback
    const cleanSecret = data.trim().toUpperCase().replace(/\s+/g, "");
    if (cleanSecret.length >= 8 && /^[A-Z2-7]+$/.test(cleanSecret)) {
      handleAddAccount("Enrolled Account", cleanSecret, "Sentinel IAM");
      Alert.alert("Account Paired", "Successfully enrolled 2FA secret key from QR code.");
    } else {
      setShowScanner(false);
      Alert.alert("Invalid QR Code", "Scanned code does not contain a valid Base32 2FA secret.");
    }
  };

  const progressPercent = Math.max(0, Math.min(100, (remainingSeconds / 30) * 100));

  // Full-Screen Native Android Device Lock Gate
  if (requireBiometrics && hasBiometricHardware && !isVaultUnlocked) {
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
              Biometric verification or device screen lock required to access enterprise TOTP passcodes and verification tools.
            </Text>

            <TouchableOpacity style={styles.primaryUnlockButton} onPress={handleUnlockApp}>
              <Text style={styles.primaryUnlockButtonText}>
                UNLOCK WITH {biometricTypeLabel} / PIN
              </Text>
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

          {requireBiometrics && hasBiometricHardware && (
            <TouchableOpacity style={styles.quickLockIconBtn} onPress={handleLockApp}>
              <Text style={styles.quickLockIconText}>LOCK</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Horizontal Swipable Paged Container (Main Canvas) */}
      <ScrollView
        ref={pagerRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={handleScrollEnd}
        style={styles.pagerContainer}
      >
        {/* TAB 1: PASSCODES */}
        <View style={[styles.pageItem, { width: pageWidth }]}>
          {accounts.length > 0 ? (
            <FlatList
              data={accounts}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.listContentWithDock}
              showsVerticalScrollIndicator={false}
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
                      <TouchableOpacity
                        style={styles.cardDeleteBtn}
                        onPress={() => confirmDeleteAccount(item.id, item.name, item.issuer)}
                      >
                        <Text style={styles.cardDeleteBtnText}>REMOVE</Text>
                      </TouchableOpacity>
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
          )}
        </View>

        {/* TAB 2: PAIR KEY */}
        <View style={[styles.pageItem, { width: pageWidth }]}>
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
                    Enter account identity and Base32 secret key manually for camera-less provisioning.
                  </Text>

                  <TextInput
                    style={styles.inputField}
                    placeholder="Account Email (e.g. user@domain.com)"
                    placeholderTextColor="#64748b"
                    value={accountName}
                    onChangeText={setAccountName}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  <TextInput
                    style={styles.inputField}
                    placeholder="Issuer Organization (e.g. Sentinel IAM)"
                    placeholderTextColor="#64748b"
                    value={accountIssuer}
                    onChangeText={setAccountIssuer}
                    autoCapitalize="words"
                    autoCorrect={false}
                  />
                  <TextInput
                    style={[
                      styles.inputField,
                      manualValidationError ? styles.inputFieldError : null,
                    ]}
                    placeholder="Base32 Secret Key (e.g. JBSWY3DPEHPK3PXP)"
                    placeholderTextColor="#64748b"
                    value={secretKey}
                    onChangeText={handleSecretKeyChange}
                    autoCapitalize="characters"
                    autoCorrect={false}
                  />

                  {manualValidationError && (
                    <View style={styles.validationErrorBox}>
                      <Text style={styles.validationErrorText}>{manualValidationError}</Text>
                    </View>
                  )}

                  <TouchableOpacity
                    style={styles.addKeyButton}
                    onPress={() => {
                      handleAddAccount();
                      if (!manualValidationError && accountName.trim() && secretKey.trim()) {
                        handleSelectTab("CODES");
                      }
                    }}
                  >
                    <Text style={styles.addKeyButtonText}>ENROLL ACCOUNT KEY</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          </ScrollView>
        </View>

        {/* TAB 3: SYSTEM */}
        <View style={[styles.pageItem, { width: pageWidth }]}>
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
        </View>
      </ScrollView>

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

      {/* In-App Push Authorization Modal (Mounted only when active) */}
      {pendingChallenge !== null && (
        <Modal
          visible={true}
          animationType="fade"
          transparent={true}
          onRequestClose={() => handleRespondChallenge("DENY")}
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
                Select the number displayed on your browser screen to approve access (biometrics required):
              </Text>

              <View style={styles.numberOptionsRow}>
                {pendingChallenge.options.map((opt) => (
                  <TouchableOpacity
                    key={opt}
                    disabled={respondingChallenge}
                    style={styles.numberOptionButton}
                    onPress={() => handleRespondChallenge("APPROVE", opt)}
                  >
                    <Text style={styles.numberOptionText}>{opt}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <TouchableOpacity
                disabled={respondingChallenge}
                style={styles.denyButton}
                onPress={() => handleRespondChallenge("DENY")}
              >
                <Text style={styles.denyButtonText}>
                  {respondingChallenge ? "PROCESSING..." : "DENY REQUEST"}
                </Text>
              </TouchableOpacity>
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
  pagerContainer: {
    flex: 1,
  },
  pageItem: {
    flex: 1,
  },
  pageContentFlex: {
    flex: 1,
  },
  onboardingContainer: {
    paddingVertical: 16,
    alignItems: "center",
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
});
