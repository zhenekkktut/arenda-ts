"use client";

import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Banknote,
  CalendarDays,
  Calculator,
  CarFront,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  FileSpreadsheet,
  FileText,
  Fuel,
  History,
  LoaderCircle,
  LockKeyhole,
  MonitorSmartphone,
  Plus,
  Pencil,
  CirclePause,
  ReceiptText,
  Smartphone,
  Settings,
  SlidersHorizontal,
  Trash2,
  UnlockKeyhole,
  Upload,
  WalletCards,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";
import { calculateTaxYear, type TaxAdjustment, type TaxYearOptions } from "@/app/tax-calculation";
import { normalizeExpenseShortcuts, validateExpenseShortcuts, type ExpenseShortcut } from "@/app/expense-shortcuts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Toaster } from "@/components/ui/sonner";
import {
  buildReconciliationHtml,
  buildRentActHtml,
  calculateFuelAdjustment,
  calculateRental,
  calculateSettlement,
  defaultDocumentMeta,
  DEFAULT_DOCUMENT_SETTINGS,
  periodBounds,
  reconciliationDateError,
  reconciliationSummary,
  sharedBottlePeriodParts,
  suggestInvoicePeriods,
  type DocumentCalculation,
  type DocumentMeta,
  type DocumentSettings,
  type Downtime,
} from "@/app/document-tools";

type Entry = {
  id: number;
  entryDate: string;
  units: number;
  note: string;
};

type Invoice = {
  id: number;
  period: string;
  invoiceNumber: string;
  invoiceDate: string;
  kind: "fixed" | "variable" | "other";
  actNumber?: string;
  amountKopecks: number;
  bottleStartDate?: string;
  bottleEndDate?: string;
  dueDate: string | null;
  note: string;
};

type Payment = {
  id: number;
  invoiceId: number;
  groupId?: number;
  paymentDate: string;
  amountKopecks: number;
  method: "bank" | "cash";
  documentNumber: string;
  note: string;
};

type Expense = {
  payer?: "self" | "customer";
  id: number;
  expenseDate: string;
  category: string;
  amountKopecks: number;
  method: "bank" | "cash";
  documentNumber: string;
  note: string;
};

type ExpenseCategory = {
  id: string;
  name: string;
  builtIn: boolean;
};

type AuditEvent = {
  id: number;
  at: string;
  period: string;
  entity: "entry" | "invoice" | "payment" | "expense" | "downtime" | "month" | "settings" | "document";
  title: string;
  detail: string;
};

type ThemeMode = "light" | "dark" | "system";

type Closure = {
  period: string;
  actualUnits: number;
  includedUnits: number;
  excessUnits: number;
  baseKopecks: number;
  rateKopecks: number;
  intensityKopecks?: number;
  variableKopecks: number;
  totalKopecks: number;
  closedAt: string;
  baseFullKopecks?: number;
  baseReductionKopecks?: number;
  calendarDays?: number;
  downtimeDays?: number;
  payableDays?: number;
};

type DashboardData = {
  entries: Entry[];
  invoices: Invoice[];
  payments: Payment[];
  openingPayments?: Payment[];
  expenses: Expense[];
  expenseCategories?: ExpenseCategory[];
  expenseShortcuts?: ExpenseShortcut[];
  closure: Closure | null;
  rules: {
    baseKopecks: number;
    includedUnits: number;
    rateKopecks: number;
  };
  settings?: DocumentSettings;
  downtimes?: Downtime[];
  documentMeta?: DocumentMeta;
  documentArchive?: ArchivedDocument[];
  auditLog?: AuditEvent[];
  taxPayments?: Payment[];
  taxAdjustments?: TaxAdjustment[];
  taxOptions?: TaxYearOptions[];
};

type ArchivedDocument = {
  id: number;
  period: string;
  kind: "act" | "reconciliation" | "daily" | "ledger";
  number: string;
  version: number;
  generatedAt: string;
  inputSnapshot: string;
  html: string;
  pdfUri?: string;
};

type OfflineStore = {
  version: 6;
  entries: Entry[];
  invoices: Invoice[];
  payments: Payment[];
  expenses: Expense[];
  expenseCategories: ExpenseCategory[];
  expenseShortcuts: ExpenseShortcut[];
  closures: Closure[];
  settings: DocumentSettings;
  downtimes: Downtime[];
  documents: DocumentMeta[];
  documentArchive: ArchivedDocument[];
  auditLog: AuditEvent[];
  taxAdjustments: TaxAdjustment[];
  taxOptions: TaxYearOptions[];
};

type AndroidAppBridge = {
  copyText: (text: string) => void;
  saveBase64File: (base64: string, fileName: string, mimeType: string) => void;
  saveHtmlAsPdf: (html: string, fileName: string) => void;
  saveArchivedHtmlAsPdf?: (html: string, fileName: string, archiveId: string) => void;
  openArchivedPdf?: (uri: string) => void;
  shareArchivedPdf?: (uri: string) => void;
  setTheme?: (theme: "light" | "dark") => void;
};

declare global {
  interface Window {
    AndroidApp?: AndroidAppBridge;
    onArchivePdfSaved?: (id: string, uri: string) => void;
  }
}

type ConfirmState = {
  title: string;
  description: string;
  actionLabel: string;
  destructive?: boolean;
  run: () => Promise<void>;
};

type ImportRow = {
  entryDate: string;
  units: number;
  note: string;
};

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

const DEFAULT_RULES = {
  baseKopecks: DEFAULT_DOCUMENT_SETTINGS.baseKopecks,
  includedUnits: DEFAULT_DOCUMENT_SETTINGS.includedUnits,
  rateKopecks: DEFAULT_DOCUMENT_SETTINGS.rateKopecks,
};

const DEFAULT_EXPENSE_CATEGORIES: ExpenseCategory[] = [
  { id: "fuel", name: "Топливо", builtIn: true },
  { id: "repair", name: "Ремонт", builtIn: true },
  { id: "base_lease", name: "Аренда Евгению", builtIn: true },
  { id: "insurance", name: "Страхование", builtIn: true },
  { id: "tax", name: "Налог и сборы", builtIn: true },
  { id: "other", name: "Прочее", builtIn: true },
];
const WEEKDAY_LABELS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const EXPENSE_CHART_COLORS = ["#2f8ff0", "#7c65df", "#f1aa32", "#32a477", "#e16c71", "#6f7f92", "#3bb6c7", "#bb68bb"];

function normalizeExpenseCategories(value: unknown, allowEmpty = false): ExpenseCategory[] {
  const supplied = Array.isArray(value) ? value : DEFAULT_EXPENSE_CATEGORIES;
  const valid = supplied
    .filter((item): item is Partial<ExpenseCategory> & { id: string; name: string } => (
      Boolean(item) &&
      typeof item === "object" &&
      typeof (item as Partial<ExpenseCategory>).id === "string" &&
      /^[a-z0-9_-]{1,48}$/.test((item as Partial<ExpenseCategory>).id ?? "") &&
      typeof (item as Partial<ExpenseCategory>).name === "string" &&
      Boolean((item as Partial<ExpenseCategory>).name?.trim())
    ))
    .map((item) => ({
      id: item.id,
      name: item.name.trim().slice(0, 36),
      builtIn: DEFAULT_EXPENSE_CATEGORIES.some((category) => category.id === item.id),
    }));
  const unique: ExpenseCategory[] = [];
  const seen = new Set<string>();
  let customCount = 0;
  for (const category of valid) {
    if (seen.has(category.id)) continue;
    if (!category.builtIn && customCount >= 12) continue;
    seen.add(category.id);
    if (!category.builtIn) customCount += 1;
    unique.push(category);
  }
  if (unique.length > 0 || allowEmpty) return unique;
  return DEFAULT_EXPENSE_CATEGORIES.map((category) => ({ ...category }));
}

const OFFLINE_STORAGE_KEY = "arenda-ts-offline-v1";
const THEME_STORAGE_KEY = "arenda-ts-theme-v1";
const LAST_BACKUP_STORAGE_KEY = "arenda-ts-last-backup-v1";
const DOCUMENT_TEXT_FIELDS = [
  "city", "contractNumber", "rentalStart", "rentalEnd", "lessorFull", "lessorShort", "lessorSignerShort", "lessorDative", "lessorInn",
  "lesseeFull", "lesseeShort", "lesseeInn", "lesseeKpp", "lesseeDirector",
  "lesseeDirectorShort", "vehicleModel", "vehicleYear", "vehicleVin", "vehiclePlate", "vatLabel",
] as const satisfies readonly (keyof DocumentSettings)[];

function normalizeDocumentSettings(value: unknown): DocumentSettings {
  const supplied = value && typeof value === "object" ? value as Partial<DocumentSettings> : {};
  const settings: DocumentSettings = { ...DEFAULT_DOCUMENT_SETTINGS, ...supplied };
  for (const field of DOCUMENT_TEXT_FIELDS) {
    if (!settings[field].trim() || settings[field].includes("[")) {
      settings[field] = DEFAULT_DOCUMENT_SETTINGS[field];
    }
  }
  return settings;
}

function applyTheme(theme: "light" | "dark") {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute(
    "content",
    theme === "dark" ? "#0c111b" : "#ffffff",
  );
  window.AndroidApp?.setTheme?.(theme);
}

