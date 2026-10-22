import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { createServer } from "vite";
import { documentTools } from "./pdf-fixture.mjs";

const KEY = "arenda-ts-offline-v1";
const tools = documentTools();

function fixture(overrides = {}) {
  const store = {
    version: 6,
    settings: { ...tools.DEFAULT_DOCUMENT_SETTINGS,
      rentalStart: "2026-09-01", rentalEnd: "2026-10-31" },
    entries: [{ id: 1, entryDate: "2026-10-01", units: 110, note: "Сохранённая доставка" }],
    invoices: [{ id: 2, period: "2026-10", invoiceNumber: "32", invoiceDate: "2026-10-02",
      kind: "fixed", amountKopecks: 400_000, dueDate: null, note: "Сохранённый счёт" }],
    payments: [{ id: 3, invoiceId: 2, paymentDate: "2026-10-02", amountKopecks: 200_000,
      method: "bank", documentNumber: "П-32", note: "Частичная оплата" }],
    expenses: [{ id: 4, expenseDate: "2026-10-01", category: "fuel", payer: "customer",
      amountKopecks: 150_000, method: "bank", documentNumber: "Т-4", note: "Заправка" }],
    closures: [],
    downtimes: [{ id: 5, kind: "technical", startDate: "2026-10-06", endDate: "2026-10-06",
      reason: "Ремонт", basis: "Согласовано", note: "Сохранённый простой" }],
    documents: [{ period: "2026-10", actNumber: "8", reconciliationNumber: "8",
      documentDate: "2026-11-01", asOfDate: "2026-11-01", openingBalanceKopecks: 0,
      basis: "Сохранённое основание", adjustments: "" }],
    documentArchive: [{ id: 6, period: "2026-10", kind: "act", number: "8", version: 1,
      generatedAt: "2026-11-01T00:00:00Z", html: "<!doctype html><html><body>Saved act</body></html>",
      inputSnapshot: "{}", pdfUri: "content://media/external/downloads/6" }],
    auditLog: [],
    taxAdjustments: [{ id: 7, date: "2026-10-02", kind: "tax_paid", amountKopecks: 123_456,
      note: "Старые налоговые данные" }],
    taxOptions: [{ year: 2026, deductionKopecks: 12_345, hasWorkers: false }],
    ...overrides,
  };
  return store;
}

