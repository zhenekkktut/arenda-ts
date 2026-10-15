import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { createServer } from "vite";
import { documentTools } from "./pdf-fixture.mjs";

test("bank and email texts preserve invoice parts, cents and VAT without showing fuel", async (t) => {
  const server = await createServer({ configFile: "offline/vite.config.ts", hmr: false,
    optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true }, appType: "custom" });
  try {
    const { invoiceLine, paymentPurpose, emailText } = await server.ssrLoadModule(path.resolve("app/rental-app.tsx"));
    const settings = { ...documentTools().DEFAULT_DOCUMENT_SETTINGS, vehicleVin: "TEST-VIN" };
    const invoice = { id: 3, period: "2026-09", invoiceNumber: "31", invoiceDate: "2026-10-13",
      kind: "mixed", fixedAmountKopecks: 1_250_000, variableAmountKopecks: 1_700_000,
      amountKopecks: 2_950_000, dueDate: null, note: "", allocationMode: "unlinked" };
    const compact = (text) => text.replace(/\s/g, "");

    await t.test("one invoice produces two bank positions and one payment purpose", () => {
      const line = invoiceLine(invoice, settings);
      assert.equal(line.split("\n\n").length, 2);
      assert.match(line, /Часть постоянной арендной платы/);
      assert.match(line, /Переменная часть арендной платы/);
      assert.match(compact(line), /Сумма:12500₽/);
      assert.match(compact(line), /Сумма:17000₽/);
      const purpose = paymentPurpose(invoice, settings);
      assert.match(purpose, /постоянную и переменную части/);
      assert.match(purpose, /счёту № 31 от 13\.10\.2026/);
      assert.match(purpose, /сентябрь 2026 года/);
      for (const text of [line, purpose, emailText(invoice, settings)]) assert.doesNotMatch(text, /топлив|вычет/i);
    });

    await t.test("fractional rubles remain exact in bank lines and the email total", () => {
      const withCents = { ...invoice, fixedAmountKopecks: 1_250_050, variableAmountKopecks: 1_700_051,
        amountKopecks: 2_950_101 };
      const line = compact(invoiceLine(withCents, settings));
      const email = compact(emailText(withCents, settings));
      assert.match(line, /12500,5₽/);
      assert.match(line, /17000,51₽/);
      assert.match(email, /29501,01₽/);
      assert.match(email, /12500,5₽/);
      assert.match(email, /17000,51₽/);
    });

    await t.test("an unlinked invoice never acquires stale bottle dates in copied text", () => {
      const stale = { ...invoice, kind: "fixed", bottleStartDate: "2026-09-10", bottleEndDate: "2026-09-16" };
      assert.doesNotMatch(invoiceLine(stale, settings), /бутыли за|10\.09|16\.09/);
      assert.match(invoiceLine({ ...stale, allocationMode: "auto" }, settings), /10\.09\.2026–16\.09\.2026/);
    });

    await t.test("payment and email use the saved VAT wording", () => {
      const saved = { ...settings, vatLabel: "НДС 5% включён в сумму" };
      for (const text of [paymentPurpose(invoice, saved), emailText(invoice, saved)]) {
        assert.match(text, /НДС 5% включён в сумму/);
        assert.doesNotMatch(text, /Без НДС/);
      }
    });
  } finally { await server.close(); }
});
