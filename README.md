# Sentinal Security — Mobile Authenticator

Mobile client application designed to serve as the physical possession factor in the Sentinal Security Multi-Factor Authentication (MFA) ecosystem (modeled after Okta Verify and Duo Mobile).

* **Architecture Target**: Android 64-bit (`arm64-v8a` / modern Android 10+ devices)
* **Latest APK Download**: Available via the [Web Download Portal](https://web-beta-orcin-33.vercel.app/download) or `/dw` build registry
* **Central API Gateway**: `https://backend-pi68.onrender.com`

For the complete architectural specification and end-to-end authentication flows, refer to [`UNIFIED-SYSTEM-GUIDE.md`](../UNIFIED-SYSTEM-GUIDE.md).

---

## 1. Tech Stack
* Platform: React Native (0.86.x)
* Framework: Expo (SDK 57)
* Routing: Expo Router (v57)
* Language: TypeScript 6
* Secure Vault: Hardware KeyStore via `expo-secure-store` (AES-256 GCM in Android TEE)
* Biometrics: Inherence factor via `expo-local-authentication` (fingerprint, face unlock, PIN fallback)

---

## 2. Core Capabilities

1. **RFC 6238 TOTP Generator**: Generates rotating 30-second cryptographic passcodes completely offline.
2. **Out-of-Band Push Authorization**: Background polling detects web sign-in attempts and presents a 2-digit number-matching challenge to defeat push fatigue.
3. **Biometric Vault Lock**: Protects paired accounts and MFA approvals behind device fingerprint or face verification.
4. **QR Code Scanner**: Fast enrollment via device camera or compliant manual Base32 key input.

---

## 3. Environment Variables & Local Development

Configure `EXPO_PUBLIC_API_URL` to override the backend gateway:
* Production Default: `https://backend-pi68.onrender.com`
* Local Override (in `.env`): `http://<your-lan-ip>:8080`

### Installation & Run
```bash
cd mobile
npm install
npx expo start --android
```

---

## 4. Automated CI/CD APK Build Pipeline

All release APK compilation is executed in the cloud via GitHub Actions:
* **Workflow**: `.github/workflows/build-apk.yml`
* **Target**: ARM64 release APK with APK Signature Scheme v2 & v3 (Android 15 compatible)
* **Webhook**: Registers completed builds to the backend `/api/builds` endpoint upon success

### CI Rules & Constraints
* **GitHub Actions Exclusive Compilation**: Never compile Android release APKs locally. Always trigger compilation via GitHub Actions.
* **Push Local Commits First**: Before triggering any CI compilation, verify that all local commits in `mobile/` are pushed to `origin/development`. Never dispatch a build workflow with unpushed changes.
* **Protected Workflow**: `.github/workflows/build-apk.yml` is strictly protected from modification.

---

## 5. Protocols & Tracking
All contributors and AI agents must follow the repository standards documented in [`AGENTS.md`](../AGENTS.md):
* Git identity: `ractopen` (`197402134+ractopen@users.noreply.github.com`)
* Jira issue linking: `[SS-XX]` commit tags
* Perennial branch: `development`
