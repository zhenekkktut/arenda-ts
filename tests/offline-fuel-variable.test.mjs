import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { createServer } from "vite";
import { documentTools } from "./pdf-fixture.mjs";

const KEY = "arenda-ts-offline-v1";
const PERIOD = "2026-09";
const tools = documentTools();

function fixture(overrides = {}) {
  return {
    version: 6,
    settings: { ...tools.DEFAULT_DOCUMENT_SETTINGS, rentalStart: "2026-09-01" },
    entries: [{ id: 1, entryDate: "2026-09-10", units: 2_138, note: "Фактический развоз" }],
    invoices: [{ id: 28, period: PERIOD, invoiceNumber: "28", invoiceDate: "2026-09-26",
      kind: "fixed", amountKopecks: 3_120_000, allocationMode: "auto", allocationVersion: 1,
      bottleStartDate: "2026-09-10", bottleEndDate: "2026-09-10",
      bottleAllocations: [{ date: "2026-09-10", amountKopecks: 3_120_000 }],
      rentalSupplementKopecks: 0, actNumber: "1", dueDate: null, note: "Сохранённый счёт" }],
    payments: [{ id: 1, invoiceId: 28, paymentDate: "2026-09-28", amountKopecks: 1_000_000,
      method: "bank", documentNumber: "ПП-28", note: "Частичная оплата" }],
    expenses: [{ id: 1, expenseDate: "2026-09-12", amountKopecks: 1_250_000,
      category: "fuel", payer: "customer", method: "bank", documentNumber: "Т-1", note: "" }],
    downtimes: [], closures: [], documents: [], auditLog: [],
    documentArchive: [{ id: 1, period: PERIOD, kind: "act", number: "1", version: 1,
      generatedAt: "2026-10-03T09:00:00Z", html: "<!doctype html><html><body>Сохранённый акт 73 000</body></html>",
      inputSnapshot: '{"fuelCalculation":"whole-bottles-variable-first-v2","unchanged":true}',
      pdfUri: "content://media/external/downloads/123" }],
    ...overrides,
  };
}

const newInvoice = (amountKopecks, allocationMode = "unlinked", extra = {}) => ({
  action: "create_invoice", period: PERIOD, invoiceNumber: "29", invoiceDate: "2026-10-03",
  kind: "fixed", amountKopecks, allocationMode, actNumber: "1", dueDate: null, note: "",
  ...extra,
});

