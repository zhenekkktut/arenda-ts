import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = fs.readFileSync(new URL("../app/invoice-allocation.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
} }).outputText;
const module = { exports: {} };
new Function("exports", "module", compiled)(module.exports, module);
const { proposeInvoiceAllocation: propose, validateInvoiceAllocation: validate } = module.exports;

const entry = (day, units) => ({ entryDate: `2026-09-${String(day).padStart(2, "0")}`, units });
const row = (day, amountKopecks) => ({ date: `2026-09-${String(day).padStart(2, "0")}`, amountKopecks });
const base = (extra = {}) => ({ period: "2026-09", invoiceDate: "2026-10-02", amountKopecks: 1_230_000,
  kind: "fixed", entries: [entry(17, 145), entry(18, 255), entry(19, 100)], invoices: [],
  settings: { rentalStart: "2026-08-01", rentalEnd: "2027-07-31", rateKopecks: 4_000 },
  fixedTargetKopecks: 5_600_000, netRentKopecks: 7_300_000, ...extra });
const candidate = (bottleAllocations, rentalSupplementKopecks = 0) => ({ allocationVersion: 1,
  bottleAllocations, rentalSupplementKopecks });
const invoice = (id, amountKopecks, allocations, extra = {}) => ({ id, invoiceNumber: String(id),
  period: "2026-09", invoiceDate: "2026-09-20", kind: "fixed", amountKopecks,
  ...candidate(allocations), ...extra });
const accepted = (proposal) => candidate(proposal.bottleAllocations, proposal.rentalSupplementKopecks);

test("an exact 12300-ruble invoice splits the last actual date, not its physical bottles", () => {
  const input = base();
  const unchanged = structuredClone(input);
  const result = propose(input);
  assert.deepEqual(result.bottleAllocations, [row(17, 580_000), row(18, 650_000)]);
  assert.equal(result.coveredKopecks, 1_230_000);
  assert.equal(result.uncoveredKopecks, 0);
  assert.equal(result.lastDayRemainingKopecks, 370_000);
  assert.equal(result.startDate, "2026-09-17");
  assert.equal(result.endDate, "2026-09-18");
  assert.equal(result.ready, true);
  assert.deepEqual(result.days[1], { date: "2026-09-18", units: 255, grossKopecks: 1_020_000,
    alreadyAllocatedKopecks: 0, amountKopecks: 650_000, remainingKopecks: 370_000 });
  assert.deepEqual(validate(input, accepted(result)), accepted(result));
  assert.deepEqual(input, unchanged);
});

test("the next same-kind invoice starts with the unpaid allocation remainder of the previous date", () => {
  const first = invoice(1, 1_230_000, [row(17, 580_000), row(18, 650_000)]);
  const input = base({ amountKopecks: 400_000, invoices: [first] });
  const result = propose(input);
  assert.deepEqual(result.bottleAllocations, [row(18, 370_000), row(19, 30_000)]);
  assert.equal(result.days.find((day) => day.date.endsWith("18")).alreadyAllocatedKopecks, 650_000);
  assert.equal(result.lastDayRemainingKopecks, 370_000);
  assert.equal(result.ready, true);
  validate(input, accepted(result));
});

test("fixed and variable invoice kinds share one money ledger rather than charging bottles twice", () => {
  const first = invoice(1, 1_230_000, [row(17, 580_000), row(18, 650_000)]);
  for (const kind of ["fixed", "variable", "other"]) {
    const input = base({ kind, amountKopecks: 370_000, invoices: [first] });
    const result = propose(input);
    assert.deepEqual(result.bottleAllocations, [row(18, 370_000)]);
    assert.equal(result.ready, true);
    validate(input, accepted(result));
    assert.throws(() => validate(input, candidate([row(17, 370_000)])), /свободной суммы/);
  }
});

test("removing a record releases only its claims and later-issued explicit invoices remain reserved", () => {
  const first = invoice(1, 580_000, [row(17, 580_000)]);
  const later = invoice(2, 200_000, [row(18, 200_000)], { invoiceDate: "2026-10-10" });
  const reserved = propose(base({ invoiceDate: "2026-09-18", amountKopecks: 900_000, invoices: [first, later] }));
  assert.deepEqual(reserved.bottleAllocations, [row(18, 820_000)]);
  assert.equal(reserved.uncoveredKopecks, 80_000);
  const afterDelete = propose(base({ invoiceDate: "2026-09-18", amountKopecks: 900_000, invoices: [later] }));
  assert.deepEqual(afterDelete.bottleAllocations, [row(17, 580_000), row(18, 320_000)]);
  assert.equal(afterDelete.days[1].alreadyAllocatedKopecks, 200_000);
  assert.equal(afterDelete.ready, true);
});

