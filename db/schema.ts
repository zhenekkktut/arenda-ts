import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const intensityEntries = sqliteTable(
  "intensity_entries",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    entryDate: text("entry_date").notNull(),
    units: integer("units").notNull(),
    note: text("note").notNull().default(""),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("idx_intensity_entries_date_unique").on(table.entryDate),
  ],
);

export const invoices = sqliteTable(
  "invoices",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    period: text("period").notNull(),
    invoiceNumber: text("invoice_number").notNull(),
    invoiceDate: text("invoice_date").notNull(),
    kind: text("kind").notNull(),
    amountKopecks: integer("amount_kopecks").notNull(),
    dueDate: text("due_date"),
    note: text("note").notNull().default(""),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_invoices_period_date").on(table.period, table.invoiceDate),
  ],
);

export const payments = sqliteTable(
  "payments",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    invoiceId: integer("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "cascade" }),
    paymentDate: text("payment_date").notNull(),
    amountKopecks: integer("amount_kopecks").notNull(),
    method: text("method").notNull(),
    documentNumber: text("document_number").notNull().default(""),
    note: text("note").notNull().default(""),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("idx_payments_invoice_date").on(table.invoiceId, table.paymentDate)],
);

export const expenses = sqliteTable(
  "expenses",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    expenseDate: text("expense_date").notNull(),
    category: text("category").notNull(),
    amountKopecks: integer("amount_kopecks").notNull(),
    method: text("method").notNull(),
    documentNumber: text("document_number").notNull().default(""),
    note: text("note").notNull().default(""),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("idx_expenses_date").on(table.expenseDate)],
);

export const monthClosures = sqliteTable("month_closures", {
  period: text("period").primaryKey(),
  actualUnits: integer("actual_units").notNull(),
  includedUnits: integer("included_units").notNull(),
  excessUnits: integer("excess_units").notNull(),
  baseKopecks: integer("base_kopecks").notNull(),
  rateKopecks: integer("rate_kopecks").notNull(),
  variableKopecks: integer("variable_kopecks").notNull(),
  totalKopecks: integer("total_kopecks").notNull(),
  closedAt: text("closed_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
