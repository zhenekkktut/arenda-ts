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
  assert.equal(adjustment.roundingKopecks, 2_000);
  assert.equal(adjustment.calculation.actualUnits, 1_825);
  assert.equal(adjustment.calculation.intensityKopecks, 7_300_000);
  assert.equal(adjustment.calculation.baseKopecks, 6_748_000);
  assert.equal(adjustment.calculation.variableKopecks, 552_000);
  assert.equal(adjustment.calculation.totalKopecks, 7_300_000);
});

test("the full rounded deduction applies below the original fixed minimum", () => {
  const gross = grossCalculation(1_800);
  const adjustment = tools.calculateFuelAdjustment(period, gross, [fuel(1_250_000)]);
  assert.equal(gross.totalKopecks, 8_000_000);
  assert.equal(gross.baseKopecks, 8_000_000);
  assert.equal(adjustment.calculation.actualUnits, 1_487);
  assert.equal(adjustment.calculation.intensityKopecks, 5_948_000);
  assert.equal(adjustment.calculation.baseKopecks, 6_748_000);
  assert.equal(adjustment.calculation.variableKopecks, 0);
  assert.equal(adjustment.calculation.totalKopecks, 6_748_000);
  assert.equal(tools.calculateSettlement(period, gross, [], [fuel(1_250_000)]).netRentKopecks, 6_748_000);
});

test("months without customer fuel retain the original rent calculation", () => {
  const gross = grossCalculation();
  const adjustment = tools.calculateFuelAdjustment(period, gross, []);
  assert.deepEqual(adjustment.calculation, gross);
  for (const field of ["customerFuelKopecks", "fuelUnits", "roundedFuelKopecks", "fuelDeductionKopecks", "roundingKopecks"]) {
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

test("fuel beyond the full charge caps payable rent and adjusted bottles at zero", () => {
  const gross = grossCalculation(100);
  const adjustment = tools.calculateFuelAdjustment(period, gross, [fuel(10_000_000)]);
  assert.equal(adjustment.customerFuelKopecks, 10_000_000);
  assert.equal(adjustment.fuelUnits, 2_500);
  assert.equal(adjustment.roundedFuelKopecks, 10_000_000);
  assert.equal(adjustment.fuelDeductionKopecks, gross.totalKopecks);
  assert.equal(adjustment.calculation.actualUnits, 0);
  assert.equal(adjustment.calculation.baseKopecks, 0);
  assert.equal(adjustment.calculation.intensityKopecks, 0);
  assert.equal(adjustment.calculation.variableKopecks, 0);
  assert.equal(adjustment.calculation.totalKopecks, 0);
  assert.equal(tools.calculateSettlement(period, gross, [], [fuel(10_000_000)]).netRentKopecks, 0);
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
  assert.equal(adjustment.roundingKopecks, 0);
  assert.equal(adjustment.calculation.actualUnits, gross.actualUnits);
  assert.equal(adjustment.calculation.intensityKopecks, 0);
  assert.equal(adjustment.calculation.baseKopecks, 6_750_000);
  assert.equal(adjustment.calculation.totalKopecks, 6_750_000);
  assert.equal(tools.calculateSettlement(period, gross, [], expenses).netRentKopecks, 6_750_000);
  assert.equal(JSON.stringify({ gross, expenses }), original);
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
  assert.match(act, /Постоянная часть Ф<\/td><td class="value">67[\s ]480,00 руб\./);
  assert.doesNotMatch(act, /топлив|округлен|12[\s ]520/i);
  assert.match(reconciliation, /41[\s ]800,00/);
  assert.match(reconciliation, /Осталось выставить[\s\S]*?29[\s ]500,00/);
  assert.equal(JSON.stringify(input), original, "Document generation and calculations must preserve old phone records");
});