function resolvedTheme(mode: ThemeMode): "light" | "dark" {
  if (mode !== "system") return mode;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function appendAudit(store: OfflineStore, event: Omit<AuditEvent, "id" | "at">) {
  const audit: AuditEvent = {
    id: nextId(store.auditLog),
    at: new Date().toISOString(),
    ...event,
  };
  store.auditLog = [audit, ...store.auditLog].slice(0, 300);
}

function emptyOfflineStore(): OfflineStore {
  return {
    version: 6,
    entries: [],
    invoices: [],
    payments: [],
    expenses: [],
    expenseCategories: normalizeExpenseCategories(undefined),
    expenseShortcuts: normalizeExpenseShortcuts(undefined, normalizeExpenseCategories(undefined)),
    closures: [],
    settings: normalizeDocumentSettings(undefined),
    downtimes: [],
    documents: [],
    documentArchive: [],
    auditLog: [],
    taxAdjustments: [],
    taxOptions: [],
  };
}

function isOfflineRuntime() {
  return typeof window !== "undefined" &&
    (window.location.protocol === "file:" || Boolean(window.AndroidApp));
}

function normalizeOfflineStore(value: unknown): OfflineStore {
  if (!value || typeof value !== "object") throw new Error("Неверный формат резервной копии");
  const store = value as Partial<OfflineStore>;
  if (
    !Array.isArray(store.entries) ||
    !Array.isArray(store.invoices) ||
    !Array.isArray(store.payments) ||
    !Array.isArray(store.expenses) ||
    !Array.isArray(store.closures)
  ) {
    throw new Error("В резервной копии не хватает данных");
  }
  return {
    version: 6,
    entries: store.entries,
    invoices: store.invoices,
    payments: store.payments,
    expenses: store.expenses,
    expenseCategories: normalizeExpenseCategories(store.expenseCategories),
    expenseShortcuts: normalizeExpenseShortcuts(store.expenseShortcuts, normalizeExpenseCategories(store.expenseCategories)),
    closures: store.closures,
    settings: normalizeDocumentSettings(store.settings),
    downtimes: Array.isArray(store.downtimes) ? store.downtimes : [],
    documents: Array.isArray(store.documents) ? store.documents : [],
    documentArchive: Array.isArray(store.documentArchive) ? store.documentArchive : [],
    auditLog: Array.isArray(store.auditLog) ? store.auditLog.slice(0, 300) : [],
    taxAdjustments: Array.isArray(store.taxAdjustments) ? store.taxAdjustments.filter((row) =>
      row && Number.isSafeInteger(row.id) && validIsoDate(row.date) &&
      Number.isSafeInteger(row.amountKopecks) && row.amountKopecks > 0 &&
      (row.kind === "income" || row.kind === "tax_paid")
    ) : [],
    taxOptions: Array.isArray(store.taxOptions) ? store.taxOptions.filter((row) =>
      row && Number.isInteger(row.year) && row.year >= 2020 && row.year <= 2100 &&
      Number.isSafeInteger(row.deductionKopecks) && row.deductionKopecks >= 0 &&
      typeof row.hasWorkers === "boolean"
    ) : [],
  };
}

function readOfflineStore() {
  const saved = window.localStorage.getItem(OFFLINE_STORAGE_KEY);
  if (!saved) return emptyOfflineStore();
  try {
    return normalizeOfflineStore(JSON.parse(saved));
  } catch {
    throw new Error("Не удалось прочитать данные на телефоне");
  }
}

function writeOfflineStore(store: OfflineStore) {
  window.localStorage.setItem(OFFLINE_STORAGE_KEY, JSON.stringify(store));
}

function nextId(rows: { id: number }[]) {
  return rows.reduce((maximum, row) => Math.max(maximum, row.id), 0) + 1;
}

function validIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function automaticOpeningBalance(store: OfflineStore, period: string) {
  let balance = 0;
  for (let cursor = store.settings.rentalStart.slice(0, 7); cursor < period;) {
    const gross = calculateRental(cursor, store.entries, store.downtimes, store.settings);
    balance += calculateFuelAdjustment(cursor, gross, store.expenses).calculation.totalKopecks;
    const [year, month] = cursor.split("-").map(Number);
    cursor = `${year + (month === 12 ? 1 : 0)}-${String(month === 12 ? 1 : month + 1).padStart(2, "0")}`;
  }
  const priorInvoiceIds = new Set(store.invoices.filter((i) => i.period < period).map((i) => i.id));
  balance -= store.payments.filter((p) => priorInvoiceIds.has(p.invoiceId) && p.paymentDate < `${period}-01`)
    .reduce((sum, p) => sum + p.amountKopecks, 0);
  return balance;
}

export function offlineDashboard(period: string): DashboardData {
  const store = readOfflineStore();
  const from = `${period}-01`;
  const to = `${period}-31`;
  const entries = store.entries
    .filter((entry) => entry.entryDate >= from && entry.entryDate <= to)
    .sort((a, b) => b.entryDate.localeCompare(a.entryDate) || b.id - a.id);
  const invoices = store.invoices
    .filter((invoice) => invoice.period === period)
    .sort((a, b) => b.invoiceDate.localeCompare(a.invoiceDate) || b.id - a.id);
  const invoiceIds = new Set(invoices.map((invoice) => invoice.id));
  const payments = store.payments
    .filter((payment) => invoiceIds.has(payment.invoiceId))
    .sort((a, b) => b.paymentDate.localeCompare(a.paymentDate) || b.id - a.id);
  const priorInvoiceIds = new Set(store.invoices.filter((invoice) => invoice.period < period).map((invoice) => invoice.id));
  const openingPayments = store.payments.filter((payment) => priorInvoiceIds.has(payment.invoiceId) && payment.paymentDate >= from);
  const expenses = store.expenses
    .filter((expense) => expense.expenseDate >= from && expense.expenseDate <= to)
    .sort((a, b) => b.expenseDate.localeCompare(a.expenseDate) || b.id - a.id);
  const downtimes = store.downtimes
    .filter((downtime) => downtime.startDate <= to && downtime.endDate >= from)
    .sort((a, b) => b.startDate.localeCompare(a.startDate) || b.id - a.id);
  const savedMeta = store.documents.find((document) => document.period === period);
  const documentMeta = { ...(savedMeta ?? defaultDocumentMeta(period, store.documents.length + 1, localIsoDate())),
    openingBalanceKopecks: savedMeta && Number.isSafeInteger(savedMeta.openingBalanceKopecks)
      ? savedMeta.openingBalanceKopecks : automaticOpeningBalance(store, period) };

  return {
    entries,
    invoices,
    payments,
    openingPayments,
    expenses,
    expenseCategories: store.expenseCategories,
    expenseShortcuts: store.expenseShortcuts,
    closure: store.closures.find((closure) => closure.period === period) ?? null,
    rules: {
      baseKopecks: store.settings.baseKopecks,
      includedUnits: store.settings.includedUnits,
      rateKopecks: store.settings.rateKopecks,
    },
    settings: store.settings,
    downtimes,
    documentMeta,
    documentArchive: store.documentArchive.filter((document) => document.period === period).sort((a, b) => b.id - a.id),
    auditLog: store.auditLog.filter((event) => event.period === period).slice(0, 100),
    taxPayments: store.payments,
    taxAdjustments: store.taxAdjustments,
    taxOptions: store.taxOptions,
  };
}

export function saveOfflineAction(payload: Record<string, unknown>) {
  const store = readOfflineStore();
  const action = payload.action;

  if (action === "save_entry") {
    const entryDate = payload.entryDate;
    const units = Number(payload.units);
    if (!validIsoDate(entryDate) || !Number.isSafeInteger(units) || units < 0) {
      throw new Error("Проверьте дату и количество");
    }
    const note = typeof payload.note === "string" ? payload.note.trim().slice(0, 300) : "";
    const existing = store.entries.find((entry) => entry.entryDate === entryDate);
    if (existing) {
      const previousUnits = existing.units;
      existing.units = units;
      existing.note = note;
      appendAudit(store, {
        period: entryDate.slice(0, 7),
        entity: "entry",
        title: `Изменена запись за ${dateLabel(entryDate)}`,
        detail: `${number(previousUnits)} → ${number(units)} ед.`,
      });
    } else {
      store.entries.push({ id: nextId(store.entries), entryDate, units, note });
      appendAudit(store, {
        period: entryDate.slice(0, 7),
        entity: "entry",
        title: `Добавлена запись за ${dateLabel(entryDate)}`,
        detail: `${number(units)} ед.`,
      });
    }
  } else if (action === "import_entries") {
    if (!Array.isArray(payload.entries) || payload.entries.length === 0) {
      throw new Error("В файле нет записей для загрузки");
    }
    let importedPeriod = "";
    let importedUnits = 0;
    for (const item of payload.entries) {
      if (!item || typeof item !== "object") throw new Error("Проверьте строки файла");
      const row = item as Record<string, unknown>;
      const entryDate = row.entryDate;
      const units = Number(row.units);
      if (!validIsoDate(entryDate) || !Number.isSafeInteger(units) || units < 0) {
        throw new Error("В файле есть неверная дата или количество");
      }
      const note = typeof row.note === "string" ? row.note.trim().slice(0, 300) : "";
      importedPeriod ||= entryDate.slice(0, 7);
      importedUnits += units;
      const existing = store.entries.find((entry) => entry.entryDate === entryDate);
      if (existing) {
        existing.units = units;
        existing.note = note;
      } else {
        store.entries.push({ id: nextId(store.entries), entryDate, units, note });
      }
    }
    appendAudit(store, {
      period: importedPeriod,
      entity: "entry",
      title: "Импортированы ежедневные записи",
      detail: `${number(payload.entries.length)} дн. · ${number(importedUnits)} ед.`,
    });
  } else if (action === "delete_entry") {
    const id = Number(payload.id);
    const entry = store.entries.find((row) => row.id === id);
    if (!entry) throw new Error("Запись не найдена");
    store.entries = store.entries.filter((row) => row.id !== id);
    appendAudit(store, {
      period: entry.entryDate.slice(0, 7),
      entity: "entry",
      title: `Удалена запись за ${dateLabel(entry.entryDate)}`,
      detail: `${number(entry.units)} ед.`,
    });
  } else if (action === "create_invoice" || action === "update_invoice") {
    const amountKopecks = Number(payload.amountKopecks);
    if (
      typeof payload.period !== "string" ||
      typeof payload.invoiceNumber !== "string" ||
      !payload.invoiceNumber.trim() ||
      !validIsoDate(payload.invoiceDate) ||
      !["fixed", "variable", "other"].includes(String(payload.kind)) ||
      !Number.isSafeInteger(amountKopecks) ||
      amountKopecks <= 0
    ) {
      throw new Error("Проверьте данные счёта");
    }
    const dueDate = payload.dueDate === "" || payload.dueDate == null ? null : String(payload.dueDate);
    if (dueDate !== null && !validIsoDate(dueDate)) throw new Error("Проверьте срок оплаты");
    const editId = action === "update_invoice" ? Number(payload.id) : null;
    const previousInvoice = editId === null ? null : store.invoices.find((row) => row.id === editId) ?? null;
    if (editId !== null && !store.invoices.some((row) => row.id === editId)) throw new Error("Запись не найдена");
    const bottleStartDate = typeof payload.bottleStartDate === "string" ? payload.bottleStartDate : "";
    const bottleEndDate = typeof payload.bottleEndDate === "string" ? payload.bottleEndDate : "";
    if ((bottleStartDate || bottleEndDate) &&
        (!validIsoDate(bottleStartDate) || !validIsoDate(bottleEndDate) ||
          bottleStartDate > bottleEndDate || bottleStartDate.slice(0, 7) !== payload.period ||
          bottleEndDate.slice(0, 7) !== payload.period)) {
      throw new Error("Укажите даты бутылей внутри выбранного месяца");
    }
    if (bottleStartDate && store.invoices.some((invoice) => invoice.id !== editId &&
      invoice.period === payload.period && invoice.bottleStartDate && invoice.bottleEndDate &&
      invoice.bottleStartDate <= bottleEndDate && invoice.bottleEndDate >= bottleStartDate &&
      !sharedBottlePeriodParts(invoice, { kind: String(payload.kind), bottleStartDate, bottleEndDate }))) {
      throw new Error("Периоды бутылей по счетам не должны пересекаться");
    }
    const recordId = editId ?? nextId(store.invoices);
    if (editId !== null) store.invoices = store.invoices.filter((row) => row.id !== editId);
    store.invoices.push({
      id: recordId,
      period: payload.period,
      invoiceNumber: payload.invoiceNumber.trim().slice(0, 60),
      invoiceDate: payload.invoiceDate,
      kind: payload.kind as Invoice["kind"],
      actNumber: String(payload.actNumber ?? "").trim().slice(0, 40),
      amountKopecks,
      ...(bottleStartDate ? { bottleStartDate, bottleEndDate } : {}),
      dueDate,
      note: typeof payload.note === "string" ? payload.note.trim().slice(0, 300) : "",
    });
    appendAudit(store, {
      period: String(payload.period),
      entity: "invoice",
      title: editId === null ? `Добавлен счёт №${payload.invoiceNumber}` : `Изменён счёт №${payload.invoiceNumber}`,
      detail: previousInvoice
        ? `${money(previousInvoice.amountKopecks)} → ${money(amountKopecks)}`
        : money(amountKopecks),
    });
  } else if (action === "delete_invoice") {
    const id = Number(payload.id);
    const invoice = store.invoices.find((row) => row.id === id);
    store.invoices = store.invoices.filter((invoice) => invoice.id !== id);
    store.payments = store.payments.filter((payment) => payment.invoiceId !== id);
    if (invoice) {
      appendAudit(store, {
        period: invoice.period,
        entity: "invoice",
        title: `Удалён счёт №${invoice.invoiceNumber}`,
        detail: money(invoice.amountKopecks),
      });
    }
  } else if (action === "restore_invoice") {
    const invoice = payload.invoice as Invoice | undefined;
    const payments = payload.payments as Payment[] | undefined;
    if (
      !invoice || !Number.isSafeInteger(invoice.id) || invoice.id <= 0 ||
      !/^\d{4}-\d{2}$/.test(invoice.period) ||
      !validIsoDate(invoice.invoiceDate) ||
      !invoice.invoiceNumber?.trim() ||
      !["fixed", "variable", "other"].includes(invoice.kind) ||
      !Number.isSafeInteger(invoice.amountKopecks) || invoice.amountKopecks <= 0 ||
      !Array.isArray(payments) || payments.some((payment) => (
        !Number.isSafeInteger(payment.id) || payment.id <= 0 ||
        payment.invoiceId !== invoice.id ||
        !validIsoDate(payment.paymentDate) ||
        !Number.isSafeInteger(payment.amountKopecks) || payment.amountKopecks <= 0 ||
        !["bank", "cash"].includes(payment.method)
      ))
    ) throw new Error("Не удалось восстановить счёт");
    const restoredId = store.invoices.some((row) => row.id === invoice.id)
      ? nextId(store.invoices)
      : invoice.id;
    store.invoices.push({ ...invoice, id: restoredId });
    for (const payment of payments) {
      store.payments.push({
        ...payment,
        invoiceId: restoredId,
        id: store.payments.some((row) => row.id === payment.id) ? nextId(store.payments) : payment.id,
      });
    }
    appendAudit(store, {
      period: invoice.period,
      entity: "invoice",
      title: `Восстановлен счёт №${invoice.invoiceNumber}`,
      detail: `${money(invoice.amountKopecks)} · ${number(payments.length)} оплат`,
    });
  } else if (action === "create_payment_split") {
    const allocations = payload.allocations as { invoiceId: number; amountKopecks: number }[];
    const amountKopecks = Number(payload.amountKopecks);
    if (!Array.isArray(allocations) || allocations.length < 2 || !validIsoDate(payload.paymentDate) ||
      !["bank", "cash"].includes(String(payload.method)) ||
      !Number.isSafeInteger(amountKopecks) || amountKopecks <= 0 ||
      allocations.some((row) => !store.invoices.some((i) => i.id === row.invoiceId) ||
        !Number.isSafeInteger(row.amountKopecks) || row.amountKopecks <= 0) ||
      new Set(allocations.map((row) => row.invoiceId)).size !== allocations.length ||
      allocations.reduce((sum, row) => sum + row.amountKopecks, 0) !== amountKopecks) {
      throw new Error("Проверьте распределение платежа по счетам");
    }
    const groupId = Date.now();
    for (const row of allocations) {
      store.payments.push({ id: nextId(store.payments), groupId, invoiceId: row.invoiceId,
        paymentDate: String(payload.paymentDate), amountKopecks: row.amountKopecks,
        method: payload.method as Payment["method"],
        documentNumber: String(payload.documentNumber ?? "").trim().slice(0, 80),
        note: String(payload.note ?? "").trim().slice(0, 300),
      });
    }
    appendAudit(store, { period: store.invoices.find((i) => i.id === allocations[0].invoiceId)?.period ?? "",
      entity: "payment", title: "Платёж распределён по счетам",
      detail: `${money(amountKopecks)} · ${allocations.length} счёта`,
    });
  } else if (action === "create_payment" || action === "update_payment") {
    const invoiceId = Number(payload.invoiceId);
    const amountKopecks = Number(payload.amountKopecks);
    if (
      !store.invoices.some((invoice) => invoice.id === invoiceId) ||
      !validIsoDate(payload.paymentDate) ||
      !Number.isSafeInteger(amountKopecks) ||
      amountKopecks <= 0 ||
      !["bank", "cash"].includes(String(payload.method))
    ) {
      throw new Error("Проверьте данные оплаты");
    }
    const editId = action === "update_payment" ? Number(payload.id) : null;
    const previousPayment = editId === null ? null : store.payments.find((row) => row.id === editId) ?? null;
    if (editId !== null && !store.payments.some((row) => row.id === editId)) throw new Error("Запись не найдена");
    const recordId = editId ?? nextId(store.payments);
    if (editId !== null) store.payments = store.payments.filter((row) => row.id !== editId);
    store.payments.push({
      id: recordId,
      invoiceId,
      paymentDate: payload.paymentDate,
      amountKopecks,
      method: payload.method as Payment["method"],
      documentNumber: typeof payload.documentNumber === "string" ? payload.documentNumber.trim().slice(0, 80) : "",
      note: typeof payload.note === "string" ? payload.note.trim().slice(0, 300) : "",
    });
    const invoice = store.invoices.find((row) => row.id === invoiceId);
    appendAudit(store, {
      period: invoice?.period ?? String(payload.paymentDate).slice(0, 7),
      entity: "payment",
      title: editId === null ? `Добавлена оплата по счёту №${invoice?.invoiceNumber ?? "—"}` : `Изменена оплата по счёту №${invoice?.invoiceNumber ?? "—"}`,
      detail: previousPayment
        ? `${money(previousPayment.amountKopecks)} → ${money(amountKopecks)}`
        : money(amountKopecks),
    });
  } else if (action === "delete_payment") {
    const id = Number(payload.id);
    const payment = store.payments.find((row) => row.id === id);
    const invoice = payment ? store.invoices.find((row) => row.id === payment.invoiceId) : null;
    store.payments = store.payments.filter((payment) => payment.id !== id);
    if (payment) {
      appendAudit(store, {
        period: invoice?.period ?? payment.paymentDate.slice(0, 7),
        entity: "payment",
        title: `Удалена оплата по счёту №${invoice?.invoiceNumber ?? "—"}`,
        detail: money(payment.amountKopecks),
      });
    }
  } else if (action === "create_expense" || action === "update_expense") {
    const amountKopecks = Number(payload.amountKopecks);
    const category = String(payload.category ?? "");
    if (
      !validIsoDate(payload.expenseDate) ||
      !store.expenseCategories.some((item) => item.id === category) ||
      !Number.isSafeInteger(amountKopecks) ||
      amountKopecks <= 0 ||
      !["bank", "cash"].includes(String(payload.method))
    ) {
      throw new Error("Проверьте данные расхода");
    }
    const editId = action === "update_expense" ? Number(payload.id) : null;
    const previousExpense = editId === null ? null : store.expenses.find((row) => row.id === editId) ?? null;
    if (editId !== null && !store.expenses.some((row) => row.id === editId)) throw new Error("Запись не найдена");
    const recordId = editId ?? nextId(store.expenses);
    if (editId !== null) store.expenses = store.expenses.filter((row) => row.id !== editId);
    store.expenses.push({
      id: recordId,
      expenseDate: payload.expenseDate,
      category,
      payer: category === "fuel" && payload.payer === "customer" ? "customer" : "self",
      amountKopecks,
      method: payload.method as Expense["method"],
      documentNumber: typeof payload.documentNumber === "string" ? payload.documentNumber.trim().slice(0, 80) : "",
      note: typeof payload.note === "string" ? payload.note.trim().slice(0, 300) : "",
    });
    const categoryName = store.expenseCategories.find((item) => item.id === category)?.name ?? "Расход";
    appendAudit(store, {
      period: String(payload.expenseDate).slice(0, 7),
      entity: "expense",
      title: editId === null ? `Добавлен расход «${categoryName}»` : `Изменён расход «${categoryName}»`,
      detail: previousExpense
        ? `${money(previousExpense.amountKopecks)} → ${money(amountKopecks)}`
        : money(amountKopecks),
    });
  } else if (action === "delete_expense") {
    const id = Number(payload.id);
    const expense = store.expenses.find((row) => row.id === id);
    store.expenses = store.expenses.filter((expense) => expense.id !== id);
    if (expense) {
      const categoryName = store.expenseCategories.find((item) => item.id === expense.category)?.name ?? "Расход";
      appendAudit(store, {
        period: expense.expenseDate.slice(0, 7),
        entity: "expense",
        title: `Удалён расход «${categoryName}»`,
        detail: money(expense.amountKopecks),
      });
    }
  } else if (action === "save_expense_categories") {
    if (!Array.isArray(payload.categories)) throw new Error("Проверьте список категорий");
    const categories = normalizeExpenseCategories(payload.categories, true);
    if (categories.length === 0) throw new Error("Оставьте хотя бы одну категорию");
    const categoryIds = new Set(categories.map((category) => category.id));
    const fallbackCategory = categories.find((category) => category.id === "other") ?? categories[0];
    store.expenses = store.expenses.map((expense) => (
      categoryIds.has(expense.category)
        ? expense
        : { ...expense, category: fallbackCategory.id, payer: "self" }
    ));
    store.expenseCategories = categories;
    store.expenseShortcuts = normalizeExpenseShortcuts(store.expenseShortcuts, categories);
    appendAudit(store, {
      period: localIsoDate().slice(0, 7),
      entity: "settings",
      title: "Изменены категории расходов",
      detail: `${number(categories.length)} категорий`,
    });
  } else if (action === "save_expense_shortcuts") {
    store.expenseShortcuts = validateExpenseShortcuts(payload.shortcuts, store.expenseCategories);
    appendAudit(store, { period: localIsoDate().slice(0, 7), entity: "settings",
      title: "Изменены быстрые кнопки расходов", detail: `${number(store.expenseShortcuts.length)} кнопок` });
  } else if (action === "save_settings") {
    const value = payload.settings;
    if (!value || typeof value !== "object") throw new Error("Проверьте настройки договора");
    const settings = value as Partial<DocumentSettings>;
    const baseKopecks = Number(settings.baseKopecks);
    const includedUnits = Number(settings.includedUnits);
    const rateKopecks = Number(settings.rateKopecks);
    if (
      !validIsoDate(settings.contractDate) ||
      !validIsoDate(settings.rentalStart) || !validIsoDate(settings.rentalEnd) ||
      settings.rentalStart > settings.rentalEnd ||
      !Number.isSafeInteger(baseKopecks) || baseKopecks <= 0 ||
      !Number.isSafeInteger(includedUnits) || includedUnits < 0 ||
      !Number.isSafeInteger(rateKopecks) || rateKopecks < 0
    ) {
      throw new Error("Проверьте дату договора и условия расчёта");
    }
    for (const field of DOCUMENT_TEXT_FIELDS) {
      if (typeof settings[field] !== "string" || !String(settings[field]).trim()) {
        throw new Error("Заполните все реквизиты договора");
      }
    }
    const shortcuts = payload.shortcuts === undefined ? store.expenseShortcuts
      : validateExpenseShortcuts(payload.shortcuts, store.expenseCategories);
    store.settings = {
      ...(settings as DocumentSettings),
      baseKopecks,
      includedUnits,
      rateKopecks,
    };
    store.expenseShortcuts = shortcuts;
    appendAudit(store, {
      period: localIsoDate().slice(0, 7),
      entity: "settings",
      title: "Изменены настройки расчёта",
      detail: `${money(baseKopecks)} · ${number(includedUnits)} ед. · ${money(rateKopecks)}/ед.`,
    });
  } else if (action === "save_document_meta") {
    const period = String(payload.period ?? "");
    const openingBalanceKopecks = Number(payload.openingBalanceKopecks);
    if (
      !/^\d{4}-\d{2}$/.test(period) ||
      !validIsoDate(payload.documentDate) ||
      !String(payload.actNumber ?? "").trim() ||
      !String(payload.reconciliationNumber ?? "").trim() ||
      !Number.isSafeInteger(openingBalanceKopecks)
    ) {
      throw new Error("Проверьте номер, дату и начальное сальдо документов");
    }
    const document: DocumentMeta = {
      period,
      actNumber: String(payload.actNumber).trim().slice(0, 40),
      reconciliationNumber: String(payload.reconciliationNumber).trim().slice(0, 40),
      documentDate: String(payload.documentDate),
      basis: String(payload.basis ?? "").trim().slice(0, 400),
      openingBalanceKopecks,
      asOfDate: validIsoDate(payload.asOfDate) ? String(payload.asOfDate) : String(payload.documentDate),
      adjustments: String(payload.adjustments ?? "").trim().slice(0, 300),
    };
    store.documents = [...store.documents.filter((item) => item.period !== period), document];
  } else if (action === "archive_document") {
    const document = payload.document as ArchivedDocument;
    if (!document || !Number.isSafeInteger(document.id) || document.id <= 0 || !/^\d{4}-\d{2}$/.test(document.period) ||
      !["act", "reconciliation", "daily", "ledger"].includes(document.kind) ||
      typeof document.html !== "string" || !document.html.startsWith("<!doctype html>")) {
      throw new Error("Неверные данные документа");
    }
    if (store.documentArchive.some((item) => item.id === document.id)) throw new Error("Документ уже существует");
    store.documentArchive.push(document);
  } else if (action === "delete_document") {
    const id = Number(payload.id);
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error("Неверный номер документа");
    const document = store.documentArchive.find((item) => item.id === id);
    if (!document) throw new Error("Документ не найден");
    store.documentArchive = store.documentArchive.filter((item) => item.id !== id);
    appendAudit(store, { period: document.period, entity: "document", title: "Документ удалён из архива",
      detail: `№${document.number} · версия ${document.version}` });
  } else if (action === "link_document_pdf") {
    const document = store.documentArchive.find((item) => item.id === Number(payload.id));
    if (document && typeof payload.uri === "string" && payload.uri.startsWith("content://")) {
      document.pdfUri = payload.uri;
    }
  } else if (action === "create_downtime" || action === "update_downtime") {
    const startDate = String(payload.startDate ?? "");
    const endDate = String(payload.endDate ?? "");
    if (!validIsoDate(startDate) || !validIsoDate(endDate) || startDate > endDate) {
      throw new Error("Проверьте даты простоя");
    }
    if (!String(payload.reason ?? "").trim() || !String(payload.basis ?? "").trim()) {
      throw new Error("Укажите причину и подтверждение технического простоя");
    }
    const start = new Date(`${startDate}T12:00:00Z`);
    const end = new Date(`${endDate}T12:00:00Z`);
    if ((end.getTime() - start.getTime()) / 86_400_000 > 366) {
      throw new Error("Один период простоя не может быть длиннее года");
    }
    const editId = action === "update_downtime" ? Number(payload.id) : null;
    if (editId !== null && !store.downtimes.some((row) => row.id === editId)) {
      throw new Error("Период простоя не найден");
    }
    const recordId = editId ?? nextId(store.downtimes);
    store.downtimes = store.downtimes.filter((row) => row.id !== editId);
    store.downtimes.push({
      id: recordId,
      startDate,
      endDate,
      reason: String(payload.reason).trim().slice(0, 160),
      basis: String(payload.basis).trim().slice(0, 300),
      note: String(payload.note ?? "").trim().slice(0, 300),
    });
    appendAudit(store, {
      period: startDate.slice(0, 7),
      entity: "downtime",
      title: editId === null ? "Добавлен простой" : "Изменён простой",
      detail: startDate === endDate ? dateLabel(startDate) : `${dateLabel(startDate)} — ${dateLabel(endDate)}`,
    });
  } else if (action === "delete_downtime") {
    const id = Number(payload.id);
    const downtime = store.downtimes.find((row) => row.id === id);
    if (!downtime) throw new Error("Период простоя не найден");
    store.downtimes = store.downtimes.filter((row) => row.id !== id);
    appendAudit(store, {
      period: downtime.startDate.slice(0, 7),
      entity: "downtime",
      title: "Удалён простой",
      detail: downtime.startDate === downtime.endDate
        ? dateLabel(downtime.startDate)
        : `${dateLabel(downtime.startDate)} — ${dateLabel(downtime.endDate)}`,
    });
  } else if (action === "close_month") {
    const period = String(payload.period ?? "");
    if (!/^\d{4}-\d{2}$/.test(period)) throw new Error("Неверно указан месяц");
    const calculation = calculateRental(period, store.entries, store.downtimes, store.settings);
    const closure: Closure = {
      period,
      ...calculation,
      closedAt: new Date().toISOString(),
    };
    store.closures = [...store.closures.filter((row) => row.period !== period), closure];
    appendAudit(store, {
      period,
      entity: "month",
      title: `Закрыт ${monthLabel(period).toLowerCase()}`,
      detail: `${number(calculation.actualUnits)} ед. · ${money(calculation.totalKopecks)}`,
    });
  } else if (action === "reopen_month") {
    const period = String(payload.period ?? "");
    store.closures = store.closures.filter((closure) => closure.period !== period);
    appendAudit(store, {
      period,
      entity: "month",
      title: `Открыт ${monthLabel(period).toLowerCase()}`,
      detail: "Редактирование снова доступно",
    });
  } else if (action === "save_tax_adjustment") {
    const date = String(payload.date ?? "");
    const amountKopecks = Number(payload.amountKopecks);
    const kind = payload.kind;
    if (!validIsoDate(date) || !Number.isSafeInteger(amountKopecks) || amountKopecks <= 0 ||
      (kind !== "income" && kind !== "tax_paid")) throw new Error("Проверьте налоговую запись");
    const id = Number(payload.id) || nextId(store.taxAdjustments);
    store.taxAdjustments = store.taxAdjustments.filter((row) => row.id !== id);
    store.taxAdjustments.push({ id, date, amountKopecks, kind, note: String(payload.note ?? "").trim().slice(0, 120) });
  } else if (action === "delete_tax_adjustment") {
    store.taxAdjustments = store.taxAdjustments.filter((row) => row.id !== Number(payload.id));
  } else if (action === "save_tax_options") {
    const year = Number(payload.year);
    const deductionKopecks = Number(payload.deductionKopecks);
    if (!Number.isInteger(year) || year < 2020 || year > 2100 ||
      !Number.isSafeInteger(deductionKopecks) || deductionKopecks < 0 ||
      typeof payload.hasWorkers !== "boolean") throw new Error("Проверьте налоговые настройки");
    store.taxOptions = store.taxOptions.filter((row) => row.year !== year);
    store.taxOptions.push({ year, deductionKopecks, hasWorkers: payload.hasWorkers });
  } else {
    throw new Error("Неизвестное действие");
  }

  writeOfflineStore(store);
}

function utf8Base64(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return window.btoa(binary);
}

function saveBrowserFile(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

const invoiceLabels: Record<Invoice["kind"], string> = {
  fixed: "Постоянная часть",
  variable: "Переменная часть",
  other: "Прочее",
};

const monthNamesGenitive = [
  "январь",
  "февраль",
  "март",
  "апрель",
  "май",
  "июнь",
  "июль",
  "август",
  "сентябрь",
  "октябрь",
  "ноябрь",
  "декабрь",
];

function localIsoDate() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 10);
}

function money(kopecks: number) {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 0,
  }).format(kopecks / 100);
}

function number(value: number) {
  return new Intl.NumberFormat("ru-RU").format(value);
}

function dateLabel(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("ru-RU").format(new Date(`${value}T12:00:00`));
}

function nextIsoDate(value: string) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function addIsoDays(value: string, amount: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function weekStart(value: string) {
  const date = new Date(`${value}T12:00:00Z`);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - day + 1);
  return date.toISOString().slice(0, 10);
}

function shortWeekRange(start: string, end: string) {
  const format = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" });
  return `${format.format(new Date(`${start}T12:00:00Z`))} — ${format.format(new Date(`${end}T12:00:00Z`))}`;
}

function downtimeLabel(downtime: Downtime) {
  return downtime.startDate === downtime.endDate
    ? dateLabel(downtime.startDate)
    : `${dateLabel(downtime.startDate)} — ${dateLabel(downtime.endDate)}`;
}

function monthLabel(value: string) {
  const text = new Intl.DateTimeFormat("ru-RU", {
    month: "long",
    year: "numeric",
  }).format(new Date(`${value}-01T12:00:00`));
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function documentPeriod(value: string) {
  const [year, month] = value.split("-");
  return `${monthNamesGenitive[Number(month) - 1]} ${year} года`;
}

function invoiceLine(invoice: Invoice, settings: DocumentSettings) {
  const part =
    invoice.kind === "fixed"
      ? "Часть постоянной арендной платы"
      : invoice.kind === "variable"
        ? "Переменная часть арендной платы"
        : "Арендная плата";
  const days = invoice.bottleStartDate && invoice.bottleEndDate
    ? `, бутыли за ${dateLabel(invoice.bottleStartDate)}–${dateLabel(invoice.bottleEndDate)}` : "";
  return `${part} за ${documentPeriod(invoice.period)}${days} по договору аренды транспортного средства без экипажа № ${settings.contractNumber} от ${dateLabel(settings.contractDate)}, автомобиль ${settings.vehicleModel}, VIN ${settings.vehicleVin}.`;
}

function paymentPurpose(invoice: Invoice, settings: DocumentSettings) {
  const part =
    invoice.kind === "fixed"
      ? "часть постоянной арендной платы"
      : invoice.kind === "variable"
        ? "переменную часть арендной платы"
        : "арендную плату";
  return `Оплата по счёту № ${invoice.invoiceNumber} от ${dateLabel(invoice.invoiceDate)} за ${part} за ${documentPeriod(invoice.period)} по договору № ${settings.contractNumber} от ${dateLabel(settings.contractDate)}. Без НДС.`;
}

function emailSubject(invoice: Invoice, settings: DocumentSettings) {
  return `Счёт № ${invoice.invoiceNumber} — аренда ${settings.vehicleModel} за ${documentPeriod(invoice.period)}`;
}

function emailText(invoice: Invoice, settings: DocumentSettings) {
  const action =
    invoice.kind === "fixed"
      ? "на частичную оплату постоянной арендной платы"
      : invoice.kind === "variable"
        ? "на оплату переменной части арендной платы"
        : "на оплату арендной платы";

  return `Направляю счёт № ${invoice.invoiceNumber} ${action} за ${settings.vehicleModel} за ${documentPeriod(invoice.period)} по договору № ${settings.contractNumber} от ${dateLabel(settings.contractDate)}.`;
}

function toKopecks(value: string) {
  const normalized = value.replace(/\s/g, "").replace(",", ".");
  const rubles = Number(normalized);
  return Number.isFinite(rubles) && rubles > 0 ? Math.round(rubles * 100) : 0;
}

function toSignedKopecks(value: string) {
  const normalized = value.replace(/\s/g, "").replace(",", ".");
  const rubles = Number(normalized);
  return Number.isFinite(rubles) ? Math.round(rubles * 100) : null;
}

function printHtmlInBrowser(html: string) {
  const frame = document.createElement("iframe");
  frame.style.position = "fixed";
  frame.style.width = "1px";
  frame.style.height = "1px";
  frame.style.opacity = "0";
  frame.style.pointerEvents = "none";
  document.body.appendChild(frame);
  const target = frame.contentWindow;
  if (!target) throw new Error("Не удалось открыть документ");
  target.document.open();
  target.document.write(html);
  target.document.close();
  window.setTimeout(() => {
    target.focus();
    target.print();
    window.setTimeout(() => frame.remove(), 2_000);
  }, 300);
}

function statusFor(invoice: Invoice, paid: number) {
  if (paid >= invoice.amountKopecks) return { label: "Оплачен", tone: "paid" };
  if (paid > 0) return { label: "Частично", tone: "partial" };
  if (invoice.dueDate && invoice.dueDate < localIsoDate()) {
    return { label: "Просрочен", tone: "overdue" };
  }
  return { label: "Выставлен", tone: "issued" };
}

function isoDate(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function importDate(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return isoDate(value.getFullYear(), value.getMonth() + 1, value.getDate());
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86_400_000);
    return isoDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
  }

  const text = String(value ?? "").trim();
  let match = text.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/);
  if (match) return isoDate(Number(match[1]), Number(match[2]), Number(match[3]));

  match = text.match(/^(\d{1,2})[-./](\d{1,2})[-./](\d{4})$/);
  if (match) return isoDate(Number(match[3]), Number(match[2]), Number(match[1]));
  return null;
}

