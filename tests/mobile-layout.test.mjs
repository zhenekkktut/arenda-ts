import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const styles = fs.readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../app/rental-app.tsx", import.meta.url), "utf8");
const activity = fs.readFileSync(
  new URL("../android/app/src/main/java/ru/zhenekkktut/arendats/MainActivity.java", import.meta.url),
  "utf8",
);
const manifest = fs.readFileSync(
  new URL("../android/app/src/main/AndroidManifest.xml", import.meta.url),
  "utf8",
);

test("mobile dialogs stay inside the viewport without inherited centering", () => {
  assert.match(styles, /\[data-slot="dialog-content"\][\s\S]*?inset:\s*auto 0 0 !important/);
  assert.match(styles, /--tw-translate-x:\s*0px !important/);
  assert.match(styles, /--tw-translate-y:\s*0px !important/);
  assert.match(styles, /max-height:\s*calc\(100dvh - 0\.75rem\)/);
  assert.match(styles, /overflow-y:\s*auto/);
});

test("Android keeps content clear of system bars and resizes for the keyboard", () => {
  assert.match(activity, /setOnApplyWindowInsetsListener/);
  assert.match(activity, /WindowInsets\.Type\.systemBars\(\) \| WindowInsets\.Type\.displayCutout\(\)/);
  assert.match(activity, /layoutParams\.setMargins\(insetLeft, insetTop, insetRight, insetBottom\)/);
  assert.match(manifest, /android:windowSoftInputMode="adjustResize"/);
});

test("quick entry always exposes the historical date and advances after save", () => {
  assert.match(app, /<FieldLabel>Дата доставки<\/FieldLabel>/);
  assert.match(app, /min=\{`\$\{month\}-01`\}/);
  assert.match(app, /const followingDate = nextIsoDate\(entryDate\)/);
  assert.match(app, /selectEntryDate\(followingDate\)/);
  assert.doesNotMatch(app, /entryOptionsOpen/);
});

test("dark theme is persisted and also updates Android system bars", () => {
  assert.match(app, /arenda-ts-theme-v1/);
  assert.match(styles, /html\[data-theme="dark"\]/);
  assert.match(activity, /public void setTheme\(String theme\)/);
  assert.match(activity, /setStatusBarColor\(statusBar\)/);
  assert.match(activity, /setNavigationBarColor\(background\)/);
});