test("unknown old ranges block new invoices but can be reviewed in date and id order", () => {
  const old = (id, date) => ({ id, invoiceNumber: `old-${id}`, period: "2026-09", invoiceDate: date,
    kind: "fixed", amountKopecks: 400_000, bottleStartDate: "2026-09-17", bottleEndDate: "2026-09-18" });
  const history = [old(2, "2026-09-20"), old(1, "2026-09-20")];
  const fresh = base({ amountKopecks: 400_000, invoices: history });
  assert.equal(propose(fresh).needsReview, true);
  assert.throws(() => validate(fresh, candidate([row(17, 400_000)])), /Сначала проверьте/);
  const firstReview = base({ amountKopecks: 400_000, invoices: history, excludeInvoiceId: 1 });
  const first = propose(firstReview);
  assert.equal(first.ready, true);
  assert.deepEqual(first.legacyInvoiceNumbers, ["old-2"]);
  validate(firstReview, accepted(first));
  const outOfOrder = base({ amountKopecks: 400_000, invoices: history, excludeInvoiceId: 2 });
  assert.equal(propose(outOfOrder).needsReview, true);
  const reviewed = [invoice(1, 400_000, first.bottleAllocations), history[0]];
  const second = propose(base({ amountKopecks: 400_000, invoices: reviewed, excludeInvoiceId: 2 }));
  assert.deepEqual(second.bottleAllocations, [row(17, 180_000), row(18, 220_000)]);
  assert.equal(second.ready, true);
  assert.deepEqual(history, [old(2, "2026-09-20"), old(1, "2026-09-20")]);
});

test("editing one invoice excludes its own claims while preserving valid later reservations", () => {
  const history = [invoice(1, 300_000, [row(17, 300_000)]),
    invoice(2, 280_000, [row(17, 280_000)], { invoiceDate: "2026-09-21" })];
  const input = base({ amountKopecks: 400_000, invoices: history, excludeInvoiceId: 1 });
  const result = propose(input);
  assert.deepEqual(result.bottleAllocations, [row(17, 300_000), row(18, 100_000)]);
  validate(input, accepted(result));
});

test("invalid explicit records can be repaired chronologically without circular overcapacity blocking", () => {
  const history = [invoice(1, 400_000, [row(17, 400_000)]),
    invoice(2, 400_000, [row(17, 400_000)], { invoiceDate: "2026-09-21" })];
  assert.equal(propose(base({ invoices: history })).needsReview, true);
  const firstInput = base({ amountKopecks: 400_000, invoices: history, excludeInvoiceId: 1 });
  const first = propose(firstInput);
  assert.equal(first.ready, true);
  assert.deepEqual(first.invalidInvoiceNumbers, ["2"]);
  validate(firstInput, accepted(first));
  assert.equal(propose(base({ amountKopecks: 400_000, invoices: history, excludeInvoiceId: 2 })).needsReview, true);
});

test("date limits use the invoice date, selected month and lease without creating future records", () => {
  const input = base({ invoiceDate: "2026-09-18", amountKopecks: 1_230_000,
    settings: { rentalStart: "2026-09-18", rentalEnd: "2026-09-19", rateKopecks: 4_000 },
    entries: [entry(17, 100), entry(18, 100), entry(19, 100), { entryDate: "2026-10-01", units: 100 }] });
  const result = propose(input);
  assert.deepEqual(result.bottleAllocations, [row(18, 400_000)]);
  assert.equal(result.uncoveredKopecks, 830_000);
  assert.equal(result.ready, false);
  assert.throws(() => validate(input, candidate([row(19, 1_230_000)])), /не позже даты счёта/);
  assert.throws(() => validate(input, candidate([row(17, 1_230_000)])), /срока аренды/);
  const constrained = propose(base({ amountKopecks: 400_000, startDate: "2026-09-19", endDate: "2026-09-19" }));
  assert.deepEqual(constrained.bottleAllocations, [row(19, 400_000)]);
  assert.equal(propose(base({ invoiceDate: "2026-08-31" })).availableKopecks, 0);
});

test("the planner respects fixed, variable and monthly net ceilings including old invoice faces", () => {
  const fixed = invoice(1, 5_500_000, [row(17, 5_500_000)]);
  const plentiful = [entry(17, 2_000), entry(18, 2_000)];
  const first = propose(base({ entries: plentiful, invoices: [fixed], amountKopecks: 300_000 }));
  assert.equal(first.coveredKopecks, 100_000);
  assert.equal(first.uncoveredKopecks, 200_000);
  const variable = propose(base({ kind: "variable", entries: plentiful, invoices: [fixed], amountKopecks: 2_000_000 }));
  assert.equal(variable.coveredKopecks, 1_700_000);
  assert.equal(variable.uncoveredKopecks, 300_000);
  assert.throws(() => validate(base({ entries: plentiful, invoices: [fixed], amountKopecks: 300_000 }),
    candidate([row(18, 300_000)])), /превышает оставшуюся/);
});

