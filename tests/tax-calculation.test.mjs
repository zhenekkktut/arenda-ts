import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { createServer } from "vite";

test("УСН follows payment dates across invoice periods and accounts for partial payments", async () => {
  const server = await createServer({ configFile: "offline/vite.config.ts",
    optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true }, appType: "custom" });
  try {
    const { calculateTaxYear } = await server.ssrLoadModule(path.resolve("app/tax-calculation.ts"));
    const payments = [
      { paymentDate: "2026-03-31", amountKopecks: 2_000_000 },
      { paymentDate: "2026-04-01", amountKopecks: 1_120_000 },
      { paymentDate: "2027-01-01", amountKopecks: 1_000_000 },
    ];
    const adjustments = [
      { id: 1, date: "2026-04-02", amountKopecks: 500_000, kind: "income", note: "" },
      { id: 2, date: "2026-03-25", amountKopecks: 50_000, kind: "tax_paid", note: "" },
    ];
    const q1 = calculateTaxYear(2026, 1, payments, adjustments,
      { year: 2026, deductionKopecks: 0, hasWorkers: false });
    assert.equal(q1.incomeKopecks, 2_000_000);
    assert.equal(q1.reserveKopecks, 120_000);
    assert.equal(q1.outstandingKopecks, 70_000);
    const q2 = calculateTaxYear(2026, 2, payments, adjustments,
      { year: 2026, deductionKopecks: 100_000, hasWorkers: false });
    assert.equal(q2.incomeKopecks, 3_620_000);
    assert.equal(q2.reserveKopecks, 97_200);
    assert.equal(q2.outstandingKopecks, 67_200);
    const limited = calculateTaxYear(2026, 2, payments, adjustments,
      { year: 2026, deductionKopecks: 300_000, hasWorkers: true });
    assert.equal(limited.deductionKopecks, 108_600);
  } finally { await server.close(); }
});

test("old phone data gains empty tax records without losing existing invoices", async () => {
  const server = await createServer({ configFile: "offline/vite.config.ts",
    optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true }, appType: "custom", hmr: false });
  const storage = new Map();
  globalThis.window = { localStorage: { getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value) } };
  try {
    const { saveOfflineAction } = await server.ssrLoadModule(path.resolve("app/rental-app.tsx"));
    storage.set("arenda-ts-offline-v1", JSON.stringify({ version: 5, entries: [], invoices: [
      { id: 1, period: "2026-09", invoiceNumber: "7", amountKopecks: 3_120_000 }],
      payments: [], expenses: [], closures: [] }));
    saveOfflineAction({ action: "save_tax_adjustment", date: "2026-09-28", kind: "tax_paid", amountKopecks: 100_000 });
    const result = JSON.parse(storage.get("arenda-ts-offline-v1"));
    assert.equal(result.invoices[0].invoiceNumber, "7");
    assert.equal(result.taxAdjustments[0].amountKopecks, 100_000);
  } finally { delete globalThis.window; await server.close(); }
});
