"use client";

import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Banknote,
  CalendarDays,
  Calculator,
  CarFront,
  CheckCircle2,
  Copy,
  Download,
  FileSpreadsheet,
  FileText,
  Fuel,
  LoaderCircle,
  LockKeyhole,
  Plus,
  ReceiptText,
  Smartphone,
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
  id: number;
  expenseDate: string;
  category: "base_lease" | "repair" | "fuel" | "insurance" | "tax" | "other";
  amountKopecks: number;
  method: "bank" | "cash";
  documentNumber: string;
  note: string;
};

type Closure = {
  period: string;
  actualUnits: number;
  includedUnits: number;
  excessUnits: number;
  baseKopecks: number;
  rateKopecks: number;
  variableKopecks: number;
  totalKopecks: number;
  closedAt: string;
};

type DashboardData = {
  entries: Entry[];
  invoices: Invoice[];
  payments: Payment[];
  expenses: Expense[];
  closure: Closure | null;
  rules: {
    baseKopecks: number;
    includedUnits: number;
    rateKopecks: number;
  };
};

type OfflineStore = {
  version: 1;
  entries: Entry[];
  invoices: Invoice[];
  payments: Payment[];
  expenses: Expense[];
  closures: Closure[];
};

type AndroidAppBridge = {
  copyText: (text: string) => void;
  saveBase64File: (base64: string, fileName: string, mimeType: string) => void;
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
  baseKopecks: 8_000_000,
  includedUnits: 2_000,
  rateKopecks: 4_000,
};

const OFFLINE_STORAGE_KEY = "arenda-ts-offline-v1";

