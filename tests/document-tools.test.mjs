import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
import { compactInput, sampleInput } from "./pdf-fixture.mjs";

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

test("rent act keeps the contract amount while reconciliation deducts customer fuel", () => {
  const settings = { ...tools.DEFAULT_DOCUMENT_SETTINGS, lesseeDirector: "Иванова Ивана Ивановича" };
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
  assert.match(act, /в лице генерального директора Иванова Ивана Ивановича/);
  assert.match(reconciliation, /АКТ СВЕРКИ ВЗАИМНЫХ РАСЧЁТОВ/);
  assert.equal((act.match(/class="signature-header"/g) ?? []).length, 2);
  assert.match(act, /32[\s ]000,00 руб/);
  assert.match(act, /Подтверждённого технического простоя не было; P = 0 дней/);
  assert.doesNotMatch(act, /Зачёт расходов на топливо/);
  assert.match(reconciliation, /Вычет топлива, оплаченного заказчиком/);
  assert.match(reconciliation, /№ 27/);
  assert.match(reconciliation, /08\.09\.2026/);
  assert.match(reconciliation, /35[\s ]000,00/);
  assert.match(reconciliation, /73[\s ]000,00/);
  assert.equal(tools.reconciliationSummary(input).customerFuelKopecks, 400_000);
  assert.equal(tools.reconciliationSummary(input).balance, 7_300_000);
  assert.equal((packageHtml.match(/class="page"/g) ?? []).length, 2);
});

test("short reconciliation puts invoices and dated fuel on one sheet without removed columns or boilerplate", () => {
  const input = compactInput(tools);
  const html = tools.buildReconciliationHtml(input);
  assert.equal((html.match(/class="page"/g) ?? []).length, 1);
  const invoiceTable = html.match(/<table class="reconciliation-invoices">[\s\S]*?<\/table>/)[0];
  assert.deepEqual([...invoiceTable.matchAll(/<th>(.*?)<\/th>/g)].map(match => match[1]),
    ["Счёт", "К оплате", "Оплачено", "Остаток"]);
  assert.match(html, /class="reconciliation-daily"/);
  assert.match(html, /12\.09\.2026<\/td>\s*<td class="value">100<\/td><td class="value">2[\s ]500,00/);
  assert.match(html, /18\.09\.2026<\/td>\s*<td class="value">100<\/td><td class="value">2[\s ]500,00/);
  assert.match(invoiceTable, /75[\s ]000,00/);
  assert.match(invoiceTable, /45[\s ]000,00/);
  assert.equal(tools.reconciliationSummary(input).balance, 4_500_000);
  assert.doesNotMatch(html, /В старых счетах|Основания вычета топлива по датам|Поступившие платежи на сумму|Подписанием акта|Сроки оплаты|class="signatures"/);
});

test("long reconciliation starts daily rows on the first page and preserves all dates across continuations", () => {
  const input = sampleInput(tools);
  const html = tools.buildReconciliationHtml(input);
  const pages = [...html.matchAll(/<section class="page">([\s\S]*?)<\/section>/g)].map(match => match[1]);
  assert.equal(pages.length, 2);
  assert.match(pages[0], /class="reconciliation-invoices"/);
  assert.match(pages[0], /class="reconciliation-daily"/);
  assert.doesNotMatch(pages[1], /<h1>|<p|class="signatures"/);
  assert.match(pages[1], /<tbody><tr><td>№ \d+ · /);
  for (const entry of input.entries) {
    const date = entry.entryDate.split("-").reverse().join(".");
    assert.equal(html.split(`<td>${date}</td>`).length - 1, 1, date);
  }
  assert.match(pages[1], /Итого за август 2026 года/);
});

