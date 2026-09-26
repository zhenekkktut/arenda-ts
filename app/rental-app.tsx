"use client";

import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Banknote,
  CalendarDays,
  Calculator,
  CarFront,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  FileSpreadsheet,
  FileText,
  Fuel,
  LoaderCircle,
  LockKeyhole,
  Moon,
  Plus,
  Pencil,
  CirclePause,
  ReceiptText,
  Smartphone,
  Settings,
  SlidersHorizontal,
  Sun,
  Trash2,
  UnlockKeyhole,
  Upload,
  WalletCards,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
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
  buildDocumentPackageHtml,
  buildReconciliationHtml,
  buildRentActHtml,
  calculateRental,
  defaultDocumentMeta,
  DEFAULT_DOCUMENT_SETTINGS,
  periodBounds,
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
  amountKopecks: number;
  dueDate: string | null;
  note: string;
};

type Payment = {
  id: number;
  invoiceId: number;
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
  expenses: Expense[];
  expenseCategories?: ExpenseCategory[];
  closure: Closure | null;
  rules: {
    baseKopecks: number;
    includedUnits: number;
    rateKopecks: number;
  };
  settings?: DocumentSettings;
  downtimes?: Downtime[];
  documentMeta?: DocumentMeta;
};

type OfflineStore = {
  version: 4;
  entries: Entry[];
  invoices: Invoice[];
  payments: Payment[];
  expenses: Expense[];
  expenseCategories: ExpenseCategory[];
  closures: Closure[];
  settings: DocumentSettings;
  downtimes: Downtime[];
  documents: DocumentMeta[];
};

type AndroidAppBridge = {
  copyText: (text: string) => void;
  saveBase64File: (base64: string, fileName: string, mimeType: string) => void;
  saveHtmlAsPdf: (html: string, fileName: string) => void;
  setTheme?: (theme: "light" | "dark") => void;
};

