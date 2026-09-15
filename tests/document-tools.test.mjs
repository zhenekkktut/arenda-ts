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

test("rent calculation deduplicates overlapping downtime days", () => {
  const settings = { ...tools.DEFAULT_DOCUMENT_SETTINGS };
  const calculation = tools.calculateRental(
    "2026-08",
    [{ entryDate: "2026-08-01", units: 2_800 }],
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
  assert.equal(calculation.variableKopecks, 3_200_000);
});

test("official documents separate accrual from payments and fuel offsets", () => {
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
    openingBalanceKopecks: 1_000_000,
  };
  const input = {
    settings,
    meta,
    calculation,
    downtimes: [],
    invoices: [{ id: 1, invoiceNumber: "15" }],
    payments: [{ invoiceId: 1, paymentDate: "2026-08-20", amountKopecks: 3_000_000, method: "bank", documentNumber: "77" }],
    expenses: [{ expenseDate: "2026-08-22", category: "fuel", payer: "customer", amountKopecks: 400_000, documentNumber: "ППР", note: "" }],
  };

  const act = tools.buildRentActHtml(input);
  const reconciliation = tools.buildReconciliationHtml(input);
  const packageHtml = tools.buildDocumentPackageHtml(input);

  assert.match(act, /112[\s ]000,00/);
  assert.match(act, /Сто двенадцать тысяч рублей 00 копеек/);
  assert.doesNotMatch(act, /Зачёт расходов на топливо/);
  assert.match(reconciliation, /Зачёт расходов на топливо/);
  assert.match(reconciliation, /88[\s ]000,00/);
  assert.equal((packageHtml.match(/class="page"/g) ?? []).length, 2);
});

test("user-entered document text is escaped", () => {
  const settings = { ...tools.DEFAULT_DOCUMENT_SETTINGS, city: "<Выборг>" };
  const calculation = tools.calculateRental("2026-08", [], [], settings);
  const meta = tools.defaultDocumentMeta("2026-08", 1, "2026-09-15");
  const html = tools.buildRentActHtml({ settings, meta, calculation, downtimes: [], invoices: [], payments: [], expenses: [] });
  assert.match(html, /&lt;Выборг&gt;/);
  assert.doesNotMatch(html, /г\. <Выборг>/);
});
