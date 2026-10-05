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
    settings: { ...tools.DEFAULT_DOCUMENT_SETTINGS },
    entries: [
      { id: 1, entryDate: "2026-09-16", units: 2000, note: "" },
      { id: 2, entryDate: "2026-09-17", units: 145, note: "" },
      { id: 3, entryDate: "2026-09-18", units: 255, note: "" },
    ],
    invoices: [], payments: [], expenses: [], closures: [], downtimes: [],
    documents: [], documentArchive: [], auditLog: [], taxAdjustments: [], taxOptions: [],
    ...overrides,
  };
}

function invoice(number, amountKopecks, allocations, kind = "fixed", extra = {}) {
  return {
    action: "create_invoice", period: PERIOD, invoiceNumber: number,
    invoiceDate: "2026-10-02", kind, amountKopecks, actNumber: "2", dueDate: null, note: "",
    bottleStartDate: allocations[0]?.date ?? "", bottleEndDate: allocations.at(-1)?.date ?? "",
    allocationVersion: 1, bottleAllocations: allocations, rentalSupplementKopecks: 0,
    ...extra,
  };
}

const partial = () => invoice("28", 1_230_000, [
  { date: "2026-09-17", amountKopecks: 580_000 },
  { date: "2026-09-18", amountKopecks: 650_000 },
]);
const payment = (invoiceId, amountKopecks) => ({
  action: "create_payment", invoiceId, amountKopecks, paymentDate: "2026-10-03",
  method: "bank", documentNumber: "ПП-1", note: "Поступивший платёж",
});

