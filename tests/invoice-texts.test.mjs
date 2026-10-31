import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { createServer } from "vite";
import { documentTools } from "./pdf-fixture.mjs";

test("bank and email texts preserve invoice parts, cents and VAT without showing fuel", async (t) => {
  const server = await createServer({ configFile: "offline/vite.config.ts", hmr: false,
    optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true }, appType: "custom" });
  try {
    const { invoiceLine, invoiceBankPositions, invoiceTextIssue, paymentPurpose, emailSubject, emailText } = await server.ssrLoadModule(path.resolve("app/rental-app.tsx"));
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
      assert.match(compact(line), /Сумма:12500,00₽/);
      assert.match(compact(line), /Сумма:17000,00₽/);
      const positions = invoiceBankPositions(invoice, settings);
      assert.deepEqual(positions.map((row) => row.amountText), ["12500,00", "17000,00"]);
      assert.equal(positions.reduce((sum, row) => sum + row.amountKopecks, 0), invoice.amountKopecks);
      assert.ok(positions.every((row) => !row.text.includes("29500")), "A position never copies the whole mixed invoice amount");
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
      assert.match(line, /12500,50₽/);
      assert.match(line, /17000,51₽/);
      assert.match(email, /29501,01₽/);
      assert.match(email, /12500,50₽/);
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

    await t.test("single positions copy their own exact bank amount without grouping or currency signs", () => {
      for (const kind of ["fixed", "variable", "other"]) {
        const positions = invoiceBankPositions({ ...invoice, kind, amountKopecks: 1_230_001 }, settings);
        assert.equal(positions.length, 1);
        assert.equal(positions[0].amountText, "12300,01");
        assert.match(positions[0].text, /сентябрь 2026 года/);
      }
    });

    await t.test("subject and message keep issued date, billing month and saved due date separate", () => {
      const withDue = { ...invoice, dueDate: "2026-10-25" };
      assert.match(emailSubject(withDue, settings), /№ 31 от 13\.10\.2026/);
      assert.match(emailSubject(withDue, settings), /сентябрь 2026 года/);
      const body = emailText(withDue, settings);
      assert.match(body, /Направляю счёт № 31 от 13\.10\.2026/);
      assert.match(body, /Срок оплаты: до 25\.10\.2026/);
      assert.ok(body.includes("\n\n"));
      assert.doesNotMatch(body, /<br|<p>|Subject:|Тема письма:/i);
    });

    await t.test("saved fields cannot insert accidental line breaks into bank text or the subject", () => {
      const spaced = { ...settings, contractNumber: "  002-АР/2026\r\n", vehicleModel: "Fiat\nDucato", vehicleVin: " TEST-VIN ", vatLabel: "Без НДС." };
      const numbered = { ...invoice, invoiceNumber: " 31\r\n " };
      assert.match(invoiceLine(numbered, spaced), /Fiat Ducato, VIN TEST-VIN\./);
      for (const position of invoiceBankPositions(numbered, spaced)) assert.doesNotMatch(position.text, /\r|\n/);
      assert.doesNotMatch(emailSubject(numbered, spaced), /\r|\n/);
      assert.doesNotMatch(paymentPurpose(numbered, spaced), /\.\./);
    });

    await t.test("incomplete or damaged invoice metadata is rejected before text is presented for copying", () => {
      for (const damaged of [
        { ...invoice, amountKopecks: 0 },
        { ...invoice, fixedAmountKopecks: 1 },
        { ...invoice, invoiceDate: "2026-02-31" },
        { ...invoice, period: "2026-13" },
        { ...invoice, invoiceNumber: " " },
        { ...invoice, kind: "damaged" },
      ]) {
        assert.ok(invoiceTextIssue(damaged, settings));
        assert.throws(() => invoiceBankPositions(damaged, settings));
      }
      const missing = { ...settings, vehicleVin: "" };
      assert.match(invoiceTextIssue(invoice, missing), /реквизитов/);
      assert.throws(() => invoiceLine(invoice, missing), /реквизитов/);
      assert.equal(invoiceTextIssue(invoice, settings), "");
    });
  } finally { await server.close(); }
});
