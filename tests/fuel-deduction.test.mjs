import assert from "node:assert/strict";
import test from "node:test";
import { documentTools } from "./pdf-fixture.mjs";

const tools = documentTools();
const period = "2026-09";
const settings = { ...tools.DEFAULT_DOCUMENT_SETTINGS };
const entries = [{ entryDate: "2026-09-10", units: 2_138, note: "Фактический вывоз" }];
const fuel = (amountKopecks, expenseDate = "2026-09-12", extra = {}) => ({
  expenseDate, category: "fuel", payer: "customer", amountKopecks, documentNumber: "", note: "", ...extra,
});
const grossCalculation = (units = 2_138) => tools.calculateRental(period,
  [{ entryDate: "2026-09-10", units }], [], settings);

test("customer fuel is summed for the month before rounding the bottle deduction upwards", () => {
  const gross = grossCalculation();
  const expenses = [fuel(277_000, "2026-09-12"), fuel(354_000, "2026-09-18"),
    fuel(354_000, "2026-09-23"), fuel(265_000, "2026-09-28")];
  const adjustment = tools.calculateFuelAdjustment(period, gross, expenses);
  assert.equal(gross.totalKopecks, 8_552_000);
  assert.equal(adjustment.customerFuelKopecks, 1_250_000);
  assert.equal(adjustment.fuelUnits, 313, "Rounding each fuel record separately would wrongly deduct 315 bottles");
  assert.equal(adjustment.roundedFuelKopecks, 1_252_000);
  assert.equal(adjustment.fuelDeductionKopecks, 1_252_000);
  assert.equal(adjustment.variableFuelKopecks, 1_252_000);
  assert.equal(adjustment.fixedFuelKopecks, 0);
  assert.equal(adjustment.roundingKopecks, 2_000);
  assert.equal(adjustment.calculation.actualUnits, 1_825);
  assert.equal(adjustment.calculation.intensityKopecks, 7_300_000);
  assert.equal(adjustment.calculation.baseKopecks, 8_000_000);
  assert.equal(adjustment.calculation.variableKopecks, -700_000);
  assert.equal(adjustment.calculation.totalKopecks, 7_300_000);
});

test("the full rounded deduction makes variable rent negative while keeping fixed rent intact", () => {
  const gross = grossCalculation(1_800);
  const adjustment = tools.calculateFuelAdjustment(period, gross, [fuel(1_250_000)]);
  assert.equal(gross.totalKopecks, 8_000_000);
  assert.equal(gross.baseKopecks, 8_000_000);
  assert.equal(adjustment.variableFuelKopecks, 1_252_000);
  assert.equal(adjustment.fixedFuelKopecks, 0);
  assert.equal(adjustment.calculation.actualUnits, 1_487);
  assert.equal(adjustment.calculation.intensityKopecks, 5_948_000);
  assert.equal(adjustment.calculation.baseKopecks, 8_000_000);
  assert.equal(adjustment.calculation.variableKopecks, -1_252_000);
  assert.equal(adjustment.calculation.totalKopecks, 6_748_000);
  assert.equal(tools.calculateSettlement(period, gross, [], [fuel(1_250_000)]).netRentKopecks, 6_748_000);
});

test("months without customer fuel retain the original rent calculation", () => {
  const gross = grossCalculation();
  const adjustment = tools.calculateFuelAdjustment(period, gross, []);
  assert.deepEqual(adjustment.calculation, gross);
  for (const field of ["customerFuelKopecks", "fuelUnits", "roundedFuelKopecks", "fuelDeductionKopecks", "roundingKopecks",
    "variableFuelKopecks", "fixedFuelKopecks"]) {
    assert.equal(adjustment[field], 0);
  }
});