test("reconciliation traces each invoice to days and shows fuel deductions on their dates", () => {
  const settings = { ...tools.DEFAULT_DOCUMENT_SETTINGS };
  const counts = [100, 110, 110, ...Array(10).fill(100), 90, 90, ...Array(5).fill(80), 100, ...Array(10).fill(80)];
  const entries = counts.map((units, index) => ({ entryDate: `2026-08-${String(index + 1).padStart(2, "0")}`, units }));
  const invoices = [
    { id: 31, period: "2026-08", invoiceNumber: "31", invoiceDate: "2026-08-04", bottleStartDate: "2026-08-01", bottleEndDate: "2026-08-03", amountKopecks: 1_280_000 },
    { id: 32, period: "2026-08", invoiceNumber: "32", invoiceDate: "2026-08-16", bottleStartDate: "2026-08-04", bottleEndDate: "2026-08-15", amountKopecks: 3_970_000 },
    { id: 33, period: "2026-08", invoiceNumber: "33", invoiceDate: "2026-08-22", bottleStartDate: "2026-08-16", bottleEndDate: "2026-08-21", amountKopecks: 2_000_000 },
    { id: 34, period: "2026-08", invoiceNumber: "34", invoiceDate: "2026-09-01", bottleStartDate: "2026-08-22", bottleEndDate: "2026-08-31", amountKopecks: 3_200_000 },
  ];
  const input = {
    settings, meta: { ...tools.defaultDocumentMeta("2026-08", 1, "2026-09-15"), asOfDate: "2026-09-15" },
    calculation: tools.calculateRental("2026-08", entries, [], settings), downtimes: [], entries, invoices,
    expenses: [
      { expenseDate: "2026-08-07", category: "fuel", payer: "customer", amountKopecks: 250_000 },
      { expenseDate: "2026-08-12", category: "fuel", payer: "customer", amountKopecks: 300_000 },
      { expenseDate: "2026-08-13", category: "fuel", payer: "customer", amountKopecks: 200_000 },
    ],
    payments: [
      { invoiceId: 31, paymentDate: "2026-08-05", amountKopecks: 1_280_000, documentNumber: "" },
      { invoiceId: 32, paymentDate: "2026-08-18", amountKopecks: 3_000_000, documentNumber: "" },
      { invoiceId: 33, paymentDate: "2026-08-25", amountKopecks: 2_000_000, documentNumber: "" },
    ],
  };
  const act = tools.buildRentActHtml(input);
  const reconciliation = tools.buildReconciliationHtml(input);
  assert.equal(input.calculation.totalKopecks, 11_200_000);
  assert.equal(tools.reconciliationSummary(input).balance, 4_170_000);
  assert.match(act, /112[\s ]000,00/);
  assert.match(reconciliation, /07\.08\.2026<\/td><td class="value">100<\/td>\s*<td class="value">2[\s ]500,00<\/td><td class="value">1[\s ]500,00/);
  assert.match(reconciliation, /12\.08\.2026<\/td><td class="value">100<\/td>\s*<td class="value">3[\s ]000,00<\/td><td class="value">1[\s ]000,00/);
  assert.match(reconciliation, /13\.08\.2026<\/td><td class="value">100<\/td>\s*<td class="value">2[\s ]000,00<\/td><td class="value">2[\s ]000,00/);
  assert.match(reconciliation, /39[\s ]700,00/);
  assert.match(reconciliation, /41[\s ]700,00/);
  assert.doesNotMatch(reconciliation, /По данным<br>Арендодателя/);
  assert.doesNotMatch(reconciliation, /Повторно эти суммы не начисляются/);
  assert.equal((reconciliation.match(/class="page"/g) ?? []).length, 2);
});

test("fixed and variable invoices share days and deduct customer fuel once", () => {
  const settings = { ...tools.DEFAULT_DOCUMENT_SETTINGS };
  const entries = [1000, 900, 900].map((units, index) => ({ entryDate: `2026-08-0${index + 1}`, units }));
  const invoices = [
    { id: 1, invoiceNumber: "F", period: "2026-08", invoiceDate: "2026-08-04", kind: "fixed",
      bottleStartDate: "2026-08-01", bottleEndDate: "2026-08-03", amountKopecks: 7_750_000 },
    { id: 2, invoiceNumber: "V", period: "2026-08", invoiceDate: "2026-08-04", kind: "variable",
      bottleStartDate: "2026-08-01", bottleEndDate: "2026-08-03", amountKopecks: 3_200_000 },
  ];
  const input = { settings, meta: tools.defaultDocumentMeta("2026-08", 1, "2026-09-15"), entries,
    calculation: tools.calculateRental("2026-08", entries, [], settings), downtimes: [], invoices,
    expenses: [{ expenseDate: "2026-08-02", category: "fuel", payer: "customer", amountKopecks: 250_000 }],
    payments: [{ invoiceId: 1, paymentDate: "2026-08-05", amountKopecks: 7_000_000 },
      { invoiceId: 2, paymentDate: "2026-08-05", amountKopecks: 3_200_000 }],
  };
  const html = tools.buildReconciliationHtml(input);
  const daily = html.split('class="reconciliation-daily"')[1];
  assert.equal(tools.fuelInvoiceForDate(invoices, "2026-08-02"), 1);
  assert.equal((daily.match(/02\.08\.2026<\/td>/g) ?? []).length, 1);
  assert.match(daily, /Итого счета № F, № V/);
  assert.match(daily, /2[\s ]800<\/td><td class="value">2[\s ]500,00<\/td>\s*<td class="value">109[\s ]500,00/);
  assert.doesNotMatch(daily, /5[\s ]600/);
  assert.equal(tools.reconciliationSummary(input).balance, 750_000);
  const splitInvoices = [
    { ...invoices[0], id: 1, invoiceNumber: "F1", bottleEndDate: "2026-08-01", amountKopecks: 4_000_000 },
    { ...invoices[0], id: 3, invoiceNumber: "F2", bottleStartDate: "2026-08-02", amountKopecks: 3_750_000 },
    invoices[1],
  ];
  const splitHtml = tools.buildReconciliationHtml({ ...input, invoices: splitInvoices });
  const splitDaily = splitHtml.split('class="reconciliation-daily"')[1];
  assert.equal(tools.fuelInvoiceForDate(splitInvoices, "2026-08-02"), 3);
  assert.equal((splitDaily.match(/02\.08\.2026<\/td>/g) ?? []).length, 1);
  assert.match(splitDaily, /2[\s ]800<\/td><td class="value">2[\s ]500,00<\/td>\s*<td class="value">109[\s ]500,00/);
});

