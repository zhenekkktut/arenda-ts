import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { documentTools } from "./pdf-fixture.mjs";
import { createServer } from "vite";

test("old phone records survive migration and one bank payment is allocated without duplication", async () => {
  const server = await createServer({ configFile: "offline/vite.config.ts", hmr: false,
    optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true }, appType: "custom" });
  const storage = new Map();
  globalThis.window = { localStorage: { getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value) } };
  try {
    const { saveOfflineAction } = await server.ssrLoadModule(path.resolve("app/rental-app.tsx"));
    storage.set("arenda-ts-offline-v1", JSON.stringify({ version: 5,
      entries: [{ id: 1, entryDate: "2026-08-01", units: 100, note: "" }],
      invoices: [{ id: 1, period: "2026-08", invoiceNumber: "27", invoiceDate: "2026-09-08", kind: "fixed", amountKopecks: 5_000_000, dueDate: null, note: "" },
        { id: 2, period: "2026-08", invoiceNumber: "28", invoiceDate: "2026-09-08", kind: "variable", amountKopecks: 6_200_000, dueDate: null, note: "" }],
      payments: [], expenses: [], closures: [] }));
    saveOfflineAction({ action: "create_payment_split", paymentDate: "2026-09-10", amountKopecks: 3_500_000,
      method: "bank", documentNumber: "ПП-1", note: "", allocations: [
        { invoiceId: 1, amountKopecks: 2_000_000 }, { invoiceId: 2, amountKopecks: 1_500_000 }] });
    const read = () => JSON.parse(storage.get("arenda-ts-offline-v1"));
    assert.equal(read().version, 6);
    assert.equal(read().entries[0].units, 100);
    assert.equal(read().payments.length, 2);
    assert.equal(read().payments.reduce((sum, p) => sum + p.amountKopecks, 0), 3_500_000);
    assert.equal(new Set(read().payments.map((p) => p.groupId)).size, 1);
    assert.equal(read().settings.contractNumber, "002-АР/2026");
    assert.equal(read().invoices[0].bottleStartDate, undefined);
    saveOfflineAction({ action: "update_invoice", id: 1, period: "2026-08", invoiceNumber: "27",
      invoiceDate: "2026-09-08", kind: "fixed", amountKopecks: 5_000_000, dueDate: "", note: "старый счёт" });
    assert.equal(read().invoices.find((invoice) => invoice.id === 1).note, "старый счёт");
    assert.equal(read().invoices.find((invoice) => invoice.id === 1).bottleStartDate, undefined);
    saveOfflineAction({ action: "create_invoice", period: "2026-08", invoiceNumber: "29",
      invoiceDate: "2026-08-06", kind: "fixed", amountKopecks: 1_200_000,
      bottleStartDate: "2026-08-04", bottleEndDate: "2026-08-06", dueDate: "", note: "" });
    assert.equal(read().invoices.find((invoice) => invoice.invoiceNumber === "29").bottleEndDate, "2026-08-06");
    assert.throws(() => saveOfflineAction({ action: "create_invoice", period: "2026-08", invoiceNumber: "30",
      invoiceDate: "2026-08-07", kind: "fixed", amountKopecks: 100_000,
      bottleStartDate: "2026-08-06", bottleEndDate: "2026-08-07", dueDate: "", note: "" }),
    /не должны пересекаться/);
    assert.equal(read().invoices.length, 3);
    saveOfflineAction({ action: "create_invoice", period: "2026-08", invoiceNumber: "30",
      invoiceDate: "2026-08-07", kind: "variable", amountKopecks: 100_000,
      bottleStartDate: "2026-08-04", bottleEndDate: "2026-08-06", dueDate: "", note: "" });
    assert.equal(read().invoices.length, 4);
    saveOfflineAction({ action: "create_invoice", period: "2026-08", invoiceNumber: "32",
      invoiceDate: "2026-08-08", kind: "fixed", amountKopecks: 100_000,
      bottleStartDate: "2026-08-07", bottleEndDate: "2026-08-09", dueDate: "", note: "" });
    saveOfflineAction({ action: "update_invoice", id: read().invoices.find((invoice) => invoice.invoiceNumber === "30").id,
      period: "2026-08", invoiceNumber: "30", invoiceDate: "2026-08-10", kind: "variable", amountKopecks: 100_000,
      bottleStartDate: "2026-08-04", bottleEndDate: "2026-08-09", dueDate: "", note: "" });
    assert.equal(read().invoices.find((invoice) => invoice.invoiceNumber === "30").bottleEndDate, "2026-08-09");
    assert.throws(() => saveOfflineAction({ action: "create_invoice", period: "2026-08", invoiceNumber: "31",
      invoiceDate: "2026-08-07", kind: "variable", amountKopecks: 100_000,
      bottleStartDate: "2026-08-05", bottleEndDate: "2026-08-07", dueDate: "", note: "" }),
    /не должны пересекаться/);
    assert.throws(() => saveOfflineAction({ action: "create_payment_split", paymentDate: "2026-09-10",
      amountKopecks: 4_000_000, method: "bank", allocations: [
        { invoiceId: 1, amountKopecks: 2_000_000 }, { invoiceId: 2, amountKopecks: 1_500_000 }] }));
    assert.equal(read().payments.length, 2);
    saveOfflineAction({ action: "archive_document", document: { id: 9, period: "2026-08", kind: "act", number: "1",
      version: 1, generatedAt: "2026-09-15T00:00:00Z", inputSnapshot: "{}", html: "<!doctype html><html></html>" } });
    saveOfflineAction({ action: "save_entry", entryDate: "2026-08-01", units: 110, note: "изменено" });
    assert.equal(read().entries[0].units, 110);
    assert.equal(read().documentArchive[0].version, 1);
  } finally { delete globalThis.window; await server.close(); }
});

