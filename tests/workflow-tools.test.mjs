import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = fs.readFileSync(new URL("../app/workflow-tools.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const module = { exports: {} };
new Function("exports", "module", compiled)(module.exports, module);
const { nextInvoiceNumber, missingEntryDates, linkedAsOfDate } = module.exports;

const invoices = (...numbers) => numbers.map((invoiceNumber) => ({ invoiceNumber }));
const fullLease = { rentalStart: "2026-01-01", rentalEnd: "2027-12-31" };
const missing = (extra = {}) => {
  const values = { period: "2026-10", today: "2026-10-05", settings: fullLease,
    entries: [], downtimes: [], ...extra };
  return missingEntryDates(values.period, values.today, values.settings, values.entries, values.downtimes);
};

test("invoice numbers use the largest number across history, including padded numbers", () => {
  const history = invoices("6", " 0031 ", "12", "31", "custom/99");
  const unchanged = structuredClone(history);
  assert.equal(nextInvoiceNumber(history), "32");
  assert.deepEqual(history, unchanged);
  assert.equal(nextInvoiceNumber(invoices("0", "000")), "1");
});

test("an empty phone starts at one and nonnumeric numbering stays manual", () => {
  assert.equal(nextInvoiceNumber([]), "1");
  assert.equal(nextInvoiceNumber(invoices("С-24", "2026/32", " ")), "");
  assert.equal(nextInvoiceNumber(invoices("1.5", "-4", "1e3", "Infinity")), "");
  assert.equal(nextInvoiceNumber(invoices("С-24", "15", "2026/32")), "16");
});

test("number suggestion stops before unsafe arithmetic and does not choose a colliding number", () => {
  const safe = String(Number.MAX_SAFE_INTEGER);
  assert.equal(nextInvoiceNumber(invoices(String(Number.MAX_SAFE_INTEGER - 1))), safe);
  assert.equal(nextInvoiceNumber(invoices(safe)), "");
  assert.equal(nextInvoiceNumber(invoices("12", "9007199254740992")), "");
  assert.equal(nextInvoiceNumber(invoices("9".repeat(400))), "");
  assert.equal(nextInvoiceNumber(invoices("1", "02", "3", "0004")), "5");
  for (const malformed of [null, { invoiceNumber: 31 }, { invoiceNumber: null }, { invoiceNumber: {} }]) {
    const history = [{ invoiceNumber: "12" }, malformed];
    const unchanged = structuredClone(history);
    assert.equal(nextInvoiceNumber(history), "");
    assert.deepEqual(history, unchanged);
  }
});

test("missing records include today, skip Sundays and accept a saved zero quantity", () => {
  assert.deepEqual(missing({ entries: [{ entryDate: "2026-10-02", units: 0 }] }),
    ["2026-10-01", "2026-10-03", "2026-10-05"]);
  assert.deepEqual(missing({ today: "2026-10-04" }), ["2026-10-01", "2026-10-02", "2026-10-03"]);
});

test("missing records are clipped to the rental dates and confirmed overlapping downtime", () => {
  const settings = { rentalStart: "2026-10-02", rentalEnd: "2026-10-07" };
  const downtimes = [
    { startDate: "2026-09-30", endDate: "2026-10-02" },
    { startDate: "2026-10-05", endDate: "2026-10-06" },
    { startDate: "2026-10-06", endDate: "2026-10-20" },
  ];
  assert.deepEqual(missing({ today: "2026-10-31", settings, downtimes }), ["2026-10-03"]);
  assert.deepEqual(missing({ settings: { ...settings, rentalStart: "2026-11-01", rentalEnd: "2027-01-31" } }), []);
});

test("a future month and a month after the lease have no missing records", () => {
  assert.deepEqual(missing({ period: "2026-11" }), []);
  assert.deepEqual(missing({ settings: { rentalStart: "2026-08-01", rentalEnd: "2026-09-30" } }), []);
});

test("calendar bounds work across December and January without spilling into a neighboring month", () => {
  const settings = { rentalStart: "2026-12-30", rentalEnd: "2027-01-02" };
  assert.deepEqual(missing({ period: "2026-12", today: "2027-01-02", settings }),
    ["2026-12-30", "2026-12-31"]);
  assert.deepEqual(missing({ period: "2027-01", today: "2027-01-02", settings }),
    ["2027-01-01", "2027-01-02"]);
});

test("February includes leap day only in a leap year", () => {
  assert.deepEqual(missing({ period: "2028-02", today: "2028-03-03",
    settings: { rentalStart: "2028-02-28", rentalEnd: "2028-03-03" } }),
    ["2028-02-28", "2028-02-29"]);
  assert.deepEqual(missing({ period: "2027-02", today: "2027-03-03",
    settings: { rentalStart: "2027-02-27", rentalEnd: "2027-03-03" } }), ["2027-02-27"]);
});

test("malformed dates do not produce invented missing days", () => {
  for (const extra of [{ period: "2026-13" }, { period: "2026-2" }, { today: "2026-02-30" },
    { settings: { ...fullLease, rentalStart: "" } },
    { settings: { rentalStart: "2026-11-01", rentalEnd: "2026-10-01" } }]) {
    assert.deepEqual(missing(extra), []);
  }
  assert.deepEqual(missing({ downtimes: [
    { startDate: "2026-10-07", endDate: "2026-10-01" },
    { startDate: "2026-02-30", endDate: "2026-10-31" },
  ] }), ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-05"]);
});

test("workflow helpers leave saved records and rental dates untouched", () => {
  const input = { settings: { ...fullLease }, entries: [{ entryDate: "2026-10-01" }],
    downtimes: [{ startDate: "2026-10-02", endDate: "2026-10-03" }] };
  const unchanged = structuredClone(input);
  assert.deepEqual(missing(input), ["2026-10-05"]);
  assert.deepEqual(input, unchanged);
});

test("reconciliation date follows document date while the dates are linked", () => {
  assert.equal(linkedAsOfDate("2026-10-05", "2026-10-03", "2026-10-03"), "2026-10-05");
});

test("changing document date preserves a separately selected reconciliation date", () => {
  assert.equal(linkedAsOfDate("2026-10-05", "2026-10-03", "2026-10-04"), "2026-10-04");
  assert.equal(linkedAsOfDate("2026-10-05", "2026-10-03", ""), "");
});