test("a genuine monthly fixed-floor supplement has no fabricated bottle dates and cannot be used twice", () => {
  const input = base({ entries: [entry(17, 500)], amountKopecks: 6_000_000,
    fixedTargetKopecks: 8_000_000, netRentKopecks: 8_000_000, allowRentalSupplement: true });
  const first = propose(input);
  assert.deepEqual(first.bottleAllocations, [row(17, 2_000_000)]);
  assert.equal(first.rentalSupplementKopecks, 4_000_000);
  assert.equal(first.ready, true);
  validate(input, accepted(first));
  const history = [invoice(1, 6_000_000, first.bottleAllocations, { rentalSupplementKopecks: 4_000_000 })];
  const secondInput = { ...input, amountKopecks: 2_000_000, invoices: history };
  const second = propose(secondInput);
  assert.deepEqual(second.bottleAllocations, []);
  assert.equal(second.rentalSupplementKopecks, 2_000_000);
  assert.equal(second.startDate, "");
  assert.equal(second.endDate, "");
  assert.equal(second.ready, true);
  validate(secondInput, accepted(second));
  assert.equal(propose({ ...input, allowRentalSupplement: false }).uncoveredKopecks, 4_000_000);
  assert.throws(() => validate({ ...input, kind: "variable" }, accepted(first)), /только в счёте постоянной части/);
});

test("new monthly volume invalidates excessive saved supplements without changing saved amounts", () => {
  const saved = invoice(1, 8_000_000, [row(17, 2_000_000)], { rentalSupplementKopecks: 6_000_000 });
  const input = base({ entries: [entry(17, 500), entry(18, 500)], invoices: [saved],
    fixedTargetKopecks: 8_000_000, netRentKopecks: 8_000_000, allowRentalSupplement: true });
  const unchanged = structuredClone(input);
  const result = propose(input);
  assert.equal(result.needsReview, true);
  assert.deepEqual(result.invalidInvoiceNumbers, ["1"]);
  const repairedInput = { ...input, excludeInvoiceId: 1, amountKopecks: 8_000_000 };
  const repaired = propose(repairedInput);
  assert.deepEqual(repaired.bottleAllocations, [row(17, 2_000_000), row(18, 2_000_000)]);
  assert.equal(repaired.rentalSupplementKopecks, 4_000_000);
  validate(repairedInput, accepted(repaired));
  assert.deepEqual(input, unchanged);
});

test("the last invoice net ceiling excludes month-end fuel without deducting it from particular days", () => {
  const input = base({ entries: [entry(17, 1_000), entry(18, 1_000)], amountKopecks: 7_300_000,
    kind: "other" });
  const result = propose(input);
  assert.deepEqual(result.bottleAllocations, [row(17, 4_000_000), row(18, 3_300_000)]);
  assert.equal(result.lastDayRemainingKopecks, 700_000);
  validate(input, accepted(result));
});

test("malformed, duplicate, unsafe and zero money allocations are rejected", () => {
  const input = base({ amountKopecks: 400_000 });
  for (const malformed of [null, {}, { ...candidate([row(17, 400_000)]), allocationVersion: 2 },
    candidate([row(17, 200_000), row(17, 200_000)]), candidate([row(17, 399_999)]),
    candidate([row(17, -1)]), candidate([row(17, 400_000.5)]), candidate([row(17, Number.MAX_SAFE_INTEGER + 1)]),
    candidate([row(17, 0)]), candidate([{ date: "2026-09-31", amountKopecks: 400_000 }])]) {
    assert.throws(() => validate(input, malformed), Error);
  }
  assert.throws(() => validate(input, candidate([row(18, 2_000_000)])), /должна точно совпадать/);
  assert.throws(() => validate(base({ amountKopecks: 2_000_000 }), candidate([row(18, 2_000_000)])), /свободной суммы/);
  assert.equal(propose(base({ amountKopecks: 0 })).ready, false);
  assert.equal(propose(base({ amountKopecks: NaN })).ready, false);
  assert.equal(propose(base({ amountKopecks: Number.MAX_SAFE_INTEGER + 1 })).ready, false);
});

test("zero rates, duplicate physical records and arithmetic overflow are handled without invented units", () => {
  const duplicate = propose(base({ entries: [entry(17, 70), entry(17, 75)], amountKopecks: 580_000 }));
  assert.deepEqual(duplicate.bottleAllocations, [row(17, 580_000)]);
  assert.equal(duplicate.days[0].units, 145);
  const zero = base({ settings: { ...base().settings, rateKopecks: 0 }, amountKopecks: 400_000 });
  assert.deepEqual(propose(zero).bottleAllocations, []);
  assert.equal(propose(zero).uncoveredKopecks, 400_000);
  assert.equal(propose({ ...zero, allowRentalSupplement: true }).rentalSupplementKopecks, 400_000);
  const overflow = base({ entries: [entry(17, Number.MAX_SAFE_INTEGER)] });
  assert.equal(propose(overflow).ready, false);
  assert.throws(() => validate(overflow, candidate([row(17, 1_230_000)])), /слишком большая/);
  const invalidDate = base({ invoiceDate: "2026-09-31" });
  assert.equal(propose(invalidDate).ready, false);
  assert.throws(() => validate(invalidDate, candidate([row(17, 1_230_000)])), /месяц и дату/);
});
