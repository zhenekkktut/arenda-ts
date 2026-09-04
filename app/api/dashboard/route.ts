import { and, asc, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { getDb } from "@/db";
import {
  expenses,
  intensityEntries,
  invoices,
  monthClosures,
  payments,
} from "@/db/schema";

export const dynamic = "force-dynamic";

const BASE_KOPECKS = 8_000_000;
const INCLUDED_UNITS = 2_000;
const RATE_KOPECKS = 4_000;

const periodPattern = /^\d{4}-(0[1-9]|1[0-2])$/;
const datePattern = /^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/;

function fail(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

function errorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "Неизвестная ошибка";
  if (message.includes("no such table")) {
    return "База данных ещё не подготовлена. Повторите попытку через минуту.";
  }
  return message;
}

function validPeriod(value: unknown): value is string {
  return typeof value === "string" && periodPattern.test(value);
}

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !datePattern.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function positiveInt(value: unknown) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function nonNegativeInt(value: unknown) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

async function monthIsClosed(period: string) {
  const db = getDb();
  const [closure] = await db
    .select({ period: monthClosures.period })
    .from(monthClosures)
    .where(eq(monthClosures.period, period))
    .limit(1);
  return Boolean(closure);
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const period = url.searchParams.get("month");
    if (!validPeriod(period)) return fail("Неверно указан месяц");

    const db = getDb();
    const from = `${period}-01`;
    const to = `${period}-31`;

    const [entryRows, invoiceRows, expenseRows, closureRows] = await Promise.all([
      db
        .select()
        .from(intensityEntries)
        .where(and(gte(intensityEntries.entryDate, from), lte(intensityEntries.entryDate, to)))
        .orderBy(desc(intensityEntries.entryDate), desc(intensityEntries.id)),
      db
        .select()
        .from(invoices)
        .where(eq(invoices.period, period))
        .orderBy(desc(invoices.invoiceDate), desc(invoices.id)),
      db
        .select()
        .from(expenses)
        .where(and(gte(expenses.expenseDate, from), lte(expenses.expenseDate, to)))
        .orderBy(desc(expenses.expenseDate), desc(expenses.id)),
      db.select().from(monthClosures).where(eq(monthClosures.period, period)).limit(1),
    ]);

    const invoiceIds = invoiceRows.map((invoice) => invoice.id);
    const paymentRows = invoiceIds.length
      ? await db
          .select()
          .from(payments)
          .where(inArray(payments.invoiceId, invoiceIds))
          .orderBy(desc(payments.paymentDate), desc(payments.id))
      : [];

    return Response.json({
      entries: entryRows,
      invoices: invoiceRows,
      payments: paymentRows,
      expenses: expenseRows,
      closure: closureRows[0] ?? null,
      rules: {
        baseKopecks: BASE_KOPECKS,
        includedUnits: INCLUDED_UNITS,
        rateKopecks: RATE_KOPECKS,
      },
    });
  } catch (error) {
    return fail(errorMessage(error), 500);
  }
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as Record<string, unknown>;
    const action = payload.action;
    const db = getDb();

    if (action === "save_entry") {
      const entryDate = payload.entryDate;
      const units = nonNegativeInt(payload.units);
      const note = typeof payload.note === "string" ? payload.note.trim().slice(0, 300) : "";
      if (!validDate(entryDate) || units === null) return fail("Проверьте дату и количество");
      const period = entryDate.slice(0, 7);
      if (await monthIsClosed(period)) return fail("Месяц закрыт. Сначала откройте его заново.", 409);

      const [row] = await db
        .insert(intensityEntries)
        .values({ entryDate, units, note })
        .onConflictDoUpdate({
          target: intensityEntries.entryDate,
          set: { units, note, updatedAt: new Date().toISOString() },
        })
        .returning();
      return Response.json({ entry: row }, { status: 201 });
    }

    if (action === "import_entries") {
      if (!Array.isArray(payload.entries) || payload.entries.length === 0) {
        return fail("В файле нет записей для загрузки");
      }
      if (payload.entries.length > 500) {
        return fail("За один раз можно загрузить не больше 500 записей");
      }

      const uniqueEntries = new Map<string, { entryDate: string; units: number; note: string }>();
      for (const item of payload.entries) {
        if (!item || typeof item !== "object") return fail("Проверьте строки файла");
        const entry = item as Record<string, unknown>;
        const entryDate = entry.entryDate;
        const units = nonNegativeInt(entry.units);
        const note = typeof entry.note === "string" ? entry.note.trim().slice(0, 300) : "";
        if (!validDate(entryDate) || units === null) return fail("В файле есть неверная дата или количество");
        uniqueEntries.set(entryDate, { entryDate, units, note });
      }

      const rows = [...uniqueEntries.values()];
      const periods = [...new Set(rows.map((row) => row.entryDate.slice(0, 7)))];
      const closedMonths = await db
        .select({ period: monthClosures.period })
        .from(monthClosures)
        .where(inArray(monthClosures.period, periods));
      if (closedMonths.length > 0) {
        const labels = closedMonths.map((row) => row.period).sort().join(", ");
        return fail(`Нельзя загрузить записи: закрыты месяцы ${labels}`, 409);
      }

      const updatedAt = new Date().toISOString();
      const statements = rows.map((row) =>
        db
          .insert(intensityEntries)
          .values(row)
          .onConflictDoUpdate({
            target: intensityEntries.entryDate,
            set: { units: row.units, note: row.note, updatedAt },
          }),
      );
      for (let index = 0; index < statements.length; index += 100) {
        const batch = statements.slice(index, index + 100);
        const firstStatement = batch[0];
        if (firstStatement) await db.batch([firstStatement, ...batch.slice(1)]);
      }
      return Response.json({ imported: rows.length }, { status: 201 });
    }

    if (action === "delete_entry") {
      const id = positiveInt(payload.id);
      if (!id) return fail("Запись не найдена");
      const [entry] = await db
        .select({ entryDate: intensityEntries.entryDate })
        .from(intensityEntries)
        .where(eq(intensityEntries.id, id))
        .limit(1);
      if (!entry) return fail("Запись не найдена", 404);
      if (await monthIsClosed(entry.entryDate.slice(0, 7))) return fail("Месяц закрыт", 409);
      await db.delete(intensityEntries).where(eq(intensityEntries.id, id));
      return Response.json({ ok: true });
    }

    if (action === "create_invoice") {
      const period = payload.period;
      const invoiceNumber = typeof payload.invoiceNumber === "string" ? payload.invoiceNumber.trim().slice(0, 60) : "";
      const invoiceDate = payload.invoiceDate;
      const kind = payload.kind;
      const amountKopecks = positiveInt(payload.amountKopecks);
      const dueDate = payload.dueDate === "" || payload.dueDate == null ? null : payload.dueDate;
      const note = typeof payload.note === "string" ? payload.note.trim().slice(0, 300) : "";
      if (!validPeriod(period) || !invoiceNumber || !validDate(invoiceDate) || !["fixed", "variable", "other"].includes(String(kind)) || !amountKopecks || (dueDate !== null && !validDate(dueDate))) {
        return fail("Проверьте данные счёта");
      }
      const [row] = await db.insert(invoices).values({
        period,
        invoiceNumber,
        invoiceDate,
        kind: String(kind),
        amountKopecks,
        dueDate,
        note,
      }).returning();
      return Response.json({ invoice: row }, { status: 201 });
    }

    if (action === "delete_invoice") {
      const id = positiveInt(payload.id);
      if (!id) return fail("Счёт не найден");
      await db.delete(invoices).where(eq(invoices.id, id));
      return Response.json({ ok: true });
    }

    if (action === "create_payment") {
      const invoiceId = positiveInt(payload.invoiceId);
      const paymentDate = payload.paymentDate;
      const amountKopecks = positiveInt(payload.amountKopecks);
      const method = payload.method;
      const documentNumber = typeof payload.documentNumber === "string" ? payload.documentNumber.trim().slice(0, 80) : "";
      const note = typeof payload.note === "string" ? payload.note.trim().slice(0, 300) : "";
      if (!invoiceId || !validDate(paymentDate) || !amountKopecks || !["bank", "cash"].includes(String(method))) {
        return fail("Проверьте данные оплаты");
      }
      const [invoice] = await db.select({ id: invoices.id }).from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
      if (!invoice) return fail("Счёт не найден", 404);
      const [row] = await db.insert(payments).values({
        invoiceId,
        paymentDate,
        amountKopecks,
        method: String(method),
        documentNumber,
        note,
      }).returning();
      return Response.json({ payment: row }, { status: 201 });
    }

    if (action === "delete_payment") {
      const id = positiveInt(payload.id);
      if (!id) return fail("Оплата не найдена");
      await db.delete(payments).where(eq(payments.id, id));
      return Response.json({ ok: true });
    }

    if (action === "create_expense") {
      const expenseDate = payload.expenseDate;
      const category = payload.category;
      const amountKopecks = positiveInt(payload.amountKopecks);
      const method = payload.method;
      const documentNumber = typeof payload.documentNumber === "string" ? payload.documentNumber.trim().slice(0, 80) : "";
      const note = typeof payload.note === "string" ? payload.note.trim().slice(0, 300) : "";
      if (!validDate(expenseDate) || !["base_lease", "repair", "fuel", "insurance", "tax", "other"].includes(String(category)) || !amountKopecks || !["bank", "cash"].includes(String(method))) {
        return fail("Проверьте данные расхода");
      }
      const [row] = await db.insert(expenses).values({
        expenseDate,
        category: String(category),
        amountKopecks,
        method: String(method),
        documentNumber,
        note,
      }).returning();
      return Response.json({ expense: row }, { status: 201 });
    }

    if (action === "delete_expense") {
      const id = positiveInt(payload.id);
      if (!id) return fail("Расход не найден");
      await db.delete(expenses).where(eq(expenses.id, id));
      return Response.json({ ok: true });
    }

    if (action === "close_month") {
      const period = payload.period;
      if (!validPeriod(period)) return fail("Неверно указан месяц");
      const rows = await db
        .select({ units: intensityEntries.units })
        .from(intensityEntries)
        .where(and(gte(intensityEntries.entryDate, `${period}-01`), lte(intensityEntries.entryDate, `${period}-31`)))
        .orderBy(asc(intensityEntries.entryDate));
      const actualUnits = rows.reduce((sum, row) => sum + row.units, 0);
      const excessUnits = Math.max(0, actualUnits - INCLUDED_UNITS);
      const variableKopecks = excessUnits * RATE_KOPECKS;
      const totalKopecks = BASE_KOPECKS + variableKopecks;
      const [row] = await db.insert(monthClosures).values({
        period,
        actualUnits,
        includedUnits: INCLUDED_UNITS,
        excessUnits,
        baseKopecks: BASE_KOPECKS,
        rateKopecks: RATE_KOPECKS,
        variableKopecks,
        totalKopecks,
      }).onConflictDoUpdate({
        target: monthClosures.period,
        set: {
          actualUnits,
          includedUnits: INCLUDED_UNITS,
          excessUnits,
          baseKopecks: BASE_KOPECKS,
          rateKopecks: RATE_KOPECKS,
          variableKopecks,
          totalKopecks,
          closedAt: new Date().toISOString(),
        },
      }).returning();
      return Response.json({ closure: row }, { status: 201 });
    }

    if (action === "reopen_month") {
      const period = payload.period;
      if (!validPeriod(period)) return fail("Неверно указан месяц");
      await db.delete(monthClosures).where(eq(monthClosures.period, period));
      return Response.json({ ok: true });
    }

    return fail("Неизвестное действие");
  } catch (error) {
    return fail(errorMessage(error), 500);
  }
}
