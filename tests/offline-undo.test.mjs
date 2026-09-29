import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { createServer } from "vite";

test("deleting an invoice can restore its payments even after IDs are reused", async () => {
  const server = await createServer({
    configFile: "offline/vite.config.ts",
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true },
    appType: "custom",
  });
  const storage = new Map();
  globalThis.window = {
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    },
  };

  try {
    const { saveOfflineAction } = await server.ssrLoadModule(path.resolve("app/rental-app.tsx"));
    const store = () => JSON.parse(storage.get("arenda-ts-offline-v1"));
    const invoice = (invoiceNumber, amountKopecks) => ({
      action: "create_invoice",
      period: "2026-09",
      invoiceNumber,
      invoiceDate: "2026-09-26",
      kind: "fixed",
      amountKopecks,
      dueDate: null,
      note: "",
    });
    const payment = (invoiceId, amountKopecks) => ({
      action: "create_payment",
      invoiceId,
      paymentDate: "2026-09-27",
      amountKopecks,
      method: "bank",
      documentNumber: "ПП-8",
      note: "Проверка связи со счётом",
    });

    saveOfflineAction(invoice("28", 3_120_000));
    saveOfflineAction(payment(1, 1_000_000));
    const originalInvoice = store().invoices[0];
    const originalPayments = store().payments;

    saveOfflineAction({ action: "delete_invoice", id: originalInvoice.id });
    assert.equal(store().invoices.length, 0);
    assert.equal(store().payments.length, 0);

    saveOfflineAction(invoice("29", 500_000));
    saveOfflineAction(payment(1, 100_000));
    saveOfflineAction({ action: "restore_invoice", invoice: originalInvoice, payments: originalPayments });

    const restored = store();
    const invoice28 = restored.invoices.find((row) => row.invoiceNumber === "28");
    const invoice29 = restored.invoices.find((row) => row.invoiceNumber === "29");
    assert.equal(invoice29.id, 1);
    assert.equal(invoice28.amountKopecks, 3_120_000);
    assert.notEqual(invoice28.id, invoice29.id);
    assert.deepEqual(restored.payments.map((row) => row.invoiceId).sort(), [invoice28.id, invoice29.id].sort());
    assert.equal(restored.payments.find((row) => row.invoiceId === invoice28.id).amountKopecks, 1_000_000);
    assert.equal(restored.payments.find((row) => row.invoiceId === invoice28.id).documentNumber, "ПП-8");
  } finally {
    delete globalThis.window;
    await server.close();
  }
});
