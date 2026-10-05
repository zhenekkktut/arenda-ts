import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
import { allocationInput, compactInput, sampleInput } from "./pdf-fixture.mjs";

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

test("rent act deducts customer fuel through intensity and reconciliation uses the same net rent", () => {
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

  assert.match(act, /108[\s ]000,00/);
  assert.match(act, /108[\s ]000 \(Сто восемь тысяч\) рублей 00 копеек/);
  assert.match(act, /Учтено единиц интенсивности N, штук<\/td><td class="value">2[\s ]700/);
  assert.match(act, /Постоянная часть Ф = 80[\s ]000 × d \/ D<\/td><td class="value">80[\s ]000,00/);
  assert.equal(input.calculation.actualUnits, 2_800);
  assert.equal(input.calculation.totalKopecks, 11_200_000);
  assert.match(act, /Переменная часть: И - Ф, если результат положительный/);
  assert.match(act, /в лице генерального директора Иванова Ивана Ивановича/);
  assert.match(reconciliation, /АКТ СВЕРКИ ВЗАИМНЫХ РАСЧЁТОВ/);
  assert.equal((act.match(/class="signature-header"/g) ?? []).length, 2);
  assert.match(act, /28[\s ]000,00 руб/);
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
  assert.match(invoiceTable, /Итого по счетам[\s\S]*Осталось выставить<\/td>\s*<td class="value">0,00/);
  assert.equal(tools.reconciliationSummary(input).balance, 4_500_000);
  assert.doesNotMatch(html, /В старых счетах|Основания вычета топлива по датам|Поступившие платежи на сумму|Подписанием акта|Сроки оплаты|class="signatures"/);
});

test("remaining to invoice deducts monthly fuel and issued invoices independently of payments and opening debt", () => {
  const input = compactInput(tools);
  input.invoices[2].invoiceDate = "2026-10-03";
  const remaining = (value) => tools.buildReconciliationHtml(value)
    .match(/<td colspan="3">Осталось выставить<\/td>\s*<td class="value">([^<]+)/)[1].replace(/\u00a0/g, " ");
  assert.equal(remaining(input), "25 000,00", "A future invoice does not reduce the amount on a historical act");
  assert.equal(remaining({ ...input, payments: [], meta: { ...input.meta, openingBalanceKopecks: 2_000_000 } }), "25 000,00",
    "Payments and prior debt belong to the debt calculation, not the uninvoiced amount");
  assert.equal(remaining({ ...input, meta: { ...input.meta, asOfDate: "2026-10-03", documentDate: "2026-10-03" } }), "0,00");
  assert.equal(remaining({ ...input, invoices: [{ ...input.invoices[0], amountKopecks: 8_000_000 }] }), "0,00",
    "An amount invoiced above net rent must not become a negative amount to invoice");
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
  assert.match(pages[1], /Начислено за август 2026 года/);
  assert.match(pages[1], /Итого к оплате за месяц после вычета топлива/);
});

test("reconciliation traces each invoice to gross daily amounts and deducts dated fuel at month end", () => {
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
  assert.equal(tools.reconciliationSummary(input).balance, 4_168_000);
  assert.match(act, /104[\s ]480,00/);
  assert.match(reconciliation, /07\.08\.2026<\/td><td class="value">100<\/td>\s*<td class="value">2[\s ]500,00<\/td><td class="value">4[\s ]000,00/);
  assert.match(reconciliation, /12\.08\.2026<\/td><td class="value">100<\/td>\s*<td class="value">3[\s ]000,00<\/td><td class="value">4[\s ]000,00/);
  assert.match(reconciliation, /13\.08\.2026<\/td><td class="value">100<\/td>\s*<td class="value">2[\s ]000,00<\/td><td class="value">4[\s ]000,00/);
  assert.equal((reconciliation.match(/Вычет топлива заказчика за месяц/g) ?? []).length, 1);
  assert.match(reconciliation, /Вычет топлива заказчика за месяц[^<]*<\/td><td class="value">−7[\s ]520,00/);
  assert.match(reconciliation, /188 бутылей × 40,00 руб.; округление 20,00 руб./);
  assert.match(reconciliation, /Итого к оплате за месяц после вычета топлива<\/td><td class="value">104[\s ]480,00/);
  assert.doesNotMatch(reconciliation, /Разница между расчётом|Разница до начисления/);
  assert.match(reconciliation, /39[\s ]700,00/);
  assert.match(reconciliation, /41[\s ]680,00/);
  assert.doesNotMatch(reconciliation, /По данным<br>Арендодателя/);
  assert.doesNotMatch(reconciliation, /Повторно эти суммы не начисляются/);
  assert.equal((reconciliation.match(/class="page"/g) ?? []).length, 2);
});

