import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { createServer } from "vite";
import { documentTools, sampleInput } from "./pdf-fixture.mjs";

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

test("editing quick buttons and completing missing details preserve the saved contract and records", async () => {
  const server = await createServer({ configFile: "offline/vite.config.ts", hmr: false,
    optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true }, appType: "custom" });
  const previousWindow = globalThis.window;
  const tools = documentTools();
  const settings = { ...tools.DEFAULT_DOCUMENT_SETTINGS,
    city: "Сохранённый город", contractNumber: "Сохранённый договор",
    baseKopecks: 7_500_000, includedUnits: 1_800, rateKopecks: 4_500 };
  const original = { version: 6, settings,
    entries: [{ id: 11, entryDate: "2026-09-10", units: 123, note: "Сохранённая запись" }],
    invoices: [{ id: 21, period: "2026-09", invoiceNumber: "С-21", invoiceDate: "2026-09-11",
      kind: "fixed", amountKopecks: 553_500, dueDate: null,
      bottleStartDate: "2026-09-10", bottleEndDate: "2026-09-10", note: "Сохранённый счёт" }],
    payments: [{ id: 31, invoiceId: 21, paymentDate: "2026-09-12", amountKopecks: 200_000,
      method: "bank", documentNumber: "П-31", note: "Частичная оплата" }],
    expenses: [{ id: 41, expenseDate: "2026-09-10", category: "fuel", payer: "customer",
      amountKopecks: 150_000, method: "bank", documentNumber: "Т-41", note: "Топливо заказчика" }],
    closures: [], downtimes: [],
    documents: [{ period: "2026-09", actNumber: "7", reconciliationNumber: "7",
      documentDate: "2026-10-03", asOfDate: "2026-10-03", openingBalanceKopecks: 12_300,
      basis: "Сохранённое основание", adjustments: "" }],
    documentArchive: [{ id: 51, period: "2026-09", kind: "act", number: "7", version: 1,
      generatedAt: "2026-10-03T00:00:00Z", html: "<!doctype html><html><body>Saved act</body></html>",
      inputSnapshot: "{}", pdfUri: "content://media/external/downloads/51" }] };
  const storage = new Map([["arenda-ts-offline-v1", JSON.stringify(original)]]);
  globalThis.window = { localStorage: { getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value) } };
  const read = () => JSON.parse(storage.get("arenda-ts-offline-v1"));
  const recordKeys = ["entries", "invoices", "payments", "expenses", "closures", "downtimes", "documents", "documentArchive"];
  try {
    const { saveOfflineAction } = await server.ssrLoadModule(path.resolve("app/rental-app.tsx"));
    const shortcuts = [{ id: "customer-refuel", title: "Топливо заказчика", category: "fuel",
      payer: "customer", amountKopecks: 150_000 }];

    // Quick buttons remain configurable before the one-time document details are filled in.
    assert.equal(settings.lessorFull, "");
    assert.equal(settings.vehiclePlate, "");
    assert.doesNotThrow(() => saveOfflineAction({ action: "save_expense_shortcuts", shortcuts }));
    assert.deepEqual(read().expenseShortcuts, shortcuts);
    assert.deepEqual(read().settings, settings);
    for (const key of recordKeys) assert.deepEqual(read()[key], original[key], key);

    // Completing details must accept an unused grammatical form and retain old contract terms.
    const filledSettings = { ...sampleInput(tools).settings,
      ...Object.fromEntries(["city", "contractNumber", "contractDate", "rentalStart", "rentalEnd",
        "vehicleModel", "vehicleYear", "vatLabel", "baseKopecks", "includedUnits", "rateKopecks"]
        .map((key) => [key, settings[key]])), lessorDative: "" };
    assert.doesNotThrow(() => saveOfflineAction({ action: "save_settings", settings: filledSettings }));
    assert.deepEqual(read().settings, filledSettings);
    assert.equal(read().settings.lessorDative, "");
    assert.deepEqual(read().expenseShortcuts, shortcuts);
    for (const key of recordKeys) assert.deepEqual(read()[key], original[key], key);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    await server.close();
  }
});
