import assert from "node:assert/strict";
import test from "node:test";
import { documentTools } from "./pdf-fixture.mjs";

const tools = documentTools();
const settings = { ...tools.DEFAULT_DOCUMENT_SETTINGS, rateKopecks: 4_000 };
const entry = (day, units = 10) => ({ entryDate: `2026-09-${String(day).padStart(2, "0")}`, units });
const fuel = (day, amountKopecks, extra = {}) => ({ expenseDate: `2026-09-${String(day).padStart(2, "0")}`,
  category: "fuel", payer: "customer", amountKopecks, ...extra });
const invoice = (id, start, end, extra = {}) => ({ id, invoiceNumber: `TEST-${id}`, period: "2026-09",
  kind: "fixed", invoiceDate: "2026-09-20", amountKopecks: 100_000,
  bottleStartDate: `2026-09-${String(start).padStart(2, "0")}`,
  bottleEndDate: `2026-09-${String(end).padStart(2, "0")}`, ...extra });
const suggest = (extra = {}) => tools.suggestInvoicePeriods({ period: "2026-09", kind: "fixed",
  invoiceDate: "2026-09-30", entries: [], invoices: [], expenses: [], settings, ...extra });
const dates = (result) => result.periods.map(({ startDate, endDate }) => [startDate, endDate]);

test("invoice suggestions aggregate daily records and report gross bottles separately from customer fuel", () => {
  const result = suggest({ invoiceDate: "2026-09-03", entries: [entry(3, 110), entry(1, 60), entry(2, 110), entry(1, 40)],
    expenses: [fuel(2, 50_000), fuel(2, 70_000), fuel(2, 90_000, { payer: "self" }),
      fuel(3, 80_000, { category: "repair" }), fuel(4, 100_000)] });
  assert.deepEqual(result, { periods: [{ startDate: "2026-09-01", endDate: "2026-09-03", units: 320,
    customerFuelKopecks: 120_000, grossKopecks: 1_280_000 }], needsReview: false,
    legacyInvoiceNumbers: [], hasRelevantDays: true });
  assert.equal("amountKopecks" in result.periods[0], false);
});

test("zero entries and fuel-only days are real endpoints without inventing empty trailing dates", () => {
  const result = suggest({ invoiceDate: "2026-09-06", entries: [entry(1, 0), entry(3, 30)],
    expenses: [fuel(5, 60_000)] });
  assert.deepEqual(result.periods, [{ startDate: "2026-09-01", endDate: "2026-09-05", units: 30,
    customerFuelKopecks: 60_000, grossKopecks: 120_000 }]);
  const onlyFuel = suggest({ expenses: [fuel(12, 75_000)] });
  assert.deepEqual(onlyFuel.periods, [{ startDate: "2026-09-12", endDate: "2026-09-12", units: 0,
    customerFuelKopecks: 75_000, grossKopecks: 0 }]);
});

test("invoice date, selected month and lease bounds limit the suggested calendar days", () => {
  const entries = [{ entryDate: "2026-08-31", units: 99 }, entry(2, 99), entry(3, 10), entry(10, 20),
    entry(20, 30), entry(21, 99), { entryDate: "2026-10-01", units: 99 }];
  const boundedSettings = { ...settings, rentalStart: "2026-09-03", rentalEnd: "2026-09-20" };
  const beforeEnd = suggest({ entries, settings: boundedSettings, invoiceDate: "2026-09-10" });
  assert.deepEqual(dates(beforeEnd), [["2026-09-03", "2026-09-10"]]);
  assert.equal(beforeEnd.periods[0].units, 30);
  const laterInvoice = suggest({ entries, settings: boundedSettings, invoiceDate: "2026-10-10" });
  assert.deepEqual(dates(laterInvoice), [["2026-09-03", "2026-09-20"]]);
  assert.equal(laterInvoice.periods[0].units, 60);
  const monthEnd = suggest({ invoiceDate: "2026-10-10", entries: [entry(30), { entryDate: "2026-10-01", units: 99 }] });
  assert.deepEqual(dates(monthEnd), [["2026-09-30", "2026-09-30"]]);
});

test("known invoice ranges divide suggestions even when the intervening days have no records", () => {
  const result = suggest({ entries: [entry(12), entry(9), entry(6), entry(3), entry(1)],
    invoices: [invoice(1, 2, 4), invoice(2, 7, 8, { kind: "other" }), invoice(3, 10, 11)] });
  assert.deepEqual(dates(result), [["2026-09-01", "2026-09-01"], ["2026-09-06", "2026-09-06"],
    ["2026-09-09", "2026-09-09"], ["2026-09-12", "2026-09-12"]]);
  assert.equal(result.periods.reduce((sum, period) => sum + period.units, 0), 40);
  assert.equal(result.needsReview, false);
});

test("fixed and variable invoices can share bottle dates while other invoices block either part", () => {
  const entries = [entry(1), entry(3), entry(5)];
  assert.deepEqual(dates(suggest({ entries, invoices: [invoice(1, 2, 4, { kind: "variable" })] })),
    [["2026-09-01", "2026-09-05"]]);
  assert.deepEqual(dates(suggest({ kind: "variable", entries, invoices: [invoice(1, 2, 4)] })),
    [["2026-09-01", "2026-09-05"]]);
  for (const kind of ["fixed", "variable"]) {
    assert.deepEqual(dates(suggest({ kind, entries, invoices: [invoice(1, 2, 4, { kind: "other" })] })),
      [["2026-09-01", "2026-09-01"], ["2026-09-05", "2026-09-05"]]);
  }
  assert.deepEqual(dates(suggest({ kind: "other", entries, invoices: [invoice(1, 2, 4)] })),
    [["2026-09-01", "2026-09-01"], ["2026-09-05", "2026-09-05"]]);
});

