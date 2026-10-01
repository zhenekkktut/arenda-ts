import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = fs.readFileSync(new URL("../app/document-tools.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const module = { exports: {} };
new Function("exports", "module", compiled)(module.exports, module);
const tools = module.exports;

test("rent calculation deduplicates downtime and applies the contract max formula", () => {
  const settings = { ...tools.DEFAULT_DOCUMENT_SETTINGS };
  const calculation = tools.calculateRental(
    "2026-08",
    [{ entryDate: "2026-08-01", units: 1_800 }],
    [
      { id: 1, startDate: "2026-08-10", endDate: "2026-08-20", reason: "Ремонт", note: "" },
      { id: 2, startDate: "2026-08-15", endDate: "2026-08-25", reason: "Ремонт", note: "" },
    ],
    settings,
  );

  assert.equal(calculation.calendarDays, 31);
  assert.equal(calculation.downtimeDays, 16);
  assert.equal(calculation.payableDays, 15);
  assert.equal(calculation.baseKopecks, Math.round(8_000_000 * 15 / 31));
  assert.equal(calculation.intensityKopecks, 7_200_000);
  assert.equal(calculation.variableKopecks, 7_200_000 - calculation.baseKopecks);
  assert.equal(calculation.totalKopecks, 7_200_000);
});

test("downtime always reduces F while the total remains the greater of F and I", () => {
  const settings = { ...tools.DEFAULT_DOCUMENT_SETTINGS };
  const downtime = [
    { id: 1, startDate: "2026-08-10", endDate: "2026-08-20", reason: "Простой автомобиля", note: "" },
  ];

  const atLimit = tools.calculateRental(
    "2026-08",
    [{ entryDate: "2026-08-01", units: 2_000 }],
    downtime,
    settings,
  );
  const aboveLimit = tools.calculateRental(
    "2026-08",
    [{ entryDate: "2026-08-01", units: 2_800 }],
    downtime,
    settings,
  );

  assert.equal(atLimit.baseKopecks, Math.round(8_000_000 * 20 / 31));
  assert.equal(atLimit.baseReductionKopecks, 8_000_000 - atLimit.baseKopecks);
  assert.equal(atLimit.intensityKopecks, 8_000_000);
  assert.equal(atLimit.variableKopecks, 8_000_000 - atLimit.baseKopecks);
  assert.equal(atLimit.totalKopecks, 8_000_000);
  assert.equal(aboveLimit.baseKopecks, Math.round(8_000_000 * 20 / 31));
  assert.equal(aboveLimit.intensityKopecks, 11_200_000);
  assert.equal(aboveLimit.variableKopecks, 11_200_000 - aboveLimit.baseKopecks);
  assert.equal(aboveLimit.totalKopecks, 11_200_000);
});

test("partial ownership excludes days before the lease begins", () => {
  const settings = { ...tools.DEFAULT_DOCUMENT_SETTINGS, rentalStart: "2026-08-16" };
  const calculation = tools.calculateRental("2026-08", [
    { entryDate: "2026-08-01", units: 100 }, { entryDate: "2026-08-16", units: 300 },
  ], [], settings);
  assert.equal(calculation.calendarDays, 31);
  assert.equal(calculation.ownershipDays, 16);
  assert.equal(calculation.payableDays, 16);
  assert.equal(calculation.actualUnits, 300);
  assert.equal(calculation.baseKopecks, Math.round(8_000_000 * 16 / 31));
});

test("August reference act and reconciliation use invoice 27 and exclude fuel offsets", () => {
  const settings = { ...tools.DEFAULT_DOCUMENT_SETTINGS };
  const calculation = tools.calculateRental(
    "2026-08",
    [{ entryDate: "2026-08-01", units: 2_800 }],
    [],
    settings,
  );
  const meta = {
    period: "2026-08",
    actNumber: "1",
    reconciliationNumber: "1",
    documentDate: "2026-09-15",
    basis: "Ежедневный реестр",
    asOfDate: "2026-09-15",
    openingBalanceKopecks: 0,
  };
  const input = {
    settings,
    meta,
    calculation,
    downtimes: [],
    invoices: [{ id: 1, invoiceNumber: "27", invoiceDate: "2026-09-08", period: "2026-08", amountKopecks: 3_500_000 }],
    payments: [{ invoiceId: 1, paymentDate: "2026-09-10", amountKopecks: 3_500_000, method: "bank", documentNumber: "" }],
    expenses: [{ expenseDate: "2026-08-22", category: "fuel", payer: "customer", amountKopecks: 400_000, documentNumber: "ППР", note: "" }],
  };

  const act = tools.buildRentActHtml(input);
  const reconciliation = tools.buildReconciliationHtml(input);
  const packageHtml = tools.buildDocumentPackageHtml(input);

  assert.match(act, /112[\s ]000,00/);
  assert.match(act, /112[\s ]000 \(Сто двенадцать тысяч\) рублей 00 копеек/);
  assert.match(act, /Переменная часть: И - Ф, если результат положительный/);
  assert.match(act, /32[\s ]000,00 руб/);
  assert.match(act, /Подтверждённого технического простоя не было; P = 0 дней/);
  assert.doesNotMatch(act, /Зачёт расходов на топливо/);
  assert.doesNotMatch(reconciliation, /Зачёт расходов на топливо/);
  assert.match(reconciliation, /счёт № 27 от 08\.09\.2026/);
  assert.match(reconciliation, /35[\s ]000,00/);
  assert.match(reconciliation, /77[\s ]000,00/);
  assert.match(reconciliation, /Семьдесят семь тысяч/);
  assert.equal(tools.reconciliationSummary(input).balance, 7_700_000);
  assert.equal((packageHtml.match(/class="page"/g) ?? []).length, 2);
});

test("reconciliation uses period-linked payments received no later than the selected date", () => {
  const settings = { ...tools.DEFAULT_DOCUMENT_SETTINGS };
  const input = { settings, meta: { ...tools.defaultDocumentMeta("2026-08", 1, "2026-09-15"), asOfDate: "2026-09-15" },
    calculation: tools.calculateRental("2026-08", [{ entryDate: "2026-08-01", units: 2800 }], [], settings),
    downtimes: [], entries: [], expenses: [],
    invoices: [{ id: 1, invoiceNumber: "27", period: "2026-08" }, { id: 2, invoiceNumber: "28", period: "2026-09" }],
    payments: [{ invoiceId: 1, paymentDate: "2026-09-10", amountKopecks: 2_000_000, method: "bank", documentNumber: "" },
      { invoiceId: 1, paymentDate: "2026-09-16", amountKopecks: 1_500_000, method: "bank", documentNumber: "" },
      { invoiceId: 2, paymentDate: "2026-09-10", amountKopecks: 5_000_000, method: "bank", documentNumber: "" }],
  };
  const currentPeriod = { ...input, invoices: input.invoices.filter((i) => i.period === "2026-08") };
  assert.equal(tools.reconciliationSummary(currentPeriod).paidKopecks, 2_000_000);
  assert.equal(tools.reconciliationSummary(currentPeriod).balance, 9_200_000);
});

test("user-entered document text is escaped", () => {
  const settings = { ...tools.DEFAULT_DOCUMENT_SETTINGS, city: "<Выборг>" };
  const calculation = tools.calculateRental("2026-08", [], [], settings);
  const meta = tools.defaultDocumentMeta("2026-08", 1, "2026-09-15");
  const html = tools.buildRentActHtml({ settings, meta, calculation, downtimes: [], invoices: [], payments: [], expenses: [] });
  assert.match(html, /&lt;Выборг&gt;/);
  assert.doesNotMatch(html, /г\. <Выборг>/);
});
