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
  assert.match(app, /className="date-input-native"/);
  assert.match(app, /min=\{monthBounds\.start\}/);
  assert.match(app, /const followingDate = nextIsoDate\(entryDate\)/);
  assert.match(app, /selectEntryDate\(followingDate\)/);
  assert.doesNotMatch(app, /entryOptionsOpen/);
});

test("quick entry controls keep a stable mobile layout", () => {
  assert.match(app, /quick-entry-title">Бутылки за день/);
  assert.match(app, /className="fast-entry-date-row"/);
  assert.match(app, /className="fast-entry-quantity"[\s\S]*?className="fast-entry-row"/);
  assert.doesNotMatch(app, /entry-live-total/);
  assert.doesNotMatch(app, /today-button/);
  assert.match(styles, /\.fast-entry-row\s*\{[\s\S]*?align-items:\s*stretch/);
  assert.match(styles, /\.fast-entry-row button\s*\{[\s\S]*?width:\s*8\.4rem/);
});

test("weekly bottle calendar lives in the Days section", () => {
  assert.match(app, /<TabsContent value="entries"[\s\S]*?className="panel week-overview"/);
  assert.match(app, /className="panel week-overview"[\s\S]*?currentWeekDays\.map/);
  assert.match(app, /weekUnits \* documentSettings\.rateKopecks/);
  assert.match(app, /weekEntries\.map\(\(entry\)/);
  assert.match(styles, /\.week-days\s*\{[\s\S]*?grid-template-columns:\s*repeat\(7/);
  assert.match(styles, /\.week-date-native\s*\{[\s\S]*?opacity:\s*0/);
});

test("dark theme is persisted and also updates Android system bars", () => {
  assert.match(app, /arenda-ts-theme-v1/);
  assert.match(styles, /html\[data-theme="dark"\]/);
  assert.match(activity, /public void setTheme\(String theme\)/);
  assert.match(activity, /setStatusBarColor\(statusBar\)/);
  assert.match(activity, /setNavigationBarColor\(background\)/);
});

test("expense category filter updates both the total and visible rows", () => {
  assert.match(app, /const \[expenseFilter, setExpenseFilter\]/);
  assert.match(app, /const filteredExpenses = data\?\.expenses\.filter/);
  assert.match(app, /const filteredExpenseTotal = filteredExpenses\.reduce/);
  assert.match(app, /money\(filteredExpenseTotal\)/);
  assert.match(app, /filteredExpenses\.map\(\(expense\)/);
  assert.match(styles, /\.expense-filter\s*\{[\s\S]*?overflow-x:\s*auto/);
});

test("expense categories can be renamed, added, and deleted in the offline app", () => {
  assert.match(app, /save_expense_categories/);
  assert.match(app, /Категории расходов/);
  assert.match(app, /Добавить свою категорию/);
  assert.match(app, /removeExpenseCategory/);
  assert.match(app, /category: fallbackCategory\.id/);
  assert.doesNotMatch(app, /!category\.builtIn && \(/);
  assert.match(app, /expenseCategories\.map/);
  assert.match(app, /expenseCategoryName\(expense\.category\)/);
});
