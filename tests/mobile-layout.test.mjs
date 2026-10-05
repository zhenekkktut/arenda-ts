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
  assert.match(app, /<Dialog open=\{quickEntryOpen\}[\s\S]*?type="date"/);
  assert.match(app, /min=\{monthBounds\.start\}/);
  assert.match(app, /const followingDate = nextIsoDate\(entryDate\)/);
  assert.match(app, /selectEntryDate\(followingDate\)/);
  assert.doesNotMatch(app, /entryOptionsOpen/);
});

test("quick entry is available in the dialog without a duplicate Home form", () => {
  assert.doesNotMatch(app, /quick-entry-primary|fast-entry-form|entryUnitsRef/);
  assert.match(app, /<Dialog open=\{quickEntryOpen\}[\s\S]*?className="dialog-form quick-entry-dialog-form"/);
  assert.match(app, /ref=\{quickEntryUnitsRef\}/);
});

test("quick entry opens from the center action while calendar days open their details", () => {
  assert.match(app, /className="app-tabs grid h-auto w-full grid-cols-5/);
  assert.match(app, /className="app-quick-action"/);
  assert.match(app, /<Dialog open=\{quickEntryOpen\}/);
  assert.match(app, /onClick=\{\(\) => openDayDetails\(day\.date\)\}/);
  assert.match(app, /setMonthCalendarOpen\(false\); openDayDetails\(day\.date\)/);
  assert.match(styles, /\.app-quick-action > span\s*\{[\s\S]*?border-radius:\s*999px/);
});

test("calendar details expose bottle, expense and explicit no-trip actions with readable status", () => {
  const card = app.split("<Dialog open={dayDetailsOpen}")[1]?.split("<Dialog open={quickEntryOpen}")[0];
  assert.ok(card, "The selected date needs its own action dialog");
  assert.match(card, /className="calendar-day-status"[\s\S]*?selectedEntry\.units/);
  assert.match(card, /selectedEntry \? "Изменить бутыли" : "Записать бутыли"/);
  assert.match(card, /disabled=\{selectedDowntime\?\.kind === "no_trip"\}/);
  assert.match(card, /openDowntime\(selectedDowntime, entryDate\)/);
  assert.match(card, /Без выезда — простой/);
  assert.match(card, /action: "delete_downtime_day", date: entryDate/);
  assert.match(card, /openExpense\(entryDate\)/);
  assert.match(card, /Добавить расход за день/);
  assert.match(styles, /\.calendar-day-actions button[\s\S]*?min-height:\s*2\.75rem/);
  assert.match(app, /Пустая дата сама простоем не считается/);
});

test("theme control lives in settings and destructive edits can be undone", () => {
  assert.doesNotMatch(app, /className="theme-button"/);
  assert.match(app, /className="settings-section theme-settings-row"/);
  assert.match(app, /value=\{themeMode\}/);
  assert.match(app, /value="system">Как на телефоне/);
  assert.match(app, /label:\s*"Отменить"/);
  assert.match(app, /duration:\s*8_000/);
});

test("invoice texts open in a separate compact dialog", () => {
  assert.match(app, /setTextInvoice\(invoice\)/);
  assert.match(app, /<Dialog open=\{Boolean\(textInvoice\)\}/);
  assert.doesNotMatch(app, /<details className="copy-details">/);
  assert.match(app, /Направляю счёт №/);
  assert.doesNotMatch(app, /по субаренде/);
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

test("modern dashboard highlights missing days and protects month closing", () => {
  assert.match(app, /const missingMonthDays = useMemo/);
  assert.match(app, /className="missing-days-callout(?: [^"]*)?"/);
  assert.match(app, /open=\{closeMonthOpen\}/);
  assert.match(app, /Проверка перед закрытием/);
  assert.match(app, /month-close-checklist/);
  assert.match(styles, /\.missing-days-callout/);
});

test("weekly view includes visual bars and direct missing-day entry", () => {
  assert.match(app, /className="week-day-chart"/);
  assert.match(app, /day\.missing \? "week-day-missing"/);
  assert.match(app, /className="week-missing-action"/);
  assert.match(styles, /\.week-day-chart i\s*\{[\s\S]*?transition:\s*height/);
});

test("expenses include category visualization and quick templates", () => {
  assert.match(app, /const expenseBreakdown = useMemo/);
  assert.match(app, /className="expense-donut"/);
  assert.match(app, /Топливо заказчика/);
  assert.match(app, /expenseShortcuts\.map/);
  assert.match(app, /openExpenseTemplate\(shortcut\)/);
  assert.match(styles, /\.expense-donut\s*\{/);
});

test("offline app stores audit history and reminds about backups", () => {
  assert.match(app, /type AuditEvent/);
  assert.match(app, /appendAudit\(store/);
  assert.match(app, /История изменений/);
  assert.match(app, /arenda-ts-last-backup-v1/);
  assert.match(app, /Резервная копия старше недели/);
});
