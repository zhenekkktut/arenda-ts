import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { createServer } from "vite";

test("phone backup migration and expense shortcut edits preserve records and saved choices", async () => {
  const server = await createServer({ configFile: "offline/vite.config.ts", hmr: false,
    optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true }, appType: "custom" });
  const storage = new Map();
  const previousWindow = globalThis.window;
  globalThis.window = { localStorage: { getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value) } };
  try {
    const { saveOfflineAction } = await server.ssrLoadModule(path.resolve("app/rental-app.tsx"));
    const entry = { id: 1, entryDate: "2026-08-01", units: 100, note: "старые данные" };
    const invoice = { id: 1, period: "2026-08", invoiceNumber: "27", invoiceDate: "2026-09-08",
      kind: "fixed", amountKopecks: 5_000_000, dueDate: null, note: "старый счёт" };
    storage.set("arenda-ts-offline-v1", JSON.stringify({ version: 5,
      entries: [entry], invoices: [invoice], payments: [], expenses: [], closures: [] }));
    const read = () => JSON.parse(storage.get("arenda-ts-offline-v1"));

    saveOfflineAction({ action: "save_entry", entryDate: "2026-08-02", units: 110, note: "" });
    assert.equal(read().version, 6);
    assert.deepEqual(read().entries.find((row) => row.id === entry.id), entry);
    assert.deepEqual(read().invoices, [invoice]);
    assert.deepEqual(read().expenseShortcuts.map(({ id, category, payer }) => ({ id, category, payer })), [
      { id: "fuel-customer", category: "fuel", payer: "customer" },
      { id: "fuel-self", category: "fuel", payer: "self" },
      { id: "repair-self", category: "repair", payer: "self" },
    ]);

    const categories = [{ id: "fuel", name: "Топливо" }, { id: "repair", name: "Ремонт" },
      { id: "wash", name: "Мойка" }];
    saveOfflineAction({ action: "save_expense_categories", categories });
    const shortcuts = [
      { id: "my-wash", title: " Моя мойка ", category: "wash", payer: "self", amountKopecks: 150_000 },
      { id: "customer-fuel", title: "Заправка заказчика", category: "fuel", payer: "customer", amountKopecks: 250_000 },
    ];
    saveOfflineAction({ action: "save_expense_shortcuts", shortcuts });
    const savedShortcuts = [{ ...shortcuts[0], title: "Моя мойка" }, shortcuts[1]];
    assert.deepEqual(read().expenseShortcuts, savedShortcuts);

    // A backup JSON round trip and an unrelated edit keep the saved shortcut configuration.
    storage.set("arenda-ts-offline-v1", JSON.stringify(read()));
    saveOfflineAction({ action: "save_entry", entryDate: "2026-08-03", units: 120, note: "" });
    assert.deepEqual(read().expenseShortcuts, savedShortcuts);

    saveOfflineAction({ action: "save_expense_shortcuts", shortcuts: [] });
    saveOfflineAction({ action: "save_entry", entryDate: "2026-08-04", units: 130, note: "" });
    assert.deepEqual(read().expenseShortcuts, []);

    saveOfflineAction({ action: "save_expense_shortcuts", shortcuts });
    saveOfflineAction({ action: "save_expense_categories", categories: categories.filter(({ id }) => id !== "wash") });
    assert.deepEqual(read().expenseShortcuts, [shortcuts[1]]);
    assert.deepEqual(read().entries.find((row) => row.id === entry.id), entry);
    assert.deepEqual(read().invoices, [invoice]);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    await server.close();
  }
});
