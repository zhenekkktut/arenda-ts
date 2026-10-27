#!/usr/bin/env bash
test_status=0
gradle -p android :app:connectedDebugAndroidTest --no-daemon --stacktrace || test_status=$?
adb pull /sdcard/Download/arenda-pdf-test-output android-pdf-test-output || true
mkdir -p android-pdf-test-output
adb logcat -d -s ArendaPdf:I '*:S' > android-pdf-test-output/native-render.log || true
adb logcat -d > android-pdf-test-output/android-logcat.log || true
if [ "$test_status" -eq 0 ]; then
  for name in rent reconciliation reconciliation-compact reconciliation-mixed; do
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