test("own fuel, other expense categories and other months do not reduce this month rent", () => {
  const gross = grossCalculation();
  const expenses = [fuel(1_250_000, "2026-09-12", { payer: "self" }),
    fuel(1_250_000, "2026-09-12", { category: "repair" }), fuel(1_250_000, "2026-08-31"),
    fuel(1_250_000, "2026-10-01")];
  const adjustment = tools.calculateFuelAdjustment(period, gross, expenses);
  assert.equal(adjustment.customerFuelKopecks, 0);
  assert.deepEqual(adjustment.calculation, gross);
  assert.equal(tools.calculateSettlement(period, gross, [], expenses).netRentKopecks, gross.totalKopecks);
});

test("fuel beyond the full charge retains the negative monthly credit and never changes fixed rent", () => {
  const gross = grossCalculation(100);
  const adjustment = tools.calculateFuelAdjustment(period, gross, [fuel(10_000_000)]);
  assert.equal(adjustment.customerFuelKopecks, 10_000_000);
  assert.equal(adjustment.fuelUnits, 2_500);
  assert.equal(adjustment.roundedFuelKopecks, 10_000_000);
  assert.equal(adjustment.fuelDeductionKopecks, 10_000_000);
  assert.equal(adjustment.variableFuelKopecks, 10_000_000);
  assert.equal(adjustment.fixedFuelKopecks, 0);
  assert.equal(adjustment.calculation.actualUnits, 0);
  assert.equal(adjustment.calculation.baseKopecks, gross.baseKopecks);
  assert.equal(adjustment.calculation.intensityKopecks, 0);
  assert.equal(adjustment.calculation.variableKopecks, -10_000_000);
  assert.equal(adjustment.calculation.totalKopecks, -2_000_000);
  const settlement = tools.calculateSettlement(period, gross, [], [fuel(10_000_000)]);
  assert.equal(settlement.netRentKopecks, -2_000_000);
  assert.equal(settlement.fixedTargetKopecks, 8_000_000);
  assert.equal(settlement.variableTargetKopecks, -10_000_000);
  assert.equal(settlement.remainingToInvoiceKopecks, 0);
  assert.equal(settlement.fixedRemainingKopecks, 0);
  assert.equal(settlement.variableRemainingKopecks, 0);
});

test("old zero-rate settings use an exact money deduction without dividing or changing bottles", () => {
  const zeroRateSettings = { ...settings, rateKopecks: 0 };
  const gross = tools.calculateRental(period, entries, [], zeroRateSettings);
  const expenses = [fuel(1_250_000)];
  const original = JSON.stringify({ gross, expenses });
  const adjustment = tools.calculateFuelAdjustment(period, gross, expenses);
  assert.equal(adjustment.customerFuelKopecks, 1_250_000);
  assert.equal(adjustment.fuelUnits, 0);
  assert.equal(adjustment.roundedFuelKopecks, 1_250_000);
  assert.equal(adjustment.fuelDeductionKopecks, 1_250_000);
  assert.equal(adjustment.variableFuelKopecks, 1_250_000);
  assert.equal(adjustment.fixedFuelKopecks, 0);
  assert.equal(adjustment.roundingKopecks, 0);
  assert.equal(adjustment.calculation.actualUnits, gross.actualUnits);
  assert.equal(adjustment.calculation.intensityKopecks, 0);
  assert.equal(adjustment.calculation.baseKopecks, 8_000_000);
  assert.equal(adjustment.calculation.variableKopecks, -1_250_000);
  assert.equal(adjustment.calculation.totalKopecks, 6_750_000);
  assert.equal(tools.calculateSettlement(period, gross, [], expenses).netRentKopecks, 6_750_000);
  assert.equal(JSON.stringify({ gross, expenses }), original);
});

