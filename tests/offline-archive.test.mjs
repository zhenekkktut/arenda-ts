import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { createServer } from "vite";

test("deleting an archived document and undoing keeps source records and PDF links intact", async () => {
  const server = await createServer({ configFile: "offline/vite.config.ts", hmr: false,
    optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true }, appType: "custom" });
  const documents = [1, 2].map((id) => ({ id, period: "2026-09", kind: "reconciliation", number: "2", version: id,
    generatedAt: "2026-10-03T00:00:00Z", html: "<!doctype html><html><body>Example</body></html>",
    inputSnapshot: "{}", pdfUri: `content://media/external/downloads/${id}` }));
  const original = { version: 6, entries: [{ id: 1, entryDate: "2026-09-10", units: 100, note: "" }],
    invoices: [{ id: 1, period: "2026-09", invoiceNumber: "A", invoiceDate: "2026-09-11", kind: "fixed", amountKopecks: 400000 }],
    payments: [{ id: 1, invoiceId: 1, paymentDate: "2026-09-12", amountKopecks: 400000 }],
    expenses: [], downtimes: [], closures: [], documents: [{ period: "2026-09", actNumber: "2", reconciliationNumber: "2",
      documentDate: "2026-10-03", openingBalanceKopecks: 0, basis: "" }], documentArchive: documents };
  let stored = JSON.stringify(original);
  globalThis.window = { localStorage: { getItem: key => key === "arenda-ts-offline-v1" ? stored : null,
    setItem: (key, value) => { if (key === "arenda-ts-offline-v1") stored = value; } } };
  try {
    const { saveOfflineAction } = await server.ssrLoadModule(path.resolve("app/rental-app.tsx"));
    const read = () => JSON.parse(stored);
    saveOfflineAction({ action: "delete_document", id: 1 });
    assert.deepEqual(read().documentArchive, [documents[1]]);
    for (const key of ["entries", "invoices", "payments", "documents"]) assert.deepEqual(read()[key], original[key]);
    assert.equal(read().auditLog[0].entity, "document");
    assert.throws(() => saveOfflineAction({ action: "delete_document", id: 999 }), /не найден/);
    assert.throws(() => saveOfflineAction({ action: "delete_document", id: 0 }), /Неверный/);
    assert.throws(() => saveOfflineAction({ action: "delete_document", id: 1.5 }), /Неверный/);
    saveOfflineAction({ action: "link_document_pdf", id: 1, uri: "content://media/external/downloads/late" });
    assert.equal(read().documentArchive.length, 1, "A late export callback must not recreate a removed document");
    saveOfflineAction({ action: "archive_document", document: documents[0] });
    assert.deepEqual(read().documentArchive.find(item => item.id === 1), documents[0]);
    for (const key of ["entries", "invoices", "payments", "documents"]) assert.deepEqual(read()[key], original[key]);
  } finally { delete globalThis.window; await server.close(); }
});