test("old net invoices deduct fuel before invoicing and later payments settle the opening debt", async () => {
  const server = await createServer({ configFile: "offline/vite.config.ts", hmr: false,
    optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true }, appType: "custom" });
  const tools = documentTools();
  const store = { version: 5, settings: tools.DEFAULT_DOCUMENT_SETTINGS,
    entries: [{ id: 1, entryDate: "2026-08-01", units: 3100, note: "" },
      { id: 2, entryDate: "2026-09-10", units: 2138, note: "" }],
    invoices: [
      { id: 1, period: "2026-08", invoiceNumber: "A1", invoiceDate: "2026-09-08", kind: "fixed", amountKopecks: 3500000 },
      { id: 2, period: "2026-08", invoiceNumber: "A2", invoiceDate: "2026-08-01", kind: "other", amountKopecks: 5000000 },
      { id: 3, period: "2026-08", invoiceNumber: "A3", invoiceDate: "2026-08-30", kind: "fixed", amountKopecks: 2700000 },
      { id: 4, period: "2026-09", invoiceNumber: "S1", invoiceDate: "2026-09-26", kind: "fixed", amountKopecks: 3120000 },
      { id: 5, period: "2026-09", invoiceNumber: "S2", invoiceDate: "2026-10-01", kind: "fixed", amountKopecks: 1230000 },
      { id: 6, period: "2026-09", invoiceNumber: "S3", invoiceDate: "2026-10-01", kind: "variable", amountKopecks: 2952000 }],
    expenses: [{ id: 1, expenseDate: "2026-08-01", category: "fuel", payer: "customer", amountKopecks: 1200000 },
      { id: 2, expenseDate: "2026-09-12", category: "fuel", payer: "customer", amountKopecks: 1250000 },
      { id: 3, expenseDate: "2026-09-13", category: "repair", payer: "self", amountKopecks: 500000 }],
    payments: [
      { id: 1, invoiceId: 1, paymentDate: "2026-09-08", amountKopecks: 3500000 },
      { id: 2, invoiceId: 2, paymentDate: "2026-09-22", amountKopecks: 5000000 },
      { id: 3, invoiceId: 3, paymentDate: "2026-09-30", amountKopecks: 2700000 },
      { id: 4, invoiceId: 4, paymentDate: "2026-09-26", amountKopecks: 3120000 }],
    downtimes: [{ id: 1, startDate: "2026-09-01", endDate: "2026-09-09", reason: "Простой", note: "" }],
    closures: [], documents: [] };
  let stored = JSON.stringify(store);
  globalThis.window = { localStorage: { getItem: (key) => key === "arenda-ts-offline-v1" ? stored : null,
    setItem: (key, value) => { if (key === "arenda-ts-offline-v1") stored = value; } } };
  try {
    const { offlineDashboard, saveOfflineAction } = await server.ssrLoadModule(path.resolve("app/rental-app.tsx"));
    for (const period of ["2026-08", "2026-09"]) {
      const data = offlineDashboard(period);
      const calculation = tools.calculateRental(period, data.entries, data.downtimes, data.settings);
      const settlement = tools.calculateSettlement(period, calculation, data.invoices, data.expenses);
      assert.equal(settlement.remainingToInvoiceKopecks, 0);
      assert.equal(settlement.fixedRemainingKopecks, 0);
      assert.equal(settlement.variableRemainingKopecks, 0);
      assert.equal(settlement.netRentKopecks, period === "2026-08" ? 11200000 : 7300000);
      const input = { ...data, calculation, meta: { ...data.documentMeta, documentDate: "2026-10-02", asOfDate: "2026-10-02" } };
      const summary = tools.reconciliationSummary(input);
      assert.equal(summary.balance, period === "2026-08" ? 0 : 4180000);
      const html = tools.buildReconciliationHtml(input);
      const daily = html.split('class="reconciliation-daily"')[1];
      assert.match(daily, period === "2026-08" ? /01\.08\.2026/ : /10\.09\.2026/);
      assert.match(daily, period === "2026-08" ? /3[\s ]100/ : /2[\s ]138/);
      if (period === "2026-09") {
        assert.equal(summary.opening, 11200000);
        assert.equal(summary.openingPaidKopecks, 11200000);
        assert.match(html, /погашение задолженности за предыдущие месяцы/);
        const historical = tools.reconciliationSummary({ ...input, meta: { ...input.meta, asOfDate: "2026-09-16" } });
        assert.equal(historical.openingPaidKopecks, 3500000);
      }
    }
    const migrated = JSON.parse(stored);
    assert.equal(migrated.invoices[0].amountKopecks, 3500000);
    assert.equal(migrated.invoices[0].bottleStartDate, undefined);
    assert.equal(migrated.entries.length, 2);
    store.documents = [tools.defaultDocumentMeta("2026-09", 2, "2026-09-16")];
    stored = JSON.stringify(store);
    const original = stored;
    const zeroOpeningData = offlineDashboard("2026-09");
    assert.equal(zeroOpeningData.documentMeta.openingBalanceKopecks, 0);
    assert.equal(stored, original, "Dashboard must not change the saved phone data");
    const zeroInput = { ...zeroOpeningData,
      calculation: tools.calculateRental("2026-09", zeroOpeningData.entries, zeroOpeningData.downtimes, zeroOpeningData.settings),
      meta: { ...zeroOpeningData.documentMeta, documentDate: "2026-10-02", asOfDate: "2026-10-02" } };
    const zeroSummary = tools.reconciliationSummary(zeroInput);
    assert.equal(zeroSummary.opening, 0);
    assert.equal(zeroSummary.openingPaidKopecks, 0);
    assert.equal(zeroSummary.paidKopecks, 3120000);
    assert.equal(zeroSummary.balance, 4180000);
    const zeroHtml = tools.buildReconciliationHtml(zeroInput);
    assert.match(zeroHtml, /Поступившие платежи<\/td><td class="value">−31[\s ]200,00/);
    assert.doesNotMatch(zeroHtml, /143[\s ]200|погашение задолженности за предыдущие месяцы/);
    saveOfflineAction({ action: "save_document_meta", ...zeroInput.meta });
    assert.equal(offlineDashboard("2026-09").documentMeta.openingBalanceKopecks, 0);
    const saved = JSON.parse(stored);
    assert.deepEqual(saved.payments, store.payments);
    assert.deepEqual(saved.invoices, store.invoices);
    assert.deepEqual(saved.entries, store.entries);
  } finally { delete globalThis.window; await server.close(); }
});