test("fuel is paid entirely from available variable rent and preserves fixed proposals and the act formula", () => {
  const downtimes = [{ id: 1, startDate: "2026-09-01", endDate: "2026-09-09", reason: "Простой", note: "" }];
  const gross = tools.calculateRental(period, entries, downtimes, settings);
  const expenses = [fuel(1_250_000)];
  const invoices = [{ id: 28, period, invoiceNumber: "28", invoiceDate: "2026-09-16", kind: "fixed", amountKopecks: 3_120_000 },
    { id: 29, period, invoiceNumber: "29", invoiceDate: "2026-10-02", kind: "fixed", amountKopecks: 1_230_000 }];
  const input = { settings, meta: { ...tools.defaultDocumentMeta(period, 1, "2026-10-03"),
    asOfDate: "2026-10-03", openingBalanceKopecks: 0 }, entries, calculation: gross, downtimes,
    invoices, payments: [], expenses };
  const original = JSON.stringify(input);
  const adjustment = tools.calculateFuelAdjustment(period, gross, expenses);
  assert.equal(gross.baseKopecks, 5_600_000);
  assert.equal(gross.variableKopecks, 2_952_000);
  assert.equal(adjustment.variableFuelKopecks, 1_252_000);
  assert.equal(adjustment.fixedFuelKopecks, 0);
  assert.equal(adjustment.calculation.actualUnits, 1_825);
  assert.equal(adjustment.calculation.baseKopecks, 5_600_000);
  assert.equal(adjustment.calculation.intensityKopecks, 7_300_000);
  assert.equal(adjustment.calculation.variableKopecks, 1_700_000);
  assert.equal(adjustment.calculation.totalKopecks, 7_300_000);
  const settlement = tools.calculateSettlement(period, gross, invoices, expenses);
  assert.equal(settlement.fixedTargetKopecks, 5_600_000);
  assert.equal(settlement.variableTargetKopecks, 1_700_000);
  assert.equal(settlement.totalInvoicedKopecks, 4_350_000);
  assert.equal(settlement.fixedRemainingKopecks, 1_250_000);
  assert.equal(settlement.variableRemainingKopecks, 1_700_000);
  assert.equal(settlement.remainingToInvoiceKopecks, 2_950_000);
  assert.equal(settlement.fixedRemainingKopecks + settlement.variableRemainingKopecks,
    settlement.remainingToInvoiceKopecks);
  const act = tools.buildRentActHtml(input);
  assert.match(act, /Постоянная часть Ф = 80[\s ]000 × d \/ D<\/td><td class="value">56[\s ]000,00 руб\./);
  assert.match(act, /Учтено единиц интенсивности N, штук<\/td><td class="value">1[\s ]825<\/td>/);
  assert.match(act, /Переменная часть П<\/td><td class="value">17[\s ]000,00 руб\./);
  assert.doesNotMatch(act, /топлив|округлен|12[\s ]520/i);
  assert.equal(JSON.stringify(input), original);
});