declare global {
  interface Window {
    AndroidApp?: AndroidAppBridge;
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
const DOCUMENT_TEXT_FIELDS = [
  "city", "contractNumber", "lessorFull", "lessorShort", "lessorSignerShort", "lessorInn",
  "lesseeFull", "lesseeShort", "lesseeInn", "lesseeKpp", "lesseeDirector",
  "lesseeDirectorShort", "vehicleModel", "vehicleVin", "vehiclePlate",
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

function emptyOfflineStore(): OfflineStore {
  return {
    version: 4,
    entries: [],
    invoices: [],
    payments: [],
    expenses: [],
    expenseCategories: normalizeExpenseCategories(undefined),
    closures: [],
    settings: normalizeDocumentSettings(undefined),
    downtimes: [],
    documents: [],
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
    version: 4,
    entries: store.entries,
    invoices: store.invoices,
    payments: store.payments,
    expenses: store.expenses,
    expenseCategories: normalizeExpenseCategories(store.expenseCategories),
    closures: store.closures,
    settings: normalizeDocumentSettings(store.settings),
    downtimes: Array.isArray(store.downtimes) ? store.downtimes : [],
    documents: Array.isArray(store.documents) ? store.documents : [],
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

function offlineDashboard(period: string): DashboardData {
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
  const expenses = store.expenses
    .filter((expense) => expense.expenseDate >= from && expense.expenseDate <= to)
    .sort((a, b) => b.expenseDate.localeCompare(a.expenseDate) || b.id - a.id);
  const downtimes = store.downtimes
    .filter((downtime) => downtime.startDate <= to && downtime.endDate >= from)
    .sort((a, b) => b.startDate.localeCompare(a.startDate) || b.id - a.id);
  const documentMeta = store.documents.find((document) => document.period === period)
    ?? defaultDocumentMeta(period, store.documents.length + 1, localIsoDate());

  return {
    entries,
    invoices,
    payments,
    expenses,
    expenseCategories: store.expenseCategories,
    closure: store.closures.find((closure) => closure.period === period) ?? null,
    rules: {
      baseKopecks: store.settings.baseKopecks,
      includedUnits: store.settings.includedUnits,
      rateKopecks: store.settings.rateKopecks,
    },
    settings: store.settings,
    downtimes,
    documentMeta,
  };
}

function saveOfflineAction(payload: Record<string, unknown>) {
  const store = readOfflineStore();
  const action = payload.action;

  if (action === "save_entry") {
    const entryDate = payload.entryDate;
    const units = Number(payload.units);
    if (!validIsoDate(entryDate) || !Number.isSafeInteger(units) || units < 0) {
      throw new Error("Проверьте дату и количество");
    }
    if (store.closures.some((closure) => closure.period === entryDate.slice(0, 7))) {
      throw new Error("Месяц закрыт. Сначала откройте его заново.");
    }
    const note = typeof payload.note === "string" ? payload.note.trim().slice(0, 300) : "";
    const existing = store.entries.find((entry) => entry.entryDate === entryDate);
    if (existing) {
      existing.units = units;
      existing.note = note;
    } else {
      store.entries.push({ id: nextId(store.entries), entryDate, units, note });
    }
  } else if (action === "import_entries") {
    if (!Array.isArray(payload.entries) || payload.entries.length === 0) {
      throw new Error("В файле нет записей для загрузки");
    }
    for (const item of payload.entries) {
      if (!item || typeof item !== "object") throw new Error("Проверьте строки файла");
      const row = item as Record<string, unknown>;
      const entryDate = row.entryDate;
      const units = Number(row.units);
      if (!validIsoDate(entryDate) || !Number.isSafeInteger(units) || units < 0) {
        throw new Error("В файле есть неверная дата или количество");
      }
      if (store.closures.some((closure) => closure.period === entryDate.slice(0, 7))) {
        throw new Error(`Нельзя изменить закрытый месяц ${entryDate.slice(0, 7)}`);
      }
      const note = typeof row.note === "string" ? row.note.trim().slice(0, 300) : "";
      const existing = store.entries.find((entry) => entry.entryDate === entryDate);
      if (existing) {
        existing.units = units;
        existing.note = note;
      } else {
        store.entries.push({ id: nextId(store.entries), entryDate, units, note });
      }
    }
  } else if (action === "delete_entry") {
    const id = Number(payload.id);
    const entry = store.entries.find((row) => row.id === id);
    if (!entry) throw new Error("Запись не найдена");
    if (store.closures.some((closure) => closure.period === entry.entryDate.slice(0, 7))) {
      throw new Error("Месяц закрыт");
    }
    store.entries = store.entries.filter((row) => row.id !== id);
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
    if (editId !== null && !store.invoices.some((row) => row.id === editId)) throw new Error("Запись не найдена");
    const recordId = editId ?? nextId(store.invoices);
    if (editId !== null) store.invoices = store.invoices.filter((row) => row.id !== editId);
    store.invoices.push({
      id: recordId,
      period: payload.period,
      invoiceNumber: payload.invoiceNumber.trim().slice(0, 60),
      invoiceDate: payload.invoiceDate,
      kind: payload.kind as Invoice["kind"],
      amountKopecks,
      dueDate,
      note: typeof payload.note === "string" ? payload.note.trim().slice(0, 300) : "",
    });
  } else if (action === "delete_invoice") {
    const id = Number(payload.id);
    store.invoices = store.invoices.filter((invoice) => invoice.id !== id);
    store.payments = store.payments.filter((payment) => payment.invoiceId !== id);
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
  } else if (action === "delete_payment") {
    const id = Number(payload.id);
    store.payments = store.payments.filter((payment) => payment.id !== id);
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
  } else if (action === "delete_expense") {
    const id = Number(payload.id);
    store.expenses = store.expenses.filter((expense) => expense.id !== id);
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
  } else if (action === "save_settings") {
    const value = payload.settings;
    if (!value || typeof value !== "object") throw new Error("Проверьте настройки договора");
    const settings = value as Partial<DocumentSettings>;
    const baseKopecks = Number(settings.baseKopecks);
    const includedUnits = Number(settings.includedUnits);
    const rateKopecks = Number(settings.rateKopecks);
    if (
      !validIsoDate(settings.contractDate) ||
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
    store.settings = {
      ...(settings as DocumentSettings),
      baseKopecks,
      includedUnits,
      rateKopecks,
    };
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
    };
    store.documents = [...store.documents.filter((item) => item.period !== period), document];
  } else if (action === "create_downtime" || action === "update_downtime") {
    const startDate = String(payload.startDate ?? "");
    const endDate = String(payload.endDate ?? "");
    if (!validIsoDate(startDate) || !validIsoDate(endDate) || startDate > endDate) {
      throw new Error("Проверьте даты простоя");
    }
    const start = new Date(`${startDate}T12:00:00Z`);
    const end = new Date(`${endDate}T12:00:00Z`);
    if ((end.getTime() - start.getTime()) / 86_400_000 > 366) {
      throw new Error("Один период простоя не может быть длиннее года");
    }
    const locked = store.closures.some((closure) => {
      const bounds = periodBounds(closure.period);
      return startDate <= bounds.end && endDate >= bounds.start;
    });
    if (locked) throw new Error("Простой затрагивает закрытый месяц");
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
      reason: String(payload.reason ?? "Простой автомобиля").trim().slice(0, 160),
      note: String(payload.note ?? "").trim().slice(0, 300),
    });
  } else if (action === "delete_downtime") {
    const id = Number(payload.id);
    const downtime = store.downtimes.find((row) => row.id === id);
    if (!downtime) throw new Error("Период простоя не найден");
    const locked = store.closures.some((closure) => {
      const bounds = periodBounds(closure.period);
      return downtime.startDate <= bounds.end && downtime.endDate >= bounds.start;
    });
    if (locked) throw new Error("Простой относится к закрытому месяцу");
    store.downtimes = store.downtimes.filter((row) => row.id !== id);
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
  } else if (action === "reopen_month") {
    const period = String(payload.period ?? "");
    store.closures = store.closures.filter((closure) => closure.period !== period);
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
  return `${part} за ${documentPeriod(invoice.period)} по договору аренды транспортного средства без экипажа № ${settings.contractNumber} от ${dateLabel(settings.contractDate)}, автомобиль ${settings.vehicleModel}, VIN ${settings.vehicleVin}.`;
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
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [theme, setTheme] = useState<"light" | "dark">("light");

  const [entryDate, setEntryDate] = useState(today);
  const entryUnitsRef = useRef<HTMLInputElement>(null);
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
  const [invoiceDate, setInvoiceDate] = useState(today);
  const [invoiceDueDate, setInvoiceDueDate] = useState("");
  const [invoiceAmount, setInvoiceAmount] = useState("80000");
  const [invoiceNote, setInvoiceNote] = useState("");

  const [editingPaymentId, setEditingPaymentId] = useState<number | null>(null);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentInvoiceId, setPaymentInvoiceId] = useState<number | null>(null);
  const [paymentDate, setPaymentDate] = useState(today);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<Payment["method"]>("bank");
  const [paymentDocument, setPaymentDocument] = useState("");
  const [paymentNote, setPaymentNote] = useState("");

  const [editingExpenseId, setEditingExpenseId] = useState<number | null>(null);
  const [expenseFilter, setExpenseFilter] = useState<string>("all");
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [expenseCategoriesOpen, setExpenseCategoriesOpen] = useState(false);
  const [expenseCategoriesDraft, setExpenseCategoriesDraft] = useState<ExpenseCategory[]>(() => normalizeExpenseCategories(undefined));
  const [expenseDate, setExpenseDate] = useState(today);
  const [expenseCategory, setExpenseCategory] = useState("base_lease");
  const [expenseAmount, setExpenseAmount] = useState("20000");
  const [expenseMethod, setExpenseMethod] = useState<Expense["method"]>("bank");
  const [expenseDocument, setExpenseDocument] = useState("");
  const [expenseNote, setExpenseNote] = useState("");

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState<DocumentSettings>({ ...DEFAULT_DOCUMENT_SETTINGS });
  const [actNumber, setActNumber] = useState("1");
  const [reconciliationNumber, setReconciliationNumber] = useState("1");
  const [documentDate, setDocumentDate] = useState(today);
  const [documentBasis, setDocumentBasis] = useState("");
  const [openingBalance, setOpeningBalance] = useState("0");

  const [downtimeOpen, setDowntimeOpen] = useState(false);
  const [editingDowntimeId, setEditingDowntimeId] = useState<number | null>(null);
  const [downtimeStart, setDowntimeStart] = useState(today);
  const [downtimeEnd, setDowntimeEnd] = useState(today);

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
    const nextTheme = savedTheme === "dark" ? "dark" : "light";
    applyTheme(nextTheme);
    const timer = window.setTimeout(() => setTheme(nextTheme), 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!data) return;
    const meta = data.documentMeta ?? defaultDocumentMeta(month, 1, today);
    setSettingsDraft({ ...(data.settings ?? DEFAULT_DOCUMENT_SETTINGS) });
    setActNumber(meta.actNumber);
    setReconciliationNumber(meta.reconciliationNumber);
    setDocumentDate(meta.documentDate);
    setDocumentBasis(meta.basis);
    setOpeningBalance(String(meta.openingBalanceKopecks / 100));
  }, [data, month, today]);

  const request = useCallback(
    async (payload: Record<string, unknown>, success: string) => {
      setBusy(true);
      try {
        if (isOfflineRuntime()) {
          saveOfflineAction(payload);
          toast.success(success);
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
        toast.success(success);
        await loadData();
        return true;
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Не удалось сохранить");
        return false;
      } finally {
        setBusy(false);
      }
    },
    [loadData],
  );

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
  // Закрытие месяца блокирует редактирование, но расчёт всегда строится по
  // действующей договорной формуле. Так старые сохранённые итоги не сохраняют
  // ошибочную логику после обновления приложения.
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
  const customerFuel = data?.expenses.filter((e) => e.category === "fuel" && e.payer === "customer").reduce((sum, e) => sum + e.amountKopecks, 0) ?? 0;
  const selfExpenses = totalExpenses - customerFuel;
  const fixedInvoiced = data?.invoices.filter((invoice) => invoice.kind === "fixed").reduce((sum, invoice) => sum + invoice.amountKopecks, 0) ?? 0;
  const variableInvoiced = data?.invoices.filter((invoice) => invoice.kind === "variable").reduce((sum, invoice) => sum + invoice.amountKopecks, 0) ?? 0;
  const fixedTargetKopecks = Math.max(0, calculation.baseKopecks - customerFuel);
  const fixedRemainingKopecks = Math.max(0, fixedTargetKopecks - fixedInvoiced);
  const variableRemainingKopecks = Math.max(0, calculation.variableKopecks - variableInvoiced);
  const filteredExpenses = data?.expenses.filter((expense) => expenseFilter === "all" || expense.category === expenseFilter) ?? [];
  const filteredExpenseTotal = filteredExpenses.reduce((sum, expense) => sum + expense.amountKopecks, 0);
  const filteredCustomerFuel = filteredExpenses.filter((expense) => expense.category === "fuel" && expense.payer === "customer").reduce((sum, expense) => sum + expense.amountKopecks, 0);
  const filteredSelfFuel = filteredExpenses.filter((expense) => expense.category === "fuel" && expense.payer !== "customer").reduce((sum, expense) => sum + expense.amountKopecks, 0);
  const netRent = Math.max(0, calculation.totalKopecks - customerFuel);
  const remainingToInvoice = Math.max(0, netRent - totalInvoiced);
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
  const currentWeekStart = weekStart(entryDate);
  const currentWeekDays = useMemo(() => {
    const entriesByDate = new Map((data?.entries ?? []).map((entry) => [entry.entryDate, entry]));
    return Array.from({ length: 7 }, (_, index) => {
      const date = addIsoDays(currentWeekStart, index);
      return {
        date,
        inMonth: date.slice(0, 7) === month,
        entry: entriesByDate.get(date),
      };
    });
  }, [currentWeekStart, data?.entries, month]);
  const weekUnits = currentWeekDays.reduce((sum, day) => sum + (day.entry?.units ?? 0), 0);
  const weekAmountKopecks = weekUnits * documentSettings.rateKopecks;
  const weekEntries = currentWeekDays
    .flatMap((day) => day.entry ? [day.entry] : [])
    .sort((a, b) => b.entryDate.localeCompare(a.entryDate));
  const monthBounds = periodBounds(month);
  const canGoToPreviousWeek = addIsoDays(entryDate, -7) >= monthBounds.start;
  const canGoToNextWeek = addIsoDays(entryDate, 7) <= monthBounds.end;

  function selectEntryDate(nextDate: string) {
    const existing = data?.entries.find((entry) => entry.entryDate === nextDate);
    setEntryDate(nextDate);
    setEntryUnits(existing ? String(existing.units) : "");
    setEntryNote(existing?.note ?? "");
  }

  function moveEntryWeek(offset: -1 | 1) {
    const nextDate = addIsoDays(entryDate, offset * 7);
    if (nextDate < monthBounds.start || nextDate > monthBounds.end) return;
    selectEntryDate(nextDate);
  }

  function toggleTheme() {
    const nextTheme = theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
    window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    applyTheme(nextTheme);
  }

  async function saveEntry(event: FormEvent) {
    event.preventDefault();
    const units = Number(entryUnits);
    if (!Number.isInteger(units) || units < 0) {
      toast.error("Введите количество целым числом");
      return;
    }
    const ok = await request(
      { action: "save_entry", entryDate, units, note: entryNote },
      `Записано: ${number(units)} бутылок`,
    );
    if (ok) {
      const followingDate = nextIsoDate(entryDate);
      setEntryUnits("");
      setEntryNote("");
      if (followingDate.slice(0, 7) === month) selectEntryDate(followingDate);
      window.requestAnimationFrame(() => entryUnitsRef.current?.focus());
    }
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
    const selectedDate = month === today.slice(0, 7) ? today : `${month}-01`;
    const kind = requestedKind ?? (
      fixedRemainingKopecks > 0
        ? "fixed"
        : data?.closure && variableRemainingKopecks > 0 && remainingToInvoice > 0
          ? "variable"
          : "fixed"
    );
    const suggestedAmount = kind === "fixed"
      ? Math.min(fixedRemainingKopecks || calculation.baseKopecks, remainingToInvoice || calculation.baseKopecks)
      : kind === "variable"
        ? Math.min(variableRemainingKopecks, remainingToInvoice || variableRemainingKopecks)
        : remainingToInvoice;
    setInvoiceKind(kind);
    setInvoiceAmount(suggestedAmount > 0 ? String(suggestedAmount / 100) : "");
    setInvoiceNumber("");
    setInvoiceDate(selectedDate);
    setInvoiceDueDate("");
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
        amountKopecks,
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
    const ok = await request(
      {
        action: editingPaymentId === null ? "create_payment" : "update_payment",
        id: editingPaymentId,
        invoiceId: paymentInvoiceId,
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
    setInvoiceKind(invoice.kind); setInvoiceNumber(invoice.invoiceNumber);
    setInvoiceDate(invoice.invoiceDate); setInvoiceDueDate(invoice.dueDate ?? "");
    setInvoiceAmount(String(invoice.amountKopecks / 100)); setInvoiceNote(invoice.note);
    setInvoiceOpen(true);
  }

  function editPayment(payment: Payment) {
    setEditingPaymentId(payment.id); setPaymentInvoiceId(payment.invoiceId);
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
    setSettingsOpen(true);
  }

  async function saveSettings(event: FormEvent) {
    event.preventDefault();
    const ok = await request(
      { action: "save_settings", settings: settingsDraft },
      "Настройки расчёта сохранены",
    );
    if (ok) setSettingsOpen(false);
  }

  function openDowntime(downtime?: Downtime) {
    const bounds = periodBounds(month);
    const selectedDate = month === today.slice(0, 7) ? today : bounds.start;
    setEditingDowntimeId(downtime?.id ?? null);
    setDowntimeStart(downtime?.startDate ?? selectedDate);
    setDowntimeEnd(downtime?.endDate ?? selectedDate);
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
        reason: "Простой автомобиля",
        note: "",
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
        await request({ action: "delete_downtime", id: downtime.id }, "Простой удалён");
      },
    });
  }

  function currentDocumentMeta() {
    const openingBalanceKopecks = toSignedKopecks(openingBalance);
    if (openingBalanceKopecks === null) {
      toast.error("Проверьте начальное сальдо");
      return null;
    }
    if (!actNumber.trim() || !reconciliationNumber.trim() || !validIsoDate(documentDate)) {
      toast.error("Заполните номера и дату документов");
      return null;
    }
    return {
      period: month,
      actNumber: actNumber.trim(),
      reconciliationNumber: reconciliationNumber.trim(),
      documentDate,
      basis: documentBasis.trim(),
      openingBalanceKopecks,
    } satisfies DocumentMeta;
  }

  async function saveDocumentParameters() {
    const meta = currentDocumentMeta();
    if (!meta) return false;
    return request({ action: "save_document_meta", ...meta }, "Параметры документов сохранены");
  }

  async function saveOfficialPdf(kind: "act" | "reconciliation" | "package") {
    if (!data) return;
    const meta = currentDocumentMeta();
    if (!meta) return;

    try {
      if (isOfflineRuntime()) saveOfflineAction({ action: "save_document_meta", ...meta });
      const input = {
        settings: documentSettings,
        meta,
        calculation,
        downtimes: data.downtimes ?? [],
        invoices: data.invoices,
        payments: data.payments,
        expenses: data.expenses,
      };
      const html = kind === "act"
        ? buildRentActHtml(input)
        : kind === "reconciliation"
          ? buildReconciliationHtml(input)
          : buildDocumentPackageHtml(input);
      const fileName = kind === "act"
        ? `akt_arendy_${month}.pdf`
        : kind === "reconciliation"
          ? `akt_sverki_${month}.pdf`
          : `dokumenty_arendy_${month}.pdf`;

      const androidSave = Boolean(window.AndroidApp?.saveHtmlAsPdf);
      if (androidSave) {
        window.AndroidApp?.saveHtmlAsPdf?.(html, fileName);
      } else {
        printHtmlInBrowser(html);
      }
      await loadData();
      if (!androidSave) {
        toast.success(kind === "package" ? "Пакет открыт для печати" : "Документ открыт для печати");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось сформировать PDF");
    }
  }

  function askDeleteEntry(entry: Entry) {
    setConfirm({
      title: "Удалить запись?",
      description: `${dateLabel(entry.entryDate)} · ${number(entry.units)} ед.`,
      actionLabel: "Удалить",
      destructive: true,
      run: async () => {
        await request(
          { action: "delete_entry", id: entry.id, entryDate: entry.entryDate },
          "Запись удалена",
        );
      },
    });
  }

  function askDeleteInvoice(invoice: Invoice) {
    setConfirm({
      title: `Удалить счёт №${invoice.invoiceNumber}?`,
      description: "Все связанные с ним оплаты тоже будут удалены.",
      actionLabel: "Удалить счёт",
      destructive: true,
      run: async () => {
        await request({ action: "delete_invoice", id: invoice.id }, "Счёт удалён");
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
        await request({ action: "delete_payment", id: payment.id }, "Оплата удалена");
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
        await request({ action: "delete_expense", id: expense.id }, "Расход удалён");
      },
    });
  }

  function askCloseMonth() {
    setConfirm({
      title: `Закрыть ${monthLabel(month).toLowerCase()}?`,
      description: `Итог аренды будет зафиксирован: ${money(calculation.totalKopecks)}. Записи интенсивности нельзя будет менять до повторного открытия месяца.`,
      actionLabel: "Закрыть месяц",
      run: async () => {
        await request({ action: "close_month", period: month }, "Месяц закрыт");
      },
    });
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
        ["Аренда после вычета топлива, ₽", netRent / 100],
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
          "Сумма, ₽",
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
        ["ИТОГО", "", "", totalInvoiced / 100, totalPaid / 100, Math.max(0, totalInvoiced - totalPaid) / 100, "", "", "", "", "", "", "", "", ""],
      ];
      const invoicesSheet = XLSX.utils.aoa_to_sheet(invoiceRows);
      invoicesSheet["!cols"] = [
        { wch: 14 }, { wch: 14 }, { wch: 24 }, { wch: 15 }, { wch: 15 },
        { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 20 }, { wch: 24 }, { wch: 38 },
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
      writeOfflineStore(store);
      await loadData();
      toast.success("Данные восстановлены");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось восстановить данные");
    }
  }

  function settlementDetails() {
    return <div className="settlement-details">
      <div className="calculation-list mt-3">
        <div><span>Аренда по договору</span><strong>{money(calculation.totalKopecks)}</strong></div>
        <div><span>Минус топливо заказчика</span><strong>{money(customerFuel)}</strong></div>
        <div><span>К выставлению после топлива</span><strong>{money(netRent)}</strong></div>
        <div><span>Уже выставлено</span><strong>{money(totalInvoiced)}</strong></div>
        <div className="calculation-total"><span>Осталось выставить</span><strong>{money(remainingToInvoice)}</strong></div>
      </div>
      {customerFuel > calculation.totalKopecks && <p className="help-note">Топливо превышает начисление на {money(customerFuel - calculation.totalKopecks)}. Перенос на другой месяц не выполняется автоматически.</p>}
      {totalInvoiced > netRent && <p className="help-note">Выставлено больше расчётной суммы на {money(totalInvoiced - netRent)}. Проверьте ранее выставленные счета.</p>}
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
            <Button
              type="button"
              variant="ghost"
              className="theme-button"
              onClick={toggleTheme}
              aria-label={theme === "dark" ? "Включить светлую тему" : "Включить тёмную тему"}
              title={theme === "dark" ? "Светлая тема" : "Тёмная тема"}
            >
              {theme === "dark" ? <Sun className="size-5" /> : <Moon className="size-5" />}
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
          <Input
            type="month"
            value={month}
            onChange={(event) => {
              const nextMonth = event.target.value;
              setMonth(nextMonth);
              selectEntryDate(nextMonth === today.slice(0, 7) ? today : `${nextMonth}-01`);
            }}
            className="h-11 w-[155px] border-slate-200 bg-white text-base font-semibold"
            aria-label="Месяц"
          />
        </section>

        {data && !loading && !loadError && (tab === "summary" || tab === "entries") && (
          <section className="panel quick-entry quick-entry-primary">
            {data.closure ? (
              <div className="locked-note">
                <LockKeyhole className="size-5" />
                Месяц закрыт — новые записи недоступны.
              </div>
            ) : (
              <form onSubmit={saveEntry} className="fast-entry-form">
                <div className="fast-entry-meta">
                  <strong className="quick-entry-title">Быстрая запись</strong>
                  {selectedEntry && <span className="entry-existing-chip">Запись есть</span>}
                </div>

                <div className="fast-entry-date-row">
                  <label className="fast-entry-date-control">
                    <FieldLabel>Дата</FieldLabel>
                    <Input
                      className="fast-entry-date-input"
                      type="date"
                      value={entryDate}
                      min={monthBounds.start}
                      max={monthBounds.end}
                      onChange={(event) => selectEntryDate(event.target.value)}
                      aria-label="Дата доставки"
                      required
                    />
                  </label>
                </div>

                <div className="fast-entry-quantity">
                  <FieldLabel>Количество бутылок</FieldLabel>
                  <div className="fast-entry-row">
                    <Input
                      ref={entryUnitsRef}
                      type="number"
                      min="0"
                      step="1"
                      inputMode="numeric"
                      enterKeyHint="done"
                      autoComplete="off"
                      placeholder="Сколько бутылок"
                      aria-label="Количество бутылок"
                      value={entryUnits}
                      onChange={(event) => setEntryUnits(event.target.value)}
                      onFocus={(event) => event.currentTarget.select()}
                      required
                    />
                    <Button type="submit" disabled={busy || !entryUnits}>
                      {busy ? <LoaderCircle className="animate-spin" /> : selectedEntry ? <Pencil /> : <Plus />}
                      {selectedEntry ? "Обновить" : "Записать"}
                    </Button>
                  </div>
                </div>
              </form>
            )}
          </section>
        )}

        <Tabs
          value={tab}
          onValueChange={(value) => {
            setTab(value);
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
          className="modern-tabs mt-4 gap-4"
        >
          <TabsList className="app-tabs grid h-auto w-full grid-cols-4 bg-transparent p-0" aria-label="Разделы приложения">
            <TabsTrigger value="summary" className="app-tab">
              <Calculator />
              <span>Главная</span>
            </TabsTrigger>
            <TabsTrigger value="entries" className="app-tab">
              <CalendarDays />
              <span>Дни</span>
            </TabsTrigger>
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
                <section className="summary-grid">
                  <article className="money-card money-card-main">
                    <span>К выставлению</span>
                    <strong>{money(netRent)}</strong>
                    <small>после учёта топлива заказчика</small>
                  </article>
                  <article className="money-card">
                    <span>Выставлено</span>
                    <strong>{money(totalInvoiced)}</strong>
                  </article>
                  <article className="money-card">
                    <span>Остаток</span>
                    <strong className={remainingToInvoice > 0 ? "text-amber-700" : "text-emerald-700"}>{money(remainingToInvoice)}</strong>
                  </article>
                </section>
                <Button type="button" variant="outline" className="summary-details-button" onClick={() => setSettlementOpen(true)}>
                  <Calculator />Расчёт подробнее
                </Button>

                <section className="dashboard-actions" aria-label="Быстрые действия">
                  <button type="button" onClick={() => openInvoice()}>
                    <span><ReceiptText /></span>
                    <strong>Новый счёт</strong>
                  </button>
                  <button type="button" onClick={openExpense}>
                    <span><WalletCards /></span>
                    <strong>Расход</strong>
                  </button>
                  <button type="button" onClick={() => offlineMode ? openDowntime() : void exportExcel()}>
                    <span>{offlineMode ? <CirclePause /> : <FileSpreadsheet />}</span>
                    <strong>{offlineMode ? "Простой" : "Выгрузить Excel"}</strong>
                  </button>
                </section>

                <section className="panel">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <span className="eyebrow">Интенсивность эксплуатации</span>
                      <div className="mt-1 flex items-baseline gap-2">
                        <strong className="text-3xl tracking-tight">{number(calculation.actualUnits)}</strong>
                        <span className="text-muted-foreground">из {number(calculation.includedUnits)} ед.</span>
                      </div>
                    </div>
                    {data.closure ? (
                      <Badge className="status-closed"><LockKeyhole />Закрыт</Badge>
                    ) : (
                      <Badge variant="outline" className="status-open">Открыт</Badge>
                    )}
                  </div>
                  <Progress value={progress} className="mt-4 h-3 bg-slate-100 [&_[data-slot=progress-indicator]]:bg-amber-500" />
                  <div className="calculation-list mt-5">
                    <div><span>Постоянная часть за полный месяц</span><strong>{money(calculation.baseFullKopecks)}</strong></div>
                    {calculation.downtimeDays > 0 && <>
                      <div><span>Простой автомобиля</span><strong>{calculation.downtimeDays} дн.</strong></div>
                      {calculation.baseReductionKopecks > 0 && <div><span>Уменьшение за простой</span><strong>-{money(calculation.baseReductionKopecks)}</strong></div>}
                    </>}
                    <div><span>Постоянная часть Ф</span><strong>{money(calculation.baseKopecks)}</strong></div>
                    <div><span>{number(calculation.actualUnits)} × {money(calculation.rateKopecks)}</span><strong>{money(calculation.intensityKopecks)}</strong></div>
                    <div className="calculation-total"><span>Переменная часть</span><strong>{money(calculation.variableKopecks)}</strong></div>
                  </div>
                </section>

                {offlineMode && (
                  <section className="panel downtime-panel">
                    <div className="section-heading">
                      <div>
                        <span className="eyebrow">Уменьшение аренды</span>
                        <h2>Простой автомобиля</h2>
                      </div>
                      <Button type="button" variant="outline" size="sm" onClick={() => openDowntime()} disabled={Boolean(data.closure)}>
                        <Plus />Добавить
                      </Button>
                    </div>
                    <p className="downtime-explanation">Полные дни простоя уменьшают постоянную часть пропорционально календарным дням месяца.</p>
                    {(data.downtimes ?? []).length === 0 ? (
                      <p className="downtime-empty">Простоев за выбранный месяц нет.</p>
                    ) : (
                      <div className="downtime-list">
                        {(data.downtimes ?? []).map((downtime) => (
                          <article className="downtime-row" key={downtime.id}>
                            <span><CirclePause />{downtimeLabel(downtime)}</span>
                            <div>
                              {!data.closure && <Button type="button" variant="ghost" size="icon" onClick={() => openDowntime(downtime)} aria-label="Редактировать простой"><Pencil /></Button>}
                              {!data.closure && <Button type="button" variant="ghost" size="icon" onClick={() => askDeleteDowntime(downtime)} aria-label="Удалить простой"><Trash2 /></Button>}
                            </div>
                          </article>
                        ))}
                      </div>
                    )}
                  </section>
                )}

                <section className="panel cash-result">
                  <div>
                    <span className="eyebrow">Денежный результат месяца</span>
                    <strong className={cashResult < 0 ? "text-rose-700" : "text-emerald-700"}>{money(cashResult)}</strong>
                    <p>Полученные оплаты минус собственные расходы. Топливо заказчика повторно не вычитается.</p>
                  </div>
                  <Banknote className="size-8" />
                </section>

                <div className="grid gap-3 sm:grid-cols-2">
                  {data.closure ? (
                    <Button type="button" variant="outline" onClick={askReopenMonth} className="h-12">
                      <UnlockKeyhole />Открыть месяц
                    </Button>
                  ) : (
                    <Button type="button" variant="outline" onClick={askCloseMonth} className="h-12">
                      <LockKeyhole />Закрыть месяц
                    </Button>
                  )}
                  <Button type="button" onClick={exportExcel} className="h-12">
                    <Download />Скачать Excel
                  </Button>
                </div>
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
                    <label className="week-date-jump" aria-label="Выбрать неделю по дате">
                      <CalendarDays />
                      <Input
                        className="week-date-native"
                        type="date"
                        value={entryDate}
                        min={monthBounds.start}
                        max={monthBounds.end}
                        onChange={(event) => selectEntryDate(event.target.value)}
                      />
                    </label>
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
                        className={day.date === entryDate ? "week-day week-day-selected" : "week-day"}
                        disabled={!day.inMonth}
                        onClick={() => selectEntryDate(day.date)}
                        aria-pressed={day.date === entryDate}
                        aria-label={`${WEEKDAY_LABELS[index]}, ${dateLabel(day.date)}${day.entry ? `, ${day.entry.units} бутылок` : ", записи нет"}`}
                      >
                        <span>{WEEKDAY_LABELS[index]}</span>
                        <strong>{Number(day.date.slice(-2))}</strong>
                        <small>{day.entry ? number(day.entry.units) : "—"}</small>
                      </button>
                    ))}
                  </div>

                  <div className="week-totals">
                    <div><span>Бутылок за неделю</span><strong>{number(weekUnits)}</strong></div>
                    <div><span>По {number(documentSettings.rateKopecks / 100)} ₽ за единицу</span><strong>{money(weekAmountKopecks)}</strong></div>
                  </div>
                </section>

                <section className="panel">
                  <div className="section-heading">
                    <div>
                      <span className="eyebrow">{shortWeekRange(currentWeekStart, addIsoDays(currentWeekStart, 6))}</span>
                      <h2>Записи недели</h2>
                    </div>
                    <div className="entry-heading-actions">
                      <strong>{number(weekUnits)} ед.</strong>
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
                  {weekEntries.length === 0 ? (
                    <div className="empty-state">
                      <CalendarDays />
                      <p>За эту неделю записей пока нет.</p>
                      <Button type="button" variant="outline" onClick={() => entryUnitsRef.current?.focus()}>Добавить запись</Button>
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
                          {!data.closure && (
                            <div className="flex items-center gap-1">
                              <Button type="button" variant="outline" size="sm" onClick={() => { setEditingEntry(entry); setEditUnits(String(entry.units)); setEditNote(entry.note); }} aria-label={`Изменить запись за ${dateLabel(entry.entryDate)}`}>
                                <Pencil className="size-4" />Изменить
                              </Button>
                              <Button type="button" variant="ghost" size="icon" onClick={() => askDeleteEntry(entry)} aria-label="Удалить запись"><Trash2 /></Button>
                            </div>
                          )}
                        </article>
                      ))}
                    </div>
                  )}
                </section>
              </TabsContent>

              <TabsContent value="invoices" className="space-y-4">
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
                    <div><span>Постоянная часть</span><strong>{money(fixedTargetKopecks)}</strong><small>можно несколькими счетами</small></div>
                    <div><span>Осталось постоянной части</span><strong>{money(fixedRemainingKopecks)}</strong></div>
                    <div><span>Переменная часть</span><strong>{money(calculation.variableKopecks)}</strong><small>{data.closure ? "рассчитана по итогам месяца" : "после закрытия месяца"}</small></div>
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
                  <div className="space-y-3">
                    {data.invoices.map((invoice) => {
                      const invoicePayments = data.payments.filter((payment) => payment.invoiceId === invoice.id);
                      const paid = paidByInvoice.get(invoice.id) ?? 0;
                      const status = statusFor(invoice, paid);
                      return (
                        <article className="panel invoice-card" key={invoice.id}>
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
                            <div><span>Сумма</span><strong>{money(invoice.amountKopecks)}</strong></div>
                            <div><span>Оплачено</span><strong>{money(paid)}</strong></div>
                            <div><span>Остаток</span><strong>{money(Math.max(0, invoice.amountKopecks - paid))}</strong></div>
                          </div>
                          {invoice.dueDate && <p className="due-line">Срок оплаты: <strong>{dateLabel(invoice.dueDate)}</strong></p>}
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
                <section className="panel expense-total">
                  <div>
                    <span className="eyebrow">{expenseFilter === "all" ? "Расходы за месяц" : `${expenseCategoryName(expenseFilter)} за месяц`}</span>
                    <strong>{money(filteredExpenseTotal)}</strong>
                  </div>
                  <WalletCards />
                </section>
                <Button type="button" onClick={openExpense} className="h-12 w-full sm:w-auto">
                  <Plus />Добавить расход
                </Button>
                {expenseFilter === "all" && (
                  <p className="help-note">Собственные расходы: {money(selfExpenses)}. Топливо заказчика: {money(customerFuel)} — вычитается из начисленной аренды.</p>
                )}
                {expenseFilter === "fuel" && (
                  <p className="help-note">Оплатил я: {money(filteredSelfFuel)}. Оплатил заказчик: {money(filteredCustomerFuel)} — вычитается из начисленной аренды.</p>
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
                          <p>{expense.payer === "customer" ? "Заказчик · вычет из аренды" : "Оплатил я"} · {dateLabel(expense.expenseDate)} · {expense.method === "bank" ? "Безналичные" : "Наличные"}</p>
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
            <DialogDescription>Период счёта — выбранный месяц. Изменения сохраняются только в приложении, документ в банке нужно исправить отдельно.</DialogDescription>
          </DialogHeader>
          <form onSubmit={createInvoice} className="dialog-form">
            <label>
              <FieldLabel>Вид начисления</FieldLabel>
              <Select
                value={invoiceKind}
                onValueChange={(value) => {
                  const kind = value as Invoice["kind"];
                  setInvoiceKind(kind);
                  if (editingInvoiceId === null && kind === "fixed") setInvoiceAmount(fixedRemainingKopecks > 0 ? String(fixedRemainingKopecks / 100) : "");
                  if (editingInvoiceId === null && kind === "variable") setInvoiceAmount(variableRemainingKopecks > 0 ? String(variableRemainingKopecks / 100) : "");
                }}
              >
                <SelectTrigger className="h-11 w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="fixed">Часть постоянной арендной платы</SelectItem>
                  <SelectItem value="variable" disabled={!data?.closure && editingInvoiceId === null}>Переменная часть</SelectItem>
                  <SelectItem value="other">Прочее начисление</SelectItem>
                </SelectContent>
              </Select>
              {editingInvoiceId === null && <p className="help-note">Постоянную часть можно выставлять несколькими счетами. Переменная доступна после закрытия месяца.</p>}
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label><FieldLabel>Номер счёта</FieldLabel><Input value={invoiceNumber} onChange={(event) => setInvoiceNumber(event.target.value)} placeholder="Например, 24" required /></label>
              <label><FieldLabel>Сумма, ₽</FieldLabel><Input type="number" min="0.01" step="0.01" inputMode="decimal" value={invoiceAmount} onChange={(event) => setInvoiceAmount(event.target.value)} required /></label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label><FieldLabel>Дата счёта</FieldLabel><Input type="date" value={invoiceDate} onChange={(event) => setInvoiceDate(event.target.value)} required /></label>
              <label><FieldLabel>Срок оплаты</FieldLabel><Input type="date" value={invoiceDueDate} onChange={(event) => setInvoiceDueDate(event.target.value)} /></label>
            </div>
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
              <div className="grid grid-cols-2 gap-3">
                <label><FieldLabel>Номер договора</FieldLabel><Input value={settingsDraft.contractNumber} onChange={(event) => setSettingsDraft((value) => ({ ...value, contractNumber: event.target.value }))} required /></label>
                <label><FieldLabel>Дата договора</FieldLabel><Input type="date" value={settingsDraft.contractDate} onChange={(event) => setSettingsDraft((value) => ({ ...value, contractDate: event.target.value }))} required /></label>
              </div>
              <label><FieldLabel>Автомобиль</FieldLabel><Input value={settingsDraft.vehicleModel} onChange={(event) => setSettingsDraft((value) => ({ ...value, vehicleModel: event.target.value }))} placeholder="Например, Fiat Ducato" required /></label>
              <label><FieldLabel>VIN</FieldLabel><Input value={settingsDraft.vehicleVin} onChange={(event) => setSettingsDraft((value) => ({ ...value, vehicleVin: event.target.value }))} required /></label>
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
            <DialogDescription>Укажите только даты. Дни начала и окончания входят в простой.</DialogDescription>
          </DialogHeader>
          <form onSubmit={saveDowntime} className="dialog-form">
            <div className="grid grid-cols-2 gap-3">
              <label><FieldLabel>Начало</FieldLabel><Input type="date" value={downtimeStart} onChange={(event) => setDowntimeStart(event.target.value)} required /></label>
              <label><FieldLabel>Окончание</FieldLabel><Input type="date" value={downtimeEnd} onChange={(event) => setDowntimeEnd(event.target.value)} required /></label>
            </div>
            <p className="help-note">Причина не требуется. Полные дни простоя автоматически уменьшают постоянную часть пропорционально календарным дням месяца.</p>
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