test("fixed and variable invoices share gross daily totals and one monthly fuel deduction", () => {
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
  assert.equal(tools.fuelInvoiceForDate(invoices, "2026-08-02"), 2);
  assert.equal((daily.match(/02\.08\.2026<\/td>/g) ?? []).length, 1);
  assert.match(daily, /Итого по дням счетов № F, № V/);
  assert.match(daily, /2[\s ]800<\/td><td class="value">—<\/td>\s*<td class="value">112[\s ]000,00/);
  assert.match(daily, /Начислено за август 2026 года<\/td><td class="value">2[\s ]800<\/td>\s*<td class="value">2[\s ]500,00<\/td><td class="value">112[\s ]000,00/);
  assert.match(daily, /Итого к оплате за месяц после вычета топлива<\/td><td class="value">109[\s ]480,00/);
  assert.match(daily, /Вычет топлива заказчика за месяц[^<]*<\/td><td class="value">−2[\s ]520,00/);
  assert.equal((daily.match(/Вычет топлива заказчика за месяц/g) ?? []).length, 1);
  assert.doesNotMatch(daily, /5[\s ]600/);
  assert.equal(tools.reconciliationSummary(input).balance, 748_000);
  const splitInvoices = [
    { ...invoices[0], id: 1, invoiceNumber: "F1", bottleEndDate: "2026-08-01", amountKopecks: 4_000_000 },
    { ...invoices[0], id: 3, invoiceNumber: "F2", bottleStartDate: "2026-08-02", amountKopecks: 3_750_000 },
    invoices[1],
  ];
  const splitHtml = tools.buildReconciliationHtml({ ...input, invoices: splitInvoices });
  const splitDaily = splitHtml.split('class="reconciliation-daily"')[1];
  assert.equal(tools.fuelInvoiceForDate(splitInvoices, "2026-08-02"), 2);
  assert.equal((splitDaily.match(/02\.08\.2026<\/td>/g) ?? []).length, 1);
  assert.match(splitDaily, /2[\s ]800<\/td><td class="value">—<\/td>\s*<td class="value">112[\s ]000,00/);
  assert.match(splitDaily, /Итого к оплате за месяц после вычета топлива<\/td><td class="value">109[\s ]480,00/);
  assert.doesNotMatch(splitDaily, /Разница между расчётом|Разница до начисления/);
});