function importUnits(value: unknown) {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  }
  const normalized = String(value ?? "")
    .trim()
    .replace(/[\s\u00a0]/g, "")
    .replace(/(?:бутыл(?:ка|ки|ок)?|шт\.?|ед\.?)$/i, "");
  if (!/^\d+$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function normalizedHeader(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]/g, "");
}

function DocumentPreviewPages({ html }: { html: string }) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(794);
  const pageCount = Math.max(1, (html.match(/<section class="page">/g) ?? []).length);
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const resize = () => setWidth(Math.min(794, frame.clientWidth));
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);
  const scale = width / 794;
  return <div className="document-preview-frame" ref={frameRef}>
    <div className="document-preview-paper" style={{ width, height: 1123 * pageCount * scale }}>
      <iframe title="Предпросмотр PDF" srcDoc={html} sandbox="" style={{ height: 1123 * pageCount, transform: `scale(${scale})` }} />
    </div>
  </div>;
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <span className="field-label">{children}</span>;
}

function CopyBlock({
  title,
  text,
  copied,
  onCopy,
}: {
  title: string;
  text: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="copy-block">
      <div className="copy-block-heading">
        <span>{title}</span>
        <Button type="button" variant="outline" size="sm" onClick={onCopy}>
          {copied ? <CheckCircle2 /> : <Copy />}
          {copied ? "Скопировано" : "Копировать"}
        </Button>
      </div>
      <p>{text}</p>
    </div>
  );
}

