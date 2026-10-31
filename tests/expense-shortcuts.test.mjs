import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = fs.readFileSync(new URL("../app/expense-shortcuts.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const module = { exports: {} };
new Function("exports", "module", compiled)(module.exports, module);
const { normalizeExpenseShortcuts, validateExpenseShortcuts } = module.exports;

const categories = [{ id: "fuel", name: "Топливо" }, { id: "repair", name: "Ремонт" }, { id: "wash", name: "Мойка" }];
const custom = { id: "car-wash", title: " Мойка автомобиля ", category: "wash", payer: "self", amountKopecks: 150_000 };

test("old backup without quick buttons receives defaults for its existing categories", () => {
  const oldBackup = JSON.parse('{"version":6,"settings":{}}');
  assert.deepEqual(normalizeExpenseShortcuts(oldBackup.settings.expenseShortcuts, categories), [
    { id: "fuel-customer", title: "Топливо заказчика", category: "fuel", payer: "customer", amountKopecks: 0 },
    { id: "fuel-self", title: "Моё топливо", category: "fuel", payer: "self", amountKopecks: 0 },
    { id: "repair-self", title: "Ремонт", category: "repair", payer: "self", amountKopecks: 0 },
  ]);
  assert.deepEqual(normalizeExpenseShortcuts(undefined, [{ id: "repair", name: "Ремонт" }]).map((item) => item.category), ["repair"]);
});

test("custom saved buttons keep category, payer and amount through JSON round trip", () => {
  const saved = validateExpenseShortcuts([custom], categories);
  assert.deepEqual(saved, [{ ...custom, title: "Мойка автомобиля" }]);
  assert.deepEqual(normalizeExpenseShortcuts(JSON.parse(JSON.stringify(saved)), categories), saved);
  assert.equal(custom.title, " Мойка автомобиля ");
});

test("removing every quick button survives normalization and save", () => {
  assert.deepEqual(validateExpenseShortcuts([], categories), []);
  assert.deepEqual(normalizeExpenseShortcuts(JSON.parse("[]"), categories), []);
  assert.deepEqual(normalizeExpenseShortcuts(null, categories), []);
});

test("normalization preserves a useful non-fuel button and changes its payer to self", () => {
  const saved = [{ ...custom, payer: "customer" }];
  assert.deepEqual(normalizeExpenseShortcuts(saved, categories), [{ ...custom, title: "Мойка автомобиля", payer: "self" }]);
  assert.equal(saved[0].payer, "customer");
  assert.equal(normalizeExpenseShortcuts([{ ...custom, category: "fuel", payer: "customer" }], categories)[0].payer, "customer");
});

test("save refuses customer-paid non-fuel expenses while accepting customer-paid fuel", () => {
  assert.throws(() => validateExpenseShortcuts([{ ...custom, payer: "customer" }], categories), /Заказчик может оплачивать только топливо/);
  assert.equal(validateExpenseShortcuts([{ ...custom, category: "fuel", payer: "customer" }], categories)[0].payer, "customer");
});

test("normalization drops unknown categories and invalid or duplicate buttons without choosing a replacement", () => {
  const result = normalizeExpenseShortcuts([
    { ...custom, category: "removed-category" },
    { ...custom, amountKopecks: -1 },
    { ...custom, amountKopecks: 1.5 },
    { ...custom, amountKopecks: Number.MAX_SAFE_INTEGER + 1 },
    { ...custom, payer: "someone" },
    { ...custom, title: "x".repeat(41) },
    custom,
    { ...custom, id: " car-wash ", amountKopecks: 1 },
  ], categories);
  assert.deepEqual(result, [{ ...custom, title: "Мойка автомобиля" }]);
  assert.deepEqual(normalizeExpenseShortcuts([{ ...custom, category: "removed-category" }], categories), []);
  assert.equal(normalizeExpenseShortcuts(Array.from({ length: 10 }, (_, index) => ({ ...custom, id: String(index) })), categories).length, 8);
});

test("save rejects malformed buttons, unknown categories, duplicates and more than eight", () => {
  for (const invalid of [undefined, null, {}, [null], [{ ...custom, id: " " }],
    [{ ...custom, title: " " }], [{ ...custom, title: "x".repeat(41) }],
    [{ ...custom, category: "missing" }], [{ ...custom, payer: "someone" }],
    [{ ...custom, amountKopecks: -1 }], [{ ...custom, amountKopecks: 0.1 }],
    [{ ...custom, amountKopecks: "150000" }], [{ ...custom, amountKopecks: Number.MAX_SAFE_INTEGER + 1 }],
    [custom, { ...custom, id: " car-wash " }],
    Array.from({ length: 9 }, (_, index) => ({ ...custom, id: String(index) }))]) {
    assert.throws(() => validateExpenseShortcuts(invalid, categories), /быстр|Быстр/);
  }
});
