#!/usr/bin/env bash
# CI launch smoke test: installs the release APK on an emulator, launches it,
# pokes the UI, and fails if the app ANRs, crashes, or its process dies.
# Usage: smoke-test.sh <apk-path>
set -u

APK="$1"
PKG="com.sentinal.security"
OUT="smoke-test-output"
WATCH_SECONDS=60
mkdir -p "$OUT"

fail() {
  echo "SMOKE TEST FAILED: $1"
  adb logcat -d > "$OUT/logcat.txt" 2>/dev/null || true
  adb shell dumpsys activity processes > "$OUT/dumpsys-processes.txt" 2>/dev/null || true
  adb shell dumpsys window > "$OUT/dumpsys-window.txt" 2>/dev/null || true
  adb exec-out screencap -p > "$OUT/screen.png" 2>/dev/null || true
  adb pull /data/anr "$OUT/anr" >/dev/null 2>&1 || true
  exit 1
}

check_health() {
  local log
  log=$(adb logcat -d 2>/dev/null)
  if echo "$log" | grep -q "ANR in ${PKG}"; then
    fail "ANR detected for ${PKG}"
  fi
  if echo "$log" | grep -A3 "FATAL EXCEPTION" | grep -q "Process: ${PKG}"; then
    fail "Fatal Java exception in ${PKG}"
  fi
  if echo "$log" | grep -q "Fatal signal.*${PKG}\|>>> ${PKG} <<<"; then
    fail "Native crash in ${PKG}"
  fi
  if adb shell dumpsys window 2>/dev/null | grep -q "Application Not Responding: ${PKG}"; then
    fail "ANR dialog visible for ${PKG}"
  fi
  if [ -z "$(adb shell pidof ${PKG} 2>/dev/null | tr -d '\r')" ]; then
    fail "Process ${PKG} is not running"
  fi
}

echo "Installing ${APK}"
adb install -r "$APK" || fail "adb install failed"

adb logcat -c
echo "Launching ${PKG}"
adb shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1 \
  || fail "Could not launch ${PKG}"

# Give cold start (and ARM translation on the x86_64 image) time to finish.
sleep 20
check_health

# A blocked main thread only becomes an ANR once input is dispatched to it,
# so send harmless taps in an empty top-left area during the watch window.
ELAPSED=0
while [ "$ELAPSED" -lt "$WATCH_SECONDS" ]; do
  adb shell input tap 20 400 >/dev/null 2>&1 || true
  sleep 10
  ELAPSED=$((ELAPSED + 10))
  check_health
  echo "Healthy after $((ELAPSED + 20))s"
done

adb logcat -d > "$OUT/logcat.txt" 2>/dev/null || true
echo "SMOKE TEST PASSED: ${PKG} launched and stayed responsive."