export default function RentalApp() {
  const [today] = useState(() => localIsoDate());
  const [month, setMonth] = useState(today.slice(0, 7));
  const [tab, setTab] = useState("summary");
  const [offlineMode, setOfflineMode] = useState(false);
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [copiedKey, setCopiedKey] = useState("");
  const [textInvoice, setTextInvoice] = useState<Invoice | null>(null);
  const [settlementOpen, setSettlementOpen] = useState(false);
  const [quickEntryOpen, setQuickEntryOpen] = useState(false);
  const [closeMonthOpen, setCloseMonthOpen] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);
  const [entryHistoryOpen, setEntryHistoryOpen] = useState(false);
  const [monthCalendarOpen, setMonthCalendarOpen] = useState(false);
  const [taxOpen, setTaxOpen] = useState(false);
  const [taxKind, setTaxKind] = useState<TaxAdjustment["kind"]>("income");
  const [taxDate, setTaxDate] = useState(today);
  const [taxAmount, setTaxAmount] = useState("");
  const [taxNote, setTaxNote] = useState("");
  const [taxDeduction, setTaxDeduction] = useState("0");
  const [taxHasWorkers, setTaxHasWorkers] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [themeMode, setThemeMode] = useState<ThemeMode>("system");
  const [lastBackupAt, setLastBackupAt] = useState<string | null>(null);

  const [entryDate, setEntryDate] = useState(today);
  const quickEntryUnitsRef = useRef<HTMLInputElement>(null);
  const [editingEntry, setEditingEntry] = useState<Entry | null>(null);
  const [editUnits, setEditUnits] = useState("");
  const [editNote, setEditNote] = useState("");
  const [expensePayer, setExpensePayer] = useState<"self" | "customer">("self");
  const [entryUnits, setEntryUnits] = useState("");
  const [entryNote, setEntryNote] = useState("");
  const importInputRef = useRef<HTMLInputElement>(null);
  const backupInputRef = useRef<HTMLInputElement>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importFileName, setImportFileName] = useState("");
  const [importRows, setImportRows] = useState<ImportRow[]>([]);
  const [importWarnings, setImportWarnings] = useState<string[]>([]);

  const [editingInvoiceId, setEditingInvoiceId] = useState<number | null>(null);
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [invoiceKind, setInvoiceKind] = useState<Invoice["kind"]>("fixed");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceActNumber, setInvoiceActNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(today);
  const [invoiceDueDate, setInvoiceDueDate] = useState("");
  const [invoiceStartDate, setInvoiceStartDate] = useState(today);
  const [invoiceEndDate, setInvoiceEndDate] = useState(today);
  const [invoicePeriodAutomatic, setInvoicePeriodAutomatic] = useState(true);
  const [invoiceAmount, setInvoiceAmount] = useState("80000");
  const [invoiceNote, setInvoiceNote] = useState("");

  const [editingPaymentId, setEditingPaymentId] = useState<number | null>(null);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentInvoiceId, setPaymentInvoiceId] = useState<number | null>(null);
  const [paymentDate, setPaymentDate] = useState(today);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentSplits, setPaymentSplits] = useState<Record<number, string> | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<Payment["method"]>("bank");
  const [paymentDocument, setPaymentDocument] = useState("");
  const [paymentNote, setPaymentNote] = useState("");

  const [editingExpenseId, setEditingExpenseId] = useState<number | null>(null);
  const [expenseFilter, setExpenseFilter] = useState<string>("all");
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [expenseCategoriesOpen, setExpenseCategoriesOpen] = useState(false);
  const [expenseCategoriesDraft, setExpenseCategoriesDraft] = useState<ExpenseCategory[]>(() => normalizeExpenseCategories(undefined));
  const [expenseShortcutsDraft, setExpenseShortcutsDraft] = useState<ExpenseShortcut[]>([]);
  const [expenseDate, setExpenseDate] = useState(today);
  const [expenseCategory, setExpenseCategory] = useState("base_lease");
  const [expenseAmount, setExpenseAmount] = useState("20000");
  const [expenseMethod, setExpenseMethod] = useState<Expense["method"]>("bank");
  const [expenseDocument, setExpenseDocument] = useState("");
  const [expenseNote, setExpenseNote] = useState("");

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState<DocumentSettings>({ ...DEFAULT_DOCUMENT_SETTINGS });
  const [actNumber, setActNumber] = useState("1");
  const [documentDate, setDocumentDate] = useState(today);
  const [asOfDate, setAsOfDate] = useState(today);
  const [documentAdjustments, setDocumentAdjustments] = useState("");
  const [documentOpeningBalance, setDocumentOpeningBalance] = useState("0");
  const [documentDraftRevision, setDocumentDraftRevision] = useState(0);
  const documentWorkspaceRef = useRef<HTMLElement>(null);
  const [editingArchivedId, setEditingArchivedId] = useState<number | null>(null);

  const [downtimeListOpen, setDowntimeListOpen] = useState(false);
  const [downtimeOpen, setDowntimeOpen] = useState(false);
  const [editingDowntimeId, setEditingDowntimeId] = useState<number | null>(null);
  const [downtimeStart, setDowntimeStart] = useState(today);
  const [downtimeEnd, setDowntimeEnd] = useState(today);
  const [downtimeReason, setDowntimeReason] = useState("");
  const [downtimeBasis, setDowntimeBasis] = useState("");
  const [downtimeNote, setDowntimeNote] = useState("");
  const [documentPreview, setDocumentPreview] = useState<{
    kind: ArchivedDocument["kind"]; html: string; number: string; meta: DocumentMeta; inputSnapshot: string;
  } | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      if (isOfflineRuntime()) {
        setData(offlineDashboard(month));
        return;
      }
      const response = await fetch(`/api/dashboard?month=${encodeURIComponent(month)}`, {
        cache: "no-store",
      });
      const result = (await response.json()) as DashboardData & { error?: string };
      if (!response.ok) throw new Error(result.error || "Не удалось загрузить данные");
      setData(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Не удалось загрузить данные";
      setLoadError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadData();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadData]);

  useEffect(() => {
    setOfflineMode(isOfflineRuntime());
    const offerInstall = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const installed = () => setInstallPrompt(null);

    window.addEventListener("beforeinstallprompt", offerInstall);
    window.addEventListener("appinstalled", installed);
    return () => {
      window.removeEventListener("beforeinstallprompt", offerInstall);
      window.removeEventListener("appinstalled", installed);
    };
  }, []);

  useEffect(() => {
    const savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    const nextMode: ThemeMode = savedTheme === "dark" || savedTheme === "light" ? savedTheme : "system";
    setThemeMode(nextMode);
    setLastBackupAt(window.localStorage.getItem(LAST_BACKUP_STORAGE_KEY));
  }, []);

  useEffect(() => {
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    const syncTheme = () => {
      const nextTheme = resolvedTheme(themeMode);
      setTheme(nextTheme);
      applyTheme(nextTheme);
    };
    syncTheme();
    media?.addEventListener?.("change", syncTheme);
    return () => media?.removeEventListener?.("change", syncTheme);
  }, [themeMode]);

  useEffect(() => {
    if (data && !settingsOpen) setSettingsDraft({ ...(data.settings ?? DEFAULT_DOCUMENT_SETTINGS) });
  }, [data, settingsOpen]);

  // Reloading days, invoices or payments must keep an unsaved document draft.
  const documentMetaSnapshot = data
    ? JSON.stringify(data.documentMeta ?? defaultDocumentMeta(month, 1, today)) : null;
  useEffect(() => {
    if (!documentMetaSnapshot) return;
    const meta = JSON.parse(documentMetaSnapshot) as DocumentMeta;
    setActNumber(meta.actNumber);
    setDocumentDate(meta.documentDate);
    setAsOfDate(meta.asOfDate ?? meta.documentDate);
    setDocumentAdjustments(meta.adjustments ?? "");
    setDocumentOpeningBalance(String(meta.openingBalanceKopecks / 100));
    setEditingArchivedId(null);
  }, [documentMetaSnapshot, documentDraftRevision]);

  useEffect(() => {
    window.onArchivePdfSaved = (id, uri) => {
      try {
        saveOfflineAction({ action: "link_document_pdf", id: Number(id), uri });
        void loadData();
      } catch { toast.error("PDF сохранён, но ссылка в архиве не обновилась"); }
    };
    return () => { delete window.onArchivePdfSaved; };
  }, [loadData]);

  const taxYear = Number(month.slice(0, 4));
  const taxQuarter = Math.ceil(Number(month.slice(5, 7)) / 3);
  const taxOptions = data?.taxOptions?.find((item) => item.year === taxYear)
    ?? { year: taxYear, deductionKopecks: 0, hasWorkers: false };
  const tax = calculateTaxYear(taxYear, taxQuarter, data?.taxPayments ?? [],
    data?.taxAdjustments ?? [], taxOptions);

  function openTax() {
    setTaxDeduction(String(taxOptions.deductionKopecks / 100));
    setTaxHasWorkers(taxOptions.hasWorkers);
    setTaxDate(month === today.slice(0, 7) ? today : `${month}-01`);
    setTaxKind("income");
    setTaxAmount("");
    setTaxNote("");
    setTaxOpen(true);
  }

  async function saveTaxOptions(event: FormEvent) {
    event.preventDefault();
    const deductionKopecks = toSignedKopecks(taxDeduction);
    if (deductionKopecks === null || deductionKopecks < 0) { toast.error("Проверьте сумму взносов"); return; }
    await request({ action: "save_tax_options", year: taxYear, deductionKopecks, hasWorkers: taxHasWorkers }, "Расчёт налога обновлён");
  }

  async function saveTaxAdjustment(event: FormEvent) {
    event.preventDefault();
    const amountKopecks = toKopecks(taxAmount);
    if (!amountKopecks || !validIsoDate(taxDate) || !taxDate.startsWith(String(taxYear))) {
      toast.error("Проверьте сумму и дату в выбранном году"); return;
    }
    const ok = await request({ action: "save_tax_adjustment", date: taxDate,
      amountKopecks, kind: taxKind, note: taxNote }, "Запись учтена");
    if (ok) { setTaxAmount(""); setTaxNote(""); }
  }

  useEffect(() => {
    if (!offlineMode || window.sessionStorage.getItem("arenda-ts-backup-reminder-shown")) return;
    const last = lastBackupAt ? new Date(lastBackupAt).getTime() : 0;
    const backupDue = !last || Date.now() - last > 7 * 86_400_000;
    if (!backupDue) return;
    window.sessionStorage.setItem("arenda-ts-backup-reminder-shown", "1");
    const timer = window.setTimeout(() => {
      toast.info(last ? "Резервная копия старше недели" : "Создайте первую резервную копию", {
        duration: 7_000,
        action: { label: "Сохранить", onClick: exportBackup },
      });
    }, 900);
    return () => window.clearTimeout(timer);
  }, [lastBackupAt, offlineMode]);

  useEffect(() => {
    if (!quickEntryOpen) return;
    const viewport = window.visualViewport;
    const root = document.documentElement;
    const updateVisibleArea = () => {
      const height = viewport?.height ?? window.innerHeight;
      const bottom = Math.max(0, window.innerHeight - height - (viewport?.offsetTop ?? 0));
      root.style.setProperty("--app-visible-height", `${Math.round(height)}px`);
      root.style.setProperty("--app-keyboard-offset", `${Math.round(bottom)}px`);
      root.dataset.entryKeyboardOpen = bottom > 100 ? "true" : "false";
    };
    updateVisibleArea();
    viewport?.addEventListener("resize", updateVisibleArea);
    viewport?.addEventListener("scroll", updateVisibleArea);
    window.addEventListener("resize", updateVisibleArea);
    return () => {
      viewport?.removeEventListener("resize", updateVisibleArea);
      viewport?.removeEventListener("scroll", updateVisibleArea);
      window.removeEventListener("resize", updateVisibleArea);
      root.style.removeProperty("--app-visible-height");
      root.style.removeProperty("--app-keyboard-offset");
      delete root.dataset.entryKeyboardOpen;
    };
  }, [quickEntryOpen]);

  const request = useCallback(
    async (payload: Record<string, unknown>, success: string) => {
      setBusy(true);
      try {
        if (isOfflineRuntime()) {
          saveOfflineAction(payload);
          if (success) toast.success(success);
          if (["save_entry", "delete_entry", "import_entries", "create_downtime", "update_downtime", "delete_downtime", "save_settings"].includes(String(payload.action)) &&
            data?.documentArchive?.some((item) => item.kind === "act")) {
            toast.warning("Исходные данные изменены после формирования акта-расчёта. Проверьте документ и создайте новую версию.");
          }
          await loadData();
          return true;
        }
        const response = await fetch("/api/dashboard", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const result = (await response.json()) as { error?: string };
        if (!response.ok) throw new Error(result.error || "Не удалось сохранить");
        if (success) toast.success(success);
        await loadData();
        return true;
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Не удалось сохранить");
        return false;
      } finally {
        setBusy(false);
      }
    },
    [loadData, data?.documentArchive],
  );

  function showDeletedWithUndo(message: string, restore: () => Promise<unknown>) {
    if (!offlineMode) {
      toast.success(message);
      return;
    }
    toast.success(message, {
      duration: 8_000,
      action: {
        label: "Отменить",
        onClick: () => {
          void restore();
        },
      },
    });
  }

  const rules = data?.rules ?? DEFAULT_RULES;
  const documentSettings = data?.settings ?? {
    ...DEFAULT_DOCUMENT_SETTINGS,
    baseKopecks: rules.baseKopecks,
    includedUnits: rules.includedUnits,
    rateKopecks: rules.rateKopecks,
  };
  const invoiceTextReady = [
    documentSettings.contractNumber,
    documentSettings.vehicleModel,
    documentSettings.vehicleVin,
  ].every((value) => value.trim() && !value.includes("["));
  const liveCalculation = calculateRental(
    month,
    data?.entries ?? [],
    data?.downtimes ?? [],
    documentSettings,
  );
  // Закрытие фиксирует проверку, но исходные записи можно исправить и выпустить новую версию документа.
  const calculation: DocumentCalculation = liveCalculation;

  const paidByInvoice = useMemo(() => {
    const map = new Map<number, number>();
    data?.payments.forEach((payment) => {
      map.set(payment.invoiceId, (map.get(payment.invoiceId) ?? 0) + payment.amountKopecks);
    });
    return map;
  }, [data?.payments]);

  const totalPaid = data?.payments.reduce((sum, payment) => sum + payment.amountKopecks, 0) ?? 0;
  const totalInvoiced = data?.invoices.reduce((sum, invoice) => sum + invoice.amountKopecks, 0) ?? 0;
  const totalExpenses = data?.expenses.reduce((sum, expense) => sum + expense.amountKopecks, 0) ?? 0;
  const settlement = calculateSettlement(month, calculation, data?.invoices ?? [], data?.expenses ?? []);
  const customerFuel = settlement.customerFuelKopecks;
  const fuelDeduction = settlement.fuelDeductionKopecks;
  const actCalculation = settlement.calculation;
  const selfExpenses = totalExpenses - customerFuel;
  const { fixedTargetKopecks, variableTargetKopecks, fixedRemainingKopecks, variableRemainingKopecks } = settlement;
  const filteredExpenses = data?.expenses.filter((expense) => expenseFilter === "all" || expense.category === expenseFilter) ?? [];
  const filteredExpenseTotal = filteredExpenses.reduce((sum, expense) => sum + expense.amountKopecks, 0);
  const filteredCustomerFuel = filteredExpenses.filter((expense) => expense.category === "fuel" && expense.payer === "customer").reduce((sum, expense) => sum + expense.amountKopecks, 0);
  const filteredSelfFuel = filteredExpenses.filter((expense) => expense.category === "fuel" && expense.payer !== "customer").reduce((sum, expense) => sum + expense.amountKopecks, 0);
  const netRent = settlement.netRentKopecks;
  const remainingToInvoice = settlement.remainingToInvoiceKopecks;
  const invoicePeriods = useMemo(() => suggestInvoicePeriods({ period: month, kind: invoiceKind,
    invoiceDate, entries: data?.entries ?? [], invoices: data?.invoices ?? [], expenses: data?.expenses ?? [],
    settings: documentSettings, excludeInvoiceId: editingInvoiceId ?? undefined }),
    [month, invoiceKind, invoiceDate, data?.entries, data?.invoices, data?.expenses, documentSettings, editingInvoiceId]);
  useEffect(() => {
    if (!invoiceOpen || editingInvoiceId !== null || !invoicePeriodAutomatic) return;
    const proposed = invoicePeriods.needsReview ? undefined : invoicePeriods.periods[0];
    setInvoiceStartDate(proposed?.startDate ?? "");
    setInvoiceEndDate(proposed?.endDate ?? "");
  }, [invoiceOpen, editingInvoiceId, invoicePeriodAutomatic, invoicePeriods]);
  const selectedBottleUnits = data?.entries.filter((entry) => invoiceStartDate && invoiceEndDate &&
    entry.entryDate >= invoiceStartDate && entry.entryDate <= invoiceEndDate)
    .reduce((sum, entry) => sum + entry.units, 0) ?? 0;
  const selectedBottleFuel = data?.expenses.filter((expense) => expense.category === "fuel" &&
    expense.payer === "customer" && invoiceStartDate && invoiceEndDate &&
    expense.expenseDate >= invoiceStartDate && expense.expenseDate <= invoiceEndDate)
    .reduce((sum, expense) => sum + expense.amountKopecks, 0) ?? 0;
  const cashResult = totalPaid - selfExpenses;
  const progress = calculation.includedUnits > 0
    ? Math.min(100, (calculation.actualUnits / calculation.includedUnits) * 100)
    : 100;
  const importTotalUnits = importRows.reduce((sum, row) => sum + row.units, 0);
  const selectedEntry = data?.entries.find((entry) => entry.entryDate === entryDate);
  const expenseCategories = useMemo(
    () => normalizeExpenseCategories(data?.expenseCategories),
    [data?.expenseCategories],
  );
  const expenseCategoryNames = useMemo(
    () => new Map(expenseCategories.map((category) => [category.id, category.name])),
    [expenseCategories],
  );
  const expenseCategoryName = (category: string) => expenseCategoryNames.get(category) ?? "Другая категория";
  const expenseShortcuts = useMemo(() => normalizeExpenseShortcuts(data?.expenseShortcuts, expenseCategories),
    [data?.expenseShortcuts, expenseCategories]);
  const expenseBreakdown = useMemo(() => expenseCategories
    .map((category, index) => ({
      ...category,
      color: EXPENSE_CHART_COLORS[index % EXPENSE_CHART_COLORS.length],
      amountKopecks: (data?.expenses ?? [])
        .filter((expense) => expense.category === category.id)
        .reduce((sum, expense) => sum + expense.amountKopecks, 0),
    }))
    .filter((category) => category.amountKopecks > 0), [data?.expenses, expenseCategories]);
  let expenseDonutOffset = 0;
  const expenseDonutBackground = totalExpenses > 0
    ? `conic-gradient(${expenseBreakdown.map((category) => {
      const start = expenseDonutOffset;
      expenseDonutOffset += (category.amountKopecks / totalExpenses) * 100;
      return `${category.color} ${start.toFixed(2)}% ${expenseDonutOffset.toFixed(2)}%`;
    }).join(", ")})`
    : "conic-gradient(#e7ecf2 0 100%)";
  const monthBounds = periodBounds(month);
  const documentDateIssue = reconciliationDateError({ period: month, documentDate, asOfDate });
  const missingCutoff = month === today.slice(0, 7) ? today : monthBounds.end;
  const currentWeekStart = weekStart(entryDate);
  const monthCalendarDays = useMemo(() => {
    const entriesByDate = new Map((data?.entries ?? []).map((entry) => [entry.entryDate, entry]));
    const first = weekStart(monthBounds.start);
    const last = addIsoDays(weekStart(monthBounds.end), 6);
    const days = [];
    for (let date = first; date <= last; date = addIsoDays(date, 1)) {
      const inMonth = date.slice(0, 7) === month;
      const entry = entriesByDate.get(date);
      const isSunday = new Date(`${date}T12:00:00Z`).getUTCDay() === 0;
      days.push({ date, inMonth, entry, missing: inMonth && date <= missingCutoff && !isSunday && !entry });
    }
    return days;
  }, [data?.entries, month, monthBounds.start, monthBounds.end, missingCutoff]);
  const currentWeekDays = useMemo(() => {
    const entriesByDate = new Map((data?.entries ?? []).map((entry) => [entry.entryDate, entry]));
    return Array.from({ length: 7 }, (_, index) => {
      const date = addIsoDays(currentWeekStart, index);
      const inMonth = date.slice(0, 7) === month;
      const entry = entriesByDate.get(date);
      const isSunday = new Date(`${date}T12:00:00Z`).getUTCDay() === 0;
      return {
        date,
        inMonth,
        entry,
        missing: inMonth && date <= missingCutoff && !isSunday && !entry,
      };
    });
  }, [currentWeekStart, data?.entries, missingCutoff, month]);
  const weekUnits = currentWeekDays.reduce((sum, day) => sum + (day.entry?.units ?? 0), 0);
  const weekAmountKopecks = weekUnits * documentSettings.rateKopecks;
  const maxWeekUnits = Math.max(1, ...currentWeekDays.map((day) => day.entry?.units ?? 0));
  const missingWeekDays = currentWeekDays.filter((day) => day.missing);
  const weekEntries = currentWeekDays
    .flatMap((day) => day.entry ? [day.entry] : [])
    .sort((a, b) => b.entryDate.localeCompare(a.entryDate));
  const missingMonthDays = useMemo(() => {
    const entries = new Set((data?.entries ?? []).map((entry) => entry.entryDate));
    const missing: string[] = [];
    for (let date = monthBounds.start; date <= missingCutoff; date = addIsoDays(date, 1)) {
      const isSunday = new Date(`${date}T12:00:00Z`).getUTCDay() === 0;
      if (!isSunday && !entries.has(date)) missing.push(date);
    }
    return missing;
  }, [data?.entries, missingCutoff, monthBounds.start]);
  const canGoToPreviousWeek = addIsoDays(entryDate, -7) >= monthBounds.start;
  const canGoToNextWeek = addIsoDays(entryDate, 7) <= monthBounds.end;
  const unitsUntilControl = Math.max(0, calculation.includedUnits - calculation.actualUnits);
  const auditEvents = data?.auditLog ?? [];
  const lastBackupLabel = lastBackupAt
    ? `Последняя копия: ${new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" }).format(new Date(lastBackupAt))}`
    : "Резервная копия ещё не создавалась";
  const backupDue = !lastBackupAt || Date.now() - new Date(lastBackupAt).getTime() > 7 * 86_400_000;

  function selectEntryDate(nextDate: string) {
    const existing = data?.entries.find((entry) => entry.entryDate === nextDate);
    setEntryDate(nextDate);
    setEntryUnits(existing ? String(existing.units) : "");
    setEntryNote(existing?.note ?? "");
  }

  function openEntryForDate(nextDate: string) {
    selectEntryDate(nextDate);
    setQuickEntryOpen(true);
  }

  function moveEntryWeek(offset: -1 | 1) {
    const nextDate = addIsoDays(entryDate, offset * 7);
    if (nextDate < monthBounds.start || nextDate > monthBounds.end) return;
    selectEntryDate(nextDate);
  }

  function changeTheme(nextMode: ThemeMode) {
    setThemeMode(nextMode);
    window.localStorage.setItem(THEME_STORAGE_KEY, nextMode);
  }

  async function saveEntryValue(units: number) {
    const ok = await request(
      { action: "save_entry", entryDate, units, note: entryNote },
      selectedEntry ? `Обновлено: ${number(units)} бутылок` : `Записано: ${number(units)} бутылок`,
    );
    if (ok) {
      navigator.vibrate?.(12);
      const followingDate = nextIsoDate(entryDate);
      setEntryUnits("");
      setEntryNote("");
      if (followingDate.slice(0, 7) === month) selectEntryDate(followingDate);
      window.requestAnimationFrame(() => quickEntryUnitsRef.current?.focus());
    }
  }

  async function saveEntry(event: FormEvent) {
    event.preventDefault();
    const units = Number(entryUnits);
    if (!Number.isInteger(units) || units < 0) {
      toast.error("Введите количество целым числом");
      return;
    }
    if (units > 500) {
      setConfirm({
        title: `Записать ${number(units)} бутылок?`,
        description: "Количество заметно выше обычного. Проверьте цифру перед сохранением.",
        actionLabel: "Всё верно",
        run: () => saveEntryValue(units),
      });
      return;
    }
    await saveEntryValue(units);
  }

  async function readImportFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Файл слишком большой. Максимум — 5 МБ");
      return;
    }

    try {
      const XLSX = await import("xlsx");
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
      const firstSheet = workbook.SheetNames[0];
      if (!firstSheet) throw new Error("В файле нет листов");

      const grid = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[firstSheet], {
        header: 1,
        raw: true,
        defval: "",
      });
      const dateHeaders = new Set(["дата", "датазаписи", "date"]);
      const unitsHeaders = new Set([
        "бутылки",
        "бутылок",
        "количество",
        "количествобутылок",
        "интенсивность",
        "интенсивностьед",
        "шт",
        "ед",
        "units",
      ]);
      const noteHeaders = new Set(["примечание", "заметка", "комментарий", "note"]);

      let headerIndex = -1;
      let dateColumn = -1;
      let unitsColumn = -1;
      let noteColumn = -1;
      for (let rowIndex = 0; rowIndex < Math.min(grid.length, 10); rowIndex += 1) {
        const headers = grid[rowIndex].map(normalizedHeader);
        const possibleDate = headers.findIndex((header) => dateHeaders.has(header));
        const possibleUnits = headers.findIndex((header) => unitsHeaders.has(header));
        if (possibleDate >= 0 && possibleUnits >= 0) {
          headerIndex = rowIndex;
          dateColumn = possibleDate;
          unitsColumn = possibleUnits;
          noteColumn = headers.findIndex((header) => noteHeaders.has(header));
          break;
        }
      }

      if (headerIndex < 0) {
        throw new Error("Нужны колонки «Дата» и «Бутылки»");
      }

      const uniqueRows = new Map<string, ImportRow>();
      let invalidRows = 0;
      let repeatedDates = 0;
      for (const row of grid.slice(headerIndex + 1)) {
        if (row.every((cell) => String(cell ?? "").trim() === "")) continue;
        const entryDate = importDate(row[dateColumn]);
        const units = importUnits(row[unitsColumn]);
        if (!entryDate || units === null) {
          invalidRows += 1;
          continue;
        }
        if (uniqueRows.has(entryDate)) repeatedDates += 1;
        uniqueRows.set(entryDate, {
          entryDate,
          units,
          note: noteColumn >= 0 ? String(row[noteColumn] ?? "").trim().slice(0, 300) : "",
        });
      }

      const rows = [...uniqueRows.values()].sort((a, b) => a.entryDate.localeCompare(b.entryDate));
      if (rows.length === 0) throw new Error("В файле не найдено ни одной записи");
      if (rows.length > 500) throw new Error("За один раз можно загрузить не больше 500 записей");

      const warnings: string[] = [];
      if (invalidRows > 0) warnings.push(`Пропущено строк с ошибками: ${invalidRows}`);
      if (repeatedDates > 0) warnings.push(`Повторяющихся дат в файле: ${repeatedDates}. Оставлено последнее значение.`);
      setImportFileName(file.name);
      setImportRows(rows);
      setImportWarnings(warnings);
      setImportOpen(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось прочитать файл");
    }
  }

  async function importEntries() {
    if (importRows.length === 0) return;
    const ok = await request(
      { action: "import_entries", entries: importRows },
      `Загружено записей: ${number(importRows.length)}`,
    );
    if (ok) {
      setImportOpen(false);
      setImportFileName("");
      setImportRows([]);
      setImportWarnings([]);
    }
  }

  async function copyText(text: string, key: string) {
    try {
      if (window.AndroidApp) {
        window.AndroidApp.copyText(text);
      } else if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        const copied = document.execCommand("copy");
        textarea.remove();
        if (!copied) throw new Error("copy failed");
      }
      setCopiedKey(key);
      toast.success("Текст скопирован");
    } catch {
      toast.error("Не получилось скопировать текст");
    }
  }

  function openInvoice(requestedKind?: Invoice["kind"]) {
    setEditingInvoiceId(null);
    const selectedDate = today;
    const kind = requestedKind ?? (
      fixedRemainingKopecks > 0
        ? "fixed"
        : data?.closure && variableRemainingKopecks > 0 && remainingToInvoice > 0
          ? "variable"
          : "fixed"
    );
    const suggestedAmount = kind === "fixed"
      ? fixedRemainingKopecks
      : kind === "variable"
        ? variableRemainingKopecks
        : remainingToInvoice;
    setInvoiceKind(kind);
    setInvoiceAmount(suggestedAmount > 0 ? String(suggestedAmount / 100) : "");
    setInvoiceNumber("");
    setInvoiceActNumber(actNumber);
    setInvoiceDate(selectedDate);
    setInvoiceDueDate("");
    const proposed = suggestInvoicePeriods({ period: month, kind, invoiceDate: selectedDate,
      entries: data?.entries ?? [], invoices: data?.invoices ?? [], expenses: data?.expenses ?? [], settings: documentSettings });
    setInvoicePeriodAutomatic(true);
    setInvoiceStartDate(proposed.needsReview ? "" : proposed.periods[0]?.startDate ?? "");
    setInvoiceEndDate(proposed.needsReview ? "" : proposed.periods[0]?.endDate ?? "");
    setInvoiceNote("");
    setInvoiceOpen(true);
  }

  async function createInvoice(event: FormEvent) {
    event.preventDefault();
    const amountKopecks = toKopecks(invoiceAmount);
    if (!invoiceNumber.trim() || !amountKopecks) {
      toast.error("Укажите номер и сумму счёта");
      return;
    }
    if ((!invoiceStartDate || !invoiceEndDate) && editingInvoiceId === null) {
      toast.error("Укажите первый и последний день бутылей по счёту");
      return;
    }
    if (editingInvoiceId === null && invoiceKind === "variable" && !data?.closure) {
      toast.error("Переменная часть выставляется после закрытия месяца");
      return;
    }
    if (editingInvoiceId === null && invoiceKind === "variable" && fixedRemainingKopecks > 0) {
      toast.error("Сначала выставьте постоянную часть");
      return;
    }
    const ok = await request(
      {
        action: editingInvoiceId === null ? "create_invoice" : "update_invoice",
        id: editingInvoiceId,
        period: month,
        invoiceNumber,
        invoiceDate,
        kind: invoiceKind,
        actNumber: invoiceActNumber,
        amountKopecks,
        bottleStartDate: invoiceStartDate,
        bottleEndDate: invoiceEndDate,
        dueDate: invoiceDueDate,
        note: invoiceNote,
      },
      editingInvoiceId === null ? "Счёт добавлен в историю" : "Счёт изменён",
    );
    if (ok) setInvoiceOpen(false);
  }

  function openPayment(invoice: Invoice) {
    setEditingPaymentId(null);
    const alreadyPaid = paidByInvoice.get(invoice.id) ?? 0;
    setPaymentInvoiceId(invoice.id);
    setPaymentSplits(null);
    setPaymentDate(today);
    setPaymentAmount(String(Math.max(0, invoice.amountKopecks - alreadyPaid) / 100));
    setPaymentMethod("bank");
    setPaymentDocument("");
    setPaymentNote("");
    setPaymentOpen(true);
  }

  async function createPayment(event: FormEvent) {
    event.preventDefault();
    const amountKopecks = toKopecks(paymentAmount);
    if (!paymentInvoiceId || !amountKopecks) {
      toast.error("Укажите сумму оплаты");
      return;
    }
    const allocations = paymentSplits ? Object.entries(paymentSplits)
      .map(([invoiceId, rubles]) => ({ invoiceId: Number(invoiceId), amountKopecks: toKopecks(rubles) ?? 0 }))
      .filter((row) => row.amountKopecks > 0) : [];
    if (paymentSplits && (allocations.length < 2 ||
      allocations.reduce((sum, row) => sum + row.amountKopecks, 0) !== amountKopecks)) {
      toast.error("Распределите всю сумму минимум по двум счетам");
      return;
    }
    const ok = await request(
      {
        action: paymentSplits && editingPaymentId === null ? "create_payment_split"
          : editingPaymentId === null ? "create_payment" : "update_payment",
        id: editingPaymentId,
        invoiceId: paymentInvoiceId,
        allocations,
        paymentDate,
        amountKopecks,
        method: paymentMethod,
        documentNumber: paymentDocument,
        note: paymentNote,
      },
      "Оплата сохранена",
    );
    if (ok) setPaymentOpen(false);
  }

  function openExpense() {
    const initialCategory = expenseFilter !== "all" && expenseCategories.some((category) => category.id === expenseFilter)
      ? expenseFilter
      : expenseCategories.find((category) => category.id === "base_lease")?.id ?? expenseCategories[0]?.id ?? "other";
    setEditingExpenseId(null);
    setExpenseDate(month === today.slice(0, 7) ? today : `${month}-01`);
    setExpensePayer("self");
    setExpenseCategory(initialCategory);
    setExpenseAmount(initialCategory === "base_lease" ? "20000" : "");
    setExpenseMethod("bank");
    setExpenseDocument("");
    setExpenseNote("");
    setExpenseOpen(true);
  }

  function openExpenseTemplate(shortcut: ExpenseShortcut) {
    const { category, payer } = shortcut;
    if (!expenseCategories.some((item) => item.id === category)) {
      openExpense();
      return;
    }
    setEditingExpenseId(null);
    setExpenseDate(month === today.slice(0, 7) ? today : `${month}-01`);
    setExpensePayer(payer);
    setExpenseCategory(category);
    setExpenseAmount(shortcut.amountKopecks > 0 ? String(shortcut.amountKopecks / 100) : "");
    setExpenseMethod("bank");
    setExpenseDocument("");
    setExpenseNote("");
    setExpenseOpen(true);
  }

  function openExpenseCategories() {
    setExpenseCategoriesDraft(expenseCategories.map((category) => ({ ...category })));
    setExpenseCategoriesOpen(true);
  }

  function addExpenseCategory() {
    const customCount = expenseCategoriesDraft.filter((category) => !category.builtIn).length;
    if (customCount >= 12) {
      toast.error("Можно добавить не больше 12 своих категорий");
      return;
    }
    setExpenseCategoriesDraft((categories) => [
      ...categories,
      {
        id: `custom_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        name: "Новая категория",
        builtIn: false,
      },
    ]);
  }

  function removeExpenseCategory(category: ExpenseCategory) {
    if (expenseCategoriesDraft.length <= 1) {
      toast.error("Оставьте хотя бы одну категорию");
      return;
    }
    const usedCount = data?.expenses.filter((expense) => expense.category === category.id).length ?? 0;
    setExpenseCategoriesDraft((categories) => categories.filter((item) => item.id !== category.id));
    if (usedCount > 0) {
      toast.info(`${number(usedCount)} расходов будут перенесены в оставшуюся категорию`);
    }
  }

  async function saveExpenseCategories(event: FormEvent) {
    event.preventDefault();
    if (expenseCategoriesDraft.some((category) => !category.name.trim())) {
      toast.error("У каждой категории должно быть название");
      return;
    }
    const categories = normalizeExpenseCategories(expenseCategoriesDraft, true);
    if (categories.length === 0) {
      toast.error("Оставьте хотя бы одну категорию");
      return;
    }
    const ok = await request(
      { action: "save_expense_categories", categories },
      "Категории расходов сохранены",
    );
    if (ok) {
      if (expenseFilter !== "all" && !categories.some((category) => category.id === expenseFilter)) {
        setExpenseFilter("all");
      }
      setExpenseCategoriesOpen(false);
    }
  }

  async function createExpense(event: FormEvent) {
    event.preventDefault();
    const amountKopecks = toKopecks(expenseAmount);
    if (!amountKopecks) {
      toast.error("Укажите сумму расхода");
      return;
    }
    const ok = await request(
      {
        action: editingExpenseId === null ? "create_expense" : "update_expense",
        id: editingExpenseId,
        expenseDate,
        category: expenseCategory,
        payer: expenseCategory === "fuel" ? expensePayer : "self",
        amountKopecks,
        method: expenseMethod,
        documentNumber: expenseDocument,
        note: expenseNote,
      },
      "Расход сохранён",
    );
    if (ok) setExpenseOpen(false);
  }

  function editInvoice(invoice: Invoice) {
    setEditingInvoiceId(invoice.id);
    setInvoicePeriodAutomatic(false);
    setInvoiceKind(invoice.kind); setInvoiceNumber(invoice.invoiceNumber);
    setInvoiceActNumber(invoice.actNumber ?? data?.documentMeta?.actNumber ?? "");
    setInvoiceDate(invoice.invoiceDate); setInvoiceDueDate(invoice.dueDate ?? "");
    setInvoiceStartDate(invoice.bottleStartDate ?? "");
    setInvoiceEndDate(invoice.bottleEndDate ?? "");
    setInvoiceAmount(String(invoice.amountKopecks / 100)); setInvoiceNote(invoice.note);
    setInvoiceOpen(true);
  }

  function editPayment(payment: Payment) {
    setEditingPaymentId(payment.id); setPaymentInvoiceId(payment.invoiceId);
    setPaymentSplits(null);
    setPaymentDate(payment.paymentDate); setPaymentAmount(String(payment.amountKopecks / 100));
    setPaymentMethod(payment.method); setPaymentDocument(payment.documentNumber);
    setPaymentNote(payment.note); setPaymentOpen(true);
  }

  function editExpense(expense: Expense) {
    setEditingExpenseId(expense.id); setExpenseDate(expense.expenseDate);
    setExpenseCategory(expense.category); setExpenseAmount(String(expense.amountKopecks / 100));
    setExpenseMethod(expense.method); setExpensePayer(expense.payer ?? "self");
    setExpenseDocument(expense.documentNumber); setExpenseNote(expense.note);
    setExpenseOpen(true);
  }

  function openSettings() {
    setSettingsDraft({ ...documentSettings });
    setExpenseShortcutsDraft(expenseShortcuts.map((shortcut) => ({ ...shortcut })));
    setSettingsOpen(true);
  }

  async function saveSettings(event: FormEvent) {
    event.preventDefault();
    const ok = await request(
      { action: "save_settings", settings: settingsDraft, shortcuts: expenseShortcutsDraft },
      "Настройки расчёта сохранены",
    );
    if (ok) setSettingsOpen(false);
  }

  function addExpenseShortcut() {
    if (expenseShortcutsDraft.length >= 8 || !expenseCategories.length) return;
    setExpenseShortcutsDraft((items) => [...items, {
      id: `shortcut-${Date.now().toString(36)}`, title: "Новая кнопка", category: expenseCategories[0].id,
      payer: "self", amountKopecks: 0,
    }]);
  }

  function updateExpenseShortcut(id: string, patch: Partial<ExpenseShortcut>) {
    setExpenseShortcutsDraft((items) => items.map((item) => item.id === id ? { ...item, ...patch } : item));
  }

  async function saveExpenseShortcuts() {
    await request({ action: "save_expense_shortcuts", shortcuts: expenseShortcutsDraft }, "Быстрые кнопки сохранены");
  }

  function openDowntime(downtime?: Downtime) {
    const bounds = periodBounds(month);
    const selectedDate = month === today.slice(0, 7) ? today : bounds.start;
    setEditingDowntimeId(downtime?.id ?? null);
    setDowntimeStart(downtime?.startDate ?? selectedDate);
    setDowntimeEnd(downtime?.endDate ?? selectedDate);
    setDowntimeReason(downtime?.reason === "Простой автомобиля" ? "" : downtime?.reason ?? "");
    setDowntimeBasis(downtime?.basis ?? "");
    setDowntimeNote(downtime?.note ?? "");
    setDowntimeOpen(true);
  }

  async function saveDowntime(event: FormEvent) {
    event.preventDefault();
    const ok = await request(
      {
        action: editingDowntimeId === null ? "create_downtime" : "update_downtime",
        id: editingDowntimeId,
        startDate: downtimeStart,
        endDate: downtimeEnd,
        reason: downtimeReason,
        basis: downtimeBasis,
        note: downtimeNote,
      },
      editingDowntimeId === null ? "Простой добавлен" : "Простой изменён",
    );
    if (ok) setDowntimeOpen(false);
  }

  function askDeleteDowntime(downtime: Downtime) {
    setConfirm({
      title: "Удалить период простоя?",
      description: downtimeLabel(downtime),
      actionLabel: "Удалить",
      destructive: true,
      run: async () => {
        const ok = await request({ action: "delete_downtime", id: downtime.id }, "");
        if (ok) {
          showDeletedWithUndo("Простой удалён", () => request({
            action: "create_downtime",
            startDate: downtime.startDate,
            endDate: downtime.endDate,
            reason: downtime.reason,
            basis: downtime.basis,
            note: downtime.note,
          }, "Простой восстановлен"));
        }
      },
    });
  }

  function currentDocumentMeta() {
    const openingBalanceKopecks = documentOpeningBalance.trim() ? toSignedKopecks(documentOpeningBalance) : null;
    if (!actNumber.trim() || !validIsoDate(documentDate) || !validIsoDate(asOfDate) ||
        openingBalanceKopecks === null || !Number.isSafeInteger(openingBalanceKopecks)) {
      toast.error("Заполните номер, дату и начальный долг документов");
      return null;
    }
    return {
      period: month,
      actNumber: actNumber.trim(),
      reconciliationNumber: actNumber.trim(),
      documentDate,
      basis: data?.documentMeta?.basis ?? "",
      openingBalanceKopecks,
      asOfDate,
      adjustments: documentAdjustments.trim(),
    } satisfies DocumentMeta;
  }

  function documentInputSnapshot(kind: ArchivedDocument["kind"], meta: DocumentMeta) {
    return JSON.stringify({ kind, meta, settings: documentSettings, calculation, fuelCalculation: "whole-bottles-variable-first-v2",
      entries: data?.entries ?? [], downtimes: data?.downtimes ?? [],
      ...(kind === "act" ? { expenses: (data?.expenses ?? []).filter((expense) => expense.category === "fuel" && expense.payer === "customer") } : {}),
      ...(kind === "reconciliation" || kind === "ledger"
        ? { invoices: data?.invoices ?? [], payments: data?.payments ?? [], openingPayments: data?.openingPayments ?? [], expenses: data?.expenses ?? [] } : {}),
    });
  }

  function archiveIsStale(item: ArchivedDocument) {
    try {
      const stored = JSON.parse(item.inputSnapshot) as { meta: DocumentMeta };
      const currentMeta = { ...stored.meta,
        openingBalanceKopecks: data?.documentMeta?.openingBalanceKopecks ?? stored.meta.openingBalanceKopecks };
      return item.inputSnapshot !== documentInputSnapshot(item.kind, currentMeta);
    } catch { return true; }
  }

  function editArchivedDocument(item: ArchivedDocument) {
    try {
      const snapshot = JSON.parse(item.inputSnapshot) as { meta?: DocumentMeta };
      const meta = snapshot.meta ?? data?.documentMeta;
      if (!meta || !validIsoDate(meta.documentDate) || !validIsoDate(meta.asOfDate ?? meta.documentDate) ||
          !Number.isSafeInteger(meta.openingBalanceKopecks)) throw new Error("Некорректные реквизиты документа");
      setActNumber(item.number || (item.kind === "reconciliation" ? meta.reconciliationNumber : meta.actNumber) || meta.actNumber);
      setDocumentDate(meta.documentDate);
      setAsOfDate(meta.asOfDate ?? meta.documentDate);
      setDocumentOpeningBalance(String(meta.openingBalanceKopecks / 100));
      setDocumentAdjustments(meta.adjustments ?? "");
      setEditingArchivedId(item.id);
      setDocumentPreview(null);
      window.setTimeout(() => documentWorkspaceRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
      toast.info("Реквизиты загружены. Исправьте их и создайте новую версию по текущим данным.");
    } catch {
      toast.error("Не удалось прочитать старый документ. Заполните форму документов и создайте его заново.");
    }
  }

  function askDeleteDocument(item: ArchivedDocument) {
    setConfirm({ title: `Удалить документ №${item.number}, версия ${item.version}?`,
      description: "Версия будет удалена из архива приложения. Сохранённый PDF остаётся отдельным файлом в «Загрузках».",
      actionLabel: "Удалить из архива", destructive: true,
      run: async () => {
        const ok = await request({ action: "delete_document", id: item.id }, "");
        if (ok) {
          if (editingArchivedId === item.id) setEditingArchivedId(null);
          showDeletedWithUndo("Документ удалён из архива", () => request({ action: "archive_document", document: item }, "Документ восстановлен"));
        }
      },
    });
  }

  function prepareDocument(kind: "act" | "reconciliation") {
    if (!data) return;
    if (DOCUMENT_TEXT_FIELDS.some((field) => field !== "lessorDative" && !documentSettings[field].trim())) {
      toast.error("Заполните реквизиты договора в настройках перед формированием документа");
      return;
    }
    const meta = currentDocumentMeta();
    if (!meta) return;
    if (isOfflineRuntime()) {
      const number = kind === "act" ? meta.actNumber : meta.reconciliationNumber;
      const previous = readOfflineStore().documentArchive.filter((item) => item.kind === kind && item.number === number);
      if (previous.some((item) => item.period !== month)) toast.warning(`Документ №${number} уже есть за другой период`);
      if (previous.some((item) => item.period === month)) toast.info("За этот период уже есть документ. Новая копия получит следующий номер версии.");
    }
    try {
      const input = {
        settings: documentSettings,
        meta,
        calculation,
        downtimes: data.downtimes ?? [],
        invoices: data.invoices,
        payments: data.payments,
        openingPayments: data.openingPayments,
        expenses: data.expenses,
        entries: data.entries,
      };
      const html = kind === "act" ? buildRentActHtml(input) : buildReconciliationHtml(input);
      if (kind === "reconciliation" && reconciliationSummary(input).balance < 0) {
        toast.error("Образец акта сверки описывает задолженность. При переплате проверьте расчёты до подписания.");
        return;
      }
      setDocumentPreview({ kind, html, meta, number: kind === "act" ? meta.actNumber : meta.reconciliationNumber,
        inputSnapshot: documentInputSnapshot(kind, meta) });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось сформировать PDF");
    }
  }

  async function savePreviewedDocument() {
    if (!documentPreview) return;
    const { kind, html, meta, number, inputSnapshot } = documentPreview;
    const previous = data?.documentArchive ?? [];
    const version = Math.max(0, ...previous.filter((item) => item.kind === kind && item.number === number)
      .map((item) => item.version)) + 1;
    const id = Date.now();
    const archived: ArchivedDocument = { id, kind, period: month, number, version,
      generatedAt: new Date().toISOString(), inputSnapshot, html };
    if (isOfflineRuntime()) {
      const ok = await request({ action: "save_document_meta", ...meta }, "");
      if (!ok) return;
      const saved = await request({ action: "archive_document", document: archived }, "Документ добавлен в архив");
      if (!saved) return;
    }
    const fileName = `${kind}_${month}_v${version}_${id}.pdf`;
    if (window.AndroidApp?.saveArchivedHtmlAsPdf) {
      window.AndroidApp.saveArchivedHtmlAsPdf(html, fileName, String(id));
    } else if (window.AndroidApp?.saveHtmlAsPdf) {
      window.AndroidApp.saveHtmlAsPdf(html, fileName);
    } else printHtmlInBrowser(html);
    setDocumentPreview(null);
  }

  function askDeleteEntry(entry: Entry) {
    setConfirm({
      title: "Удалить запись?",
      description: `${dateLabel(entry.entryDate)} · ${number(entry.units)} ед.`,
      actionLabel: "Удалить",
      destructive: true,
      run: async () => {
        const ok = await request(
          { action: "delete_entry", id: entry.id, entryDate: entry.entryDate },
          "",
        );
        if (ok) {
          showDeletedWithUndo("Запись удалена", () => request({
            action: "save_entry",
            entryDate: entry.entryDate,
            units: entry.units,
            note: entry.note,
          }, "Запись восстановлена"));
        }
      },
    });
  }

  function askDeleteInvoice(invoice: Invoice) {
    const linkedPayments = data?.payments.filter((payment) => payment.invoiceId === invoice.id) ?? [];
    setConfirm({
      title: `Удалить счёт №${invoice.invoiceNumber}?`,
      description: "Все связанные с ним оплаты тоже будут удалены.",
      actionLabel: "Удалить счёт",
      destructive: true,
      run: async () => {
        const ok = await request({ action: "delete_invoice", id: invoice.id }, "");
        if (ok) {
          showDeletedWithUndo("Счёт удалён", () => request({
            action: "restore_invoice",
            invoice,
            payments: linkedPayments,
          }, "Счёт и оплаты восстановлены"));
        }
      },
    });
  }

  function askDeletePayment(payment: Payment) {
    setConfirm({
      title: "Удалить оплату?",
      description: `${dateLabel(payment.paymentDate)} · ${money(payment.amountKopecks)}`,
      actionLabel: "Удалить",
      destructive: true,
      run: async () => {
        const ok = await request({ action: "delete_payment", id: payment.id }, "");
        if (ok) {
          showDeletedWithUndo("Оплата удалена", () => request({
            action: "create_payment",
            invoiceId: payment.invoiceId,
            paymentDate: payment.paymentDate,
            amountKopecks: payment.amountKopecks,
            method: payment.method,
            documentNumber: payment.documentNumber,
            note: payment.note,
          }, "Оплата восстановлена"));
        }
      },
    });
  }

  function askDeleteExpense(expense: Expense) {
    setConfirm({
      title: "Удалить расход?",
      description: `${expenseCategoryName(expense.category)} · ${money(expense.amountKopecks)}`,
      actionLabel: "Удалить",
      destructive: true,
      run: async () => {
        const ok = await request({ action: "delete_expense", id: expense.id }, "");
        if (ok) {
          showDeletedWithUndo("Расход удалён", () => request({
            action: "create_expense",
            expenseDate: expense.expenseDate,
            category: expense.category,
            payer: expense.payer ?? "self",
            amountKopecks: expense.amountKopecks,
            method: expense.method,
            documentNumber: expense.documentNumber,
            note: expense.note,
          }, "Расход восстановлен"));
        }
      },
    });
  }

  function askCloseMonth() {
    setCloseMonthOpen(true);
  }

  async function closeMonth() {
    const ok = await request({ action: "close_month", period: month }, "Месяц закрыт");
    if (ok) {
      navigator.vibrate?.([18, 45, 18]);
      setCloseMonthOpen(false);
    }
  }

  function askReopenMonth() {
    setConfirm({
      title: "Открыть месяц для изменений?",
      description: "После этого можно будет исправлять ежедневные показатели и снова закрыть месяц.",
      actionLabel: "Открыть месяц",
      run: async () => {
        await request({ action: "reopen_month", period: month }, "Месяц снова открыт");
      },
    });
  }

  async function exportExcel() {
    if (!data) return;
    try {
      const XLSX = await import("xlsx");
      const workbook = XLSX.utils.book_new();

      const entriesRows: (string | number)[][] = [
        ["Дата", "Интенсивность, ед.", "Примечание"],
        ...[...data.entries]
          .sort((a, b) => a.entryDate.localeCompare(b.entryDate))
          .map((entry) => [dateLabel(entry.entryDate), entry.units, entry.note]),
        ["ИТОГО", calculation.actualUnits, ""],
      ];
      const entriesSheet = XLSX.utils.aoa_to_sheet(entriesRows);
      entriesSheet["!cols"] = [{ wch: 15 }, { wch: 22 }, { wch: 42 }];
      XLSX.utils.book_append_sheet(workbook, entriesSheet, "Реестр интенсивности");

      const calculationRows: (string | number)[][] = [
        ["Показатель", "Значение"],
        ["Расчётный период", monthLabel(month)],
        ["Фактическая интенсивность, ед.", calculation.actualUnits],
        ["Контрольный объём, ед.", calculation.includedUnits],
        ["Календарных дней", calculation.calendarDays],
        ["Дней простоя", calculation.downtimeDays],
        ["Оплачиваемых дней", calculation.payableDays],
        ["Постоянная часть за полный месяц, ₽", calculation.baseFullKopecks / 100],
        ["Уменьшение за простой, ₽", calculation.baseReductionKopecks / 100],
        ["Постоянная часть к начислению, ₽", calculation.baseKopecks / 100],
        ["Ставка интенсивности, ₽/ед.", calculation.rateKopecks / 100],
        ["Показатель интенсивности И = 40 × N, ₽", calculation.intensityKopecks / 100],
        ["Переменная часть И − Ф, ₽", calculation.variableKopecks / 100],
        ["ИТОГО — большая из Ф и И, ₽", calculation.totalKopecks / 100],
        ["Топливо оплачено заказчиком, ₽", customerFuel / 100],
        ["Вычтено на топливо, бутылей", settlement.fuelUnits],
        ["Корректировка округления топлива, ₽", settlement.roundingKopecks / 100],
        ["Вычет топлива с округлением, ₽", fuelDeduction / 100],
        ["Вычет топлива из переменной части, ₽", settlement.variableFuelKopecks / 100],
        ["Остаток вычета из постоянной части, ₽", settlement.fixedFuelKopecks / 100],
        ["Учтено в акте-расчёте, ед.", actCalculation.actualUnits],
        ["Постоянная часть в акте-расчёте, ₽", actCalculation.baseKopecks / 100],
        ["Переменная часть в акте-расчёте, ₽", actCalculation.variableKopecks / 100],
        ["К оплате после вычета топлива, ₽", netRent / 100],
        ["Уже выставлено, ₽", totalInvoiced / 100],
        ["Осталось выставить, ₽", remainingToInvoice / 100],
        ["Собственные расходы, ₽", selfExpenses / 100],
        ["Статус месяца", data.closure ? "Закрыт" : "Открыт"],
      ];
      const calculationSheet = XLSX.utils.aoa_to_sheet(calculationRows);
      calculationSheet["!cols"] = [{ wch: 38 }, { wch: 24 }];
      XLSX.utils.book_append_sheet(workbook, calculationSheet, "Расчёт аренды");

      const invoiceRows: (string | number)[][] = [
        [
          "Счёт №",
          "Дата счёта",
          "Вид начисления",
          "Первый день бутылей",
          "Последний день бутылей",
          "Сумма счёта после вычета топлива, ₽",
          "Оплачено, ₽",
          "Остаток, ₽",
          "Срок оплаты",
          "Статус",
          "Способ оплаты",
          "Платёжный документ",
          "Примечание",
          "Строка счёта",
          "Назначение платежа",
          "Тема письма",
          "Текст письма",
        ],
        ...data.invoices.map((invoice) => {
          const invoicePayments = data.payments.filter((payment) => payment.invoiceId === invoice.id);
          const paid = invoicePayments.reduce((sum, payment) => sum + payment.amountKopecks, 0);
          const status = statusFor(invoice, paid).label;
          return [
            invoice.invoiceNumber,
            dateLabel(invoice.invoiceDate),
            invoiceLabels[invoice.kind],
            dateLabel(invoice.bottleStartDate ?? null),
            dateLabel(invoice.bottleEndDate ?? null),
            invoice.amountKopecks / 100,
            paid / 100,
            Math.max(0, invoice.amountKopecks - paid) / 100,
            dateLabel(invoice.dueDate),
            status,
            [...new Set(invoicePayments.map((payment) => payment.method === "bank" ? "Безналичные" : "Наличные"))].join(", "),
            invoicePayments.map((payment) => payment.documentNumber).filter(Boolean).join(", "),
            invoice.note,
            invoiceLine(invoice, documentSettings),
            paymentPurpose(invoice, documentSettings),
            emailSubject(invoice, documentSettings),
            emailText(invoice, documentSettings),
          ];
        }),
        ["ИТОГО", "", "", "", "", totalInvoiced / 100, totalPaid / 100,
          Math.max(0, totalInvoiced - totalPaid) / 100,
          "", "", "", "", "", "", "", "", ""],
      ];
      const invoicesSheet = XLSX.utils.aoa_to_sheet(invoiceRows);
      invoicesSheet["!cols"] = [
        { wch: 14 }, { wch: 14 }, { wch: 24 }, { wch: 19 }, { wch: 19 },
        { wch: 26 }, { wch: 15 }, { wch: 15 },
        { wch: 15 }, { wch: 15 }, { wch: 20 }, { wch: 24 }, { wch: 38 },
        { wch: 48 }, { wch: 62 }, { wch: 46 }, { wch: 70 },
      ];
      XLSX.utils.book_append_sheet(workbook, invoicesSheet, "Счета и оплаты");

      const expenseRows: (string | number)[][] = [
        ["Дата", "Категория", "Сумма, ₽", "Способ оплаты", "Документ", "Примечание", "Кто оплатил", "Вычет из аренды, ₽"],
        ...data.expenses.map((expense) => [
          dateLabel(expense.expenseDate),
          expenseCategoryName(expense.category),
          expense.amountKopecks / 100,
          expense.method === "bank" ? "Безналичные" : "Наличные",
          expense.documentNumber,
          expense.note,
          expense.payer === "customer" ? "Заказчик" : "Я",
          expense.category === "fuel" && expense.payer === "customer" ? expense.amountKopecks / 100 : 0,
        ]),
        ["ИТОГО", "", totalExpenses / 100, "", "", ""],
      ];
      const expensesSheet = XLSX.utils.aoa_to_sheet(expenseRows);
      expensesSheet["!cols"] = [{ wch: 15 }, { wch: 24 }, { wch: 15 }, { wch: 20 }, { wch: 22 }, { wch: 38 }, { wch: 20 }, { wch: 24 }];
      XLSX.utils.book_append_sheet(workbook, expensesSheet, "Расходы");

      const downtimeRows: (string | number)[][] = [
        ["Начало", "Окончание"],
        ...(data.downtimes ?? []).map((downtime) => [
          dateLabel(downtime.startDate),
          dateLabel(downtime.endDate),
        ]),
        ["ИТОГО ДНЕЙ ПРОСТОЯ", calculation.downtimeDays],
      ];
      const downtimeSheet = XLSX.utils.aoa_to_sheet(downtimeRows);
      downtimeSheet["!cols"] = [{ wch: 22 }, { wch: 22 }];
      XLSX.utils.book_append_sheet(workbook, downtimeSheet, "Простой");

      const fileName = `arenda_ts_${month}.xlsx`;
      if (window.AndroidApp) {
        const base64 = XLSX.write(workbook, {
          bookType: "xlsx",
          type: "base64",
          compression: true,
        });
        window.AndroidApp.saveBase64File(
          base64,
          fileName,
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        );
      } else {
        XLSX.writeFile(workbook, fileName, { compression: true });
      }
      toast.success("Excel-файл сформирован");
    } catch {
      toast.error("Не удалось сформировать Excel");
    }
  }

  function exportBackup() {
    try {
      const fileName = `arenda_ts_backup_${localIsoDate()}.json`;
      const json = JSON.stringify(readOfflineStore(), null, 2);
      if (window.AndroidApp) {
        window.AndroidApp.saveBase64File(
          utf8Base64(json),
          fileName,
          "application/json",
        );
      } else {
        saveBrowserFile(new Blob([json], { type: "application/json;charset=utf-8" }), fileName);
      }
      const savedAt = new Date().toISOString();
      window.localStorage.setItem(LAST_BACKUP_STORAGE_KEY, savedAt);
      setLastBackupAt(savedAt);
      navigator.vibrate?.(12);
      toast.success("Резервная копия подготовлена");
    } catch {
      toast.error("Не удалось создать резервную копию");
    }
  }

  async function restoreBackup(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error("Файл слишком большой");
      const store = normalizeOfflineStore(JSON.parse(await file.text()));
      store.documentArchive = store.documentArchive.map(({ pdfUri: _oldDeviceUri, ...document }) => document);
      writeOfflineStore(store);
      await loadData();
      setDocumentDraftRevision((revision) => revision + 1);
      setDocumentPreview(null);
      toast.success("Данные восстановлены");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось восстановить данные");
    }
  }

  function settlementDetails() {
    return <div className="settlement-details">
      <div className="calculation-list mt-3">
        <div><span>Аренда по договору</span><strong>{money(calculation.totalKopecks)}</strong></div>
        <div><span>Вычет топлива заказчика</span><strong>−{money(fuelDeduction)}</strong></div>
        <div><span>К оплате после вычета топлива</span><strong>{money(netRent)}</strong></div>
        <div><span>Уже выставлено</span><strong>{money(totalInvoiced)}</strong></div>
        <div className="calculation-total"><span>Осталось выставить</span><strong>{money(remainingToInvoice)}</strong></div>
      </div>
      {customerFuel > 0 && <p className="help-note">Топливо заказчика: {money(customerFuel)}. {settlement.fuelUnits > 0 ? `Для расчёта вычтено ${number(settlement.fuelUnits)} бутылей, с округлением вверх: ${money(fuelDeduction)}.` : `Вычет при нулевой ставке: ${money(fuelDeduction)}.`} Из переменной части: {money(settlement.variableFuelKopecks)}.{settlement.fixedFuelKopecks > 0 && ` Остаток вычета из постоянной части: ${money(settlement.fixedFuelKopecks)}.`} По дням оно видно в акте сверки.</p>}
      {totalInvoiced > netRent && <p className="help-note">Выставлено больше суммы после вычета топлива на {money(totalInvoiced - netRent)}. Проверьте ранее выставленные счета.</p>}
      <Button className="mt-4 w-full" type="button" disabled={remainingToInvoice <= 0} onClick={() => {
        setSettlementOpen(false);
        openInvoice();
      }}>Создать следующий счёт</Button>
      <p className="help-note">Сначала приложение предложит постоянную часть. Переменную часть — только после закрытия месяца.</p>
    </div>;
  }

  async function installApp() {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === "accepted") {
      toast.success("Приложение установлено");
      setInstallPrompt(null);
    }
  }

  const viewMeta: Record<string, { title: string; description: string }> = {
    summary: { title: "Главная", description: "Суммы и состояние месяца" },
    entries: { title: "Ежедневные записи", description: "Количество по дням и импорт" },
    invoices: { title: "Счета и оплаты", description: "Долги, оплаты и тексты для банка" },
    expenses: { title: "Расходы", description: "Топливо, ремонт и остальные затраты" },
  };
  const activeView = viewMeta[tab] ?? viewMeta.summary;

  return (
    <div className="app-root min-h-screen">
      <Toaster position="top-center" richColors theme={theme} />

      <header className="app-header">
        <div className="app-shell flex items-center justify-between gap-3 py-3">
          <div className="app-identity flex min-w-0 items-center gap-3">
            <div className="brand-mark" aria-hidden="true">
              <CarFront className="size-6" />
            </div>
            <div className="min-w-0">
              <span className="app-name">Аренда ТС</span>
              <h1 className="truncate text-lg font-extrabold tracking-tight sm:text-xl">{activeView.title}</h1>
              <p className="app-status-line">
                <span className="status-dot" aria-hidden="true" />
                {offlineMode ? "Сохранено на телефоне" : activeView.description}
              </p>
            </div>
          </div>
          <div className="header-actions">
            {!offlineMode && installPrompt && (
              <Button
                type="button"
                onClick={() => void installApp()}
                className="install-button"
                aria-label="Установить приложение"
              >
                <Smartphone className="size-4" />
                <span className="hidden sm:inline">Установить</span>
              </Button>
            )}
            <Button
              type="button"
              onClick={exportExcel}
              disabled={!data || loading}
              className="export-button"
              aria-label="Скачать отчёт в Excel"
            >
              <FileSpreadsheet className="size-5" />
              <span className="hidden sm:inline">Excel</span>
            </Button>
            {offlineMode && (
              <Button
                type="button"
                variant="ghost"
                className="settings-button"
                onClick={openSettings}
                aria-label="Настройки расчёта"
              >
                <Settings className="size-5" />
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="app-shell app-main">
        <section className="month-bar" aria-label="Выбор расчётного месяца">
          <div className="month-copy">
            <span className="month-icon" aria-hidden="true"><CalendarDays /></span>
            <div>
              <span className="eyebrow">Месяц</span>
              <strong>{monthLabel(month)}</strong>
            </div>
          </div>
          <label className="month-picker">
            <span>{monthLabel(month).replace(" г.", "")}</span><CalendarDays aria-hidden="true" />
            <Input
            type="month"
            value={month}
            onChange={(event) => {
              const nextMonth = event.target.value;
              setMonth(nextMonth);
              selectEntryDate(nextMonth === today.slice(0, 7) ? today : `${nextMonth}-01`);
            }}
            className="month-native"
            aria-label="Месяц"
          />
          </label>
        </section>

        <Tabs
          value={tab}
          onValueChange={(value) => {
            setTab(value);
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
          className="modern-tabs mt-4 gap-4"
        >
          <TabsList className="app-tabs grid h-auto w-full grid-cols-5 bg-transparent p-0" aria-label="Разделы приложения">
            <TabsTrigger value="summary" className="app-tab">
              <Calculator />
              <span>Главная</span>
            </TabsTrigger>
            <TabsTrigger value="entries" className="app-tab">
              <CalendarDays />
              <span>Дни</span>
            </TabsTrigger>
            <button
              type="button"
              className="app-quick-action"
              onClick={() => {
                setQuickEntryOpen(true);
                window.setTimeout(() => quickEntryUnitsRef.current?.focus(), 180);
              }}
              aria-label="Добавить запись бутылок"
            >
              <span><Plus /></span>
              <small>Запись</small>
            </button>
            <TabsTrigger value="invoices" className="app-tab">
              <ReceiptText />
              <span>Счета</span>
            </TabsTrigger>
            <TabsTrigger value="expenses" className="app-tab">
              <WalletCards />
              <span>Расходы</span>
            </TabsTrigger>
          </TabsList>

          {loading ? (
            <div className="panel flex min-h-56 items-center justify-center">
              <LoaderCircle className="size-7 animate-spin text-primary" />
            </div>
          ) : loadError ? (
            <div className="panel py-12 text-center">
              <p className="font-semibold">{loadError}</p>
              <Button type="button" onClick={() => void loadData()} className="mt-4">Повторить</Button>
            </div>
          ) : data ? (
            <>
              <TabsContent value="summary" className="space-y-4">
                <section className="settlement-hero" aria-label="Расчёт с заказчиком за месяц">
                  <div className="settlement-hero-heading">
                    <span>Расчёт с заказчиком · {monthLabel(month)}</span>
                    {data.closure ? <LockKeyhole aria-label="Месяц закрыт" /> : null}
                  </div>
                  <div className="settlement-hero-result">
                    <span>Осталось выставить</span>
                    <strong>{money(remainingToInvoice)}</strong>
                  </div>
                  <div className="settlement-hero-breakdown">
                    <div><span>Начислено</span><strong>{money(calculation.totalKopecks)}</strong></div>
                    <div><span>Вычет топлива заказчика</span><strong>−{money(fuelDeduction)}</strong></div>
                    <div><span>Уже выставлено</span><strong>−{money(totalInvoiced)}</strong></div>
                  </div>
                  <button type="button" className="settlement-hero-link" onClick={() => setSettlementOpen(true)}>
                    Показать расчёт <ChevronRight />
                  </button>
                </section>
                <section className="dashboard-actions" aria-label="Быстрые действия">
                  <button type="button" onClick={() => openInvoice()}>
                    <span><ReceiptText /></span>
                    <strong>Новый счёт</strong>
                  </button>
                  <button type="button" onClick={openExpense}>
                    <span><WalletCards /></span>
                    <strong>Расход</strong>
                  </button>
                  <button type="button" onClick={() => offlineMode ? setDowntimeListOpen(true) : void exportExcel()}>
                    <span>{offlineMode ? <CirclePause /> : <FileSpreadsheet />}</span>
                    <strong>{offlineMode ? "Простой" : "Выгрузить Excel"}</strong>
                  </button>
                </section>

                <section className="panel month-progress-compact">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <span className="eyebrow">Объём месяца</span>
                      <div className="mt-1 flex items-baseline gap-2">
                        <strong className="text-3xl tracking-tight">{number(calculation.actualUnits)}</strong>
                        <span className="text-muted-foreground">из {number(calculation.includedUnits)} ед.</span>
                      </div>
                    </div>
                    <span className="month-progress-state">{data.closure ? "Месяц закрыт" : "Месяц открыт"}</span>
                  </div>
                  <Progress value={progress} className="mt-4 h-3 bg-slate-100 [&_[data-slot=progress-indicator]]:bg-amber-500" />
                  <div className="month-progress-footer">
                    <span>{unitsUntilControl > 0 ? `До ${number(calculation.includedUnits)} осталось ${number(unitsUntilControl)} ед.` : `Контрольный объём выполнен на ${Math.round(progress)}%`}</span>
                  </div>
                  {missingMonthDays.length > 0 && (
                    <button
                      type="button"
                      className="missing-days-callout"
                      onClick={() => {
                        setTab("entries");
                        selectEntryDate(missingMonthDays[0]);
                      }}
                    >
                      <CalendarDays />
                      <span>Без записи: {number(missingMonthDays.length)} рабочих дней</span>
                      <ChevronRight />
                    </button>
                  )}
                </section>

                <details className="panel month-tools">
                  <summary>
                    <span><strong>Отчёты и управление месяцем</strong><small>Денежный результат, Excel, история</small></span>
                    <ChevronDown aria-hidden="true" />
                  </summary>
                  <div className="month-tools-body">
                    <div className="month-tools-cash">
                      <Banknote aria-hidden="true" />
                      <div>
                        <span>Оплаты минус собственные расходы</span>
                        <strong className={cashResult < 0 ? "negative" : ""}>{money(cashResult)}</strong>
                      </div>
                    </div>
                    <div className="month-tools-actions">
                      {data.closure ? (
                        <Button type="button" variant="outline" onClick={askReopenMonth}>
                          <UnlockKeyhole />Открыть месяц
                        </Button>
                      ) : (
                        <Button type="button" variant="outline" onClick={askCloseMonth}>
                          <LockKeyhole />Закрыть месяц
                        </Button>
                      )}
                      <Button type="button" variant="outline" onClick={exportExcel}>
                        <Download />Скачать Excel
                      </Button>
                      {offlineMode && (
                        <Button type="button" variant="outline" onClick={() => setAuditOpen(true)}>
                          <History />История изменений
                        </Button>
                      )}
                    </div>
                  </div>
                </details>
                {offlineMode && <section ref={documentWorkspaceRef} className="panel document-workspace">
                  <div className="flex items-center gap-3"><FileText className="size-6 text-primary" /><div>
                    <h2 className="text-xl font-bold">Документы · {monthLabel(month)}</h2>
                    <p className="text-sm text-muted-foreground">Данные берутся из дней, простоев, счетов и оплат.</p>
                  </div></div>
                  {editingArchivedId !== null && <p className="help-note">Редактирование архивного документа. Новая версия будет рассчитана по текущим дням, счетам и оплатам. Для изменения количества бутылей откройте «Дни», для счетов и оплат — «Счета».</p>}
                  <div className="document-fields">
                    <label className="col-span-2"><FieldLabel>№ обоих актов</FieldLabel><Input value={actNumber} onChange={(e) => setActNumber(e.target.value)} /></label>
                    <label><FieldLabel>Дата составления</FieldLabel><Input type="date" value={documentDate} onChange={(e) => setDocumentDate(e.target.value)} /></label>
                    <label><FieldLabel>Сверка по состоянию на</FieldLabel><Input type="date" min={monthBounds.end} value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} /></label>
                    <label className="col-span-2"><FieldLabel>Долг на начало периода, ₽</FieldLabel><Input type="number" step="0.01" inputMode="decimal" value={documentOpeningBalance} onChange={(e) => setDocumentOpeningBalance(e.target.value)} /></label>
                  </div>
                  <Button type="button" variant="outline" onClick={() => { setDocumentDate(today); setAsOfDate(today); }}>Составить на сегодня</Button>
                  {documentDateIssue && <p className="help-note" role="alert">{documentDateIssue}</p>}
                  {!documentDateIssue && (data.invoices.some((invoice) => invoice.invoiceDate > asOfDate) ||
                    [...data.payments, ...((toSignedKopecks(documentOpeningBalance) ?? 0) > 0 ? data.openingPayments ?? [] : [])].some((payment) => payment.paymentDate > asOfDate)) &&
                    <p className="help-note">В сверку на {dateLabel(asOfDate)} не войдут более поздние счета и оплаты. Для полного расчёта выберите нужную дату или нажмите «Составить на сегодня».</p>}
                  <label className="document-note"><FieldLabel>Замечания и согласованные корректировки</FieldLabel><Input value={documentAdjustments} onChange={(e) => setDocumentAdjustments(e.target.value)} placeholder="Если нет — останется «отсутствуют»" /></label>
                  <p className="help-note">При нулевом начальном долге оплаты за предыдущие месяцы в этот акт не входят. Оплаты выбранного месяца учитываются по связи со счётом и дате поступления.</p>
                  <p className="help-note">В акте-расчёте: календарных дней {actCalculation.calendarDays}; владение {actCalculation.ownershipDays}; простой {actCalculation.downtimeDays}; оплачиваемых дней {actCalculation.payableDays}. N: {number(actCalculation.actualUnits)}. Ф: {money(actCalculation.baseKopecks)}. И: {money(actCalculation.intensityKopecks)}. Переменная часть: {money(actCalculation.variableKopecks)}. Итого: {money(actCalculation.totalKopecks)}.</p>
                  {missingMonthDays.length > 0 && <p className="help-note text-amber-700">Дни без записи: {number(missingMonthDays.length)}. Проверьте календарь до подписания акта.</p>}
                  {data.invoices.some((invoice) => (paidByInvoice.get(invoice.id) ?? 0) < invoice.amountKopecks) &&
                    <p className="help-note text-amber-700">Есть неоплаченные или частично оплаченные счета. Их остатки видны в разделе «Счета».</p>}
                  {data.payments.reduce((sum, payment) => sum + payment.amountKopecks, 0) > netRent &&
                    <p className="help-note text-amber-700">Оплаты превышают сумму после вычета топлива: переплата {money(data.payments.reduce((sum, payment) => sum + payment.amountKopecks, 0) - netRent)}.</p>}
                  <div className="document-actions">
                    <Button type="button" onClick={() => prepareDocument("act")}>Предпросмотр акта-расчёта</Button>
                    <Button type="button" variant="outline" onClick={() => prepareDocument("reconciliation")}>Акт сверки</Button>
                  </div>
                  <details className="document-archive"><summary>Архив документов · {(data.documentArchive ?? []).filter((item) => item.kind === "act" || item.kind === "reconciliation").length}</summary>
                    {(data.documentArchive ?? []).filter((item) => item.kind === "act" || item.kind === "reconciliation").map((item) => {
                      const stale = archiveIsStale(item);
                      return <div key={item.id} className="document-archive-row"><div><strong>{item.kind === "act" ? "Акт-расчёт" : item.kind === "reconciliation" ? "Акт сверки" : item.kind === "daily" ? "Ведомость" : "Реестр"} №{item.number} · версия {item.version}</strong>
                        <small>{new Date(item.generatedAt).toLocaleString("ru-RU")} {stale ? "· Данные изменились после формирования" : "· Актуально"}</small></div>
                        {item.pdfUri && <Button type="button" variant="outline" onClick={() => window.AndroidApp?.openArchivedPdf?.(item.pdfUri!)}>Открыть PDF</Button>}
                        {item.pdfUri && <Button type="button" variant="ghost" onClick={() => window.AndroidApp?.shareArchivedPdf?.(item.pdfUri!)}>Отправить</Button>}
                        <Button type="button" variant="outline" onClick={() => window.AndroidApp?.saveArchivedHtmlAsPdf?.(item.html, `${item.kind}_${item.period}_v${item.version}_${item.id}.pdf`, String(item.id))}>{item.pdfUri ? "Повторить PDF" : "Сохранить PDF"}</Button>
                        <Button type="button" variant="outline" onClick={() => editArchivedDocument(item)}><Pencil />Изменить и создать заново</Button>
                        <Button type="button" variant="ghost" onClick={() => askDeleteDocument(item)}><Trash2 />Удалить из архива</Button>
                      </div>;
                    })}
                  </details>
                </section>}
              </TabsContent>

              <TabsContent value="entries" className="space-y-4">
                <section className="panel week-overview" aria-label="Просмотр бутылок за неделю">
                  <div className="week-calendar-toolbar">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => moveEntryWeek(-1)}
                      disabled={!canGoToPreviousWeek}
                      aria-label="Предыдущая неделя"
                    >
                      <ChevronLeft />
                    </Button>
                    <div className="week-range">
                      <span>Неделя</span>
                      <strong>{shortWeekRange(currentWeekStart, addIsoDays(currentWeekStart, 6))}</strong>
                    </div>
                    <Button type="button" variant="ghost" size="icon" onClick={() => setMonthCalendarOpen(true)} aria-label="Открыть месячный календарь">
                      <CalendarDays />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => moveEntryWeek(1)}
                      disabled={!canGoToNextWeek}
                      aria-label="Следующая неделя"
                    >
                      <ChevronRight />
                    </Button>
                  </div>

                  <div className="week-days">
                    {currentWeekDays.map((day, index) => (
                      <button
                        key={day.date}
                        type="button"
                        className={[
                          "week-day",
                          day.date === entryDate ? "week-day-selected" : "",
                          day.missing ? "week-day-missing" : "",
                        ].filter(Boolean).join(" ")}
                        disabled={!day.inMonth}
                        onClick={() => openEntryForDate(day.date)}
                        aria-pressed={day.date === entryDate}
                        aria-label={`${WEEKDAY_LABELS[index]}, ${dateLabel(day.date)}${day.entry ? `, ${day.entry.units} бутылок` : ", записи нет"}`}
                      >
                        <span>{WEEKDAY_LABELS[index]}</span>
                        <strong>{Number(day.date.slice(-2))}</strong>
                        <span className="week-day-chart" aria-hidden="true">
                          <i style={{ height: day.entry ? `${Math.max(12, (day.entry.units / maxWeekUnits) * 100)}%` : "0%" }} />
                        </span>
                        <small>{day.entry ? number(day.entry.units) : day.missing ? "нет" : "—"}</small>
                      </button>
                    ))}
                  </div>

                  <div className="week-totals">
                    <div><span>Бутылок за неделю</span><strong>{number(weekUnits)}</strong></div>
                    <div><span>По {number(documentSettings.rateKopecks / 100)} ₽ за единицу</span><strong>{money(weekAmountKopecks)}</strong></div>
                  </div>
                  {missingWeekDays.length > 0 && (
                    <button
                      type="button"
                      className="week-missing-action"
                      onClick={() => openEntryForDate(missingWeekDays[0].date)}
                    >
                      <span>Нужно заполнить: {number(missingWeekDays.length)}</span>
                      <strong>Внести запись <ChevronRight /></strong>
                    </button>
                  )}
                </section>

                <section className="panel entry-history">
                  <div className="entry-history-heading">
                    <Button type="button" variant="ghost" className="entry-history-toggle" onClick={() => setEntryHistoryOpen((open) => !open)} aria-expanded={entryHistoryOpen} aria-controls="entry-history-list">
                    <div>
                      <span className="eyebrow">{shortWeekRange(currentWeekStart, addIsoDays(currentWeekStart, 6))}</span>
                      <strong>История записей</strong>
                    </div>
                    <small>{number(weekEntries.length)}</small><ChevronDown />
                    </Button>
                    <div className="entry-heading-actions">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => importInputRef.current?.click()}
                      >
                        <Upload />
                        Импорт Excel
                      </Button>
                      <input
                        ref={importInputRef}
                        type="file"
                        accept=".xlsx,.xls,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                        className="sr-only"
                        onChange={(event) => void readImportFile(event)}
                        aria-label="Выбрать Excel или CSV для импорта"
                      />
                    </div>
                  </div>
                  {entryHistoryOpen && <div className="entry-history-list" id="entry-history-list">{weekEntries.length === 0 ? (
                    <div className="empty-state">
                      <CalendarDays />
                      <p>За эту неделю записей пока нет.</p>
                      <Button type="button" variant="outline" onClick={() => setQuickEntryOpen(true)}>Добавить запись</Button>
                    </div>
                  ) : (
                    <div className="record-list">
                      {weekEntries.map((entry) => (
                        <article className="record-row" key={entry.id}>
                          <div className="record-date"><CalendarDays />{dateLabel(entry.entryDate)}</div>
                          <div className="entry-record-value min-w-0 flex-1">
                            <strong>{number(entry.units)} ед.</strong>
                            <span>{money(entry.units * documentSettings.rateKopecks)}</span>
                            {entry.note && <p>{entry.note}</p>}
                          </div>
                          {(
                            <div className="entry-record-actions">
                              <Button type="button" variant="outline" size="sm" onClick={() => { setEditingEntry(entry); setEditUnits(String(entry.units)); setEditNote(entry.note); }} aria-label={`Изменить запись за ${dateLabel(entry.entryDate)}`}>
                                <Pencil className="size-4" /><span className="entry-edit-label">Изменить</span>
                              </Button>
                              <Button type="button" variant="ghost" size="icon" onClick={() => askDeleteEntry(entry)} aria-label="Удалить запись"><Trash2 /></Button>
                            </div>
                          )}
                        </article>
                      ))}
                    </div>
                  )}</div>}
                </section>
              </TabsContent>

              <TabsContent value="invoices" className="space-y-4">
                {offlineMode && <section className="panel tax-summary">
                  <div><span className="eyebrow">УСН 6% · {taxQuarter} квартал {taxYear}</span>
                    <strong>{money(tax.outstandingKopecks)}</strong>
                    <small>Ориентир к доплате с учётом отмеченных платежей</small></div>
                  <Button type="button" variant="outline" onClick={openTax}>Открыть расчёт</Button>
                </section>}
                <section className="finance-summary">
                  <div><span>Выставлено</span><strong>{money(totalInvoiced)}</strong></div>
                  <div><span>Получено</span><strong>{money(totalPaid)}</strong></div>
                  <div><span>Долг по счетам</span><strong>{money(Math.max(0, totalInvoiced - totalPaid))}</strong></div>
                </section>
                <section className="panel payment-schedule">
                  <div className="section-heading">
                    <div>
                      <span className="eyebrow">Порядок по договору</span>
                      <h2>Сначала постоянная, затем переменная</h2>
                    </div>
                  </div>
                  <div className="schedule-grid">
                    <div><span>Постоянная часть</span><strong>{money(fixedTargetKopecks)}</strong><small>{settlement.fixedFuelKopecks > 0 ? "после остатка вычета топлива; можно несколькими счетами" : "по договору и дням простоя; можно несколькими счетами"}</small></div>
                    <div><span>Осталось постоянной части</span><strong>{money(fixedRemainingKopecks)}</strong></div>
                    <div><span>Переменная часть</span><strong>{money(variableTargetKopecks)}</strong><small>{data.closure ? customerFuel > 0 ? "после вычета топлива" : "рассчитана по итогам месяца" : "после закрытия месяца"}</small></div>
                  </div>
                </section>
                <Button type="button" onClick={() => openInvoice()} className="h-12 w-full sm:w-auto">
                  <Plus />Добавить выставленный счёт
                </Button>

                {data.invoices.length === 0 ? (
                  <section className="panel empty-state">
                    <ReceiptText />
                    <p>История счетов за этот месяц пуста.</p>
                  </section>
                ) : (
                  <div className="space-y-3 invoice-timeline">
                    {data.invoices.map((invoice) => {
                      const invoicePayments = data.payments.filter((payment) => payment.invoiceId === invoice.id);
                      const paid = paidByInvoice.get(invoice.id) ?? 0;
                      const status = statusFor(invoice, paid);
                      return (
                        <article className={`panel invoice-card invoice-card-${status.tone}`} key={invoice.id}>
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="flex flex-wrap items-center gap-2">
                                <h2>Счёт №{invoice.invoiceNumber}</h2>
                                <span className={`invoice-status invoice-status-${status.tone}`}>{status.label}</span>
                              </div>
                              <p className="mt-1 text-sm text-muted-foreground">
                                {invoiceLabels[invoice.kind]} · {dateLabel(invoice.invoiceDate)}
                              </p>
                            </div>
                            {offlineMode && <Button type="button" variant="ghost" size="icon" onClick={() => editInvoice(invoice)} aria-label="Редактировать счёт"><Pencil /></Button>}
                            <Button type="button" variant="ghost" size="icon" onClick={() => askDeleteInvoice(invoice)} aria-label="Удалить счёт">
                              <Trash2 />
                            </Button>
                          </div>
                          <div className="invoice-amounts">
                            <div><span>Сумма счёта</span><strong>{money(invoice.amountKopecks)}</strong></div>
                            <div><span>Оплачено</span><strong>{money(paid)}</strong></div>
                            <div><span>Остаток</span><strong>{money(Math.max(0, invoice.amountKopecks - paid))}</strong></div>
                          </div>
                            {invoice.dueDate && <p className="due-line">Срок оплаты: <strong>{dateLabel(invoice.dueDate)}</strong></p>}
                            <p className="due-line">Период: <strong>{monthLabel(invoice.period)}</strong>{invoice.actNumber && <> · акт-расчёт №{invoice.actNumber}</>}</p>
                            <p className="due-line">Дни бутылей: <strong>{invoice.bottleStartDate && invoice.bottleEndDate
                              ? `${dateLabel(invoice.bottleStartDate)} — ${dateLabel(invoice.bottleEndDate)}` : "не указаны"}</strong></p>
                          {invoice.note && <p className="record-note">{invoice.note}</p>}

                          <Button
                            type="button"
                            variant="outline"
                            className="invoice-copy-button"
                            onClick={() => {
                              if (!invoiceTextReady) {
                                toast.error("Сначала заполните данные договора в настройках");
                                openSettings();
                                return;
                              }
                              setCopiedKey("");
                              setTextInvoice(invoice);
                            }}
                          >
                            <FileText />Тексты для счёта и письма
                          </Button>

                          {invoicePayments.length > 0 && (
                            <div className="payment-list">
                              {invoicePayments.map((payment) => (
                                <div key={payment.id}>
                                  <span>{dateLabel(payment.paymentDate)} · {payment.method === "bank" ? "Безналичные" : "Наличные"}</span>
                                  <strong>{money(payment.amountKopecks)}</strong>
                                  {offlineMode && <Button type="button" variant="ghost" size="icon" onClick={() => editPayment(payment)} aria-label="Редактировать оплату"><Pencil /></Button>}
                            <Button type="button" variant="ghost" size="icon" onClick={() => askDeletePayment(payment)} aria-label="Удалить оплату"><Trash2 /></Button>
                                </div>
                              ))}
                            </div>
                          )}
                          <Button type="button" variant="outline" onClick={() => openPayment(invoice)} className="mt-4 w-full sm:w-auto">
                            <Plus />Добавить оплату
                          </Button>
                        </article>
                      );
                    })}
                  </div>
                )}
              </TabsContent>

              <TabsContent value="expenses" className="space-y-4">
                <div className="expense-filter-heading">
                  <div>
                    <span className="eyebrow">Показывать расходы</span>
                    <strong>Фильтр по категориям</strong>
                  </div>
                  {offlineMode && (
                    <Button type="button" variant="outline" size="sm" onClick={openExpenseCategories}>
                      <SlidersHorizontal />Настроить
                    </Button>
                  )}
                </div>
                <div className="expense-filter" role="group" aria-label="Фильтр расходов по категории">
                  {[{ id: "all", name: "Все" }, ...expenseCategories].map((category) => (
                    <Button
                      key={category.id}
                      type="button"
                      variant="ghost"
                      size="sm"
                      className={expenseFilter === category.id ? "expense-filter-active" : ""}
                      aria-pressed={expenseFilter === category.id}
                      onClick={() => setExpenseFilter(category.id)}
                    >
                      {category.name}
                    </Button>
                  ))}
                </div>
                <section className="panel expense-visual" aria-label="Структура расходов за месяц">
                  <div className="expense-donut" style={{ background: expenseDonutBackground }}>
                    <div>
                      <span>Всего</span>
                      <strong>{money(totalExpenses)}</strong>
                    </div>
                  </div>
                  <div className="expense-legend">
                    <span className="eyebrow">Структура расходов</span>
                    {expenseBreakdown.length === 0 ? (
                      <p>Добавьте первый расход — здесь появится распределение.</p>
                    ) : expenseBreakdown.map((category) => (
                      <button type="button" key={category.id} onClick={() => setExpenseFilter(category.id)}>
                        <i style={{ background: category.color }} />
                        <span>{category.name}</span>
                        <strong>{money(category.amountKopecks)}</strong>
                      </button>
                    ))}
                  </div>
                </section>
                <section className="panel expense-total">
                  <div>
                    <span className="eyebrow">{expenseFilter === "all" ? "Расходы за месяц" : `${expenseCategoryName(expenseFilter)} за месяц`}</span>
                    <strong>{money(filteredExpenseTotal)}</strong>
                  </div>
                  <WalletCards />
                </section>
                {expenseShortcuts.length > 0 && <div className="expense-templates" aria-label="Быстрое добавление расхода">
                  <span>Быстро добавить</span>
                  <div>
                    {expenseShortcuts.map((shortcut) => <button key={shortcut.id} type="button" onClick={() => openExpenseTemplate(shortcut)}>
                      {shortcut.category === "fuel" ? <Fuel /> : shortcut.category === "repair" ? <Wrench /> : <WalletCards />}{shortcut.title}
                    </button>)}
                  </div>
                </div>}
                <Button type="button" onClick={openExpense} className="h-12 w-full sm:w-auto">
                  <Plus />Добавить расход
                </Button>
                {expenseFilter === "all" && (
                  <p className="help-note">Собственные расходы: {money(selfExpenses)}. Топливо заказчика: {money(customerFuel)}. Вычет с округлением до целых бутылей: {money(fuelDeduction)}.</p>
                )}
                {expenseFilter === "fuel" && (
                  <p className="help-note">Оплатил я: {money(filteredSelfFuel)}. Оплатил заказчик: {money(filteredCustomerFuel)} — вычитается из суммы к оплате.</p>
                )}

                {filteredExpenses.length === 0 ? (
                  <section className="panel empty-state">
                    <WalletCards />
                    <p>{data.expenses.length === 0 ? "Расходов за этот месяц пока нет." : `По категории «${expenseCategoryName(expenseFilter)}» расходов нет.`}</p>
                  </section>
                ) : (
                  <div className="space-y-3">
                    {filteredExpenses.map((expense) => (
                      <article className="panel expense-row" key={expense.id}>
                        <div className="expense-icon">
                          {expense.category === "fuel" ? <Fuel /> : expense.category === "repair" ? <Wrench /> : <WalletCards />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <h2>{expenseCategoryName(expense.category)}</h2>
                            <strong>{money(expense.amountKopecks)}</strong>
                          </div>
                          <p>{expense.payer === "customer" ? "Оплатил заказчик" : "Оплатил я"} · {dateLabel(expense.expenseDate)} · {expense.method === "bank" ? "Безналичные" : "Наличные"}</p>
                          {(expense.documentNumber || expense.note) && (
                            <p>{[expense.documentNumber && `Документ: ${expense.documentNumber}`, expense.note].filter(Boolean).join(" · ")}</p>
                          )}
                        </div>
                        {offlineMode && <Button type="button" variant="ghost" size="icon" onClick={() => editExpense(expense)} aria-label="Редактировать расход"><Pencil /></Button>}
                            <Button type="button" variant="ghost" size="icon" onClick={() => askDeleteExpense(expense)} aria-label="Удалить расход"><Trash2 /></Button>
                      </article>
                    ))}
                  </div>
                )}
              </TabsContent>

            </>
          ) : null}
        </Tabs>

        {offlineMode && tab === "summary" && (
          <section className="panel offline-storage-panel mt-4">
            <div>
              <span className="eyebrow">Хранение данных</span>
              <strong>Всё сохранено на этом телефоне</strong>
              <p>Приложение работает без интернета. Иногда сохраняйте копию, чтобы не потерять записи при поломке или замене телефона.</p>
              <span className={backupDue ? "backup-status backup-status-due" : "backup-status"}>
                {backupDue ? "● " : "✓ "}{lastBackupLabel}
              </span>
            </div>
            <div className="offline-storage-actions">
              <Button type="button" variant="outline" onClick={exportBackup}>
                <Download />Сохранить копию
              </Button>
              <Button type="button" variant="outline" onClick={() => backupInputRef.current?.click()}>
                <Upload />Восстановить
              </Button>
              <input
                ref={backupInputRef}
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={(event) => void restoreBackup(event)}
              />
            </div>
          </section>
        )}
      </main>

      <Dialog open={Boolean(documentPreview)} onOpenChange={(open) => !open && setDocumentPreview(null)}>
        <DialogContent className="dialog-card document-preview-dialog">
          <DialogHeader><DialogTitle>Предпросмотр документа</DialogTitle>
            <DialogDescription>Проверьте суммы, даты и текст перед сохранением PDF. Подписи останутся пустыми.</DialogDescription>
          </DialogHeader>
          {documentPreview && <DocumentPreviewPages html={documentPreview.html} />}
          <DialogFooter><Button type="button" variant="outline" onClick={() => setDocumentPreview(null)}>Назад</Button>
            <Button type="button" onClick={() => void savePreviewedDocument()}>Сохранить PDF</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={closeMonthOpen} onOpenChange={setCloseMonthOpen}>
        <DialogContent className="dialog-card close-month-dialog sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Проверка перед закрытием</DialogTitle>
            <DialogDescription>{monthLabel(month)}. Проверьте расчёт перед формированием акта. Позже записи можно исправить, а документ выпустить новой версией.</DialogDescription>
          </DialogHeader>
          <div className="month-close-checklist">
            <div><span><CalendarDays />Учётные дни</span><strong>{number(data?.entries.length ?? 0)}</strong></div>
            <div className={missingMonthDays.length ? "check-warning" : "check-ok"}>
              <span>{missingMonthDays.length ? <CalendarDays /> : <CheckCircle2 />}Дни без записи</span>
              <strong>{number(missingMonthDays.length)}</strong>
            </div>
            <div><span><CarFront />Учётные единицы</span><strong>{number(calculation.actualUnits)}</strong></div>
            <div><span>Календарных дней D</span><strong>{calculation.calendarDays}</strong></div>
            <div><span>Дней владения A</span><strong>{calculation.ownershipDays}</strong></div>
            <div><span><CirclePause />Дни простоя</span><strong>{number(calculation.downtimeDays)}</strong></div>
            <div><span>Оплачиваемых дней d</span><strong>{calculation.payableDays}</strong></div>
            <div><span>Постоянная часть Ф</span><strong>{money(calculation.baseKopecks)}</strong></div>
            <div><span>Показатель И</span><strong>{money(calculation.intensityKopecks)}</strong></div>
            <div><span>Переменная часть</span><strong>{money(calculation.variableKopecks)}</strong></div>
            <div><span><Fuel />Топливо заказчика</span><strong>{money(customerFuel)}</strong></div>
            <div><span><ReceiptText />Уже выставлено</span><strong>{money(totalInvoiced)}</strong></div>
            <div className="month-close-total"><span><Banknote />Начислено по договору</span><strong>{money(calculation.totalKopecks)}</strong></div>
            <div className="month-close-total month-close-remaining"><span><ReceiptText />Осталось выставить</span><strong>{money(remainingToInvoice)}</strong></div>
          </div>
          {missingMonthDays.length > 0 && (
            <button
              type="button"
              className="close-missing-link"
              onClick={() => {
                setCloseMonthOpen(false);
                setTab("entries");
                selectEntryDate(missingMonthDays[0]);
              }}
            >
              Проверить незаполненные дни <ChevronRight />
            </button>
          )}
          <p className="help-note">После фиксации можно сформировать акт-расчёт. Счёт не создаётся автоматически.</p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCloseMonthOpen(false)}>Отмена</Button>
            <Button type="button" disabled={busy} onClick={() => void closeMonth()}>
              {busy ? <LoaderCircle className="animate-spin" /> : <LockKeyhole />}
              Закрыть месяц
            </Button>
            <Button type="button" variant="outline" onClick={() => { setCloseMonthOpen(false); prepareDocument("act"); }}>Предпросмотр акта</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={auditOpen} onOpenChange={setAuditOpen}>
        <DialogContent className="dialog-card audit-dialog sm:max-w-md">
          <DialogHeader>
            <DialogTitle>История изменений</DialogTitle>
            <DialogDescription>Все основные действия за {monthLabel(month).toLowerCase()}.</DialogDescription>
          </DialogHeader>
          {auditEvents.length === 0 ? (
            <div className="empty-state compact-empty-state">
              <History />
              <p>Изменений за этот месяц пока нет.</p>
            </div>
          ) : (
            <div className="audit-list">
              {auditEvents.map((event) => (
                <article key={event.id} className={`audit-row audit-${event.entity}`}>
                  <span className="audit-icon" aria-hidden="true">
                    {event.entity === "entry" ? <CalendarDays />
                      : event.entity === "invoice" ? <ReceiptText />
                        : event.entity === "payment" ? <Banknote />
                          : event.entity === "expense" ? <WalletCards />
                            : event.entity === "downtime" ? <CirclePause />
                              : event.entity === "month" ? <LockKeyhole />
                                : <Settings />}
                  </span>
                  <div>
                    <strong>{event.title}</strong>
                    <p>{event.detail}</p>
                    <time>{new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(event.at))}</time>
                  </div>
                </article>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={downtimeListOpen} onOpenChange={setDowntimeListOpen}>
        <DialogContent className="dialog-card downtime-list-dialog sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Простой автомобиля</DialogTitle>
            <DialogDescription>Полные дни простоя уменьшают постоянную часть за выбранный месяц.</DialogDescription>
          </DialogHeader>
          <Button
            type="button"
            className="h-12 w-full"
            onClick={() => {
              setDowntimeListOpen(false);
              window.setTimeout(() => openDowntime(), 120);
            }}
          >
            <Plus />Добавить простой
          </Button>
          {(data?.downtimes ?? []).length === 0 ? (
            <div className="empty-state compact-empty-state">
              <CirclePause />
              <p>Простоев за выбранный месяц нет.</p>
            </div>
          ) : (
            <div className="downtime-list">
              {(data?.downtimes ?? []).map((downtime) => (
                <article className="downtime-row" key={downtime.id}>
                  <span><CirclePause />{downtimeLabel(downtime)}</span>
                  {(
                    <div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          setDowntimeListOpen(false);
                          window.setTimeout(() => openDowntime(downtime), 120);
                        }}
                        aria-label="Редактировать простой"
                      >
                        <Pencil />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          setDowntimeListOpen(false);
                          window.setTimeout(() => askDeleteDowntime(downtime), 120);
                        }}
                        aria-label="Удалить простой"
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={monthCalendarOpen} onOpenChange={setMonthCalendarOpen}>
        <DialogContent className="dialog-card month-calendar-dialog">
          <DialogHeader>
            <DialogTitle>{monthLabel(month)} · по дням</DialogTitle>
            <DialogDescription>В каждой ячейке: дата, количество бутылей и сумма по {number(documentSettings.rateKopecks / 100)} ₽ за бутыль. Нажмите день, чтобы внести или изменить запись.</DialogDescription>
          </DialogHeader>
          <div className="month-calendar-weekdays" aria-hidden="true">{WEEKDAY_LABELS.map((day) => <span key={day}>{day}</span>)}</div>
          <div className="month-calendar-grid">
            {monthCalendarDays.map((day) => <button
              key={day.date}
              type="button"
              className={["month-day", !day.inMonth ? "month-day-outside" : "", !day.entry ? "month-day-empty" : "", day.missing ? "month-day-missing" : "", day.date === entryDate ? "month-day-selected" : ""].filter(Boolean).join(" ")}
              disabled={!day.inMonth}
              aria-pressed={day.date === entryDate}
              aria-label={`${dateLabel(day.date)}${day.entry ? `, ${day.entry.units} бутылей, ${money(day.entry.units * documentSettings.rateKopecks)}` : ", записи нет"}`}
              onClick={() => { setMonthCalendarOpen(false); openEntryForDate(day.date); }}
            >
              <strong>{Number(day.date.slice(-2))}</strong>
              <span className="month-day-units">{day.entry ? `${number(day.entry.units)} б.` : day.missing ? "нет" : "—"}</span>
              <small className="month-day-amount">{day.entry ? money(day.entry.units * documentSettings.rateKopecks) : "—"}</small>
            </button>)}
          </div>
          <div className="month-calendar-legend"><span><i className="month-day-selected" />Выбранный день</span><span><i />Запись есть</span><span><i className="month-day-missing" />Нужно заполнить</span><span>— Нет записи</span></div>
          <div className="week-totals">
            <div><span>Бутылей за месяц</span><strong>{number(calculation.actualUnits)}</strong></div>
            <div><span>Количество × ставка</span><strong>{money(calculation.actualUnits * documentSettings.rateKopecks)}</strong></div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={quickEntryOpen} onOpenChange={setQuickEntryOpen}>
        <DialogContent
          className="dialog-card quick-entry-dialog sm:max-w-md"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            window.requestAnimationFrame(() => quickEntryUnitsRef.current?.focus());
          }}
        >
          <DialogHeader>
            <DialogTitle>Быстрая запись</DialogTitle>
            <DialogDescription>Выберите день и укажите количество бутылок.</DialogDescription>
          </DialogHeader>
          {(
            <form onSubmit={saveEntry} className="dialog-form quick-entry-dialog-form">
              <label>
                <FieldLabel>Дата</FieldLabel>
                <Input
                  type="date"
                  value={entryDate}
                  min={monthBounds.start}
                  max={monthBounds.end}
                  onChange={(event) => selectEntryDate(event.target.value)}
                  required
                />
              </label>
              <label>
                <div className="quick-dialog-label">
                  <FieldLabel>Количество бутылок</FieldLabel>
                  {selectedEntry && <span className="entry-existing-chip entry-existing-chip-light">Запись уже есть</span>}
                </div>
                <Input
                  ref={quickEntryUnitsRef}
                  type="number"
                  min="0"
                  step="1"
                  inputMode="numeric"
                  enterKeyHint="done"
                  autoComplete="off"
                  placeholder="Например, 145"
                  value={entryUnits}
                  onChange={(event) => setEntryUnits(event.target.value)}
                  onFocus={(event) => event.currentTarget.select()}
                  required
                />
              </label>
              <Button type="submit" className="quick-dialog-save" disabled={busy || !entryUnits}>
                {busy ? <LoaderCircle className="animate-spin" /> : selectedEntry ? <Pencil /> : <Plus />}
                {selectedEntry ? "Обновить запись" : "Записать"}
              </Button>
              <p className="quick-dialog-hint">После сохранения дата автоматически перейдёт на следующий день.</p>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={taxOpen} onOpenChange={setTaxOpen}>
        <DialogContent className="dialog-card tax-dialog sm:max-w-lg">
          <DialogHeader><DialogTitle>УСН 6% · {taxYear}</DialogTitle>
            <DialogDescription>Оплаты учитываются по дате поступления денег, даже если счёт выставлен за другой месяц.</DialogDescription>
          </DialogHeader>
          <div className="tax-dialog-scroll">
            <div className="tax-figures">
              <div><span>Аренда с начала года</span><strong>{money(tax.rentalKopecks)}</strong></div>
              <div><span>Прочие доходы ИП на УСН</span><strong>{money(tax.otherKopecks)}</strong></div>
              <div><span>Резерв 6% с поступлений квартала</span><strong>{money(tax.reserveKopecks)}</strong></div>
              <div><span>УСН 6% с начала года</span><strong>{money(tax.grossKopecks)}</strong></div>
              <div><span>Вычет по взносам</span><strong>−{money(tax.deductionKopecks)}</strong></div>
              <div><span>Отмечено уплаченным</span><strong>−{money(tax.paidKopecks)}</strong></div>
              <div className="tax-due"><span>Ориентир к доплате за {taxQuarter} квартал</span><strong>{money(tax.outstandingKopecks)}</strong></div>
            </div>
            <p className="help-note">Расчёт накопительно с 1 января по конец квартала. Отдельно предполагаемый взнос 1% сверх 300 000 ₽ дохода: {money(tax.extraInsuranceKopecks)}. Это взнос ИП, не дополнительный налог 6%.</p>
            <form onSubmit={(event) => void saveTaxOptions(event)} className="dialog-form tax-form">
              <strong>Уменьшение налога</strong>
              <label><FieldLabel>Взносы для вычета в {taxYear} году, ₽</FieldLabel>
                <Input inputMode="decimal" value={taxDeduction} onChange={(event) => setTaxDeduction(event.target.value)} /></label>
              <label className="tax-checkbox"><input type="checkbox" checked={taxHasWorkers} onChange={(event) => setTaxHasWorkers(event.target.checked)} /> Есть выплаты работникам или исполнителям на этом ИП</label>
              <p className="help-note">Укажите только взносы, которые применяете к УСН и ещё не использовали для патента. При выплатах физлицам вычет ограничен половиной налога. Фиксированные взносы за полный 2026 год — 57 390 ₽; их уплату учитывайте отдельно.</p>
              <Button type="submit" variant="outline" disabled={busy}>Сохранить вычет</Button>
            </form>
            <form onSubmit={(event) => void saveTaxAdjustment(event)} className="dialog-form tax-form">
              <strong>Другой доход или перечисленный налог</strong>
              <Select value={taxKind} onValueChange={(value) => setTaxKind(value as TaxAdjustment["kind"])}>
                <SelectTrigger aria-label="Тип записи"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="income">Другой доход ИП на УСН</SelectItem><SelectItem value="tax_paid">Уплатил УСН</SelectItem></SelectContent>
              </Select>
              <div className="grid grid-cols-2 gap-3"><label><FieldLabel>Дата</FieldLabel><Input type="date" value={taxDate} onChange={(event) => setTaxDate(event.target.value)} required /></label>
                <label><FieldLabel>Сумма, ₽</FieldLabel><Input inputMode="decimal" value={taxAmount} onChange={(event) => setTaxAmount(event.target.value)} required /></label></div>
              <label><FieldLabel>Примечание</FieldLabel><Input value={taxNote} onChange={(event) => setTaxNote(event.target.value)} /></label>
              <Button type="submit" disabled={busy}>Добавить запись</Button>
            </form>
            <div className="tax-records">{(data?.taxAdjustments ?? []).filter((row) => row.date.startsWith(String(taxYear)))
              .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id).map((row) =>
                <div key={row.id}><span>{dateLabel(row.date)} · {row.kind === "income" ? "Доход" : "УСН уплачен"}{row.note ? ` · ${row.note}` : ""}</span>
                  <strong>{money(row.amountKopecks)}</strong>
                  <Button type="button" variant="ghost" size="icon" aria-label="Удалить налоговую запись" onClick={() => void request({ action: "delete_tax_adjustment", id: row.id }, "Запись удалена")}><Trash2 /></Button></div>)}</div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={settlementOpen} onOpenChange={setSettlementOpen}>
        <DialogContent className="dialog-card sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Расчёт с заказчиком</DialogTitle>
            <DialogDescription>Подробности суммы к выставлению за {monthLabel(month).toLowerCase()}.</DialogDescription>
          </DialogHeader>
          {settlementDetails()}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(textInvoice)} onOpenChange={(open) => { if (!open) setTextInvoice(null); }}>
        <DialogContent className="dialog-card copy-dialog max-h-[92vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Тексты для счёта № {textInvoice?.invoiceNumber ?? ""}</DialogTitle>
            <DialogDescription>Скопируйте нужный текст и вставьте его в банк или письмо.</DialogDescription>
          </DialogHeader>
          {textInvoice && (
            <div className="copy-stack copy-dialog-stack">
              <CopyBlock
                title="Строка счёта в банке"
                text={invoiceLine(textInvoice, documentSettings)}
                copied={copiedKey === `line-${textInvoice.id}`}
                onCopy={() => void copyText(invoiceLine(textInvoice, documentSettings), `line-${textInvoice.id}`)}
              />
              <CopyBlock
                title="Назначение платежа"
                text={paymentPurpose(textInvoice, documentSettings)}
                copied={copiedKey === `purpose-${textInvoice.id}`}
                onCopy={() => void copyText(paymentPurpose(textInvoice, documentSettings), `purpose-${textInvoice.id}`)}
              />
              <CopyBlock
                title="Тема письма"
                text={emailSubject(textInvoice, documentSettings)}
                copied={copiedKey === `subject-${textInvoice.id}`}
                onCopy={() => void copyText(emailSubject(textInvoice, documentSettings), `subject-${textInvoice.id}`)}
              />
              <CopyBlock
                title="Текст письма"
                text={emailText(textInvoice, documentSettings)}
                copied={copiedKey === `email-${textInvoice.id}`}
                onCopy={() => void copyText(emailText(textInvoice, documentSettings), `email-${textInvoice.id}`)}
              />
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(editingEntry)} onOpenChange={(open) => { if (!open) setEditingEntry(null); }}>
        <DialogContent className="dialog-card">
          <DialogHeader>
            <DialogTitle>Изменить количество</DialogTitle>
            <DialogDescription>{editingEntry ? dateLabel(editingEntry.entryDate) : ""}. Сохранение заменит прежнее количество за этот день.</DialogDescription>
          </DialogHeader>
          <form className="dialog-form" onSubmit={async (event) => {
            event.preventDefault();
            if (!editingEntry || editUnits.trim() === "") return;
            const ok = await request({ action: "save_entry", entryDate: editingEntry.entryDate, units: Number(editUnits), note: editNote }, "Количество обновлено");
            if (ok) setEditingEntry(null);
          }}>
            <label><FieldLabel>Бутылок за день</FieldLabel><Input autoFocus type="number" min="0" step="1" inputMode="numeric" value={editUnits} onChange={(event) => setEditUnits(event.target.value)} onFocus={(event) => event.currentTarget.select()} required /></label>
            <label><FieldLabel>Примечание</FieldLabel><Textarea value={editNote} onChange={(event) => setEditNote(event.target.value)} /></label>
            <DialogFooter><Button type="button" variant="outline" onClick={() => setEditingEntry(null)}>Отмена</Button><Button type="submit" disabled={busy || editUnits.trim() === ""}>Сохранить</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="dialog-card import-dialog max-h-[92vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><FileSpreadsheet />Проверка импорта</DialogTitle>
            <DialogDescription>{importFileName} · проверьте записи перед загрузкой.</DialogDescription>
          </DialogHeader>

          <div className="import-summary">
            <div><span>Записей</span><strong>{number(importRows.length)}</strong></div>
            <div><span>Всего бутылок</span><strong>{number(importTotalUnits)}</strong></div>
          </div>

          {importRows.length > 0 && (
            <p className="import-period">
              Период: {dateLabel(importRows[0].entryDate)} — {dateLabel(importRows[importRows.length - 1].entryDate)}
            </p>
          )}

          <div className="import-preview" role="list" aria-label="Записи для импорта">
            {importRows.map((row) => (
              <div className="import-row" role="listitem" key={row.entryDate}>
                <span>{dateLabel(row.entryDate)}</span>
                <strong>{number(row.units)} шт.</strong>
                {row.note && <p>{row.note}</p>}
              </div>
            ))}
          </div>

          {importWarnings.map((warning) => <p className="import-warning" key={warning}>{warning}</p>)}
          <p className="import-replace-note">
            Если дата уже есть в приложении, её количество обновится. Двойной записи не появится.
          </p>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setImportOpen(false)}>Отмена</Button>
            <Button type="button" disabled={busy || importRows.length === 0} onClick={() => void importEntries()}>
              {busy ? <LoaderCircle className="animate-spin" /> : <Upload />}
              Загрузить {number(importRows.length)}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={invoiceOpen} onOpenChange={setInvoiceOpen}>
        <DialogContent className="dialog-card max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingInvoiceId === null ? "Добавить выставленный счёт" : "Редактировать счёт"}</DialogTitle>
            <DialogDescription>Укажите дни, за которые выставлен счёт: они попадут в акт сверки вместе с количеством бутылей и вычетом топлива. Изменения сохраняются только в приложении.</DialogDescription>
          </DialogHeader>
          <form onSubmit={createInvoice} className="dialog-form">
            <label>
              <FieldLabel>Вид начисления</FieldLabel>
              <Select
                value={invoiceKind}
                onValueChange={(value) => {
                  const kind = value as Invoice["kind"];
                  setInvoiceKind(kind);
                  if (editingInvoiceId === null) setInvoicePeriodAutomatic(true);
                  if (editingInvoiceId === null && kind === "fixed") setInvoiceAmount(fixedRemainingKopecks > 0 ? String(fixedRemainingKopecks / 100) : "");
                  if (editingInvoiceId === null && kind === "variable") setInvoiceAmount(variableRemainingKopecks > 0 ? String(variableRemainingKopecks / 100) : "");
                  if (editingInvoiceId === null && kind === "other") setInvoiceAmount(remainingToInvoice > 0 ? String(remainingToInvoice / 100) : "");
                }}
              >
                <SelectTrigger className="h-11 w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="fixed">Часть постоянной арендной платы</SelectItem>
                  <SelectItem value="variable" disabled={editingInvoiceId === null && (!data?.closure || fixedRemainingKopecks > 0)}>Переменная часть</SelectItem>
                  <SelectItem value="other">Прочее начисление</SelectItem>
                </SelectContent>
              </Select>
              {editingInvoiceId === null && <p className="help-note">Постоянную часть можно выставлять несколькими счетами. Переменная доступна после закрытия месяца.</p>}
            </label>
            <label><FieldLabel>Дата счёта</FieldLabel><Input type="date" value={invoiceDate} onChange={(event) => setInvoiceDate(event.target.value)} required /></label>
            <div className="rounded-xl border border-border p-3 space-y-2">
              <strong className="text-sm">Периоды по записям до {validIsoDate(invoiceDate) ? dateLabel(invoiceDate) : "выбранной даты"}</strong>
              {invoicePeriods.needsReview && <p className="help-note" role="alert">У счетов №{invoicePeriods.legacyInvoiceNumbers.join(", №")} не указан период. Перед выбором проверьте, какие дни они покрывают.</p>}
              {invoicePeriods.periods.map((period) => <Button type="button" variant="outline" key={`${period.startDate}_${period.endDate}`} className="h-auto w-full flex-col items-start gap-1 whitespace-normal py-3 text-left" onClick={() => {
                setInvoicePeriodAutomatic(false);
                setInvoiceStartDate(period.startDate);
                setInvoiceEndDate(period.endDate);
              }}>
                <span>{dateLabel(period.startDate)} — {dateLabel(period.endDate)}{invoiceStartDate === period.startDate && invoiceEndDate === period.endDate ? " · выбран" : ""}</span>
                <span className="text-xs text-muted-foreground">{number(period.units)} бутылей · {money(period.grossKopecks)} по ставке</span>
              </Button>)}
              {!invoicePeriods.periods.length && <p className="help-note">{invoicePeriods.hasRelevantDays ? "Дни уже указаны в других счетах. Проверьте их периоды или выберите даты вручную." : "До этой даты нет записей для подбора. Период можно указать вручную."}</p>}
              {!invoicePeriodAutomatic && editingInvoiceId === null && !invoicePeriods.needsReview && invoicePeriods.periods.length > 0 &&
                <Button type="button" variant="ghost" onClick={() => setInvoicePeriodAutomatic(true)}>Подобрать период автоматически</Button>}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label><FieldLabel>Номер счёта</FieldLabel><Input value={invoiceNumber} onChange={(event) => setInvoiceNumber(event.target.value)} placeholder="Например, 24" required /></label>
              <label><FieldLabel>Сумма выставленного счёта, ₽</FieldLabel><Input type="number" min="0.01" step="0.01" inputMode="decimal" value={invoiceAmount} onChange={(event) => setInvoiceAmount(event.target.value)} required /></label>
            </div>
            <p className="help-note">Введите сумму самого счёта. Оплаты и остаток считаются от этой суммы.{editingInvoiceId === null && " В предложенной сумме топливо сначала вычтено из переменной части; если её не хватает — остаток из постоянной."}</p>
            <div className="grid grid-cols-2 gap-3">
              <label><FieldLabel>Первый день бутылей</FieldLabel><Input type="date" min={`${month}-01`} max={periodBounds(month).end} value={invoiceStartDate} onChange={(event) => { setInvoicePeriodAutomatic(false); setInvoiceStartDate(event.target.value); }} required={editingInvoiceId === null} /></label>
              <label><FieldLabel>Последний день бутылей</FieldLabel><Input type="date" min={`${month}-01`} max={periodBounds(month).end} value={invoiceEndDate} onChange={(event) => { setInvoicePeriodAutomatic(false); setInvoiceEndDate(event.target.value); }} required={editingInvoiceId === null} /></label>
            </div>
            {invoiceStartDate && invoiceEndDate && invoiceStartDate <= invoiceEndDate &&
              <p className="help-note">За выбранные дни: {number(selectedBottleUnits)} бутылей, по ставке {money(selectedBottleUnits * documentSettings.rateKopecks)}. Топливо по этим датам: {money(selectedBottleFuel)}. В акте сверки общий вычет топлива показан в конце месяца.</p>}
            {editingInvoiceId === null && invoiceKind !== "other" && <p className="help-note">Предложенная сумма — остаток {invoiceKind === "fixed" ? "постоянной" : "переменной"} части аренды за месяц. Её можно изменить для частичного счёта.</p>}
            {editingInvoiceId !== null && !invoiceStartDate && !invoiceEndDate &&
              <p className="help-note">Этот старый счёт сохранён без дат бутылей. Можно оставить его как есть или добавить период для расшифровки в акте сверки.</p>}
            <label><FieldLabel>Связанный акт-расчёт №</FieldLabel><Input value={invoiceActNumber} onChange={(event) => setInvoiceActNumber(event.target.value)} placeholder="Необязательно для предварительного счёта" /></label>
            <label><FieldLabel>Срок оплаты</FieldLabel><Input type="date" value={invoiceDueDate} onChange={(event) => setInvoiceDueDate(event.target.value)} /></label>
            <label><FieldLabel>Примечание</FieldLabel><Textarea value={invoiceNote} onChange={(event) => setInvoiceNote(event.target.value)} placeholder="Необязательно" /></label>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setInvoiceOpen(false)}>Отмена</Button>
              <Button type="submit" disabled={busy}>{busy && <LoaderCircle className="animate-spin" />}Сохранить счёт</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={paymentOpen} onOpenChange={setPaymentOpen}>
        <DialogContent className="dialog-card max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingPaymentId === null ? "Добавить оплату" : "Редактировать оплату"}</DialogTitle>
            <DialogDescription>Можно вносить оплату частями и отмечать наличные или безналичные.</DialogDescription>
          </DialogHeader>
          <form onSubmit={createPayment} className="dialog-form">
            <div className="grid grid-cols-2 gap-3">
              <label><FieldLabel>Дата оплаты</FieldLabel><Input type="date" value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} required /></label>
              <label><FieldLabel>Сумма, ₽</FieldLabel><Input type="number" min="0.01" step="0.01" inputMode="decimal" value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} required /></label>
            </div>
            <label>
              <FieldLabel>Способ оплаты</FieldLabel>
              <Select value={paymentMethod} onValueChange={(value) => setPaymentMethod(value as Payment["method"])}>
                <SelectTrigger className="h-11 w-full"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="bank">Безналичные</SelectItem><SelectItem value="cash">Наличные</SelectItem></SelectContent>
              </Select>
            </label>
            <label><FieldLabel>Платёжный или кассовый документ</FieldLabel><Input value={paymentDocument} onChange={(event) => setPaymentDocument(event.target.value)} placeholder="Номер — необязательно" /></label>
            {editingPaymentId === null && (data?.invoices.length ?? 0) > 1 && <div className="payment-allocation">
              <Button type="button" variant="outline" onClick={() => setPaymentSplits(paymentSplits ? null : { [paymentInvoiceId ?? 0]: paymentAmount })}>
                {paymentSplits ? "Один счёт" : "Разнести платёж по нескольким счетам"}
              </Button>
              {paymentSplits && <div className="document-fields">{data?.invoices.map((invoice) => (
                <label key={invoice.id}><FieldLabel>Счёт №{invoice.invoiceNumber} · {monthLabel(invoice.period)}</FieldLabel>
                  <Input type="number" min="0" step="0.01" inputMode="decimal" value={paymentSplits[invoice.id] ?? ""}
                    onChange={(e) => setPaymentSplits((values) => ({ ...values, [invoice.id]: e.target.value }))} placeholder="0" /></label>
              ))}</div>}
            </div>}
            <label><FieldLabel>Примечание</FieldLabel><Textarea value={paymentNote} onChange={(event) => setPaymentNote(event.target.value)} placeholder="Необязательно" /></label>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setPaymentOpen(false)}>Отмена</Button>
              <Button type="submit" disabled={busy}>{busy && <LoaderCircle className="animate-spin" />}Сохранить оплату</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={expenseOpen} onOpenChange={setExpenseOpen}>
        <DialogContent className="dialog-card max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingExpenseId === null ? "Добавить расход" : "Редактировать расход"}</DialogTitle>
            <DialogDescription>Расход попадёт во внутренний отчёт за выбранный месяц.</DialogDescription>
          </DialogHeader>
          <form onSubmit={createExpense} className="dialog-form">
            <label>
              <FieldLabel>Категория</FieldLabel>
              <Select
                value={expenseCategory}
                onValueChange={(value) => {
                  setExpenseCategory(value);
                  if (editingExpenseId === null && value === "base_lease") setExpenseAmount("20000");
                }}
              >
                <SelectTrigger className="h-11 w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {expenseCategories.map((category) => (
                    <SelectItem key={category.id} value={category.id}>{category.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label><FieldLabel>Дата</FieldLabel><Input type="date" value={expenseDate} onChange={(event) => setExpenseDate(event.target.value)} required /></label>
              <label><FieldLabel>Сумма, ₽</FieldLabel><Input type="number" min="0.01" step="0.01" inputMode="decimal" value={expenseAmount} onChange={(event) => setExpenseAmount(event.target.value)} required /></label>
            </div>
            <label>
              <FieldLabel>Способ оплаты</FieldLabel>
              <Select value={expenseMethod} onValueChange={(value) => setExpenseMethod(value as Expense["method"])}>
                <SelectTrigger className="h-11 w-full"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="bank">Безналичные</SelectItem><SelectItem value="cash">Наличные</SelectItem></SelectContent>
              </Select>
            </label>
            {offlineMode && expenseCategory === "fuel" && (
              <label><FieldLabel>Кто оплатил топливо</FieldLabel>
                <Select value={expensePayer} onValueChange={(value) => setExpensePayer(value as "self" | "customer")}>
                  <SelectTrigger className="h-11 w-full"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="self">Я — собственный расход</SelectItem><SelectItem value="customer">Заказчик — вычесть из аренды</SelectItem></SelectContent>
                </Select>
                <p className="help-note">Выбирайте заказчика только для суммы, которую нужно зачесть в оплату аренды. Разделённую оплату внесите двумя записями.</p>
              </label>
            )}
            <label><FieldLabel>Документ</FieldLabel><Input value={expenseDocument} onChange={(event) => setExpenseDocument(event.target.value)} placeholder="Чек, заказ-наряд или платёжка" /></label>
            <label><FieldLabel>Примечание</FieldLabel><Textarea value={expenseNote} onChange={(event) => setExpenseNote(event.target.value)} placeholder="Необязательно" /></label>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setExpenseOpen(false)}>Отмена</Button>
              <Button type="submit" disabled={busy}>{busy && <LoaderCircle className="animate-spin" />}Сохранить расход</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={expenseCategoriesOpen} onOpenChange={setExpenseCategoriesOpen}>
        <DialogContent className="dialog-card max-h-[92vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Категории расходов</DialogTitle>
            <DialogDescription>Категории можно переименовывать, добавлять и удалять. Изменения появятся в фильтре и при добавлении расхода.</DialogDescription>
          </DialogHeader>
          <form onSubmit={saveExpenseCategories} className="dialog-form">
            <div className="expense-category-editor">
              {expenseCategoriesDraft.map((category) => (
                <div className="expense-category-edit-row" key={category.id}>
                  <label>
                    <span>{category.builtIn ? "Готовая категория" : "Своя категория"}</span>
                    <Input
                      value={category.name}
                      maxLength={36}
                      onChange={(event) => setExpenseCategoriesDraft((categories) => categories.map((item) => (
                        item.id === category.id ? { ...item, name: event.target.value } : item
                      )))}
                      aria-label={`Название категории ${category.name}`}
                      required
                    />
                  </label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => removeExpenseCategory(category)}
                    disabled={expenseCategoriesDraft.length <= 1}
                    aria-label={`Удалить категорию ${category.name}`}
                  >
                    <Trash2 />
                  </Button>
                </div>
              ))}
            </div>
            <Button type="button" variant="outline" onClick={addExpenseCategory} className="w-full">
              <Plus />Добавить свою категорию
            </Button>
            <p className="help-note">
              Удалённая категория исчезнет из фильтра. Если в ней есть расходы, они сохранятся и перейдут в категорию «{expenseCategoriesDraft.find((category) => category.id === "other")?.name ?? expenseCategoriesDraft[0]?.name ?? "оставшаяся"}».
            </p>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setExpenseCategoriesOpen(false)}>Отмена</Button>
              <Button type="submit" disabled={busy}>{busy && <LoaderCircle className="animate-spin" />}Сохранить категории</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="dialog-card sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Настройки расчёта</DialogTitle>
            <DialogDescription>Здесь можно изменить постоянную часть, контрольный объём и ставку за единицу.</DialogDescription>
          </DialogHeader>
          <form onSubmit={saveSettings} className="dialog-form">
            <div className="settings-section theme-settings-row">
              <div>
                <strong>Оформление</strong>
                <p>Светлое, тёмное или как в настройках телефона.</p>
              </div>
              <div className="theme-settings-control">
                <MonitorSmartphone aria-hidden="true" />
                <Select value={themeMode} onValueChange={(value) => changeTheme(value as ThemeMode)}>
                  <SelectTrigger className="theme-mode-select" aria-label="Тема приложения"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="system">Как на телефоне</SelectItem>
                    <SelectItem value="light">Светлая</SelectItem>
                    <SelectItem value="dark">Тёмная</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="settings-section expense-shortcuts-settings">
              <strong>Быстрые кнопки расходов</strong>
              <p className="help-note">Настройте название, категорию, плательщика и сумму для быстрого ввода.</p>
              {expenseShortcutsDraft.map((shortcut, index) => <div key={shortcut.id} className="expense-shortcut-editor">
                <div className="expense-shortcut-editor-heading"><strong>{shortcut.title || `Кнопка № ${index + 1}`}</strong>
                  <Button type="button" variant="ghost" size="icon" aria-label={`Удалить быструю кнопку № ${index + 1}`} onClick={() => setExpenseShortcutsDraft((items) => items.filter((item) => item.id !== shortcut.id))}><Trash2 /></Button>
                </div>
                <div className="expense-shortcut-fields">
                  <label><FieldLabel>Название кнопки</FieldLabel><Input value={shortcut.title} maxLength={40} onChange={(event) => updateExpenseShortcut(shortcut.id, { title: event.target.value })} /></label>
                  <label><FieldLabel>Категория</FieldLabel><select value={shortcut.category} onChange={(event) => updateExpenseShortcut(shortcut.id, { category: event.target.value, payer: event.target.value === "fuel" ? shortcut.payer : "self" })}>
                    {expenseCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                  </select></label>
                  <label><FieldLabel>Кто оплатил</FieldLabel><select value={shortcut.payer} onChange={(event) => updateExpenseShortcut(shortcut.id, { payer: event.target.value as ExpenseShortcut["payer"] })}>
                    <option value="self">Оплатил я</option>{shortcut.category === "fuel" && <option value="customer">Оплатил заказчик</option>}
                  </select></label>
                  <label><FieldLabel>Сумма, ₽</FieldLabel><Input type="number" min="0" step="0.01" inputMode="decimal" value={shortcut.amountKopecks / 100} onChange={(event) => updateExpenseShortcut(shortcut.id, { amountKopecks: Math.round(Number(event.target.value) * 100) })} /></label>
                </div>
              </div>)}
              {expenseShortcutsDraft.length === 0 && <p className="help-note">Быстрых кнопок пока нет.</p>}
              <p className="help-note">Сумма 0 — при добавлении расхода сумма вводится вручную. Можно создать до 8 кнопок.</p>
              <Button type="button" variant="outline" onClick={addExpenseShortcut} disabled={expenseShortcutsDraft.length >= 8 || !expenseCategories.length}><Plus />Добавить кнопку</Button>
              <Button type="button" onClick={() => void saveExpenseShortcuts()} disabled={busy}>Сохранить быстрые кнопки</Button>
            </div>

            <div className="settings-section">
              <strong>Условия аренды</strong>
              <label><FieldLabel>Постоянная часть за полный месяц, ₽</FieldLabel><Input type="number" min="0.01" step="0.01" inputMode="decimal" value={settingsDraft.baseKopecks / 100} onChange={(event) => setSettingsDraft((value) => ({ ...value, baseKopecks: Math.round(Number(event.target.value) * 100) }))} required /></label>
              <div className="grid grid-cols-2 gap-3">
                <label><FieldLabel>Контрольный объём, ед.</FieldLabel><Input type="number" min="0" step="1" inputMode="numeric" value={settingsDraft.includedUnits} onChange={(event) => setSettingsDraft((value) => ({ ...value, includedUnits: Number(event.target.value) }))} required /></label>
                <label><FieldLabel>Ставка за единицу, ₽</FieldLabel><Input type="number" min="0" step="0.01" inputMode="decimal" value={settingsDraft.rateKopecks / 100} onChange={(event) => setSettingsDraft((value) => ({ ...value, rateKopecks: Math.round(Number(event.target.value) * 100) }))} required /></label>
              </div>
              <p className="help-note">Итог месяца — большая из сумм: постоянная часть с учётом простоя или количество × ставка. Переменная часть равна положительной разнице между ними.</p>
            </div>

            <div className="settings-section">
              <strong>Данные для текста счёта</strong>
              <p className="help-note">Заполните реквизиты сторон и автомобиля один раз. Они сохранятся только на этом телефоне и будут подставляться в акты и PDF.</p>
              <div className="grid grid-cols-2 gap-3">
                <label><FieldLabel>Номер договора</FieldLabel><Input value={settingsDraft.contractNumber} onChange={(event) => setSettingsDraft((value) => ({ ...value, contractNumber: event.target.value }))} required /></label>
                <label><FieldLabel>Дата договора</FieldLabel><Input type="date" value={settingsDraft.contractDate} onChange={(event) => setSettingsDraft((value) => ({ ...value, contractDate: event.target.value }))} required /></label>
              </div>
              <label><FieldLabel>Автомобиль</FieldLabel><Input value={settingsDraft.vehicleModel} onChange={(event) => setSettingsDraft((value) => ({ ...value, vehicleModel: event.target.value }))} placeholder="Например, Fiat Ducato" required /></label>
              <label><FieldLabel>VIN</FieldLabel><Input value={settingsDraft.vehicleVin} onChange={(event) => setSettingsDraft((value) => ({ ...value, vehicleVin: event.target.value }))} required /></label>
              <div className="grid grid-cols-2 gap-3">
                <label><FieldLabel>Начало аренды</FieldLabel><Input type="date" value={settingsDraft.rentalStart} onChange={(event) => setSettingsDraft((value) => ({ ...value, rentalStart: event.target.value }))} required /></label>
                <label><FieldLabel>Конец аренды</FieldLabel><Input type="date" value={settingsDraft.rentalEnd} onChange={(event) => setSettingsDraft((value) => ({ ...value, rentalEnd: event.target.value }))} required /></label>
              </div>
              <label><FieldLabel>Арендодатель</FieldLabel><Input value={settingsDraft.lessorFull} onChange={(event) => setSettingsDraft((value) => ({ ...value, lessorFull: event.target.value }))} required /></label>
              <label><FieldLabel>Арендодатель кратко для подписи</FieldLabel><Input value={settingsDraft.lessorShort} onChange={(event) => setSettingsDraft((value) => ({ ...value, lessorShort: event.target.value }))} required /></label>
              <label><FieldLabel>Арендодатель в тексте сверки («перед кем»)</FieldLabel><Input value={settingsDraft.lessorDative} onChange={(event) => setSettingsDraft((value) => ({ ...value, lessorDative: event.target.value }))} required /></label>
              <label><FieldLabel>Расшифровка подписи арендодателя</FieldLabel><Input value={settingsDraft.lessorSignerShort} onChange={(event) => setSettingsDraft((value) => ({ ...value, lessorSignerShort: event.target.value }))} required /></label>
              <label><FieldLabel>ИНН арендодателя</FieldLabel><Input value={settingsDraft.lessorInn} onChange={(event) => setSettingsDraft((value) => ({ ...value, lessorInn: event.target.value }))} required /></label>
              <label><FieldLabel>Арендатор</FieldLabel><Input value={settingsDraft.lesseeFull} onChange={(event) => setSettingsDraft((value) => ({ ...value, lesseeFull: event.target.value }))} required /></label>
              <label><FieldLabel>Арендатор кратко для подписи</FieldLabel><Input value={settingsDraft.lesseeShort} onChange={(event) => setSettingsDraft((value) => ({ ...value, lesseeShort: event.target.value }))} required /></label>
              <div className="grid grid-cols-2 gap-3">
                <label><FieldLabel>ИНН арендатора</FieldLabel><Input value={settingsDraft.lesseeInn} onChange={(event) => setSettingsDraft((value) => ({ ...value, lesseeInn: event.target.value }))} required /></label>
                <label><FieldLabel>КПП</FieldLabel><Input value={settingsDraft.lesseeKpp} onChange={(event) => setSettingsDraft((value) => ({ ...value, lesseeKpp: event.target.value }))} required /></label>
              </div>
              <label><FieldLabel>Генеральный директор для текста «в лице…» (кого?)</FieldLabel><Input value={settingsDraft.lesseeDirector} onChange={(event) => setSettingsDraft((value) => ({ ...value, lesseeDirector: event.target.value }))} placeholder="Иванова Ивана Ивановича" required /></label>
              <label><FieldLabel>Расшифровка подписи директора</FieldLabel><Input value={settingsDraft.lesseeDirectorShort} onChange={(event) => setSettingsDraft((value) => ({ ...value, lesseeDirectorShort: event.target.value }))} required /></label>
              <div className="grid grid-cols-2 gap-3">
                <label><FieldLabel>Год автомобиля</FieldLabel><Input value={settingsDraft.vehicleYear} onChange={(event) => setSettingsDraft((value) => ({ ...value, vehicleYear: event.target.value }))} required /></label>
                <label><FieldLabel>Госномер</FieldLabel><Input value={settingsDraft.vehiclePlate} onChange={(event) => setSettingsDraft((value) => ({ ...value, vehiclePlate: event.target.value }))} required /></label>
              </div>
              <label><FieldLabel>НДС</FieldLabel><Input value={settingsDraft.vatLabel} onChange={(event) => setSettingsDraft((value) => ({ ...value, vatLabel: event.target.value }))} required /></label>
              <label><FieldLabel>Город</FieldLabel><Input value={settingsDraft.city} onChange={(event) => setSettingsDraft((value) => ({ ...value, city: event.target.value }))} required /></label>
              <p className="help-note">Эти данные хранятся только на телефоне и автоматически подставляются в тексты для банка и письма.</p>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setSettingsOpen(false)}>Отмена</Button>
              <Button type="submit" disabled={busy}>{busy && <LoaderCircle className="animate-spin" />}Сохранить настройки</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={downtimeOpen} onOpenChange={setDowntimeOpen}>
        <DialogContent className="dialog-card">
          <DialogHeader>
            <DialogTitle>{editingDowntimeId === null ? "Добавить простой" : "Редактировать простой"}</DialogTitle>
            <DialogDescription>Укажите полные календарные дни и подтверждение неисправности.</DialogDescription>
          </DialogHeader>
          <form onSubmit={saveDowntime} className="dialog-form">
            <div className="grid grid-cols-2 gap-3">
              <label><FieldLabel>Начало</FieldLabel><Input type="date" value={downtimeStart} onChange={(event) => setDowntimeStart(event.target.value)} required /></label>
              <label><FieldLabel>Окончание</FieldLabel><Input type="date" value={downtimeEnd} onChange={(event) => setDowntimeEnd(event.target.value)} required /></label>
            </div>
            <label><FieldLabel>Описание неисправности</FieldLabel><Input value={downtimeReason} onChange={(event) => setDowntimeReason(event.target.value)} required /></label>
            <label><FieldLabel>Основание / подтверждение</FieldLabel><Input value={downtimeBasis} onChange={(event) => setDowntimeBasis(event.target.value)} placeholder="Заказ-наряд, акт диагностики, переписка" required /></label>
            <label><FieldLabel>Примечание</FieldLabel><Textarea value={downtimeNote} onChange={(event) => setDowntimeNote(event.target.value)} /></label>
            <p className="help-note">Полные дни подтверждённого простоя уменьшают постоянную часть пропорционально дням месяца.</p>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDowntimeOpen(false)}>Отмена</Button>
              <Button type="submit" disabled={busy}>{busy && <LoaderCircle className="animate-spin" />}Сохранить</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(confirm)} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm?.title}</AlertDialogTitle>
            <AlertDialogDescription>{confirm?.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              variant={confirm?.destructive ? "destructive" : "default"}
              disabled={busy}
              onClick={async () => {
                const action = confirm?.run;
                setConfirm(null);
                if (action) await action();
              }}
            >
              {confirm?.actionLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
