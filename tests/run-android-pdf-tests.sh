#!/usr/bin/env bash
test_status=0
gradle -p android :app:connectedDebugAndroidTest --no-daemon --stacktrace || test_status=$?
adb pull /sdcard/Download/arenda-pdf-test-output android-pdf-test-output || true
mkdir -p android-pdf-test-output
adb logcat -d -s ArendaPdf:I '*:S' > android-pdf-test-output/native-render.log || true
exit "$test_status"
