# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

## Mobile Compilation & Deployment Protocol
- **GitHub Actions Exclusive Compilation**: Never compile Android release APKs locally. Always trigger and execute compilation via GitHub Actions (`.github/workflows/build-apk.yml`).
- **Push Local Commits First**: Before triggering any compilation or build workflow, verify that all local commits are pushed to `origin/development`. Never dispatch an APK build workflow with unpushed local changes.
