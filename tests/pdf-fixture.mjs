import fs from "node:fs";
import ts from "typescript";

export function documentTools() {
  const source = fs.readFileSync(new URL("../app/document-tools.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const module = { exports: {} };
  new Function("exports", "module", compiled)(module.exports, module);
  return module.exports;
}

export function sampleInput(tools = documentTools()) {
  const settings = { ...tools.DEFAULT_DOCUMENT_SETTINGS,
    lessorFull: "Индивидуальный предприниматель Иванов Иван Иванович", lessorShort: "ИП Иванов И. И.",
    lessorSignerShort: "Иванов И. И.", lessorDative: "ИП Иванову Ивану Ивановичу", lessorInn: "000000000000",
    lesseeFull: "ООО «Пример»", lesseeShort: "ООО «Пример»", lesseeInn: "0000000000", lesseeKpp: "000000000",
    lesseeDirector: "Петрова Петра Петровича", lesseeDirectorShort: "Петров П. П.",
    vehicleVin: "ПРИМЕР", vehiclePlate: "А000АА 00" };
  const counts = [100, 110, 110, ...Array(10).fill(100), 90, 90, ...Array(5).fill(80), 100, ...Array(10).fill(80)];
  const entries = counts.map((units, i) => ({ entryDate: `2026-08-${String(i + 1).padStart(2, "0")}`, units }));
  const invoices = [[31, "01", "03", "2026-08-04", 1280000], [32, "04", "15", "2026-08-16", 3970000],
    [33, "16", "21", "2026-08-22", 2000000], [34, "22", "31", "2026-09-01", 3200000]]
    .map(([id, start, end, invoiceDate, amountKopecks]) => ({ id, invoiceNumber: String(id), invoiceDate,
      amountKopecks, period: "2026-08", bottleStartDate: `2026-08-${start}`, bottleEndDate: `2026-08-${end}` }));
  const expenses = [["07", 250000], ["12", 300000], ["13", 200000]].map(([day, amountKopecks], i) => ({
    expenseDate: `2026-08-${day}`, amountKopecks, category: "fuel", payer: "customer", documentNumber: `Т-${i + 1}`, note: "" }));
  const payments = [[31, "05", 1280000], [32, "18", 3000000], [33, "25", 2000000]]
    .map(([invoiceId, day, amountKopecks], i) => ({ invoiceId, paymentDate: `2026-08-${day}`, amountKopecks,
      method: "bank", documentNumber: `П-${i + 1}` }));
  return { settings, meta: tools.defaultDocumentMeta("2026-08", 1, "2026-09-15"), entries, invoices,
    expenses, payments, downtimes: [], calculation: tools.calculateRental("2026-08", entries, [], settings) };
}

export function compactInput(tools = documentTools()) {
  const { settings } = sampleInput(tools);
  const entries = Array.from({ length: 15 }, (_, i) => ({ entryDate: `2026-09-${i + 10}`, units: 100 }));
  const invoices = [[101, "2026-09-25", 3000000], [102, "2026-10-01", 2000000], [103, "2026-10-01", 2500000]]
    .map(([id, invoiceDate, amountKopecks]) => ({ id, invoiceNumber: String(id), invoiceDate,
      amountKopecks, period: "2026-09" }));
  const expenses = ["12", "18"].map(day => ({ expenseDate: `2026-09-${day}`, amountKopecks: 250000,
    category: "fuel", payer: "customer" }));
  return { settings, meta: tools.defaultDocumentMeta("2026-09", 2, "2026-10-02"),
    entries, invoices, expenses, downtimes: [],
    payments: [{ invoiceId: 101, paymentDate: "2026-09-26", amountKopecks: 3000000 }],
    openingPayments: [{ invoiceId: 99, paymentDate: "2026-09-08", amountKopecks: 10000000 }],
    calculation: tools.calculateRental("2026-09", entries, [], settings) };
}

// Native export also exercises partial money from the same delivery date and a
// full no-trip day. Counts remain whole, actual bottles in both invoices.
export function allocationInput(tools = documentTools()) {
  const { settings } = sampleInput(tools);
  const entries = [{ entryDate: "2026-09-10", units: 400 },
    { entryDate: "2026-09-11", units: 320 }, { entryDate: "2026-09-12", units: 100 }];
  const downtimes = [{ id: 1, kind: "no_trip", startDate: "2026-09-01", endDate: "2026-09-01",
    reason: "Выезда не было", basis: "Запись календаря", note: "" }];
  const expenses = [{ expenseDate: "2026-09-12", amountKopecks: 500000, category: "fuel", payer: "customer" }];
  const calculation = tools.calculateRental("2026-09", entries, downtimes, settings);
  const netRent = tools.calculateFuelAdjustment("2026-09", calculation, expenses).calculation.totalKopecks;
  const invoices = [
    { id: 201, invoiceNumber: "201", invoiceDate: "2026-09-10", period: "2026-09", kind: "fixed", amountKopecks: 1250000,
      bottleStartDate: "2026-09-10", bottleEndDate: "2026-09-10", allocationVersion: 1,
      bottleAllocations: [{ date: "2026-09-10", amountKopecks: 1250000 }], rentalSupplementKopecks: 0 },
    { id: 202, invoiceNumber: "202", invoiceDate: "2026-09-11", period: "2026-09", kind: "fixed", amountKopecks: 1230000,
      bottleStartDate: "2026-09-10", bottleEndDate: "2026-09-11", allocationVersion: 1,
      bottleAllocations: [{ date: "2026-09-10", amountKopecks: 350000 }, { date: "2026-09-11", amountKopecks: 880000 }], rentalSupplementKopecks: 0 },
    { id: 203, invoiceNumber: "203", invoiceDate: "2026-10-01", period: "2026-09", kind: "fixed", amountKopecks: netRent - 2480000,
      bottleStartDate: "2026-09-11", bottleEndDate: "2026-09-12", allocationVersion: 1,
      bottleAllocations: [{ date: "2026-09-11", amountKopecks: 400000 }, { date: "2026-09-12", amountKopecks: 400000 }],
      rentalSupplementKopecks: netRent - 3280000 },
  ];
  return { settings, entries, downtimes, expenses, calculation, invoices, payments: [],
    meta: tools.defaultDocumentMeta("2026-09", 3, "2026-10-03") };
}

if (process.argv[2]) {
  const target = process.argv[2];
  fs.mkdirSync(target, { recursive: true });
  const tools = documentTools();
  const input = sampleInput(tools);
  fs.writeFileSync(`${target}/reconciliation.html`, tools.buildReconciliationHtml(input));
  const allocated = allocationInput(tools);
  fs.writeFileSync(`${target}/reconciliation-compact.html`, tools.buildReconciliationHtml(allocated));
  fs.writeFileSync(`${target}/rent.html`, tools.buildRentActHtml(allocated));
}
