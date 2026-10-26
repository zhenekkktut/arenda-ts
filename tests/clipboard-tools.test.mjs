import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { createServer } from "vite";

function fakeDocument(copyResult = true) {
  const events = [], ranges = [], initialRange = { cloneRange: () => ({ saved: true }) };
  const selection = { rangeCount: 1, getRangeAt: () => initialRange,
    removeAllRanges: () => events.push("clear ranges"), addRange: (range) => ranges.push(range) };
  let attached = false, pasted = "", textarea;
  const active = { focus: (options) => { assert.equal(options.preventScroll, true); events.push("restore focus"); } };
  const dialog = { appendChild: (node) => { textarea = node; attached = true; events.push("append inside dialog"); } };
  const doc = {
    activeElement: active, body: { appendChild: () => assert.fail("Fallback must stay inside the open dialog") },
    querySelector: () => dialog, getSelection: () => selection,
    createElement: () => ({ style: {}, value: "", setAttribute() {},
      focus: () => events.push("focus fallback"), select: () => events.push("select all"),
      setSelectionRange: (start, end) => { assert.equal(start, 0); assert.equal(end, textarea.value.length); },
      remove: () => { attached = false; events.push("remove fallback"); } }),
    execCommand: (command) => { assert.equal(command, "copy"); assert.equal(attached, true); pasted = textarea.value;
      if (copyResult instanceof Error) throw copyResult; return copyResult; },
  };
  return { doc, events, ranges, pasted: () => pasted, attached: () => attached };
}

test("plain text copying verifies the selected path and preserves exact data", async (t) => {
  const server = await createServer({ configFile: "offline/vite.config.ts", hmr: false,
    optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true }, appType: "custom" });
  try {
    const { copyPlainText, plainClipboardText, bankAmountText } = await server.ssrLoadModule(path.resolve("app/clipboard-tools.ts"));
    const original = "Счёт № 31\r\n\r\nСумма: 12\u00a0500,50 ₽.\rБез НДС.\u0000";
    const expected = "Счёт № 31\n\nСумма: 12 500,50 ₽.\nБез НДС.";

    await t.test("uses a checked native bridge only after a true result", async () => {
      let pasted = "";
      assert.equal(await copyPlainText(original, { native: { copyTextChecked: (text) => { pasted = text; return true; } } }), "verified");
      assert.equal(pasted, expected);
      for (const result of [false, undefined, "true"]) {
        await assert.rejects(copyPlainText(original, { native: { copyTextChecked: () => result,
          copyText: () => assert.fail("A failed checked copy must not produce an unverified green result") } }), /буфер обмена/);
      }
    });

    await t.test("prefers browser Clipboard over the old void preview bridge", async () => {
      let pasted = "";
      assert.equal(await copyPlainText(original, { clipboard: { writeText: async (text) => { pasted = text; } },
        native: { copyText: () => assert.fail("Do not use a void bridge when Clipboard succeeds") } }), "verified");
      assert.equal(pasted, expected);
    });

    await t.test("falls back after denied Clipboard permission, inside the active modal, with focus cleanup", async () => {
      const fake = fakeDocument();
      const mode = await copyPlainText(original, { clipboard: { writeText: async () => { throw new Error("Denied"); } }, document: fake.doc });
      assert.equal(mode, "verified"); assert.equal(fake.pasted(), expected); assert.equal(fake.attached(), false);
      assert.ok(fake.events.includes("append inside dialog")); assert.ok(fake.events.includes("restore focus"));
      assert.deepEqual(fake.ranges, [{ saved: true }]);
    });

    await t.test("failed fallback removes its temporary field and reports failure", async () => {
      for (const copyResult of [false, new Error("Blocked")]) {
        const fake = fakeDocument(copyResult);
        await assert.rejects(copyPlainText(original, { document: fake.doc }), /вручную/);
        assert.equal(fake.attached(), false); assert.ok(fake.events.includes("restore focus"));
      }
    });

    await t.test("legacy-only bridge stays distinguishable from confirmed clipboard success", async () => {
      let pasted = "";
      assert.equal(await copyPlainText(original, { native: { copyText: (text) => { pasted = text; } } }), "legacy");
      assert.equal(pasted, expected);
      await assert.rejects(copyPlainText(original, { native: { copyText: async () => { throw new Error("Preview clipboard denied"); } } }), /Preview clipboard denied/);
      await assert.rejects(copyPlainText(" \n ", { native: { copyText: () => assert.fail("Empty copy") } }), /Нет текста/);
    });

    await t.test("bank amount text keeps cents exactly, without grouping or a currency sign", () => {
      assert.equal(bankAmountText(1), "0,01"); assert.equal(bankAmountText(1_250_050), "12500,50");
      assert.equal(bankAmountText(1_700_051), "17000,51");
      assert.equal(bankAmountText(Number.MAX_SAFE_INTEGER), "90071992547409,91");
      for (const invalid of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
        assert.throws(() => bankAmountText(invalid), /сумму/);
      }
      assert.equal(plainClipboardText(original), expected);
    });
  } finally { await server.close(); }
});