test("saved mid-month dates cannot mix a full month with partial settlements after an unpaid invoice is removed", async () => {
  const server = await createServer({ configFile: "offline/vite.config.ts", hmr: false,
    optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true }, appType: "custom" });
  const tools = documentTools();
  const entries = [["10", 174], ["11", 155], ["12", 76], ["14", 117], ["15", 133],
    ["16", 125], ["17", 145], ["18", 255], ["22", 116], ["23", 146], ["24", 152],
    ["25", 116], ["28", 161], ["29", 149], ["30", 118]]
    .map(([day, units], index) => ({ id: index + 1, entryDate: `2026-09-${day}`, units, note: "" }));
  const expenses = [["12", 277000], ["18", 354000], ["23", 354000], ["28", 265000]]
    .map(([day, amountKopecks], index) => ({ id: index + 1, expenseDate: `2026-09-${day}`,
      category: "fuel", payer: "customer", amountKopecks }));
  const store = { version: 5, settings: tools.DEFAULT_DOCUMENT_SETTINGS, entries, expenses,
    invoices: [
      { id: 1, period: "2026-09", invoiceNumber: "S1", invoiceDate: "2026-09-26", kind: "fixed",
        amountKopecks: 3120000, bottleStartDate: "2026-09-10", bottleEndDate: "2026-09-16" },
      { id: 2, period: "2026-09", invoiceNumber: "S2", invoiceDate: "2026-10-01", kind: "fixed", amountKopecks: 1230000 },
      { id: 3, period: "2026-09", invoiceNumber: "S3", invoiceDate: "2026-10-01", kind: "variable", amountKopecks: 2952000 }],
    payments: [
      { id: 1, invoiceId: 1, paymentDate: "2026-09-26", amountKopecks: 3120000 },
      { id: 2, invoiceId: 2, paymentDate: "2026-10-02", amountKopecks: 1230000 }],
    downtimes: [{ id: 1, startDate: "2026-09-01", endDate: "2026-09-09", reason: "Простой", note: "" }],
    closures: [], documents: [{ ...tools.defaultDocumentMeta("2026-09", 2, "2026-09-16"), asOfDate: "2026-09-16" }] };
  let stored = JSON.stringify(store);
  globalThis.window = { localStorage: { getItem: (key) => key === "arenda-ts-offline-v1" ? stored : null,
    setItem: (key, value) => { if (key === "arenda-ts-offline-v1") stored = value; } } };
  try {
    const { offlineDashboard, saveOfflineAction } = await server.ssrLoadModule(path.resolve("app/rental-app.tsx"));
    saveOfflineAction({ action: "delete_invoice", id: 3 });
    assert.deepEqual(JSON.parse(stored).payments, store.payments,
      "Removing the unpaid invoice must not remove receipts for the other invoices");
    const data = offlineDashboard("2026-09");
    assert.equal(data.documentMeta.openingBalanceKopecks, 0);
    assert.equal(data.documentMeta.documentDate, "2026-09-16");
    assert.equal(data.documentMeta.asOfDate, "2026-09-16");
    const calculation = tools.calculateRental("2026-09", data.entries, data.downtimes, data.settings);
    assert.equal(calculation.actualUnits, 2138);
    assert.equal(calculation.totalKopecks, 8552000);
    const staleInput = { ...data, calculation, meta: data.documentMeta };
    const beforeReject = stored;
    assert.throws(() => tools.buildReconciliationHtml(staleInput));
    assert.equal(stored, beforeReject, "Rejecting an inconsistent date must not rewrite old phone records");
    const input = { ...staleInput, meta: { ...data.documentMeta, documentDate: "2026-10-03", asOfDate: "2026-10-03" } };
    const summary = tools.reconciliationSummary(input);
    const settlement = tools.calculateSettlement("2026-09", calculation, data.invoices, data.expenses);
    assert.equal(summary.opening, 0);
    assert.equal(summary.openingPaidKopecks, 0);
    assert.equal(summary.customerFuelKopecks, 1250000);
    assert.equal(summary.paidKopecks, 4350000);
    assert.equal(summary.balance, 2950000);
    assert.equal(settlement.netRentKopecks, 7300000);
    assert.equal(settlement.totalInvoicedKopecks, 4350000);
    assert.equal(settlement.remainingToInvoiceKopecks, 2950000);
    const html = tools.buildReconciliationHtml(input);
    assert.match(html, /№ S1/);
    assert.match(html, /№ S2/);
    assert.doesNotMatch(html, /№ S3/);
    assert.equal((html.match(/class="page"/g) ?? []).length, 1);
    assert.match(html, /Начислено за сентябрь 2026 года[\s\S]*?2[\s ]138[\s\S]*?12[\s ]500,00[\s\S]*?85[\s ]520,00/);
    assert.match(html, /Вычет топлива заказчика за месяц[^<]*<\/td><td class="value">−12[\s ]520,00/);
    assert.match(html, /313 бутылей × 40,00 руб.; округление 20,00 руб./);
    assert.match(html, /Итого к оплате за месяц после вычета топлива<\/td><td class="value">73[\s ]000,00/);
    assert.equal((html.match(/Вычет топлива заказчика за месяц/g) ?? []).length, 1);
    assert.doesNotMatch(html, /Разница между расчётом|Разница до начисления|Доплата до начисления/);
    assert.doesNotMatch(html, /<td>13\.09\.2026<\/td>/);
    assert.match(html, /№ S1 · 10\.09\.2026–16\.09\.2026/);
    assert.match(html, /Итого по дням счёта № S1[\s\S]*?780<\/td><td class="value">—<\/td>\s*<td class="value">31[\s ]200,00/);
    for (const [day, amount, gross] of [["12", "2[\\s ]770", "3[\\s ]040"],
      ["18", "3[\\s ]540", "10[\\s ]200"], ["23", "3[\\s ]540", "5[\\s ]840"],
      ["28", "2[\\s ]650", "6[\\s ]440"]]) {
      assert.match(html, new RegExp(`${day}\\.09\\.2026</td>\\s*<td class="value">\\d+</td>\\s*<td class="value">${amount},00</td>\\s*<td class="value">${gross},00`));
    }
    const historical = { ...input, meta: { ...input.meta, documentDate: "2026-09-30", asOfDate: "2026-09-30" } };
    const historicalHtml = tools.buildReconciliationHtml(historical);
    assert.match(historicalHtml, /№ S1/);
    assert.doesNotMatch(historicalHtml, /№ S2/);
    assert.equal(tools.reconciliationSummary(historical).balance, 4180000);
    saveOfflineAction({ action: "update_invoice", id: 2, period: "2026-09", invoiceNumber: "S2",
      invoiceDate: "2026-10-02", kind: "fixed", amountKopecks: 1230000, dueDate: "", note: "" });
    const changed = offlineDashboard("2026-09");
    const changedCalculation = tools.calculateRental("2026-09", changed.entries, changed.downtimes, changed.settings);
    assert.deepEqual(changedCalculation, calculation);
    const changedInput = { ...changed, calculation: changedCalculation, meta: input.meta };
    const changedSummary = tools.reconciliationSummary(changedInput);
    assert.equal(changedSummary.balance, summary.balance);
    assert.equal(changedSummary.paidKopecks, summary.paidKopecks);
    assert.equal(changedSummary.customerFuelKopecks, summary.customerFuelKopecks);
    assert.equal(tools.calculateSettlement("2026-09", changedCalculation, changed.invoices, changed.expenses)
      .remainingToInvoiceKopecks, settlement.remainingToInvoiceKopecks);
    assert.match(tools.buildReconciliationHtml(changedInput), /№ S2<br>02\.10\.2026/);
    assert.deepEqual(JSON.parse(stored).payments, store.payments);
    assert.deepEqual(JSON.parse(stored).entries, store.entries);
    assert.deepEqual(JSON.parse(stored).expenses, store.expenses);
  } finally { delete globalThis.window; await server.close(); }
});
