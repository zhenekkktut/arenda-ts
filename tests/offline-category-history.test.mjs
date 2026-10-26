import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { createServer } from "vite";
import { documentTools } from "./pdf-fixture.mjs";

const KEY = "arenda-ts-offline-v1";
const tools = documentTools();
const categories = [
  { id: "fuel", name: "Топливо", builtIn: true },
  { id: "repair", name: "Ремонт", builtIn: true },
  { id: "other", name: "Прочее", builtIn: true },
  { id: "wash", name: "Мойка", builtIn: false },
];
function fixture(overrides = {}) {
  return { version: 6, settings: { ...tools.DEFAULT_DOCUMENT_SETTINGS },
    entries: [{ id: 1, entryDate: "2026-09-10", units: 2138, note: "Фактический вывоз" }],
    invoices: [{ id: 2, period: "2026-09", invoiceNumber: "28", invoiceDate: "2026-09-26",
      kind: "fixed", amountKopecks: 3_120_000, note: "Сохранённый счёт" }],
    payments: [{ id: 3, invoiceId: 2, paymentDate: "2026-09-27", amountKopecks: 1_000_000,
      method: "bank", documentNumber: "П-3", note: "Сохранённая оплата" }],
    expenses: [{ id: 4, expenseDate: "2026-09-12", category: "fuel", payer: "customer",
      amountKopecks: 1_250_000, method: "bank", documentNumber: "Т-4", note: "Топливо заказчика" },
    { id: 5, expenseDate: "2026-09-13", category: "wash", payer: "self", amountKopecks: 100_000,
      method: "cash", documentNumber: "М-5", note: "Мойка" }],
    expenseCategories: structuredClone(categories),
    expenseShortcuts: [{ id: "customer-fuel", title: "Заправка заказчика", category: "fuel",
      payer: "customer", amountKopecks: 250_000 }],
    closures: [], downtimes: [], documents: [],
    documentArchive: [{ id: 6, period: "2026-09", kind: "act", number: "7", version: 1,
      generatedAt: "2026-10-01T00:00:00Z", html: "<!doctype html><html><body>Saved act</body></html>",
      inputSnapshot: "{}", pdfUri: "content://media/external/downloads/6" }],
    auditLog: [], taxAdjustments: [], taxOptions: [], ...overrides };
}

test("expense category edits preserve fuel history and rental deductions", async (t) => {
  const server = await createServer({ configFile: "offline/vite.config.ts", hmr: false,
    optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true }, appType: "custom" });
  const previousWindow = globalThis.window;
  const storage = new Map();
  globalThis.window = { localStorage: { getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value) } };
  const reset = value => storage.set(KEY, JSON.stringify(value));
  const read = () => JSON.parse(storage.get(KEY));
  try {
    const { saveOfflineAction: save, offlineDashboard, normalizeOfflineStore } =
      await server.ssrLoadModule(path.resolve("app/rental-app.tsx"));
    const charge = () => {
      const data = offlineDashboard("2026-09");
      return tools.calculateSettlement("2026-09", tools.calculateRental("2026-09", data.entries,
        data.downtimes, data.settings), data.invoices, data.expenses);
    };
    const unchangedLedger = original => {
      for (const key of ["entries", "invoices", "payments", "expenses", "closures", "downtimes",
        "documents", "documentArchive", "settings", "expenseShortcuts", "taxAdjustments", "taxOptions"]) {
        assert.deepEqual(read()[key], original[key], key);
      }
    };
    await t.test("removing fuel is rejected before any historical expense or shortcut changes", () => {
      const original = fixture(); reset(original);
      assert.equal(offlineDashboard("2026-10").expenses.length, 0, "Current month has no expense rows");
      const before = storage.get(KEY), settlement = charge();
      assert.equal(settlement.netRentKopecks, 7_300_000);
      assert.throws(() => save({ action: "save_expense_categories",
        categories: categories.filter(row => row.id !== "fuel") }), /Топливо нужно для расчёта аренды/);
      assert.equal(storage.get(KEY), before, "A rejected edit must leave the complete saved JSON unchanged");
      assert.deepEqual(charge(), settlement);
      unchangedLedger(original);
    });
    await t.test("fuel cannot disappear from an empty new phone either", () => {
      const original = fixture({ entries: [], invoices: [], payments: [], expenses: [], documentArchive: [] });
      reset(original); const before = storage.get(KEY);
      assert.throws(() => save({ action: "save_expense_categories",
        categories: [{ id: "other", name: "Все расходы" }] }), /Топливо нужно для расчёта аренды/);
      assert.equal(storage.get(KEY), before);
    });
    await t.test("fuel can be renamed without changing its semantic ID, payer or calculation", () => {
      const original = fixture(); reset(original); const before = charge();
      save({ action: "save_expense_categories", categories: categories.map(row =>
        row.id === "fuel" ? { ...row, name: "Дизель" } : row) });
      assert.equal(read().expenseCategories.find(row => row.id === "fuel").name, "Дизель");
      assert.deepEqual(charge(), before);
      unchangedLedger(original);
    });
    await t.test("deleting an ordinary category keeps the existing fallback behavior and fuel intact", () => {
      const original = fixture(); reset(original); const before = charge();
      save({ action: "save_expense_categories", categories: categories.filter(row => row.id !== "wash") });
      assert.equal(read().expenses.find(row => row.id === 5).category, "other");
      assert.deepEqual(read().expenses.find(row => row.id === 4), original.expenses.find(row => row.id === 4));
      assert.deepEqual(charge(), before);
    });
    await t.test("older backups without a category list retain fuel records through JSON round trips", () => {
      const original = fixture({ version: 5 }); delete original.expenseCategories; delete original.expenseShortcuts;
      reset(original); const before = storage.get(KEY);
      const normalized = normalizeOfflineStore(read());
      assert.equal(storage.get(KEY), before, "Reading an old backup does not rewrite the original JSON");
      assert.ok(normalized.expenseCategories.some(row => row.id === "fuel"));
      assert.deepEqual(normalized.expenses, original.expenses);
      const roundTrip = normalizeOfflineStore(JSON.parse(JSON.stringify(normalized)));
      assert.deepEqual(roundTrip.expenses, original.expenses);
      assert.deepEqual(roundTrip.documentArchive, original.documentArchive);
    });
    await t.test("a legacy category list without fuel regains the option without rewriting old expense identities", () => {
      const original = fixture({ version: 5,
        expenseCategories: [{ id: "other", name: "Разное", builtIn: true },
          { id: "wash", name: "Моя мойка", builtIn: false }] });
      reset(original); const before = storage.get(KEY);
      const normalized = normalizeOfflineStore(read());
      assert.equal(storage.get(KEY), before);
      assert.deepEqual(normalized.expenseCategories.map(row => ({ id: row.id, name: row.name })), [
        { id: "fuel", name: "Топливо" }, { id: "other", name: "Разное" }, { id: "wash", name: "Моя мойка" }]);
      assert.deepEqual(normalized.expenses, original.expenses);
      save({ action: "save_entry", entryDate: "2026-10-10", units: 0, note: "Новая запись" });
      assert.ok(read().expenseCategories.some(row => row.id === "fuel"));
      for (const key of ["invoices", "payments", "expenses", "documentArchive", "settings"]) {
        assert.deepEqual(read()[key], original[key], key);
      }
      const roundTrip = normalizeOfflineStore(JSON.parse(JSON.stringify(read())));
      assert.deepEqual(roundTrip.expenses, original.expenses);
      assert.ok(roundTrip.expenseCategories.some(row => row.id === "fuel"));
    });
  } finally {
    if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
    await server.close();
  }
});