test("offline allocation metadata and no-trip actions preserve the phone ledger", async (t) => {
  const server = await createServer({ configFile: "offline/vite.config.ts", hmr: false,
    optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true }, appType: "custom" });
  const storage = new Map();
  globalThis.window = { localStorage: {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  } };
  const reset = (store = fixture()) => storage.set(KEY, JSON.stringify(store));
  const read = () => JSON.parse(storage.get(KEY));
  try {
    const { saveOfflineAction: save, offlineDashboard } =
      await server.ssrLoadModule(path.resolve("app/rental-app.tsx"));
    const { proposeInvoiceAllocation } =
      await server.ssrLoadModule(path.resolve("app/invoice-allocation.ts"));
    const day18 = () => {
      const data = offlineDashboard(PERIOD);
      const calculation = tools.calculateRental(PERIOD, data.entries, data.downtimes, data.settings);
      const settlement = tools.calculateSettlement(PERIOD, calculation, data.invoices, data.expenses);
      return proposeInvoiceAllocation({ period: PERIOD, invoiceDate: "2026-10-03",
        amountKopecks: 1_000_000, kind: "other", entries: data.entries, invoices: data.invoices,
        settings: data.settings, fixedTargetKopecks: settlement.calculation.baseKopecks,
        netRentKopecks: settlement.netRentKopecks, startDate: "2026-09-18", endDate: "2026-09-18" });
    };
    const rejectWithoutWrite = (payload) => {
      const before = storage.get(KEY);
      assert.throws(() => save(payload));
      assert.equal(storage.get(KEY), before, "Rejected actions must leave persisted records untouched");
    };

    await t.test("reading a v6 backup neither rewrites old invoices nor invents allocation metadata", () => {
      const oldInvoice = { id: 9, period: PERIOD, invoiceNumber: "27", invoiceDate: "2026-09-26",
        kind: "fixed", amountKopecks: 3_120_000, bottleStartDate: "2026-09-10",
        bottleEndDate: "2026-09-16", dueDate: null, note: "Сохранённый старый счёт" };
      const oldPayment = { id: 4, invoiceId: 9, paymentDate: "2026-09-27", amountKopecks: 1_000_000,
        method: "bank", documentNumber: "ПП-27", note: "" };
      reset(fixture({ invoices: [oldInvoice], payments: [oldPayment] }));
      const original = storage.get(KEY);
      const dashboard = offlineDashboard(PERIOD);
      assert.equal(storage.get(KEY), original, "Viewing an old backup is a read-only operation");
      assert.deepEqual(dashboard.invoices[0], oldInvoice);
      assert.deepEqual(dashboard.payments, [oldPayment]);
      assert.equal(dashboard.invoices[0].allocationVersion, undefined);
      save({ action: "save_entry", entryDate: "2026-09-20", units: 90, note: "Новая запись" });
      assert.deepEqual(read().invoices, [oldInvoice]);
      assert.deepEqual(read().payments, [oldPayment]);
      assert.equal(read().version, 6);
    });

    await t.test("a partial 17/18 invoice stores exact daily money and keeps receipts when reviewed", () => {
      reset();
      const originalEntries = read().entries;
      save(partial());
      const saved = read().invoices[0];
      assert.equal(saved.allocationVersion, 1);
      assert.equal(saved.rentalSupplementKopecks, 0);
      assert.deepEqual(saved.bottleAllocations, partial().bottleAllocations);
      assert.equal(saved.amountKopecks, 1_230_000);
      assert.equal(day18().availableKopecks, 370_000);
      assert.equal(day18().days[0].alreadyAllocatedKopecks, 650_000);
      save(payment(saved.id, 300_000));
      const receipts = read().payments;
      save({ ...partial(), action: "update_invoice", id: saved.id,
        invoiceDate: "2026-10-03", note: "Дата уточнена" });
      assert.deepEqual(read().payments, receipts);
      assert.deepEqual(read().entries, originalEntries, "Allocating money must not split or change actual bottle counts");
      assert.deepEqual(read().invoices[0].bottleAllocations, saved.bottleAllocations);
      assert.equal(read().invoices[0].amountKopecks, saved.amountKopecks);
      assert.equal(read().invoices[0].invoiceDate, "2026-10-03");
      assert.equal(offlineDashboard(PERIOD).payments.filter((row) => row.invoiceId === saved.id)
        .reduce((sum, row) => sum + row.amountKopecks, 0), 300_000);
      rejectWithoutWrite({ ...partial(), action: "update_invoice", id: saved.id,
        allocationVersion: undefined, bottleAllocations: undefined, rentalSupplementKopecks: undefined });
    });

    await t.test("fixed, variable and other invoices all reserve the same daily money", () => {
      reset();
      save(partial());
      rejectWithoutWrite(invoice("29", 100_000,
        [{ date: "2026-09-17", amountKopecks: 100_000 }], "variable"));
      save(invoice("29", 370_000, [{ date: "2026-09-18", amountKopecks: 370_000 }], "variable"));
      assert.equal(day18().availableKopecks, 0);
      rejectWithoutWrite(invoice("30", 1, [{ date: "2026-09-18", amountKopecks: 1 }], "other"));
      save(invoice("30", 100_000, [{ date: "2026-09-16", amountKopecks: 100_000 }], "other"));
      assert.deepEqual(read().invoices.map((row) => row.kind), ["fixed", "variable", "other"]);
      assert.equal(read().invoices.filter((row) => row.bottleAllocations.some((claim) => claim.date === "2026-09-18"))
        .reduce((sum, row) => sum + row.bottleAllocations.filter((claim) => claim.date === "2026-09-18")
          .reduce((total, claim) => total + claim.amountKopecks, 0), 0), 1_020_000);
    });

    await t.test("editing, deleting and restoring an invoice update claims while restoring its linked receipt", () => {
      reset();
      save(partial());
      save(payment(1, 300_000));
      const originalReceipts = read().payments;
      save(invoice("28", 1_000_000, [
        { date: "2026-09-17", amountKopecks: 580_000 },
        { date: "2026-09-18", amountKopecks: 420_000 },
      ], "fixed", { action: "update_invoice", id: 1 }));
      assert.equal(day18().availableKopecks, 600_000);
      assert.deepEqual(read().payments, originalReceipts);
      const invoiceToRestore = read().invoices[0];
      save({ action: "delete_invoice", id: invoiceToRestore.id });
      assert.equal(day18().availableKopecks, 1_020_000);
      assert.equal(read().payments.length, 0);
      save(invoice("29", 100_000, [{ date: "2026-09-16", amountKopecks: 100_000 }], "other"));
      save(payment(1, 50_000));
      save({ action: "restore_invoice", invoice: invoiceToRestore, payments: originalReceipts });
      const restored = read().invoices.find((row) => row.invoiceNumber === "28");
      assert.notEqual(restored.id, read().invoices.find((row) => row.invoiceNumber === "29").id);
      assert.deepEqual(restored.bottleAllocations, invoiceToRestore.bottleAllocations);
      assert.equal(restored.allocationVersion, 1);
      assert.equal(restored.amountKopecks, 1_000_000);
      assert.equal(day18().availableKopecks, 600_000);
      assert.equal(read().payments.find((row) => row.invoiceId === restored.id).amountKopecks, 300_000);
      assert.equal(read().payments.reduce((sum, row) => sum + row.amountKopecks, 0), 350_000);
      assert.equal(new Set(read().payments.map((row) => row.id)).size, 2);
    });

    await t.test("restoring an invoice rejects dates reclaimed by another invoice without losing either receipt", () => {
      reset();
      save(partial());
      save(payment(1, 300_000));
      const deletedInvoice = read().invoices[0];
      const deletedReceipts = read().payments;
      save({ action: "delete_invoice", id: deletedInvoice.id });
      save(invoice("29", 100_000, [{ date: "2026-09-17", amountKopecks: 100_000 }], "variable"));
      save(payment(1, 50_000));
      const current = read();
      assert.equal(current.invoices[0].id, deletedInvoice.id, "The reclaimed invoice also exercises reused IDs");
      rejectWithoutWrite({ action: "restore_invoice", invoice: deletedInvoice, payments: deletedReceipts });
      assert.deepEqual(read().invoices, current.invoices);
      assert.deepEqual(read().payments, current.payments);
      assert.deepEqual(deletedReceipts.map((row) => row.amountKopecks), [300_000]);
    });

    await t.test("invalid allocation money or dates never partially save an invoice", () => {
      reset();
      rejectWithoutWrite(invoice("28", 1_230_000, [{ date: "2026-09-17", amountKopecks: 580_000 }]));
      rejectWithoutWrite(invoice("28", 1_230_000, [
        { date: "2026-09-17", amountKopecks: 580_000 },
        { date: "2026-09-17", amountKopecks: 650_000 },
      ]));
      rejectWithoutWrite(invoice("28", 1_230_000,
        [{ date: "2026-09-18", amountKopecks: 1_230_000 }], "fixed", { invoiceDate: "2026-09-17" }));
      rejectWithoutWrite(invoice("28", 1_230_000, [{ date: "2026-09-19", amountKopecks: 1_230_000 }]));
      assert.equal(read().invoices.length, 0);
    });

    await t.test("creating or extending a no-trip day rejects positive deliveries without deleting them", () => {
      reset();
      rejectWithoutWrite({ action: "create_downtime", kind: "no_trip",
        startDate: "2026-09-17", endDate: "2026-09-17" });
      save({ action: "create_downtime", kind: "no_trip", startDate: "2026-09-19", endDate: "2026-09-19" });
      const noTrip = read().downtimes[0];
      assert.equal(noTrip.kind, "no_trip");
      assert.equal(noTrip.startDate, "2026-09-19");
      rejectWithoutWrite({ action: "update_downtime", id: noTrip.id, kind: "no_trip",
        startDate: "2026-09-18", endDate: "2026-09-19" });
      assert.deepEqual(read().entries, fixture().entries);
      assert.equal(read().downtimes.length, 1);
      const future = new Date();
      future.setUTCDate(future.getUTCDate() + 2);
      const futureDate = future.toISOString().slice(0, 10);
      rejectWithoutWrite({ action: "create_downtime", kind: "no_trip",
        startDate: futureDate, endDate: futureDate });
    });

    await t.test("positive bottle input conflicts with a saved no-trip day while zero remains valid", () => {
      reset();
      save({ action: "save_entry", entryDate: "2026-09-19", units: 0, note: "" });
      save({ action: "create_downtime", kind: "no_trip", startDate: "2026-09-19", endDate: "2026-09-19" });
      rejectWithoutWrite({ action: "save_entry", entryDate: "2026-09-19", units: 12, note: "" });
      save({ action: "save_entry", entryDate: "2026-09-19", units: 0, note: "Выезда не было" });
      assert.equal(read().entries.find((row) => row.entryDate === "2026-09-19").units, 0);
      save({ action: "delete_downtime_day", date: "2026-09-19" });
      save({ action: "save_entry", entryDate: "2026-09-19", units: 12, note: "Выезд восстановлен" });
      assert.equal(read().entries.find((row) => row.entryDate === "2026-09-19").units, 12);
      assert.equal(read().downtimes.length, 0);
    });

    await t.test("removing one no-trip date splits every covering range and leaves technical downtime intact", () => {
      const technical = { id: 4, startDate: "2026-09-18", endDate: "2026-09-18",
        reason: "Технический простой", basis: "Заявка", note: "Старый период без kind" };
      const noTrip = (id, startDate, endDate) => ({ id, kind: "no_trip", startDate, endDate,
        reason: "Выезда не было", basis: "Календарь", note: `Период ${id}` });
      reset(fixture({ entries: [], downtimes: [
        noTrip(1, "2026-09-17", "2026-09-19"), noTrip(2, "2026-09-18", "2026-09-18"),
        noTrip(3, "2026-09-18", "2026-09-20"), technical,
      ] }));
      save({ action: "delete_downtime_day", date: "2026-09-18" });
      const rows = read().downtimes;
      assert.deepEqual(rows.find((row) => row.id === technical.id), technical);
      const noTrips = rows.filter((row) => row.kind === "no_trip");
      assert.deepEqual(noTrips.map((row) => [row.startDate, row.endDate]).sort(), [
        ["2026-09-17", "2026-09-17"], ["2026-09-19", "2026-09-19"], ["2026-09-19", "2026-09-20"],
      ]);
      assert.equal(noTrips.some((row) => row.startDate <= "2026-09-18" && row.endDate >= "2026-09-18"), false);
      assert.equal(noTrips.filter((row) => row.note === "Период 1").length, 2);
      assert.equal(noTrips.find((row) => row.note === "Период 3").basis, "Календарь");
      assert.equal(noTrips.every((row) => row.reason === "Выезда не было"), true);
      assert.equal(new Set(rows.map((row) => row.id)).size, rows.length);
      const calculation = tools.calculateRental(PERIOD, [], rows, read().settings);
      assert.equal(calculation.downtimeDays, 4, "Overlapping downtime ranges count each calendar day only once");
    });

    await t.test("an old downtime without kind retains its technical meaning and saved fields", () => {
      const old = { id: 7, startDate: "2026-09-01", endDate: "2026-09-02",
        reason: "Ремонт", basis: "Согласовано", note: "Старая резервная копия" };
      reset(fixture({ downtimes: [old] }));
      const before = storage.get(KEY);
      const dashboard = offlineDashboard(PERIOD);
      assert.equal(storage.get(KEY), before);
      assert.deepEqual(dashboard.downtimes, [old]);
      const calculation = tools.calculateRental(PERIOD, dashboard.entries, dashboard.downtimes, dashboard.settings);
      assert.equal(calculation.downtimeDays, 2);
      assert.equal(calculation.payableDays, 28);
      save({ action: "save_entry", entryDate: "2026-09-20", units: 10, note: "" });
      assert.deepEqual(read().downtimes, [old]);
      save({ action: "create_downtime", startDate: "2026-09-03", endDate: "2026-09-03",
        reason: "Ремонт", basis: "Заявка", note: "" });
      assert.equal(read().downtimes.find((row) => row.startDate === "2026-09-03").kind, "technical");
      rejectWithoutWrite({ action: "create_downtime", startDate: "2026-09-04", endDate: "2026-09-04" });
    });
  } finally {
    delete globalThis.window;
    await server.close();
  }
});
