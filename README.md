# Sentinal Security - Mobile Authenticator

Mobile client application designed to function as an authenticator tool (similar to Okta Verify or Duo Mobile). It serves as the physical possession factor in the system's Multi-Factor Authentication (MFA) workflow.

## 1. Tech Stack
* Platform: React Native (0.86.x)
* Framework: Expo (SDK 57)
* Routing: Expo Router (v57)
* Language: TypeScript 6
* State Management: React Hooks & Context

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
* Expo Go app installed on physical iOS/Android device, or an active Android Studio / Xcode simulator

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

# Type check
npx tsc --noEmit
```
