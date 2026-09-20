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
import { generateTotp, getSecondsRemaining } from "@/utils/totp";

interface TotpAccount {
  id: string;
  name: string;
  secret: string;
}

export default function AuthenticatorScreen() {
  const [accounts, setAccounts] = useState<TotpAccount[]>([]);
  const [accountName, setAccountName] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [remainingSeconds, setRemainingSeconds] = useState(getSecondsRemaining());
  const [showScanner, setShowScanner] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();

  useEffect(() => {
    const timer = setInterval(() => {
      setRemainingSeconds(getSecondsRemaining());
    }, 1000);

    return () => clearInterval(timer);
  }, []);

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

  const handleDeleteAccount = (id: string) => {
    setAccounts((prev) => prev.filter((acc) => acc.id !== id));
  };

  const handleOpenScanner = async () => {
    if (!permission?.granted) {
      const res = await requestPermission();
      if (!res.granted) {
        Alert.alert("Camera Permission Required", "Camera access is needed to scan QR codes.");
        return;
      }
    }
    setShowScanner(true);
  };

  const handleBarcodeScanned = ({ data }: { data: string }) => {
    if (!data) return;

    // Parse otpauth://totp/Issuer:Account?secret=XXX&issuer=YYY
    if (data.startsWith("otpauth://")) {
      try {
        const url = new URL(data);
        const secret = url.searchParams.get("secret");
        const pathParts = decodeURIComponent(url.pathname).replace(/^\/\/?(totp\/)?/, "").split(":");
        const name = pathParts.length > 1 ? pathParts[1] : pathParts[0];

        if (secret) {
          handleAddAccount(name || "Scanned Account", secret);
          Alert.alert("Account Added", `Successfully paired 2FA for ${name || "Scanned Account"}`);
          return;
        }
      } catch (e) {
        // Fallback to raw string parsing if URL parsing fails
      }
    }

    // Direct secret key scan fallback
    const cleanSecret = data.trim().toUpperCase().replace(/\s+/g, "");
    if (cleanSecret.length >= 8) {
      handleAddAccount("Scanned Account", cleanSecret);
      Alert.alert("Account Added", "Successfully paired 2FA secret key from QR Code.");
    } else {
      Alert.alert("Invalid QR Code", "Scanned code does not contain a valid Base32 2FA secret.");
      setShowScanner(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.headerRow}>
        <Image
          source={require("../../assets/images/icon.png")}
          style={styles.logoImage}
          resizeMode="contain"
        />
        <View>
          <Text style={styles.header}>Sentinel Authenticator</Text>
          <Text style={styles.subHeader}>RFC 6238 Standard 6-Digit TOTP</Text>
        </View>
      </View>

      <View style={styles.timerBar}>
        <Text style={styles.timerText}>
          Next Code Refresh in: <Text style={styles.timerBold}>{remainingSeconds}s</Text>
        </Text>
      </View>

      {/* Pairing Actions: QR Scan or Manual Input */}
      <View style={styles.formContainer}>
        <Text style={styles.formTitle}>Pair New 2FA Account</Text>

        <TouchableOpacity style={styles.scanButton} onPress={handleOpenScanner}>
          <Text style={styles.scanButtonText}>📷 Scan QR Code with Camera</Text>
        </TouchableOpacity>

        <View style={styles.divider}>
          <View style={styles.line} />
          <Text style={styles.dividerText}>OR MANUAL ENTRY</Text>
          <View style={styles.line} />
        </View>

        <TextInput
          style={styles.input}
          placeholder="Account Name (e.g. user@domain.com)"
          placeholderTextColor="#888"
          value={accountName}
          onChangeText={setAccountName}
          autoCapitalize="none"
        />
        <TextInput
          style={styles.input}
          placeholder="Base32 Secret Key"
          placeholderTextColor="#888"
          value={secretKey}
          onChangeText={setSecretKey}
          autoCapitalize="characters"
        />
        <TouchableOpacity style={styles.button} onPress={() => handleAddAccount()}>
          <Text style={styles.buttonText}>+ Add Account Key</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.sectionTitle}>Active 2FA Accounts ({accounts.length})</Text>

      <FlatList
        data={accounts}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => {
          const code = generateTotp(item.secret);
          const formattedCode =
            code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code;

          return (
            <View style={styles.accountCard}>
              <View style={styles.accountInfo}>
                <Text style={styles.accountName}>{item.name}</Text>
                <Text style={styles.totpCode}>{formattedCode}</Text>
                <Text style={styles.secretHint}>Secret: {item.secret}</Text>
              </View>
              <TouchableOpacity
                style={styles.deleteButton}
                onPress={() => handleDeleteAccount(item.id)}
              >
                <Text style={styles.deleteButtonText}>Delete</Text>
              </TouchableOpacity>
            </View>
          );
        }}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>No accounts paired yet.</Text>
            <Text style={styles.emptySubText}>
              Scan a QR code or enter a secret key above to pair your account.
            </Text>
          </View>
        }
      />

      {/* QR Code Scanner Modal */}
      <Modal visible={showScanner} animationType="slide" onRequestClose={() => setShowScanner(false)}>
        <SafeAreaView style={styles.scannerModal}>
          <View style={styles.scannerHeader}>
            <Text style={styles.scannerTitle}>Scan 2FA QR Code</Text>
            <TouchableOpacity onPress={() => setShowScanner(false)} style={styles.closeButton}>
              <Text style={styles.closeButtonText}>Close ✕</Text>
            </TouchableOpacity>
          </View>
          <CameraView
            style={styles.cameraView}
            barcodeScannerSettings={{
              barcodeTypes: ["qr"],
            }}
            onBarcodeScanned={handleBarcodeScanned}
          />
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    backgroundColor: "#ffffff",
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
    gap: 12,
  },
  logoImage: {
    width: 44,
    height: 44,
    borderRadius: 8,
  },
  header: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#111111",
    marginBottom: 2,
  },
  subHeader: {
    fontSize: 13,
    color: "#666666",
  },
  timerBar: {
    padding: 8,
    backgroundColor: "#f0f4f8",
    borderWidth: 1,
    borderColor: "#d0d7de",
    borderRadius: 4,
    marginBottom: 14,
  },
  timerText: {
    fontSize: 13,
    color: "#333333",
  },
  timerBold: {
    fontWeight: "bold",
    color: "#0969da",
  },
  formContainer: {
    padding: 12,
    borderWidth: 1,
    borderColor: "#cccccc",
    borderRadius: 4,
    marginBottom: 16,
    backgroundColor: "#fafafa",
  },
  formTitle: {
    fontSize: 14,
    fontWeight: "bold",
    marginBottom: 10,
    color: "#222222",
  },
  scanButton: {
    backgroundColor: "#0969da",
    paddingVertical: 12,
    borderRadius: 4,
    alignItems: "center",
    marginBottom: 10,
  },
  scanButtonText: {
    color: "#ffffff",
    fontWeight: "bold",
    fontSize: 14,
  },
  divider: {
    flexDirection: "row",
    alignItems: "center",
    marginVertical: 10,
  },
  line: {
    flex: 1,
    height: 1,
    backgroundColor: "#dddddd",
  },
  dividerText: {
    fontSize: 11,
    color: "#888888",
    marginHorizontal: 8,
    fontWeight: "600",
  },
  input: {
    borderWidth: 1,
    borderColor: "#cccccc",
    borderRadius: 4,
    padding: 8,
    fontSize: 14,
    backgroundColor: "#ffffff",
    marginBottom: 8,
    color: "#000000",
  },
  button: {
    backgroundColor: "#000000",
    paddingVertical: 10,
    borderRadius: 4,
    alignItems: "center",
  },
  buttonText: {
    color: "#ffffff",
    fontWeight: "bold",
    fontSize: 14,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: "bold",
    color: "#222222",
    marginBottom: 8,
  },
  accountCard: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 12,
    borderWidth: 1,
    borderColor: "#e1e4e8",
    borderRadius: 4,
    marginBottom: 10,
    backgroundColor: "#fcfcfc",
  },
  accountInfo: {
    flex: 1,
  },
  accountName: {
    fontSize: 14,
    fontWeight: "600",
    color: "#333333",
    marginBottom: 4,
  },
  totpCode: {
    fontSize: 26,
    fontWeight: "bold",
    letterSpacing: 3,
    color: "#0969da",
    marginBottom: 4,
  },
  secretHint: {
    fontSize: 11,
    color: "#888888",
    fontFamily: "monospace",
  },
  deleteButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: "#cf222e",
    borderRadius: 4,
  },
  deleteButtonText: {
    color: "#cf222e",
    fontSize: 12,
    fontWeight: "bold",
  },
  emptyContainer: {
    padding: 24,
    alignItems: "center",
  },
  emptyText: {
    fontSize: 15,
    fontWeight: "bold",
    color: "#555555",
  },
  emptySubText: {
    fontSize: 13,
    color: "#888888",
    textAlign: "center",
    marginTop: 4,
  },
  scannerModal: {
    flex: 1,
    backgroundColor: "#000000",
  },
  scannerHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
    backgroundColor: "#111111",
  },
  scannerTitle: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "bold",
  },
  closeButton: {
    padding: 6,
  },
  closeButtonText: {
    color: "#ff4d4f",
    fontWeight: "bold",
    fontSize: 14,
  },
  cameraView: {
    flex: 1,
  },
});
