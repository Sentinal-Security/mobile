import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  Alert,
  Image,
  Modal,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { CameraView, useCameraPermissions } from "expo-camera";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { generateTotp, getSecondsRemaining } from "@/utils/totp";

interface TotpAccount {
  id: string;
  name: string;
  secret: string;
}

const API_BASE_URL = "https://backend-pi68.onrender.com";
const ACCOUNTS_STORAGE_KEY = "@sentinel_totp_accounts";

interface PendingChallenge {
  id: number;
  userId: number;
  email: string;
  matchCode: string;
  clientOrigin: string;
  options: string[];
}

export default function AuthenticatorScreen() {
  const [accounts, setAccounts] = useState<TotpAccount[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [accountName, setAccountName] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [remainingSeconds, setRemainingSeconds] = useState(getSecondsRemaining());
  const [showScanner, setShowScanner] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();

  const [pendingChallenge, setPendingChallenge] = useState<PendingChallenge | null>(null);
  const [respondingChallenge, setRespondingChallenge] = useState(false);

  // Load saved accounts from local storage on mount
  useEffect(() => {
    const loadSavedAccounts = async () => {
      try {
        const stored = await AsyncStorage.getItem(ACCOUNTS_STORAGE_KEY);
        if (stored) {
          const parsed = JSON.parse(stored);
          if (Array.isArray(parsed)) {
            setAccounts(parsed);
          }
        }
      } catch (err) {
        console.error("Failed to load accounts from storage:", err);
      } finally {
        setIsLoaded(true);
      }
    };
    loadSavedAccounts();
  }, []);

  // Save accounts to local storage whenever accounts change
  useEffect(() => {
    if (!isLoaded) return;
    AsyncStorage.setItem(ACCOUNTS_STORAGE_KEY, JSON.stringify(accounts)).catch((err) => {
      console.error("Failed to persist accounts to storage:", err);
    });
  }, [accounts, isLoaded]);

  useEffect(() => {
    const timer = setInterval(() => {
      setRemainingSeconds(getSecondsRemaining());
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  // Poll for active push verification challenges
  useEffect(() => {
    let isMounted = true;

    const checkPendingChallenges = async () => {
      // Gather emails to check: enrolled accounts, or currently typed accountName
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
        try {
          const res = await fetch(
            `${API_BASE_URL}/api/mfa/challenge/pending?email=${encodeURIComponent(email)}`
          );
          if (!res.ok) continue;
          const json = await res.json();
          if (json.success && json.data?.hasPending && json.data.challenge) {
            const ch = json.data.challenge;
            if (!isMounted) return;

            setPendingChallenge((prev) => {
              if (prev && prev.id === ch.id) return prev;
              const matchNum = parseInt(ch.matchCode, 10) || 42;
              const d1 = (((matchNum + 17) % 90) + 10).toString();
              const d2 = (((matchNum + 43) % 90) + 10).toString();
              const opts = [ch.matchCode, d1, d2].sort(() => Math.random() - 0.5);
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
          // Ignore network errors during polling
        }
      }
    };

    checkPendingChallenges();
    const pollInterval = setInterval(checkPendingChallenges, 3000);

    return () => {
      isMounted = false;
      clearInterval(pollInterval);
    };
  }, [accounts, accountName]);

  const handleRespondChallenge = async (action: "APPROVE" | "DENY", selectedCode?: string) => {
    if (!pendingChallenge) return;
    setRespondingChallenge(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/mfa/challenge/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          challengeId: pendingChallenge.id,
          action,
          selectedCode,
        }),
      });
      const json = await res.json();
      if (json.success) {
        if (action === "APPROVE") {
          Alert.alert("Authorization Approved", "Sign-in approved successfully.");
        } else {
          Alert.alert("Authorization Denied", "Sign-in request denied.");
        }
        setPendingChallenge(null);
      } else {
        Alert.alert("Verification Error", json.message || "Failed to process authorization.");
      }
    } catch {
      Alert.alert("Network Error", "Could not reach Sentinel Security Gateway.");
    } finally {
      setRespondingChallenge(false);
    }
  };

  const handleAddAccount = (name?: string, secret?: string) => {
    const cleanName = (name || accountName).trim();
    const cleanSecret = (secret || secretKey).trim().toUpperCase().replace(/\s+/g, "");

    if (!cleanName || !cleanSecret) {
      Alert.alert("Input Error", "Both Account Name and Secret Key are required.");
      return;
    }

    const newAccount: TotpAccount = {
      id: Date.now().toString(),
      name: cleanName,
      secret: cleanSecret,
    };

    setAccounts((prev) => [newAccount, ...prev]);
    setAccountName("");
    setSecretKey("");
    setShowScanner(false);
  };

  const confirmDeleteAccount = (id: string, name: string) => {
    Alert.alert(
      "Remove Account",
      `Are you sure you want to remove ${name}? This will delete the 2FA key from this device.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => setAccounts((prev) => prev.filter((acc) => acc.id !== id)),
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
    setShowScanner(true);
  };

  const handleBarcodeScanned = ({ data }: { data: string }) => {
    if (!data) return;

    // Handle otpauth://totp/URI format
    if (data.startsWith("otpauth://")) {
      let secret = "";
      let name = "";

      const secretMatch = data.match(/[?&]secret=([A-Za-z2-7]+)/i);
      if (secretMatch && secretMatch[1]) {
        secret = secretMatch[1].toUpperCase();
      }

      const issuerMatch = data.match(/[?&]issuer=([^&]+)/i);
      const issuer = issuerMatch ? decodeURIComponent(issuerMatch[1]) : "";

      const labelMatch = data.match(/otpauth:\/\/totp\/([^?]+)/i);
      if (labelMatch && labelMatch[1]) {
        const rawLabel = decodeURIComponent(labelMatch[1]);
        if (rawLabel.includes(":")) {
          const parts = rawLabel.split(":");
          name = parts[1] || parts[0];
        } else {
          name = rawLabel;
        }
      }

      if (!name && issuer) {
        name = issuer;
      }

      if (secret) {
        handleAddAccount(name || "Sentinel Account", secret);
        Alert.alert("Account Paired", `Successfully enrolled 2FA for ${name || "Sentinel Account"}`);
        return;
      }
    }

    // Direct Base32 key fallback
    const cleanSecret = data.trim().toUpperCase().replace(/\s+/g, "");
    if (cleanSecret.length >= 8 && /^[A-Z2-7]+$/.test(cleanSecret)) {
      handleAddAccount("Enrolled Account", cleanSecret);
      Alert.alert("Account Paired", "Successfully enrolled 2FA secret key from QR code.");
    } else {
      Alert.alert("Invalid QR Code", "Scanned code does not contain a valid Base32 2FA secret.");
      setShowScanner(false);
    }
  };

  const progressPercent = Math.max(0, Math.min(100, (remainingSeconds / 30) * 100));

  return (
    <SafeAreaView style={styles.container}>
      {/* Enterprise Header with Sentinel Bracket Accent */}
      <View style={styles.headerContainer}>
        <View style={styles.headerLeft}>
          <Image
            source={require("../../assets/images/icon.png")}
            style={styles.logoImage}
            resizeMode="contain"
          />
          <View style={styles.headerTextGroup}>
            <View style={styles.badgeRow}>
              <View style={styles.statusDot} />
              <Text style={styles.brandBadge}>SENTINEL SECURITY</Text>
            </View>
            <Text style={styles.headerTitle}>Authenticator</Text>
            <Text style={styles.headerSubtitle}>RFC 6238 Standard 6-Digit TOTP</Text>
            <View style={styles.pushStatusBadge}>
              <View style={styles.pushActivePulse} />
              <Text style={styles.pushStatusText}>PUSH ACTIVE</Text>
            </View>
          </View>
        </View>
      </View>

      {/* Synchronized 30-Second Refresh Progress Bar */}
      <View style={styles.timerCard}>
        <View style={styles.timerHeaderRow}>
          <Text style={styles.timerLabel}>TOKEN REFRESH WINDOW</Text>
          <Text style={styles.timerCountdown}>{remainingSeconds}s remaining</Text>
        </View>
        <View style={styles.progressTrack}>
          <View style={[styles.progressBar, { width: `${progressPercent}%` }]} />
        </View>
      </View>

      {/* Account Enrollment Section */}
      <View style={styles.enrollmentCard}>
        <View style={styles.enrollmentHeader}>
          <Text style={styles.enrollmentTitle}>PAIR NEW 2FA ACCOUNT</Text>
        </View>

        <TouchableOpacity style={styles.primaryScanButton} onPress={handleOpenScanner}>
          <Text style={styles.primaryScanButtonText}>SCAN QR CODE</Text>
        </TouchableOpacity>

        <View style={styles.dividerRow}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>OR MANUAL KEY ENTRY</Text>
          <View style={styles.dividerLine} />
        </View>

        <TextInput
          style={styles.inputField}
          placeholder="Account Name (e.g. user@domain.com)"
          placeholderTextColor="#64748b"
          value={accountName}
          onChangeText={setAccountName}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <TextInput
          style={styles.inputField}
          placeholder="Base32 Secret Key"
          placeholderTextColor="#64748b"
          value={secretKey}
          onChangeText={setSecretKey}
          autoCapitalize="characters"
          autoCorrect={false}
        />

        <TouchableOpacity style={styles.addKeyButton} onPress={() => handleAddAccount()}>
          <Text style={styles.addKeyButtonText}>ADD ACCOUNT KEY</Text>
        </TouchableOpacity>
      </View>

      {/* Active Accounts Section */}
      <View style={styles.accountsHeaderRow}>
        <Text style={styles.sectionHeaderTitle}>ENROLLED ACCOUNTS</Text>
        <View style={styles.counterBadge}>
          <Text style={styles.counterBadgeText}>{accounts.length}</Text>
        </View>
      </View>

      <FlatList
        data={accounts}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => {
          const code = generateTotp(item.secret);
          const formattedCode =
            code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code;

          return (
            <View style={styles.accountCard}>
              <View style={styles.accountTopRow}>
                <Text style={styles.accountName} numberOfLines={1}>
                  {item.name}
                </Text>
                <View style={styles.protocolBadge}>
                  <Text style={styles.protocolBadgeText}>SHA-1 / 30S</Text>
                </View>
              </View>

              <View style={styles.tokenRow}>
                <Text style={styles.totpToken}>{formattedCode}</Text>
                <TouchableOpacity
                  style={styles.removeButton}
                  onPress={() => confirmDeleteAccount(item.id, item.name)}
                >
                  <Text style={styles.removeButtonText}>REMOVE</Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.secretHintText} numberOfLines={1}>
                KEY: {item.secret.slice(0, 6)}...{item.secret.slice(-4)}
              </Text>
            </View>
          );
        }}
        ListEmptyComponent={
          <View style={styles.emptyCard}>
            <View style={styles.emptyBracket} />
            <Text style={styles.emptyTitle}>NO SECURITY KEYS ENROLLED</Text>
            <Text style={styles.emptyDescription}>
              Scan an enrollment QR code from the Sentinel Web Portal or enter a Base32
              provisioning key to begin generating one-time passcodes.
            </Text>
          </View>
        }
      />

      {/* Full-Screen QR Code Scanner Modal */}
      <Modal
        visible={showScanner}
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

          {showScanner && permission?.granted ? (
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

      {/* In-App Push Authorization Modal (Number Matching) */}
      <Modal
        visible={pendingChallenge !== null}
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
              <Text style={styles.pushOriginLabel}>APPLICATION</Text>
              <Text style={styles.pushOriginValue}>{pendingChallenge?.clientOrigin}</Text>

              <Text style={styles.pushEmailLabel}>ACCOUNT</Text>
              <Text style={styles.pushEmailValue}>{pendingChallenge?.email}</Text>
            </View>

            <Text style={styles.pushPromptText}>
              Select the number displayed on your browser screen to approve access:
            </Text>

            <View style={styles.numberOptionsRow}>
              {pendingChallenge?.options.map((opt) => (
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 12,
    backgroundColor: "#000000",
  },
  headerContainer: {
    marginBottom: 16,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(84, 244, 252, 0.15)",
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  logoImage: {
    width: 46,
    height: 46,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(84, 244, 252, 0.35)",
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
  timerCard: {
    backgroundColor: "#070c16",
    borderWidth: 1,
    borderColor: "rgba(84, 244, 252, 0.2)",
    borderRadius: 6,
    padding: 10,
    marginBottom: 16,
  },
  timerHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  timerLabel: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1,
    color: "#94a3b8",
  },
  timerCountdown: {
    fontSize: 12,
    fontWeight: "700",
    color: "#54f4fc",
    fontFamily: "monospace",
  },
  progressTrack: {
    height: 5,
    backgroundColor: "#0f172a",
    borderRadius: 3,
    overflow: "hidden",
  },
  progressBar: {
    height: "100%",
    backgroundColor: "#54f4fc",
    borderRadius: 3,
  },
  enrollmentCard: {
    backgroundColor: "#070c16",
    borderWidth: 1,
    borderColor: "rgba(84, 244, 252, 0.2)",
    borderRadius: 6,
    padding: 14,
    marginBottom: 16,
  },
  enrollmentHeader: {
    marginBottom: 12,
  },
  enrollmentTitle: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.2,
    color: "#54f4fc",
  },
  primaryScanButton: {
    backgroundColor: "#54f4fc",
    paddingVertical: 12,
    borderRadius: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryScanButtonText: {
    color: "#000000",
    fontWeight: "800",
    fontSize: 13,
    letterSpacing: 1,
  },
  dividerRow: {
    flexDirection: "row",
    alignItems: "center",
    marginVertical: 12,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: "rgba(255, 255, 255, 0.1)",
  },
  dividerText: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1,
    color: "#64748b",
    marginHorizontal: 8,
  },
  inputField: {
    backgroundColor: "#030712",
    borderWidth: 1,
    borderColor: "rgba(84, 244, 252, 0.25)",
    borderRadius: 4,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    color: "#ffffff",
    marginBottom: 10,
  },
  addKeyButton: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: "#54f4fc",
    paddingVertical: 11,
    borderRadius: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  addKeyButtonText: {
    color: "#54f4fc",
    fontWeight: "800",
    fontSize: 12,
    letterSpacing: 1,
  },
  accountsHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  sectionHeaderTitle: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.2,
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
    fontSize: 11,
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
    borderColor: "rgba(84, 244, 252, 0.25)",
    borderLeftWidth: 3,
    borderLeftColor: "#54f4fc",
    borderRadius: 6,
    padding: 14,
    marginBottom: 10,
  },
  accountTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6,
  },
  accountName: {
    fontSize: 14,
    fontWeight: "700",
    color: "#ffffff",
    flex: 1,
    marginRight: 8,
  },
  protocolBadge: {
    backgroundColor: "#0f172a",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.1)",
  },
  protocolBadgeText: {
    fontSize: 9,
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
  totpToken: {
    fontSize: 28,
    fontWeight: "800",
    letterSpacing: 4,
    color: "#54f4fc",
    fontFamily: "monospace",
  },
  removeButton: {
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.5)",
    borderRadius: 4,
  },
  removeButtonText: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.8,
    color: "#ef4444",
  },
  secretHintText: {
    fontSize: 10,
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
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1.2,
    color: "#e2e8f0",
    marginBottom: 6,
  },
  emptyDescription: {
    fontSize: 12,
    color: "#64748b",
    textAlign: "center",
    lineHeight: 18,
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
  pushStatusBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: 6,
    alignSelf: "flex-start",
    backgroundColor: "rgba(84, 244, 252, 0.08)",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "rgba(84, 244, 252, 0.25)",
  },
  pushActivePulse: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#54f4fc",
  },
  pushStatusText: {
    fontSize: 9,
    fontWeight: "700",
    color: "#54f4fc",
    letterSpacing: 1,
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
    borderWidth: 2,
    borderColor: "#54f4fc",
    borderRadius: 8,
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
    borderRadius: 6,
    padding: 12,
    marginBottom: 16,
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
    borderRadius: 6,
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
    borderRadius: 4,
    alignItems: "center",
  },
  denyButtonText: {
    color: "#ef4444",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1,
  },
});