function emptyOfflineStore(): OfflineStore {
  return {
    version: 1,
    entries: [],
    invoices: [],
    payments: [],
    expenses: [],
    closures: [],
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
    version: 1,
    entries: store.entries,
    invoices: store.invoices,
    payments: store.payments,
    expenses: store.expenses,
    closures: store.closures,
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

  return {
    entries,
    invoices,
    payments,
    expenses,
    closure: store.closures.find((closure) => closure.period === period) ?? null,
    rules: DEFAULT_RULES,
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
  } else if (action === "create_invoice") {
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
    store.invoices.push({
      id: nextId(store.invoices),
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
  } else if (action === "create_payment") {
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
    store.payments.push({
      id: nextId(store.payments),
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
  } else if (action === "create_expense") {
    const amountKopecks = Number(payload.amountKopecks);
    if (
      !validIsoDate(payload.expenseDate) ||
      !["base_lease", "repair", "fuel", "insurance", "tax", "other"].includes(String(payload.category)) ||
      !Number.isSafeInteger(amountKopecks) ||
      amountKopecks <= 0 ||
      !["bank", "cash"].includes(String(payload.method))
    ) {
      throw new Error("Проверьте данные расхода");
    }
    store.expenses.push({
      id: nextId(store.expenses),
      expenseDate: payload.expenseDate,
      category: payload.category as Expense["category"],
      amountKopecks,
      method: payload.method as Expense["method"],
      documentNumber: typeof payload.documentNumber === "string" ? payload.documentNumber.trim().slice(0, 80) : "",
      note: typeof payload.note === "string" ? payload.note.trim().slice(0, 300) : "",
    });
  } else if (action === "delete_expense") {
    const id = Number(payload.id);
    store.expenses = store.expenses.filter((expense) => expense.id !== id);
  } else if (action === "close_month") {
    const period = String(payload.period ?? "");
    if (!/^\d{4}-\d{2}$/.test(period)) throw new Error("Неверно указан месяц");
    const actualUnits = store.entries
      .filter((entry) => entry.entryDate.startsWith(`${period}-`))
      .reduce((sum, entry) => sum + entry.units, 0);
    const excessUnits = Math.max(0, actualUnits - DEFAULT_RULES.includedUnits);
    const closure: Closure = {
      period,
      actualUnits,
      includedUnits: DEFAULT_RULES.includedUnits,
      excessUnits,
      baseKopecks: DEFAULT_RULES.baseKopecks,
      rateKopecks: DEFAULT_RULES.rateKopecks,
      variableKopecks: excessUnits * DEFAULT_RULES.rateKopecks,
      totalKopecks: DEFAULT_RULES.baseKopecks + excessUnits * DEFAULT_RULES.rateKopecks,
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

const expenseLabels: Record<Expense["category"], string> = {
  base_lease: "Аренда Евгению",
  repair: "Ремонт",
  fuel: "Топливо",
  insurance: "Страхование",
  tax: "Налог и сборы",
  other: "Прочее",
};

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

function invoiceLine(invoice: Invoice) {
  const part =
    invoice.kind === "fixed"
      ? "Постоянная часть арендной платы"
      : invoice.kind === "variable"
        ? "Переменная часть арендной платы"
        : "Арендная плата";
  return `${part} по договору субаренды транспортного средства Fiat Ducato без экипажа за ${documentPeriod(invoice.period)}.`;
}

function paymentPurpose(invoice: Invoice) {
  const part =
    invoice.kind === "fixed"
      ? "постоянную часть арендной платы"
      : invoice.kind === "variable"
        ? "переменную часть арендной платы"
        : "арендную плату";
  return `Оплата по счёту №${invoice.invoiceNumber} от ${dateLabel(invoice.invoiceDate)} за ${part} по субаренде автомобиля Fiat Ducato без экипажа за ${documentPeriod(invoice.period)}. Без НДС.`;
}

function emailSubject(invoice: Invoice) {
  return `Счёт №${invoice.invoiceNumber} от ${dateLabel(invoice.invoiceDate)} — аренда Fiat Ducato`;
}

function emailText(invoice: Invoice) {
  const part =
    invoice.kind === "fixed"
      ? "постоянной части арендной платы"
      : invoice.kind === "variable"
        ? "переменной части арендной платы"
        : "арендной платы";

  return `Счёт №${invoice.invoiceNumber} от ${dateLabel(invoice.invoiceDate)} на оплату ${part} по субаренде автомобиля Fiat Ducato без экипажа за ${documentPeriod(invoice.period)}.\nСумма: ${money(invoice.amountKopecks)}.\nСчёт во вложении.`;
}

function toKopecks(value: string) {
  const normalized = value.replace(/\s/g, "").replace(",", ".");
  const rubles = Number(normalized);
  return Number.isFinite(rubles) && rubles > 0 ? Math.round(rubles * 100) : 0;
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
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  const [entryDate, setEntryDate] = useState(today);
  const [entryUnits, setEntryUnits] = useState("");
  const [entryNote, setEntryNote] = useState("");
  const [entryOptionsOpen, setEntryOptionsOpen] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);
  const backupInputRef = useRef<HTMLInputElement>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importFileName, setImportFileName] = useState("");
  const [importRows, setImportRows] = useState<ImportRow[]>([]);
  const [importWarnings, setImportWarnings] = useState<string[]>([]);

  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [invoiceKind, setInvoiceKind] = useState<Invoice["kind"]>("fixed");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(today);
  const [invoiceDueDate, setInvoiceDueDate] = useState("");
  const [invoiceAmount, setInvoiceAmount] = useState("80000");
  const [invoiceNote, setInvoiceNote] = useState("");

  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentInvoiceId, setPaymentInvoiceId] = useState<number | null>(null);
  const [paymentDate, setPaymentDate] = useState(today);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<Payment["method"]>("bank");
  const [paymentDocument, setPaymentDocument] = useState("");
  const [paymentNote, setPaymentNote] = useState("");

  const [expenseOpen, setExpenseOpen] = useState(false);
  const [expenseDate, setExpenseDate] = useState(today);
  const [expenseCategory, setExpenseCategory] = useState<Expense["category"]>("base_lease");
  const [expenseAmount, setExpenseAmount] = useState("20000");
  const [expenseMethod, setExpenseMethod] = useState<Expense["method"]>("bank");
  const [expenseDocument, setExpenseDocument] = useState("");
  const [expenseNote, setExpenseNote] = useState("");

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
  const liveActualUnits = data?.entries.reduce((sum, entry) => sum + entry.units, 0) ?? 0;
  const liveExcessUnits = Math.max(0, liveActualUnits - rules.includedUnits);
  const liveVariableKopecks = liveExcessUnits * rules.rateKopecks;
  const liveTotalKopecks = rules.baseKopecks + liveVariableKopecks;
  const calculation = data?.closure
    ? data.closure
    : {
        actualUnits: liveActualUnits,
        includedUnits: rules.includedUnits,
        excessUnits: liveExcessUnits,
        baseKopecks: rules.baseKopecks,
        rateKopecks: rules.rateKopecks,
        variableKopecks: liveVariableKopecks,
        totalKopecks: liveTotalKopecks,
      };

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
  const rentBalance = Math.max(0, calculation.totalKopecks - totalPaid);
  const cashResult = totalPaid - totalExpenses;
  const progress = Math.min(100, (calculation.actualUnits / calculation.includedUnits) * 100);
  const importTotalUnits = importRows.reduce((sum, row) => sum + row.units, 0);

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
      setEntryUnits("");
      setEntryNote("");
      if (month === today.slice(0, 7)) {
        setEntryDate(today);
        setEntryOptionsOpen(false);
      }
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

  function openInvoice(kind: Invoice["kind"] = "fixed") {
    const selectedDate = month === today.slice(0, 7) ? today : `${month}-01`;
    setInvoiceKind(kind);
    setInvoiceAmount(
      kind === "fixed"
        ? String(rules.baseKopecks / 100)
        : kind === "variable"
          ? String(calculation.variableKopecks / 100)
          : "",
    );
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
    const ok = await request(
      {
        action: "create_invoice",
        period: month,
        invoiceNumber,
        invoiceDate,
        kind: invoiceKind,
        amountKopecks,
        dueDate: invoiceDueDate,
        note: invoiceNote,
      },
      "Счёт добавлен в историю",
    );
    if (ok) setInvoiceOpen(false);
  }

  function openPayment(invoice: Invoice) {
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
        action: "create_payment",
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
    setExpenseDate(month === today.slice(0, 7) ? today : `${month}-01`);
    setExpenseCategory("base_lease");
    setExpenseAmount("20000");
    setExpenseMethod("bank");
    setExpenseDocument("");
    setExpenseNote("");
    setExpenseOpen(true);
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
        action: "create_expense",
        expenseDate,
        category: expenseCategory,
        amountKopecks,
        method: expenseMethod,
        documentNumber: expenseDocument,
        note: expenseNote,
      },
      "Расход сохранён",
    );
    if (ok) setExpenseOpen(false);
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
      description: `${expenseLabels[expense.category]} · ${money(expense.amountKopecks)}`,
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
        ["Включено в постоянную часть, ед.", calculation.includedUnits],
        ["Превышение, ед.", calculation.excessUnits],
        ["Постоянная часть, ₽", calculation.baseKopecks / 100],
        ["Ставка сверх лимита, ₽/ед.", calculation.rateKopecks / 100],
        ["Переменная часть, ₽", calculation.variableKopecks / 100],
        ["ИТОГО АРЕНДА, ₽", calculation.totalKopecks / 100],
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
            invoiceLine(invoice),
            paymentPurpose(invoice),
            emailSubject(invoice),
            emailText(invoice),
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
        ["Дата", "Категория", "Сумма, ₽", "Способ оплаты", "Документ", "Примечание"],
        ...data.expenses.map((expense) => [
          dateLabel(expense.expenseDate),
          expenseLabels[expense.category],
          expense.amountKopecks / 100,
          expense.method === "bank" ? "Безналичные" : "Наличные",
          expense.documentNumber,
          expense.note,
        ]),
        ["ИТОГО", "", totalExpenses / 100, "", "", ""],
      ];
      const expensesSheet = XLSX.utils.aoa_to_sheet(expenseRows);
      expensesSheet["!cols"] = [{ wch: 15 }, { wch: 24 }, { wch: 15 }, { wch: 20 }, { wch: 22 }, { wch: 38 }];
      XLSX.utils.book_append_sheet(workbook, expensesSheet, "Расходы");

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

  async function installApp() {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === "accepted") {
      toast.success("Приложение установлено");
      setInstallPrompt(null);
    }
  }

  return (
    <div className="min-h-screen pb-10">
      <Toaster position="top-center" richColors />

      <header className="app-header">
        <div className="app-shell flex items-center justify-between gap-3 py-4 sm:py-5">
          <div className="flex min-w-0 items-center gap-3">
            <div className="brand-mark" aria-hidden="true">
              <CarFront className="size-6" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-xl font-bold tracking-tight sm:text-2xl">Аренда ТС</h1>
              <p className="text-sm text-white/70">
                {offlineMode ? "Fiat Ducato · данные на телефоне" : "Fiat Ducato · расчёты"}
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
              <Download className="size-4" />
              <span className="hidden sm:inline">Excel</span>
            </Button>
          </div>
        </div>
      </header>

      <main className="app-shell -mt-1 py-4 sm:py-6">
        <section className="month-bar" aria-label="Выбор расчётного месяца">
          <div>
            <span className="eyebrow">Расчётный период</span>
            <strong className="mt-1 block text-lg">{monthLabel(month)}</strong>
          </div>
          <Input
            type="month"
            value={month}
            onChange={(event) => {
              const nextMonth = event.target.value;
              setMonth(nextMonth);
              setEntryDate(nextMonth === today.slice(0, 7) ? today : `${nextMonth}-01`);
              setEntryOptionsOpen(nextMonth !== today.slice(0, 7));
            }}
            className="h-11 w-[155px] border-slate-200 bg-white text-base font-semibold"
            aria-label="Месяц"
          />
        </section>

        {data && !loading && !loadError && (
          <section className="panel quick-entry quick-entry-primary">
            {data.closure ? (
              <div className="locked-note">
                <LockKeyhole className="size-5" />
                Месяц закрыт — новые записи недоступны.
              </div>
            ) : (
              <form onSubmit={saveEntry} className="fast-entry-form">
                <div className="fast-entry-meta">
                  <div>
                    <span className="eyebrow">Бутылки за день</span>
                    <strong className="entry-date-line">
                      <CalendarDays />
                      {entryDate === today ? "Сегодня · " : ""}{dateLabel(entryDate)}
                    </strong>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="entry-options-toggle"
                    aria-expanded={entryOptionsOpen}
                    onClick={() => setEntryOptionsOpen((open) => !open)}
                  >
                    {entryOptionsOpen ? "Готово" : "Изменить"}
                  </Button>
                </div>

                <div className="fast-entry-row">
                  <label>
                    <span className="sr-only">Количество бутылок</span>
                    <Input
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
                  </label>
                  <Button type="submit" disabled={busy || !entryUnits}>
                    {busy ? <LoaderCircle className="animate-spin" /> : <Plus />}
                    Записать
                  </Button>
                </div>

                {entryOptionsOpen && (
                  <div className="fast-entry-options">
                    <label>
                      <FieldLabel>Дата записи</FieldLabel>
                      <Input type="date" value={entryDate} onChange={(event) => setEntryDate(event.target.value)} required />
                    </label>
                    <label>
                      <FieldLabel>Примечание — необязательно</FieldLabel>
                      <Input
                        placeholder="Если нужно что-то отметить"
                        value={entryNote}
                        onChange={(event) => setEntryNote(event.target.value)}
                      />
                    </label>
                  </div>
                )}
              </form>
            )}
          </section>
        )}

        <Tabs value={tab} onValueChange={setTab} className="mt-4 gap-4">
          <TabsList className="app-tabs grid h-auto w-full grid-cols-4 bg-transparent p-0">
            <TabsTrigger value="summary" className="app-tab">
              <Calculator />
              <span>Расчёт</span>
            </TabsTrigger>
            <TabsTrigger value="entries" className="app-tab">
              <CalendarDays />
              <span>Записи</span>
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
                    <span>Аренда за месяц</span>
                    <strong>{money(calculation.totalKopecks)}</strong>
                    <small>{data.closure ? "Итог зафиксирован" : "Сумма обновляется автоматически"}</small>
                  </article>
                  <article className="money-card">
                    <span>Оплачено</span>
                    <strong>{money(totalPaid)}</strong>
                  </article>
                  <article className="money-card">
                    <span>Остаток</span>
                    <strong className={rentBalance > 0 ? "text-amber-700" : "text-emerald-700"}>{money(rentBalance)}</strong>
                  </article>
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
                    <div><span>Постоянная часть</span><strong>{money(calculation.baseKopecks)}</strong></div>
                    <div><span>Превышение</span><strong>{number(calculation.excessUnits)} ед.</strong></div>
                    <div><span>Ставка сверх лимита</span><strong>{money(calculation.rateKopecks)} / ед.</strong></div>
                    <div className="calculation-total"><span>Переменная часть</span><strong>{money(calculation.variableKopecks)}</strong></div>
                  </div>
                </section>

                <section className="panel cash-result">
                  <div>
                    <span className="eyebrow">Денежный результат месяца</span>
                    <strong className={cashResult < 0 ? "text-rose-700" : "text-emerald-700"}>{money(cashResult)}</strong>
                    <p>Оплаты минус внесённые расходы. Налоги здесь не рассчитываются.</p>
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
                <section className="panel">
                  <div className="section-heading">
                    <div>
                      <span className="eyebrow">{monthLabel(month)}</span>
                      <h2>История показателей</h2>
                    </div>
                    <div className="entry-heading-actions">
                      <strong>{number(calculation.actualUnits)} ед.</strong>
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
                  {data.entries.length === 0 ? (
                    <div className="empty-state">
                      <CalendarDays />
                      <p>За этот месяц записей пока нет.</p>
                      <Button type="button" variant="outline" onClick={() => setTab("summary")}>Добавить первую</Button>
                    </div>
                  ) : (
                    <div className="record-list">
                      {data.entries.map((entry) => (
                        <article className="record-row" key={entry.id}>
                          <div className="record-date"><CalendarDays />{dateLabel(entry.entryDate)}</div>
                          <div className="min-w-0 flex-1">
                            <strong>{number(entry.units)} ед.</strong>
                            {entry.note && <p>{entry.note}</p>}
                          </div>
                          {!data.closure && (
                            <Button type="button" variant="ghost" size="icon" onClick={() => askDeleteEntry(entry)} aria-label="Удалить запись">
                              <Trash2 />
                            </Button>
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
                      <span className="eyebrow">График по договору</span>
                      <h2>Постоянная часть — 80 000 ₽</h2>
                    </div>
                  </div>
                  <div className="schedule-grid">
                    <div><span>До 1-го числа</span><strong>40 000 ₽</strong></div>
                    <div><span>До 15-го числа</span><strong>40 000 ₽</strong></div>
                    <div><span>После закрытия месяца</span><strong>{money(calculation.variableKopecks)}</strong><small>переменная часть</small></div>
                  </div>
                </section>
                <Button type="button" onClick={() => openInvoice("fixed")} className="h-12 w-full sm:w-auto">
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
                      const lineText = invoiceLine(invoice);
                      const purposeText = paymentPurpose(invoice);
                      const subjectText = emailSubject(invoice);
                      const letterText = emailText(invoice);
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

                          <details className="copy-details">
                            <summary>
                              <FileText />
                              Тексты для счёта и письма
                            </summary>
                            <div className="copy-stack">
                              <CopyBlock
                                title="Строка счёта в банке"
                                text={lineText}
                                copied={copiedKey === `line-${invoice.id}`}
                                onCopy={() => void copyText(lineText, `line-${invoice.id}`)}
                              />
                              <CopyBlock
                                title="Назначение платежа"
                                text={purposeText}
                                copied={copiedKey === `purpose-${invoice.id}`}
                                onCopy={() => void copyText(purposeText, `purpose-${invoice.id}`)}
                              />
                              <CopyBlock
                                title="Тема письма"
                                text={subjectText}
                                copied={copiedKey === `subject-${invoice.id}`}
                                onCopy={() => void copyText(subjectText, `subject-${invoice.id}`)}
                              />
                              <CopyBlock
                                title="Текст письма"
                                text={letterText}
                                copied={copiedKey === `email-${invoice.id}`}
                                onCopy={() => void copyText(letterText, `email-${invoice.id}`)}
                              />
                            </div>
                          </details>

                          {invoicePayments.length > 0 && (
                            <div className="payment-list">
                              {invoicePayments.map((payment) => (
                                <div key={payment.id}>
                                  <span>{dateLabel(payment.paymentDate)} · {payment.method === "bank" ? "Безналичные" : "Наличные"}</span>
                                  <strong>{money(payment.amountKopecks)}</strong>
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
                <section className="panel expense-total">
                  <div>
                    <span className="eyebrow">Расходы за месяц</span>
                    <strong>{money(totalExpenses)}</strong>
                  </div>
                  <WalletCards />
                </section>
                <Button type="button" onClick={openExpense} className="h-12 w-full sm:w-auto">
                  <Plus />Добавить расход
                </Button>
                <p className="help-note">Топливо и ремонт учитываются здесь для внутреннего контроля и не добавляются к арендному счёту.</p>

                {data.expenses.length === 0 ? (
                  <section className="panel empty-state">
                    <WalletCards />
                    <p>Расходов за этот месяц пока нет.</p>
                  </section>
                ) : (
                  <div className="space-y-3">
                    {data.expenses.map((expense) => (
                      <article className="panel expense-row" key={expense.id}>
                        <div className="expense-icon">
                          {expense.category === "fuel" ? <Fuel /> : expense.category === "repair" ? <Wrench /> : <WalletCards />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <h2>{expenseLabels[expense.category]}</h2>
                            <strong>{money(expense.amountKopecks)}</strong>
                          </div>
                          <p>{dateLabel(expense.expenseDate)} · {expense.method === "bank" ? "Безналичные" : "Наличные"}</p>
                          {(expense.documentNumber || expense.note) && (
                            <p>{[expense.documentNumber && `Документ: ${expense.documentNumber}`, expense.note].filter(Boolean).join(" · ")}</p>
                          )}
                        </div>
                        <Button type="button" variant="ghost" size="icon" onClick={() => askDeleteExpense(expense)} aria-label="Удалить расход"><Trash2 /></Button>
                      </article>
                    ))}
                  </div>
                )}
              </TabsContent>
            </>
          ) : null}
        </Tabs>

        {offlineMode && (
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
            <DialogTitle>Добавить выставленный счёт</DialogTitle>
            <DialogDescription>Сохраняется история счёта. Сам документ приложение пока не отправляет.</DialogDescription>
          </DialogHeader>
          <form onSubmit={createInvoice} className="dialog-form">
            <label>
              <FieldLabel>Вид начисления</FieldLabel>
              <Select
                value={invoiceKind}
                onValueChange={(value) => {
                  const kind = value as Invoice["kind"];
                  setInvoiceKind(kind);
                  if (kind === "fixed") setInvoiceAmount(String(rules.baseKopecks / 100));
                  if (kind === "variable") setInvoiceAmount(String(calculation.variableKopecks / 100));
                }}
              >
                <SelectTrigger className="h-11 w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="fixed">Постоянная часть</SelectItem>
                  <SelectItem value="variable">Переменная часть</SelectItem>
                  <SelectItem value="other">Прочее начисление</SelectItem>
                </SelectContent>
              </Select>
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
            <DialogTitle>Добавить оплату</DialogTitle>
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
            <DialogTitle>Добавить расход</DialogTitle>
            <DialogDescription>Расход попадёт во внутренний отчёт за выбранный месяц.</DialogDescription>
          </DialogHeader>
          <form onSubmit={createExpense} className="dialog-form">
            <label>
              <FieldLabel>Категория</FieldLabel>
              <Select
                value={expenseCategory}
                onValueChange={(value) => {
                  const category = value as Expense["category"];
                  setExpenseCategory(category);
                  if (category === "base_lease") setExpenseAmount("20000");
                }}
              >
                <SelectTrigger className="h-11 w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="base_lease">Аренда Евгению</SelectItem>
                  <SelectItem value="repair">Ремонт</SelectItem>
                  <SelectItem value="fuel">Топливо</SelectItem>
                  <SelectItem value="insurance">Страхование</SelectItem>
                  <SelectItem value="tax">Налог и сборы</SelectItem>
                  <SelectItem value="other">Прочее</SelectItem>
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
            <label><FieldLabel>Документ</FieldLabel><Input value={expenseDocument} onChange={(event) => setExpenseDocument(event.target.value)} placeholder="Чек, заказ-наряд или платёжка" /></label>
            <label><FieldLabel>Примечание</FieldLabel><Textarea value={expenseNote} onChange={(event) => setExpenseNote(event.target.value)} placeholder="Необязательно" /></label>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setExpenseOpen(false)}>Отмена</Button>
              <Button type="submit" disabled={busy}>{busy && <LoaderCircle className="animate-spin" />}Сохранить расход</Button>
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