test("optional Saturday days off persist without changing the phone ledger or rental calculation", async (t) => {
  const server = await createServer({ configFile: "offline/vite.config.ts", hmr: false,
    optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true }, appType: "custom" });
  const storage = new Map();
  const previousWindow = globalThis.window;
  globalThis.window = { localStorage: {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  } };
  const reset = (store = fixture()) => storage.set(KEY, JSON.stringify(store));
  const read = () => JSON.parse(storage.get(KEY));
  const ledgerKeys = ["entries", "invoices", "payments", "expenses", "closures", "downtimes",
    "documents", "documentArchive", "settings", "taxAdjustments", "taxOptions"];

  try {
    const { saveOfflineAction: save, offlineDashboard, normalizeOfflineStore } =
      await server.ssrLoadModule(path.resolve("app/rental-app.tsx"));
    const { missingEntryDates, isRestDate } =
      await server.ssrLoadModule(path.resolve("app/workflow-tools.ts"));
    const missing = (period = "2026-10", today = "2026-10-10") => {
      const data = offlineDashboard(period);
      return missingEntryDates(period, today, data.settings, data.entries, data.downtimes,
        data.restDates);
    };
    const rejectWithoutWrite = (payload) => {
      const before = storage.get(KEY);
      assert.throws(() => save(payload));
      assert.equal(storage.get(KEY), before, "A rejected selection must not change saved phone data");
    };

    await t.test("old backups read without a rewrite and unrelated saves retain the default Sunday schedule", () => {
      const original = fixture();
      reset(original);
      const encoded = storage.get(KEY);
      assert.deepEqual(offlineDashboard("2026-10").restDates, []);
      assert.equal(storage.get(KEY), encoded);
      assert.equal(missing().includes("2026-10-03"), true);
      assert.equal(missing().includes("2026-10-04"), false);
      assert.equal(isRestDate("2026-10-04"), true);
      const normalized = normalizeOfflineStore(JSON.parse(encoded));
      assert.deepEqual(normalized.restDates, []);
      assert.equal(Object.hasOwn(original, "restDates"), false);
      storage.set(KEY, JSON.stringify(normalized));
      save({ action: "save_entry", entryDate: "2026-10-02", units: 120, note: "Новая доставка" });
      assert.deepEqual(read().restDates, []);
      for (const key of ledgerKeys.filter((value) => value !== "entries")) {
        assert.deepEqual(read()[key], original[key], key);
      }
    });

    await t.test("only the selected Saturday stops requiring a record; rent and saved documents remain unchanged", () => {
      const original = fixture();
      reset(original);
      const beforeRental = tools.calculateRental("2026-10", original.entries, original.downtimes,
        original.settings);
      const beforeSettlement = tools.calculateSettlement("2026-10", beforeRental,
        original.invoices, original.expenses);
      save({ action: "set_rest_day", date: "2026-10-03", rest: true });
      const selected = read();
      assert.deepEqual(selected.restDates, ["2026-10-03"]);
      assert.equal(missing().includes("2026-10-03"), false);
      assert.equal(missing().includes("2026-10-10"), true);
      assert.equal(missing().includes("2026-10-04"), false);
      for (const key of ledgerKeys) assert.deepEqual(selected[key], original[key], key);
      const afterRental = tools.calculateRental("2026-10", selected.entries, selected.downtimes,
        selected.settings);
      assert.deepEqual(afterRental, beforeRental);
      assert.deepEqual(tools.calculateSettlement("2026-10", afterRental,
        selected.invoices, selected.expenses), beforeSettlement);
      save({ action: "set_rest_day", date: "2026-10-03", rest: true });
      assert.deepEqual(read().restDates, ["2026-10-03"], "Repeated selection must not duplicate a date");
      save({ action: "set_rest_day", date: "2026-10-03", rest: false });
      assert.deepEqual(read().restDates, []);
      assert.equal(missing().includes("2026-10-03"), true);
      for (const key of ledgerKeys) assert.deepEqual(read()[key], original[key], key);
    });

    await t.test("invalid selections are rejected atomically, including Sunday and dates outside the lease", () => {
      reset();
      for (const date of ["2026-10-04", "2026-10-05", "2026-08-29", "2026-11-07",
        "2026-02-30", "2026-10-32", "2026-2-03", "", undefined, null]) {
        rejectWithoutWrite({ action: "set_rest_day", date, rest: true });
      }
      for (const rest of [undefined, null, 0, 1, "true", "false", [], {}]) {
        rejectWithoutWrite({ action: "set_rest_day", date: "2026-10-03", rest });
      }
    });

    await t.test("a Saturday with actual deliveries cannot be marked as a day off, but a zero record can", () => {
      const original = fixture({ entries: [
        { id: 1, entryDate: "2026-10-03", units: 145, note: "Фактический выезд" },
        { id: 2, entryDate: "2026-10-10", units: 0, note: "Нулевая запись" },
      ] });
      reset(original);
      rejectWithoutWrite({ action: "set_rest_day", date: "2026-10-03", rest: true });
      save({ action: "set_rest_day", date: "2026-10-10", rest: true });
      assert.deepEqual(read().restDates, ["2026-10-10"]);
      assert.deepEqual(read().entries, original.entries);
    });

    await t.test("actual entries saved or imported after the selection stay intact and the selection can be removed", () => {
      reset(fixture({ restDates: ["2026-10-03", "2026-10-10"] }));
      save({ action: "save_entry", entryDate: "2026-10-03", units: 145, note: "Выезд состоялся" });
      save({ action: "import_entries", entries: [
        { entryDate: "2026-10-10", units: 155, note: "Импорт фактической доставки" },
      ] });
      const stored = read();
      assert.deepEqual(stored.restDates, ["2026-10-03", "2026-10-10"]);
      assert.equal(stored.entries.find((row) => row.entryDate === "2026-10-03").units, 145);
      assert.equal(stored.entries.find((row) => row.entryDate === "2026-10-10").units, 155);
      assert.equal(stored.downtimes.some((row) => row.kind === "no_trip"), false);
      save({ action: "set_rest_day", date: "2026-10-03", rest: false });
      assert.deepEqual(read().restDates, ["2026-10-10"]);
      assert.deepEqual(read().entries, stored.entries);
    });

    await t.test("backup normalization removes malformed duplicates and a JSON restore retains valid dates across months", () => {
      const source = fixture({ restDates: ["2026-10-10", "2026-09-26", "2026-10-03",
        "2026-10-03", "2026-02-30", "2026-13-01", "2026-2-03", "", null, 20261017, {}] });
      const unchanged = structuredClone(source);
      const normalized = normalizeOfflineStore(JSON.parse(JSON.stringify(source)));
      assert.deepEqual(source, unchanged);
      assert.deepEqual(normalized.restDates, ["2026-09-26", "2026-10-03", "2026-10-10"]);
      for (const key of ledgerKeys) assert.deepEqual(normalized[key], source[key], key);
      reset(normalized);
      assert.deepEqual(offlineDashboard("2026-09").restDates, ["2026-09-26"]);
      assert.deepEqual(offlineDashboard("2026-10").restDates, ["2026-10-03", "2026-10-10"]);
      assert.deepEqual(offlineDashboard("2026-11").restDates, []);
      const backup = JSON.stringify(read());
      reset(normalizeOfflineStore(JSON.parse(backup)));
      save({ action: "set_rest_day", date: "2026-10-10", rest: false });
      assert.deepEqual(read().restDates, ["2026-09-26", "2026-10-03"]);
      for (const key of ledgerKeys) assert.deepEqual(read()[key], source[key], key);
    });
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    await server.close();
  }
});
