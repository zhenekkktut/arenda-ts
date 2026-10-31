import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync(new URL("../offline/compat.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2018 } }).outputText;

function legacyContext() {
  const context = vm.createContext({});
  vm.runInContext("delete Array.prototype.at; delete String.prototype.replaceAll;", context);
  vm.runInContext(compiled, context);
  return context;
}

test("older WebView gets the Array.at behavior used by invoice allocation at first render", () => {
  const context = legacyContext();
  assert.equal(vm.runInContext("['2026-09-01','2026-09-10'].sort().at(-1)", context), "2026-09-10");
  assert.equal(vm.runInContext("[].at(-1)", context), undefined);
  assert.equal(vm.runInContext("[10,20,30].at(-2)", context), 20);
  assert.equal(vm.runInContext("[10,20,30].at(1.8)", context), 20);
  assert.equal(vm.runInContext("[10,20].at(NaN)", context), 10);
  assert.equal(vm.runInContext("[10,20].at(Infinity)", context), undefined);
  assert.equal(vm.runInContext("[10,20].at(-Infinity)", context), undefined);
  assert.equal(vm.runInContext("Array.prototype.at.call({0:'a',1:'b',length:2},-1)", context), "b");
  assert.equal(vm.runInContext("Object.getOwnPropertyDescriptor(Array.prototype,'at').enumerable", context), false);
});

test("older WebView can escape all repeated HTML characters when making documents", () => {
  const context = legacyContext();
  assert.equal(vm.runInContext(`'ООО «А & Б & В»'.replaceAll('&','&amp;')`, context), "ООО «А &amp; Б &amp; В»");
  assert.equal(vm.runInContext(`'<a><b>'.replaceAll('<','&lt;').replaceAll('>','&gt;')`, context), "&lt;a&gt;&lt;b&gt;");
  assert.equal(vm.runInContext(`'a.b.a'.replaceAll('.','!')`, context), "a!b!a");
  assert.equal(vm.runInContext(`'aba'.replaceAll(/a/g,'x')`, context), "xbx");
  assert.throws(() => vm.runInContext(`'aba'.replaceAll(/a/,'x')`, context), /global/);
  assert.equal(vm.runInContext(`'ab'.replaceAll('','-')`, context), "-a-b-");
  assert.equal(vm.runInContext(`'aba'.replaceAll('a',x=>x.toUpperCase())`, context), "AbA");
  assert.equal(vm.runInContext("Object.getOwnPropertyDescriptor(String.prototype,'replaceAll').enumerable", context), false);
});

test("modern runtimes keep their native methods unchanged", () => {
  const context = vm.createContext({});
  vm.runInContext("globalThis.originalAt=Array.prototype.at; globalThis.originalReplaceAll=String.prototype.replaceAll;", context);
  vm.runInContext(compiled, context);
  assert.equal(vm.runInContext("Array.prototype.at===originalAt && String.prototype.replaceAll===originalReplaceAll", context), true);
});