test("paid invoices issued after the new invoice date still reserve their saved bottle periods", () => {
  const result = suggest({ invoiceDate: "2026-09-12", entries: [entry(1), entry(5), entry(8), entry(12)],
    invoices: [invoice(1, 5, 8, { invoiceDate: "2026-10-15", paidKopecks: 100_000, outstandingKopecks: 0 })] });
  assert.deepEqual(dates(result), [["2026-09-01", "2026-09-01"], ["2026-09-12", "2026-09-12"]]);
  assert.equal(result.periods.reduce((sum, period) => sum + period.units, 0), 20);
});

test("legacy invoices retain candidate periods but require manual review of unknown reservations", () => {
  const result = suggest({ entries: [entry(1), entry(3)], invoices: [
    invoice(1, 1, 2, { bottleStartDate: undefined, bottleEndDate: undefined }),
    invoice(2, 1, 2, { kind: "other", bottleStartDate: undefined, bottleEndDate: undefined }),
    invoice(3, 1, 2, { kind: "variable", bottleStartDate: undefined, bottleEndDate: undefined }),
    invoice(4, 1, 2, { period: "2026-08", bottleStartDate: undefined, bottleEndDate: undefined }),
  ] });
  assert.deepEqual(dates(result), [["2026-09-01", "2026-09-03"]]);
  assert.equal(result.needsReview, true);
  assert.deepEqual(result.legacyInvoiceNumbers, ["TEST-1", "TEST-2"]);
});

test("partial, reversed, impossible and cross-month saved invoice ranges require review", () => {
  for (const malformed of [
    { bottleStartDate: "2026-09-01", bottleEndDate: undefined },
    { bottleStartDate: "2026-09-05", bottleEndDate: "2026-09-03" },
    { bottleStartDate: "2026-09-31", bottleEndDate: "2026-09-31" },
    { bottleStartDate: "2026-08-31", bottleEndDate: "2026-09-03" },
  ]) {
    const result = suggest({ entries: [entry(1), entry(3)], invoices: [invoice(1, 1, 3, malformed)] });
    assert.equal(result.needsReview, true);
    assert.deepEqual(result.legacyInvoiceNumbers, ["TEST-1"]);
    assert.deepEqual(dates(result), [["2026-09-01", "2026-09-03"]]);
  }
});

test("an invoice lacking a kind is handled conservatively instead of permitting a shared part", () => {
  const result = suggest({ entries: [entry(1), entry(3)], invoices: [invoice(1, 1, 2, { kind: undefined })] });
  assert.deepEqual(dates(result), [["2026-09-03", "2026-09-03"]]);
  const legacy = suggest({ entries: [entry(1)], invoices: [invoice(1, 1, 2,
    { kind: undefined, bottleStartDate: undefined, bottleEndDate: undefined })] });
  assert.equal(legacy.needsReview, true);
});

test("fully reserved dates differ from a month with no relevant daily records", () => {
  const reserved = suggest({ entries: [entry(1)], expenses: [fuel(2, 50_000)], invoices: [invoice(1, 1, 2)] });
  assert.deepEqual(reserved.periods, []);
  assert.equal(reserved.hasRelevantDays, true);
  assert.equal(reserved.needsReview, false);
  const empty = suggest({ entries: [{ entryDate: "2026-08-31", units: 10 }],
    expenses: [fuel(1, 50_000, { payer: "self" })] });
  assert.deepEqual(empty.periods, []);
  assert.equal(empty.hasRelevantDays, false);
});

test("editing excludes only that invoice while keeping other reservations and unknown ranges", () => {
  const result = suggest({ excludeInvoiceId: 1, entries: [entry(1), entry(3), entry(5)],
    invoices: [invoice(1, 1, 3), invoice(2, 4, 5)] });
  assert.deepEqual(dates(result), [["2026-09-01", "2026-09-03"]]);
  const oldInvoice = suggest({ excludeInvoiceId: 1, entries: [entry(1)], invoices: [
    invoice(1, 1, 3, { bottleStartDate: undefined, bottleEndDate: undefined }),
    invoice(2, 1, 3, { bottleStartDate: undefined, bottleEndDate: undefined }),
  ] });
  assert.deepEqual(oldInvoice.legacyInvoiceNumbers, ["TEST-2"]);
  assert.equal(oldInvoice.needsReview, true);
});

test("blank or invalid invoice dates and dates before the month offer no periods", () => {
  for (const invoiceDate of ["", "2026-09-31", "2026-08-31"]) {
    const result = suggest({ invoiceDate, entries: [entry(1), entry(3)] });
    assert.deepEqual(result.periods, []);
    assert.equal(result.hasRelevantDays, false);
  }
  const outsideLease = suggest({ entries: [entry(1)], settings: { ...settings, rentalStart: "2026-10-01" } });
  assert.deepEqual(outsideLease.periods, []);
  const invalidPeriod = suggest({ period: "2026-13", entries: [entry(1)] });
  assert.deepEqual(invalidPeriod.periods, []);
});

test("suggesting dates leaves source records and invoice amounts unchanged", () => {
  const input = { entries: [entry(1), entry(3)], invoices: [invoice(1, 1, 1)], expenses: [fuel(3, 50_000)] };
  const original = JSON.stringify(input);
  suggest(input);
  assert.equal(JSON.stringify(input), original);
});