test("daily detail omits absent days, retains the saved invoice range and adds only the monthly rent floor", () => {
  const settings = { ...tools.DEFAULT_DOCUMENT_SETTINGS };
  const entries = [{ entryDate: "2026-08-02", units: 100 }, { entryDate: "2026-08-04", units: 200 }];
  const input = { settings, entries, calculation: tools.calculateRental("2026-08", entries, [], settings),
    meta: tools.defaultDocumentMeta("2026-08", 1, "2026-09-15"), downtimes: [], payments: [],
    invoices: [{ id: 1, invoiceNumber: "F", period: "2026-08", invoiceDate: "2026-08-08", kind: "fixed",
      bottleStartDate: "2026-08-01", bottleEndDate: "2026-08-07", amountKopecks: 7_900_000 }],
    expenses: [{ expenseDate: "2026-08-06", category: "fuel", payer: "customer", amountKopecks: 100_000 }] };
  const html = tools.buildReconciliationHtml(input);
  const daily = html.split('class="reconciliation-daily"')[1];
  assert.match(daily, /№ F · 01\.08\.2026–07\.08\.2026/);
  for (const day of ["02", "04", "06"]) assert.equal(daily.split(`<td>${day}.08.2026</td>`).length - 1, 1);
  for (const day of ["01", "03", "05", "07"]) assert.doesNotMatch(daily, new RegExp(`<td>${day}\\.08\\.2026</td>`));
  assert.match(daily, /06\.08\.2026<\/td><td class="value">0<\/td>\s*<td class="value">1[\s ]000,00<\/td><td class="value">0,00/);
  assert.match(daily, /Итого по дням счёта № F[\s\S]*?300<\/td><td class="value">—<\/td>\s*<td class="value">12[\s ]000,00/);
  assert.match(daily, /Доплата до начисления по акту-расчёту № 1<\/td>\s*<td class="value">68[\s ]000,00/);
  assert.match(daily, /Начислено за август 2026 года[\s\S]*?<td class="value">80[\s ]000,00/);
  assert.match(daily, /Итого к оплате за месяц после вычета топлива<\/td><td class="value">79[\s ]000,00/);
  assert.equal(tools.reconciliationSummary(input).balance, 7_900_000);
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

const dailyDetail = (html) => [...html.matchAll(/<table class="reconciliation-daily">[\s\S]*?<\/table>/g)]
  .map((match) => match[0]).join("");

test("partial same-kind invoices identify included money while real bottles and gross appear once", () => {
  const input = allocationInput(tools);
  input.invoices = input.invoices.slice(0, 2);
  const html = tools.buildReconciliationHtml(input);
  const daily = dailyDetail(html);
  const datedRows = [...daily.matchAll(/<tr><td>([\s\S]*?)<\/td><td>(\d\d\.\d\d\.\d{4})<\/td>\s*<td class="value">([^<]+)<\/td>[\s\S]*?<\/tr>/g)];
  assert.deepEqual(datedRows.map((row) => [row[2], Number(row[3])]),
    [["10.09.2026", 400], ["11.09.2026", 320], ["12.09.2026", 100]]);
  assert.equal(datedRows.reduce((sum, row) => sum + Number(row[3]), 0), 820);
  assert.match(datedRows[0][1], /№ 201 · 10\.09\.2026–10\.09\.2026: 12[\s ]500,00 руб/);
  assert.match(datedRows[0][1], /№ 202 · 10\.09\.2026–11\.09\.2026: 3[\s ]500,00 руб/);
  assert.match(datedRows[0][0], /<td class="value">16[\s ]000,00<\/td>/);
  assert.match(datedRows[1][1], /№ 202: 8[\s ]800,00 руб/);
  assert.match(datedRows[1][1], /Не включено в счета: 4[\s ]000,00 руб/);
  assert.match(datedRows[1][0], /<td class="value">12[\s ]800,00<\/td>/);
  assert.match(daily, /По счёту № 201[^<]*включено по датам 12[\s ]500,00 руб\.; итого по счёту 12[\s ]500,00 руб/);
  assert.match(daily, /По счёту № 202[^<]*включено по датам 12[\s ]300,00 руб\.; итого по счёту 12[\s ]300,00 руб/);
  assert.doesNotMatch(daily, /<td class="value">(?:312,5|307,5)<\/td>/);
  assert.equal((daily.match(/Вычет топлива заказчика за месяц/g) ?? []).length, 1);
  assert.equal(input.entries[0].units, 400);
  assert.equal(input.invoices[0].amountKopecks, 1250000);
});

test("allocation supplements reconcile each invoice face without imaginary deliveries or repeated monthly fuel", () => {
  const input = allocationInput(tools);
  const html = tools.buildReconciliationHtml(input);
  const daily = dailyDetail(html);
  assert.equal((html.match(/class="page"/g) ?? []).length, 1, "Native compact fixture must remain one A4 sheet");
  assert.match(daily, /По счёту № 203[^<]*включено по датам 8[\s ]000,00 руб\.<br>Доплата до постоянной части: 39[\s ]533,33 руб\.; итого по счёту 47[\s ]533,33 руб/);
  assert.match(daily, /Доплата до постоянной части по акту-расчёту № 3<\/td>\s*<td class="value">44[\s ]533,33/);
  assert.match(daily, /Начислено за сентябрь 2026 года<\/td><td class="value">820<\/td>\s*<td class="value">5[\s ]000,00<\/td><td class="value">77[\s ]333,33/);
  assert.match(daily, /Вычет топлива заказчика за месяц[^<]*<\/td><td class="value">−5[\s ]000,00/);
  assert.match(daily, /Итого к оплате за месяц после вычета топлива<\/td><td class="value">72[\s ]333,33/);
  assert.equal((daily.match(/Вычет топлива заказчика за месяц/g) ?? []).length, 1);
  assert.equal([...daily.matchAll(/<td>\d\d\.09\.2026<\/td>/g)].length, 3);
  assert.equal(tools.reconciliationSummary(input).balance, 7233333);
  assert.equal(tools.calculateSettlement("2026-09", input.calculation, input.invoices, input.expenses).remainingToInvoiceKopecks, 0);
});

test("mixed explicit and legacy ranges retain unknown money links without duplicating shared delivery dates", () => {
  const input = allocationInput(tools);
  const legacy = { ...input.invoices[1] };
  delete legacy.allocationVersion;
  delete legacy.bottleAllocations;
  delete legacy.rentalSupplementKopecks;
  input.invoices = [input.invoices[0], legacy];
  const daily = dailyDetail(tools.buildReconciliationHtml(input));
  for (const date of ["10", "11", "12"]) assert.equal((daily.match(new RegExp(`<td>${date}\\.09\\.2026</td>`, "g")) ?? []).length, 1);
  const shared = daily.match(/<tr><td>([\s\S]*?)<\/td><td>10\.09\.2026<\/td>/)[1];
  assert.match(shared, /№ 201[^<]*12[\s ]500,00/);
  assert.match(shared, /№ 202[^<]*по периоду/);
  assert.doesNotMatch(shared, /Не включено в счета: 3[\s ]500/);
  assert.match(shared, /Остаток дня: связь по периоду/);
  assert.match(daily, /Не включено в счета: 4[\s ]000,00 руб\.<\/td><td>12\.09\.2026/);
});

test("invalid or unknown explicit allocation metadata keeps invoice faces but does not invent a legacy range link", () => {
  const input = allocationInput(tools);
  const original = { ...input.invoices[0] };
  input.invoices = [original];
  const legacy = { ...original };
  delete legacy.allocationVersion;
  delete legacy.bottleAllocations;
  delete legacy.rentalSupplementKopecks;
  const baseline = tools.buildReconciliationHtml({ ...input, invoices: [legacy] });
  assert.match(dailyDetail(baseline), /№ 201 · 10\.09\.2026–10\.09\.2026/);
  for (const changes of [
    { allocationVersion: 2 }, { bottleAllocations: undefined }, { bottleAllocations: {} },
    { bottleAllocations: [{ date: "2026-09-10", amountKopecks: 1250001 }] },
    { bottleAllocations: [{ date: "2026-09-10", amountKopecks: -1250000 }] },
    { bottleAllocations: [{ date: "2026-09-10", amountKopecks: 1249999.5 }], rentalSupplementKopecks: 0.5 },
    { bottleAllocations: [{ date: "2026-09-31", amountKopecks: 1250000 }] },
    { bottleAllocations: [{ date: "2026-10-01", amountKopecks: 1250000 }] },
    { bottleAllocations: [{ date: "2026-09-10", amountKopecks: 500000 }, { date: "2026-09-10", amountKopecks: 750000 }] },
  ]) {
    const html = tools.buildReconciliationHtml({ ...input, invoices: [{ ...original, ...changes }] });
    const daily = dailyDetail(html);
    assert.match(html, /№ 201<br>10\.09\.2026<br>Привязку суммы к датам нужно проверить/);
    assert.match(html, /<td class="value">12[\s ]500,00<\/td>/);
    assert.match(daily, /Дни без связи со счётом/);
    assert.doesNotMatch(daily, /№ 201/);
    for (const date of ["10", "11", "12"]) assert.equal((daily.match(new RegExp(`<td>${date}\\.09\\.2026</td>`, "g")) ?? []).length, 1);
  }
});

test("changed actual records and invoice dates invalidate only unsupported money links while preserving saved faces", () => {
  for (const mutate of [
    (input) => { input.entries[0].units = 300; },
    (input) => { input.entries = input.entries.slice(1); },
    (input) => { input.invoices[0].invoiceDate = "2026-09-09"; },
    (input) => { input.entries[2].units = 600; },
  ]) {
    const input = allocationInput(tools);
    const savedInvoices = structuredClone(input.invoices);
    mutate(input);
    input.calculation = tools.calculateRental(input.meta.period, input.entries, input.downtimes, input.settings);
    const before = structuredClone(input);
    const html = tools.buildReconciliationHtml(input);
    const daily = dailyDetail(html);
    const invalidId = input.entries[2]?.units === 600 ? 203 : 201;
    assert.match(html, new RegExp(`№ ${invalidId}<br>[^<]*<br>Привязку суммы к датам нужно проверить`));
    assert.doesNotMatch(daily, new RegExp(`№ ${invalidId}(?:[: ·]|<)`));
    for (const entry of input.entries) assert.equal((daily.match(new RegExp(`<td>${entry.entryDate.split("-").reverse().join("\\.")}</td>`, "g")) ?? []).length, 1);
    assert.deepEqual(input, before, "Rendering must not modify current records or saved invoice faces");
    assert.deepEqual(input.invoices.map((invoice) => invoice.amountKopecks), savedInvoices.map((invoice) => invoice.amountKopecks));
  }
  const input = allocationInput(tools);
  input.invoices = input.invoices.slice(0, 1);
  input.settings.rentalStart = "2026-09-11";
  input.calculation = tools.calculateRental(input.meta.period, input.entries, input.downtimes, input.settings);
  const daily = dailyDetail(tools.buildReconciliationHtml(input));
  assert.doesNotMatch(daily, /№ 201/);
  assert.doesNotMatch(daily, /<td>10\.09\.2026<\/td>/);
});

test("overallocated shared dates drop all conflicting links while valid third invoices, payments and real deliveries remain", () => {
  const input = allocationInput(tools);
  input.invoices[1].bottleAllocations = [{ date: "2026-09-10", amountKopecks: 450000 },
    { date: "2026-09-11", amountKopecks: 780000 }];
  input.payments = [{ invoiceId: 201, paymentDate: "2026-09-15", amountKopecks: 500000, method: "bank", documentNumber: "" }];
  const unchanged = structuredClone(input);
  const html = tools.buildReconciliationHtml(input);
  const daily = dailyDetail(html);
  for (const id of [201, 202]) {
    assert.match(html, new RegExp(`№ ${id}<br>[^<]*<br>Привязку суммы к датам нужно проверить`));
    assert.doesNotMatch(daily, new RegExp(`№ ${id}(?:[: ·]|<)`));
  }
  assert.match(daily, /№ 203/);
  assert.match(daily, /По счёту № 203[^<]*включено по датам 8[\s ]000,00/);
  assert.match(html, /№ 201<br>10\.09\.2026<br>Привязку суммы к датам нужно проверить<\/td>\s*<td class="value">12[\s ]500,00<\/td>\s*<td class="value">5[\s ]000,00/);
  const datedRows = [...daily.matchAll(/<td>(\d\d\.09\.2026)<\/td>\s*<td class="value">(\d+)<\/td>/g)];
  assert.deepEqual(datedRows.map((row) => [row[1], Number(row[2])]), [["10.09.2026", 400], ["11.09.2026", 320], ["12.09.2026", 100]]);
  assert.deepEqual(input, unchanged);
});

test("long allocation detail starts on the first sheet and retains every actual date through continuations", () => {
  const input = sampleInput(tools);
  input.invoices[0] = { ...input.invoices[0], allocationVersion: 1, rentalSupplementKopecks: 0,
    bottleAllocations: [{ date: "2026-08-01", amountKopecks: 400000 },
      { date: "2026-08-02", amountKopecks: 440000 }, { date: "2026-08-03", amountKopecks: 440000 }] };
  const html = tools.buildReconciliationHtml(input);
  const pages = [...html.matchAll(/<section class="page">([\s\S]*?)<\/section>/g)].map((match) => match[1]);
  assert.ok(pages.length >= 2);
  assert.match(pages[0], /class="reconciliation-daily"/);
  for (const entry of input.entries) assert.equal(html.split(`<td>${entry.entryDate.split("-").reverse().join(".")}</td>`).length - 1, 1);
  assert.match(pages.at(-1), /Итого к оплате за месяц после вычета топлива/);
  assert.equal((dailyDetail(html).match(/Вычет топлива заказчика за месяц/g) ?? []).length, 1);
});

test("full no-trip days reduce the fixed part and are described without a technical fault", () => {
  const input = allocationInput(tools);
  const act = tools.buildRentActHtml(input);
  assert.equal(input.calculation.downtimeDays, 1);
  assert.equal(input.calculation.payableDays, 29);
  assert.equal(input.calculation.baseKopecks, Math.round(8000000 * 29 / 30));
  assert.match(act, /01\.09\.2026–01\.09\.2026: день без выезда; Выезда не было; основание: Запись календаря/);
  assert.doesNotMatch(act, /технического простоя|технический простой|поломк/i);
  assert.match(act, /Основание и период простоя/);
  assert.match(act, /Постоянная часть Ф<\/td><td class="value">72[\s ]333,33/);
  const technical = { ...input, downtimes: [{ ...input.downtimes[0], kind: "technical", reason: "Ремонт" }] };
  assert.match(tools.buildRentActHtml(technical), /технический простой; Ремонт/);
  const legacy = { ...input, downtimes: [{ ...input.downtimes[0], kind: undefined, reason: "Ремонт" }] };
  assert.match(tools.buildRentActHtml(legacy), /01\.09\.2026–01\.09\.2026: Ремонт; основание/);
});
