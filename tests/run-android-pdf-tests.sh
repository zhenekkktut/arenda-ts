#!/usr/bin/env bash
test_status=0
# Chromium 74 in the API 29 emulator can fail GPU font-buffer serialization.
# Keep GPU composition, but rasterize in software only in this test environment.
# Userdebug/emulator WebView reads this file before the app process starts.
image_type="$(adb shell getprop ro.build.type | tr -d '\r')"
case "$image_type" in
  userdebug|eng) ;;
  *) echo "WebView test flags require a debug Android image" >&2; exit 1 ;;
esac
adb shell "echo '_ --disable-gpu-rasterization' > /data/local/tmp/webview-command-line" || exit 1
adb shell chmod 0644 /data/local/tmp/webview-command-line || exit 1
adb shell am force-stop ru.zhenekkktut.arendats || exit 1

gradle -p android :app:connectedDebugAndroidTest --no-daemon --stacktrace || test_status=$?
adb pull /sdcard/Download/arenda-pdf-test-output android-pdf-test-output || true
mkdir -p android-pdf-test-output
adb logcat -d -s ArendaPdf:I '*:S' > android-pdf-test-output/native-render.log || true
adb logcat -d > android-pdf-test-output/android-logcat.log || true
adb shell cat /data/local/tmp/webview-command-line > android-pdf-test-output/webview-render-flags.txt || true
if [ "$test_status" -eq 0 ]; then
  for name in rent reconciliation reconciliation-compact reconciliation-mixed reconciliation-interim; do
    if [ ! -s "android-pdf-test-output/$name.pdf" ] || [ ! -s "android-pdf-test-output/$name-1.png" ]; then
      echo "Missing native PDF report output: $name" >&2
      test_status=1
    fi
  done
  for name in reconciliation reconciliation-mixed; do
    if [ ! -s "android-pdf-test-output/$name-2.png" ]; then
      echo "Missing native PDF second-page output: $name" >&2
      test_status=1
    fi
  done
fi
exit "$test_status"
