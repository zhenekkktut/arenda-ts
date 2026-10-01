import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
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