test("offline signed variable fuel preserves the phone ledger and carries monthly credits", async (t) => {
  const server = await createServer({ configFile: "offline/vite.config.ts", hmr: false,
    optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true }, appType: "custom" });
  let stored = "";
  globalThis.window = { localStorage: {
    getItem: (key) => key === KEY ? stored : null,
    setItem: (key, value) => { if (key === KEY) stored = value; },
  } };
  const reset = (store) => { stored = JSON.stringify(store); };
  const read = () => JSON.parse(stored);
  try {
    const { offlineDashboard, saveOfflineAction: save } =
      await server.ssrLoadModule(path.resolve("app/rental-app.tsx"));
    const { proposeInvoiceAllocation } =
      await server.ssrLoadModule(path.resolve("app/invoice-allocation.ts"));
    const month = () => {
      const data = offlineDashboard(PERIOD);
      const gross = tools.calculateRental(PERIOD, data.entries, data.downtimes, data.settings);
      const settlement = tools.calculateSettlement(PERIOD, gross, data.invoices, data.expenses);
      return { data, gross, settlement };
    };
    const proposal = (amountKopecks, kind = "fixed") => {
      const { data, settlement } = month();
      return proposeInvoiceAllocation({ period: PERIOD, invoiceDate: "2026-10-03", amountKopecks, kind,
        entries: data.entries, invoices: data.invoices, settings: data.settings,
        fixedTargetKopecks: settlement.fixedTargetKopecks, netRentKopecks: settlement.netRentKopecks });
    };
    const rejectWithoutWrite = (payload) => {
      const original = stored;
      assert.throws(() => save(payload), Error);
      assert.equal(stored, original, "Rejected invoices must not change the persisted phone records");
    };

    await t.test("reading and editing invoice metadata preserves physical bottles, payments and archived HTML", () => {
      const original = fixture();
      reset(original);
      const serialized = stored;
      const { data, gross, settlement } = month();
      assert.equal(stored, serialized, "Opening a month must not rewrite a phone backup");
      assert.equal(gross.actualUnits, 2_138);
      assert.equal(gross.baseKopecks, 8_000_000);
      assert.equal(gross.variableKopecks, 552_000);
      assert.equal(settlement.fuelUnits, 313);
      assert.equal(settlement.fuelDeductionKopecks, 1_252_000);
      assert.equal(settlement.fixedFuelKopecks, 0);
      assert.equal(settlement.fixedTargetKopecks, 8_000_000);
      assert.equal(settlement.variableTargetKopecks, -700_000);
      assert.equal(settlement.netRentKopecks, 7_300_000);
      assert.equal(settlement.fixedRemainingKopecks, 4_180_000);
      assert.equal(settlement.variableRemainingKopecks, 0);
      assert.deepEqual(data.invoices, original.invoices);
      assert.deepEqual(data.payments, original.payments);
      assert.deepEqual(data.documentArchive, original.documentArchive);
      save({ ...original.invoices[0], action: "update_invoice", dueDate: "2026-10-15", note: "Уточнён срок оплаты" });
      const edited = read();
      assert.deepEqual(edited.invoices[0], { ...original.invoices[0], dueDate: "2026-10-15", note: "Уточнён срок оплаты" });
      for (const key of ["entries", "payments", "expenses", "documentArchive"]) {
        assert.deepEqual(edited[key], original[key], `Metadata editing must preserve ${key}`);
      }
      const input = { ...month().data, calculation: month().gross,
        meta: { ...tools.defaultDocumentMeta(PERIOD, 2, "2026-10-03"), asOfDate: "2026-10-03" } };
      tools.buildRentActHtml(input);
      tools.buildReconciliationHtml(input);
      assert.deepEqual(read().documentArchive, original.documentArchive,
        "Generating a current preview must not replace an older archived document or its PDF link");
      assert.equal(read().entries[0].units, 2_138);
    });

    await t.test("new automatic and unlinked invoices are limited by net rent, while fixed target remains contractual", () => {
      reset(fixture({ invoices: [], payments: [] }));
      const over = proposal(8_000_000);
      assert.equal(over.availableKopecks, 7_300_000);
      assert.equal(over.uncoveredKopecks, 700_000);
      assert.equal(over.ready, false);
      rejectWithoutWrite(newInvoice(8_000_000));
      rejectWithoutWrite(newInvoice(8_000_000, "auto", {
        allocationVersion: 1, bottleAllocations: [{ date: "2026-09-10", amountKopecks: 8_000_000 }],
        rentalSupplementKopecks: 0,
      }));
      assert.equal(proposal(1, "variable").availableKopecks, 0);
      const exact = proposal(7_300_000);
      assert.equal(exact.ready, true);
      save(newInvoice(7_300_000, "auto", { allocationVersion: 1, bottleAllocations: exact.bottleAllocations,
        rentalSupplementKopecks: exact.rentalSupplementKopecks }));
      const { settlement } = month();
      assert.equal(settlement.fixedTargetKopecks, 8_000_000);
      assert.equal(settlement.variableTargetKopecks, -700_000);
      assert.equal(settlement.totalInvoicedKopecks, 7_300_000);
      assert.equal(settlement.remainingToInvoiceKopecks, 0);
      assert.equal(settlement.fixedRemainingKopecks, 0);
      rejectWithoutWrite({ ...newInvoice(1), invoiceNumber: "30" });
      assert.equal(read().entries[0].units, 2_138);
    });

    await t.test("a negative net blocks new positive invoices and retains historic paid invoice money", () => {
      const original = fixture();
      original.expenses[0].amountKopecks = 10_000_000;
      reset(original);
      const { settlement } = month();
      assert.equal(settlement.fixedTargetKopecks, 8_000_000);
      assert.equal(settlement.variableTargetKopecks, -9_448_000);
      assert.equal(settlement.netRentKopecks, -1_448_000);
      assert.equal(settlement.remainingToInvoiceKopecks, 0);
      for (const kind of ["fixed", "variable", "other"]) {
        assert.equal(proposal(1, kind).availableKopecks, 0);
        rejectWithoutWrite(newInvoice(1, "unlinked", { kind }));
        rejectWithoutWrite(newInvoice(1, "auto", { kind, allocationVersion: 1,
          bottleAllocations: [{ date: "2026-09-10", amountKopecks: 1 }], rentalSupplementKopecks: 0 }));
        const legacyPayload = newInvoice(1, "unlinked", { kind });
        delete legacyPayload.allocationMode;
        rejectWithoutWrite(legacyPayload);
      }
      save({ ...original.invoices[0], action: "update_invoice", note: "Фактический ранее выставленный счёт" });
      const edited = read();
      assert.equal(edited.invoices[0].amountKopecks, original.invoices[0].amountKopecks);
      assert.deepEqual(edited.invoices[0].bottleAllocations, original.invoices[0].bottleAllocations);
      for (const key of ["entries", "payments", "expenses", "documentArchive"]) assert.deepEqual(edited[key], original[key]);
      const input = { ...month().data, calculation: month().gross,
        meta: { ...tools.defaultDocumentMeta(PERIOD, 2, "2026-10-03"), asOfDate: "2026-10-03" } };
      const summary = tools.reconciliationSummary(input);
      assert.equal(summary.balance, -2_448_000);
      assert.match(tools.buildReconciliationHtml(input), /Переплата Арендатора/);
    });

    await t.test("automatic opening carries negative rent and payments, while a saved zero opening takes priority", () => {
      const original = fixture();
      original.expenses[0].amountKopecks = 10_000_000;
      reset(original);
      const serialized = stored;
      const automatic = offlineDashboard("2026-10");
      assert.equal(automatic.documentMeta.openingBalanceKopecks, -2_448_000);
      assert.equal(stored, serialized);
      save({ action: "save_document_meta", ...tools.defaultDocumentMeta("2026-10", 2, "2026-10-31"),
        asOfDate: "2026-10-31", openingBalanceKopecks: 0 });
      const zero = offlineDashboard("2026-10");
      assert.equal(zero.documentMeta.openingBalanceKopecks, 0);
      assert.deepEqual(read().invoices, original.invoices);
      assert.deepEqual(read().payments, original.payments);
      assert.deepEqual(read().entries, original.entries);
      assert.deepEqual(read().documentArchive, original.documentArchive);
    });
  } finally { delete globalThis.window; await server.close(); }
});