test("act, settlement and reconciliation agree without reducing issued invoice or payment amounts", () => {
  const gross = tools.calculateRental(period, entries, [], settings);
  const invoices = [
    { id: 28, period, invoiceNumber: "28", invoiceDate: "2026-09-16", kind: "fixed",
      bottleStartDate: "2026-09-10", bottleEndDate: "2026-09-16", amountKopecks: 3_120_000 },
    { id: 29, period, invoiceNumber: "29", invoiceDate: "2026-10-02", kind: "fixed", amountKopecks: 1_230_000 },
  ];
  const payments = [{ invoiceId: 28, paymentDate: "2026-09-18", amountKopecks: 3_120_000,
    method: "bank", documentNumber: "ПП-28" }];
  const expenses = [fuel(1_250_000)];
  const input = { settings, meta: { ...tools.defaultDocumentMeta(period, 1, "2026-10-03"),
    asOfDate: "2026-10-03", openingBalanceKopecks: 0 }, entries, calculation: gross, downtimes: [],
    invoices, payments, expenses };
  const original = JSON.stringify(input);
  const adjustment = tools.calculateFuelAdjustment(period, gross, expenses);
  const settlement = tools.calculateSettlement(period, gross, invoices, expenses);
  const summary = tools.reconciliationSummary(input);
  assert.equal(adjustment.calculation.totalKopecks, 7_300_000);
  assert.equal(settlement.netRentKopecks, 7_300_000);
  assert.equal(settlement.totalInvoicedKopecks, 4_350_000);
  assert.equal(settlement.remainingToInvoiceKopecks, 2_950_000);
  assert.equal(summary.paidKopecks, 3_120_000);
  assert.equal(summary.balance, 4_180_000);
  assert.equal(invoices[0].amountKopecks - summary.paidKopecks, 0);
  assert.equal(invoices[1].amountKopecks, 1_230_000);
  const act = tools.buildRentActHtml(input);
  const reconciliation = tools.buildReconciliationHtml(input);
  assert.match(act, /Сумма прописью:[\s\S]*?73[\s ]000/);
  assert.match(act, /Учтено единиц интенсивности N, штук<\/td><td class="value">1[\s ]825<\/td>/);
  assert.match(act, /Постоянная часть Ф = 80[\s ]000 × d \/ D<\/td><td class="value">80[\s ]000,00 руб\./);
  assert.match(act, /Переменная часть П<\/td><td class="value">-7[\s ]000,00 руб\./);
  assert.match(act, /Итого: Ф \+ П<\/td><td class="value">73[\s ]000,00 руб\./);
  assert.doesNotMatch(act, /топлив|округлен|12[\s ]520/i);
  assert.match(reconciliation, /41[\s ]800,00/);
  assert.match(reconciliation, /Осталось выставить[\s\S]*?29[\s ]500,00/);
  assert.equal(JSON.stringify(input), original, "Document generation and calculations must preserve old phone records");
});

test("negative variable rent is shown explicitly and a negative monthly total remains a credit in both acts", () => {
  const gross = grossCalculation(100);
  const input = { settings, meta: { ...tools.defaultDocumentMeta(period, 1, "2026-10-03"),
    asOfDate: "2026-10-03", openingBalanceKopecks: 0 }, entries, calculation: gross, downtimes: [],
    invoices: [{ id: 1, period, invoiceNumber: "OLD", invoiceDate: "2026-10-01", kind: "fixed",
      amountKopecks: 1_000_000, allocationMode: "unlinked" }],
    payments: [{ invoiceId: 1, paymentDate: "2026-10-02", amountKopecks: 500_000 }],
    expenses: [fuel(10_000_000)] };
  const original = structuredClone(input);
  const summary = tools.reconciliationSummary(input);
  assert.equal(summary.netRentKopecks, -2_000_000);
  assert.equal(summary.balance, -2_500_000);
  const rent = tools.buildRentActHtml(input);
  assert.match(rent, /Постоянная часть Ф = 80[\s ]000 × d \/ D<\/td><td class="value">80[\s ]000,00 руб\./);
  assert.match(rent, /Переменная часть П<\/td><td class="value">-100[\s ]000,00 руб\./);
  assert.match(rent, /Итого: Ф \+ П<\/td><td class="value">-20[\s ]000,00 руб\./);
  assert.match(rent, /Сумма прописью:[\s\S]*?-20[\s ]000 \(Минус двадцать тысяч\) рублей 00 копеек/);
  assert.doesNotMatch(rent, /топлив|округлен|большая из сумм|если результат положительный/i);
  const reconciliation = tools.buildReconciliationHtml(input);
  assert.match(reconciliation, /Переплата Арендатора на 03\.10\.2026<\/td><td class="value">25[\s ]000,00/);
  assert.match(reconciliation, /Итог за месяц в пользу Арендатора после вычета топлива<\/td><td class="value">20[\s ]000,00/);
  assert.match(reconciliation, /Осталось выставить<\/td>\s*<td class="value">0,00/);
  assert.deepEqual(input, original);
  assert.equal(tools.moneyWords(-2_000_001), "Минус двадцать тысяч рублей 01 копейка");
});
