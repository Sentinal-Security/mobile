# Sentinal Security - Mobile Authenticator

Mobile client application designed to function as an authenticator tool (similar to Okta Verify or Duo Mobile). It serves as the physical possession factor in the system's Multi-Factor Authentication (MFA) workflow.

## 1. Tech Stack
* Platform: React Native (0.86.x)
* Framework: Expo (SDK 57)
* Routing: Expo Router (v57)
* Language: TypeScript 6
* State Management: React Hooks & Context
* Target Architecture: Android 64-bit (`arm64-v8a` / Samsung Galaxy S25 FE and modern Android devices)

## 2. System Role & Architecture
In the Sentinal Security 3-component architecture, the mobile app serves as the secondary verification device:
1. User submits username and password on the Next.js Web IAM Portal.
2. The Spring Boot backend identifies that MFA is enabled on the account and generates an authentication challenge.
3. The Mobile Authenticator app receives the challenge, allowing the user to approve the login attempt or provide a timed one-time password (TOTP).
4. The backend confirms verification and unlocks the web session.

## 3. Backend Integration
The mobile client communicates directly with the centralized Spring Boot API gateway:
* Production API Endpoint: `https://backend-pi68.onrender.com`
* Local Development Override: Configure `EXPO_PUBLIC_API_URL` in `.env` to point to your machine's local IP (e.g., `http://192.168.x.x:8080`).

## 4. Local Development

### Prerequisites
* Node.js 20+ installed
* Android SDK (build-tools 34+ or 35+) or physical Android device / emulator

### Installation
```bash
npm install
```

### Starting the Development Server
```bash
npx expo start
```
Scan the QR code displayed in the terminal with Expo Go (Android) or the default Camera app (iOS).

### Platform Commands
```bash
# Start directly on Android emulator
npx expo start --android

# Start directly on iOS simulator
npx expo start --ios

# Start web preview
npx expo start --web
```

### Type Check
```bash
npx tsc --noEmit
```

## 5. Automated CI/CD APK Build Pipeline

The mobile repository includes an automated GitHub Actions pipeline (`.github/workflows/build-apk.yml`) for compiling and packaging the release `.apk`:

### 5.1 Branch-Targeted Triggers
* **Push / Merge to `development`**: Compiles the release APK for the `development` branch only and registers the build record under `development`.
* **Push / Merge to `main`**: Compiles the release APK for the `main` branch only and registers the build record under `main`.
* **Manual Dispatch (`workflow_dispatch`)**: Allows manual execution of the build on any chosen branch directly from GitHub Actions.

### 5.2 Build Optimizations
* **Single Architecture Compilation**: Restricts compilation to `arm64-v8a` (`-PreactNativeArchitectures=arm64-v8a`) specifically for modern devices (Samsung Galaxy S25 FE), reducing compile times by skipping obsolete 32-bit (`armeabi-v7a`) and x86 architectures.
* **Gradle Worker Parallelization**: Leverages multi-core parallel execution (`--parallel --max-workers=4`) and allocates 4 GB JVM heap to avoid worker restarts.
* **Bypassed Redundant Checks**: Skips slow release lint checks (`-x lint -x lintVitalRelease -x lintVitalAnalyzeRelease`).

### 5.3 APK Signature Scheme v2 & v3 (Android 15 Compatibility)
* Modern Android (Android 11 through Android 15, Target SDK 36) strictly rejects unsigned APKs or APKs signed solely with legacy v1 (JAR signing), displaying *"There was a problem parsing the package"* or *"Can't install app"*.
* The CI pipeline automatically signs the compiled APK using Android SDK's `apksigner` with **v1, v2, and v3 signature schemes**:
  ```bash
  apksigner sign --ks android/app/debug.keystore --ks-pass pass:android --key-pass pass:android \
    --v1-signing-enabled true --v2-signing-enabled true --v3-signing-enabled true \
    --out sentinal-authenticator-arm64.apk app-release.apk
  ```
* All output builds pass `apksigner verify --verbose` before distribution.

### 5.4 Installation & Direct Downloads

| Method | Source | Format | Installation Instructions |
| :--- | :--- | :--- | :--- |
| **Web Download Portal** | Protected portal at `/dw` (Password: `seanisbtter`) | Pure `.apk` (42 MB) | **Recommended**: 1-tap direct download. Tapping the download button downloads `sentinal-authenticator-arm64.apk` directly. Tap the downloaded file to install immediately. |
| **Direct File Endpoint** | `/builds/sentinal-authenticator-arm64.apk` | Pure `.apk` (42 MB) | Direct static download URL served by the web portal. |
| **GitHub Actions Artifact** | Run summary under **Artifacts** | Compressed `.zip` | **Note**: GitHub automatically wraps artifacts in `.zip` archives. **Do not simply rename `.zip` to `.apk`**. You must extract/unzip the archive first to retrieve the signed `.apk` located inside. |

## 6. Protected System Modules Policy

The following CI/CD pipeline settings in `.github/workflows/build-apk.yml` are strictly protected:
* Target architecture `arm64-v8a`
* Gradle parallel flags (`--parallel --max-workers=4`)
* Automated `apksigner` v2/v3 signing step
* Central `/api/builds` webhook registration

Do not alter or remove these configurations without team review to prevent breaking download access or Android installation compatibility.

## 7. Jira Project Tracking & Smart Commits
* Jira Board: [Sentinel Security (SS) Board](https://ractopen.atlassian.net/jira/software/projects/SS/boards/2)
* Project Key: `SS`
* GitHub Integration: Commits pushed to `Sentinal-Security/mobile` automatically synchronize with Jira tickets.
* Commit Convention: Include the Jira issue key in square brackets (e.g., `ci(mobile): update build triggers [SS-53]`).

## 8. Git Workflow & Git Town Setup

To keep the development branch synchronized and avoid merge conflicts, all contributors must sync their local branch before making or pushing any changes.

### 8.1 Daily Sync Protocol (Always Sync First)
Before starting any new feature or bugfix, always pull the latest changes from the remote repository:

```bash
# Using Git Town (Recommended)
git town sync

# Or using standard Git
git checkout development
git pull origin development
```

### 8.2 Git Town Setup & Initialization
This repository includes a pre-configured `.git-town.toml` file with:
* **Main Branch**: `main` (production release branch)
* **Perennial Branch**: `development` (active integration branch)

To initialize or verify Git Town on your local clone:
```bash
# If running Git Town for the first time in this repo
git town init

# Verify active branch configuration
git town config
```
Because `.git-town.toml` is committed to the repository, Git Town automatically adopts the project branch conventions without requiring manual setup.

### 8.3 Recommended Feature Workflow
1. **Create a new feature branch**:
   ```bash
   git town hack feature/your-feature-name
   ```
2. **Commit changes**: Include the Jira ticket key in square brackets:
   ```bash
   git commit -m "feat(module): description of changes [SS-XX]"
   ```
3. **Synchronize with latest updates**:
   ```bash
   git town sync
   ```
4. **Merge / Ship to development**:
   ```bash
   git town ship
   ```

