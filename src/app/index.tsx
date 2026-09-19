import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { generateTotp, getSecondsRemaining } from "@/utils/totp";

interface TotpAccount {
  id: string;
  name: string;
  secret: string;
}

export default function AuthenticatorScreen() {
  const [accounts, setAccounts] = useState<TotpAccount[]>([
    {
      id: "demo-1",
      name: "demo@sentinal.security",
      secret: "JBSWY3DPEHPK3PXP",
    },
  ]);

  const [accountName, setAccountName] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [remainingSeconds, setRemainingSeconds] = useState(getSecondsRemaining());
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setRemainingSeconds(getSecondsRemaining());
      setTick((prev) => prev + 1);
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  const handleAddAccount = () => {
    const cleanName = accountName.trim();
    const cleanSecret = secretKey.trim().toUpperCase().replace(/\s+/g, "");

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
  };

  const handleDeleteAccount = (id: string) => {
    setAccounts((prev) => prev.filter((acc) => acc.id !== id));
  };

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.header}>Sentinal Authenticator (Android)</Text>
      <Text style={styles.subHeader}>RFC 6238 Standard 6-Digit TOTP</Text>

      <View style={styles.timerBar}>
        <Text style={styles.timerText}>
          Next Code Refresh in: <Text style={styles.timerBold}>{remainingSeconds}s</Text>
        </Text>
      </View>

      <View style={styles.formContainer}>
        <Text style={styles.formTitle}>Add New Account / Token</Text>
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
        <TouchableOpacity style={styles.button} onPress={handleAddAccount}>
          <Text style={styles.buttonText}>+ Add Account</Text>
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
              Add an account above or pair from the Sentinal Web IAM Dashboard.
            </Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    backgroundColor: "#ffffff",
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
    marginBottom: 12,
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
    marginBottom: 8,
    color: "#222222",
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
});