test("monthly reconciliation rejects dates before month end and permits historical month-end dates", () => {
  const input = compactInput(tools);
  const cases = [
    { documentDate: "2026-09-16", asOfDate: "2026-10-03" },
    { documentDate: "2026-10-03", asOfDate: "2026-09-16" },
    { documentDate: "2026-09-16", asOfDate: undefined },
  ];
  for (const dates of cases) {
    const meta = { ...input.meta, ...dates };
    const error = tools.reconciliationDateError(meta);
    assert.equal(typeof error, "string");
    assert.throws(() => tools.buildReconciliationHtml({ ...input, meta }), { message: error });
  }
  const monthEnd = { ...input.meta, documentDate: "2026-09-30", asOfDate: "2026-09-30" };
  assert.equal(tools.reconciliationDateError(monthEnd), null);
  const html = tools.buildReconciliationHtml({ ...input, meta: monthEnd });
  assert.match(html, /по состоянию на 30\.09\.2026/);
  assert.match(html, /30\.09\.2026/);
  assert.equal(tools.reconciliationDateError({ ...monthEnd, asOfDate: undefined }), null);
  for (const [period, lastDay] of [["2028-02", "29"], ["2026-04", "30"], ["2026-08", "31"]]) {
    const meta = { ...monthEnd, period, documentDate: `${period}-${lastDay}`, asOfDate: `${period}-${lastDay}` };
    assert.equal(tools.reconciliationDateError(meta), null);
    assert.equal(typeof tools.reconciliationDateError({ ...meta,
      asOfDate: `${period}-${String(Number(lastDay) - 1).padStart(2, "0")}` }), "string");
  }
});

test("reconciliation excludes invoices issued after a historical date following month end", () => {
  const settings = { ...tools.DEFAULT_DOCUMENT_SETTINGS };
  const entries = [{ entryDate: "2026-08-01", units: 320 }];
  const input = { settings, meta: { ...tools.defaultDocumentMeta("2026-08", 1, "2026-09-15"), asOfDate: "2026-09-10" },
    calculation: tools.calculateRental("2026-08", entries, [], settings), entries, downtimes: [],
    invoices: [
      { id: 1, invoiceNumber: "EARLY", invoiceDate: "2026-09-04", period: "2026-08", amountKopecks: 1_280_000,
        bottleStartDate: "2026-08-01", bottleEndDate: "2026-08-03" },
      { id: 2, invoiceNumber: "FUTURE", invoiceDate: "2026-09-16", period: "2026-08", amountKopecks: 4_720_000,
        bottleStartDate: "2026-08-04", bottleEndDate: "2026-08-15" },
    ], expenses: [],
    payments: [{ invoiceId: 1, paymentDate: "2026-09-05", amountKopecks: 1_000_000 },
      { invoiceId: 2, paymentDate: "2026-09-09", amountKopecks: 500_000 }],
  };
  assert.match(tools.buildReconciliationHtml(input), /EARLY/);
  assert.doesNotMatch(tools.buildReconciliationHtml(input), /FUTURE/);
  assert.match(tools.buildReconciliationHtml(input), /Аванс до даты выставления счёта/);
  assert.equal(tools.reconciliationSummary(input).paidKopecks, 1_500_000);
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
