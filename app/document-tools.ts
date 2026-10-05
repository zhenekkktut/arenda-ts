export type DocumentSettings = {
  city: string;
  contractNumber: string;
  contractDate: string;
  rentalStart: string;
  rentalEnd: string;
  lessorFull: string;
  lessorShort: string;
  lessorSignerShort: string;
  lessorDative: string;
  lessorInn: string;
  lesseeFull: string;
  lesseeShort: string;
  lesseeInn: string;
  lesseeKpp: string;
  lesseeDirector: string;
  lesseeDirectorShort: string;
  vehicleModel: string;
  vehicleYear: string;
  vehicleVin: string;
  vehiclePlate: string;
  vatLabel: string;
  baseKopecks: number;
  includedUnits: number;
  rateKopecks: number;
};

export type Downtime = {
  id: number;
  startDate: string;
  endDate: string;
  reason: string;
  basis?: string;
  note: string;
};

export type DocumentMeta = {
  period: string;
  actNumber: string;
  reconciliationNumber: string;
  documentDate: string;
  basis: string;
  openingBalanceKopecks: number;
  asOfDate?: string;
  adjustments?: string;
};

export type DocumentCalculation = {
  actualUnits: number;
  includedUnits: number;
  excessUnits: number;
  baseFullKopecks: number;
  baseKopecks: number;
  baseReductionKopecks: number;
  rateKopecks: number;
  intensityKopecks: number;
  variableKopecks: number;
  totalKopecks: number;
  calendarDays: number;
  ownershipDays: number;
  downtimeDays: number;
  payableDays: number;
};

type EntryLike = { entryDate: string; units: number; note?: string };
type PaymentLike = {
  invoiceId: number;
  paymentDate: string;
  amountKopecks: number;
  method: "bank" | "cash";
  documentNumber: string;
};
type InvoiceLike = { id: number; invoiceNumber: string; invoiceDate?: string; period?: string; kind?: string; actNumber?: string; amountKopecks?: number; bottleStartDate?: string; bottleEndDate?: string; note?: string };
type ExpenseLike = {
  expenseDate: string;
  category: string;
  payer?: "self" | "customer";
  amountKopecks: number;
  documentNumber: string;
  note: string;
};

export const DEFAULT_DOCUMENT_SETTINGS: DocumentSettings = {
  city: "Выборг",
  contractNumber: "002-АР/2026",
  contractDate: "2026-08-01",
  rentalStart: "2026-08-01",
  rentalEnd: "2027-07-31",
  lessorFull: "",
  lessorShort: "",
  lessorSignerShort: "",
  lessorDative: "",
  lessorInn: "",
  lesseeFull: "",
  lesseeShort: "",
  lesseeInn: "",
  lesseeKpp: "",
  lesseeDirector: "",
  lesseeDirectorShort: "",
  vehicleModel: "Fiat Ducato",
  vehicleYear: "2001",
  vehicleVin: "",
  vehiclePlate: "",
  vatLabel: "Без НДС",
  baseKopecks: 8_000_000,
  includedUnits: 2_000,
  rateKopecks: 4_000,
};

const monthNames = [
  "январь", "февраль", "март", "апрель", "май", "июнь",
  "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь",
];

const monthNamesGenitive = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];

function isoUtc(date: Date) {
  return date.toISOString().slice(0, 10);
}

function parseIso(value: string) {
  return new Date(`${value}T12:00:00Z`);
}

export function periodBounds(period: string) {
  const [year, month] = period.split("-").map(Number);
  const endDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    start: `${period}-01`,
    end: `${period}-${String(endDay).padStart(2, "0")}`,
    days: endDay,
  };
}

export function defaultDocumentMeta(period: string, sequence: number, today: string): DocumentMeta {
  return {
    period,
    actNumber: String(sequence),
    reconciliationNumber: String(sequence),
    documentDate: today,
    basis: `Ежедневный реестр показателей использования автомобиля за ${periodLabel(period)}`,
    openingBalanceKopecks: 0,
  };
}

export function calculateRental(
  period: string,
  entries: EntryLike[],
  downtimes: Downtime[],
  settings: DocumentSettings,
): DocumentCalculation {
  const bounds = periodBounds(period);
  const unavailable = new Set<string>();

  for (const downtime of downtimes) {
    const start = downtime.startDate < bounds.start ? bounds.start : downtime.startDate;
    const end = downtime.endDate > bounds.end ? bounds.end : downtime.endDate;
    if (start > end) continue;
    for (let cursor = parseIso(start); isoUtc(cursor) <= end; cursor = new Date(cursor.getTime() + 86_400_000)) {
      unavailable.add(isoUtc(cursor));
    }
  }

  const possessionStart = settings.rentalStart && settings.rentalStart > bounds.start ? settings.rentalStart : bounds.start;
  const possessionEnd = settings.rentalEnd && settings.rentalEnd < bounds.end ? settings.rentalEnd : bounds.end;
  const actualUnits = entries
    .filter((entry) => entry.entryDate >= possessionStart && entry.entryDate <= possessionEnd)
    .reduce((sum, entry) => sum + entry.units, 0);
  const ownershipDays = possessionStart > possessionEnd ? 0
    : Math.round((parseIso(possessionEnd).getTime() - parseIso(possessionStart).getTime()) / 86_400_000) + 1;
  const relevantDowntimeDays = [...unavailable].filter((day) => day >= possessionStart && day <= possessionEnd).length;
  const payableDays = Math.max(0, ownershipDays - relevantDowntimeDays);
  // Пункты 2.3–2.4 договора: полные дни подтверждённого простоя всегда
  // исключаются из оплачиваемых дней. Итог месяца — большая из сумм Ф и И.
  const baseKopecks = Math.round(settings.baseKopecks * payableDays / bounds.days);
  const intensityKopecks = actualUnits * settings.rateKopecks;
  const excessUnits = Math.max(0, actualUnits - settings.includedUnits);
  const variableKopecks = Math.max(0, intensityKopecks - baseKopecks);

  return {
    actualUnits,
    includedUnits: settings.includedUnits,
    excessUnits,
    baseFullKopecks: settings.baseKopecks,
    baseKopecks,
    baseReductionKopecks: settings.baseKopecks - baseKopecks,
    rateKopecks: settings.rateKopecks,
    intensityKopecks,
    variableKopecks,
    totalKopecks: Math.max(baseKopecks, intensityKopecks),
    calendarDays: bounds.days,
    downtimeDays: relevantDowntimeDays,
    ownershipDays,
    payableDays,
  };
}

// Keep calendar quantities and issued documents intact. Fuel is converted once
// for the whole month and deducted from the variable part first. Any remainder
// reduces the fixed part, so the full deduction can go below the fixed minimum.
export function calculateFuelAdjustment(
  period: string,
  gross: DocumentCalculation,
  expenses: ExpenseLike[],
) {
  const bounds = periodBounds(period);
  const customerFuelKopecks = expenses.filter((expense) => expense.category === "fuel" &&
    expense.payer === "customer" && expense.expenseDate >= bounds.start && expense.expenseDate <= bounds.end)
    .reduce((sum, expense) => sum + expense.amountKopecks, 0);
  // Zero is a supported rate in older settings: retain the monetary deduction
  // rather than dividing by zero or rewriting those settings.
  const fuelUnits = gross.rateKopecks > 0 ? Math.ceil(customerFuelKopecks / gross.rateKopecks) : 0;
  const roundedFuelKopecks = gross.rateKopecks > 0 ? fuelUnits * gross.rateKopecks : customerFuelKopecks;
  const actualUnits = Math.max(0, gross.actualUnits - fuelUnits);
  const variableFuelKopecks = Math.min(roundedFuelKopecks, gross.variableKopecks);
  const fixedFuelKopecks = Math.min(Math.max(0, roundedFuelKopecks - variableFuelKopecks), gross.baseKopecks);
  const baseKopecks = gross.baseKopecks - fixedFuelKopecks;
  const intensityKopecks = actualUnits * gross.rateKopecks;
  const totalKopecks = Math.max(baseKopecks, intensityKopecks);
  const calculation: DocumentCalculation = { ...gross, actualUnits, baseKopecks, intensityKopecks,
    excessUnits: Math.max(0, actualUnits - gross.includedUnits),
    variableKopecks: Math.max(0, intensityKopecks - baseKopecks), totalKopecks };
  return { customerFuelKopecks, fuelUnits, roundedFuelKopecks, variableFuelKopecks, fixedFuelKopecks,
    roundingKopecks: roundedFuelKopecks - customerFuelKopecks,
    fuelDeductionKopecks: gross.totalKopecks - totalKopecks, calculation };
}

export function periodLabel(period: string) {
  const [year, month] = period.split("-");
  return `${monthNames[Number(month) - 1]} ${year} года`;
}

export function longDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return `${String(day).padStart(2, "0")} ${monthNamesGenitive[month - 1]} ${year} года`;
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function rubles(kopecks: number) {
  return new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(kopecks / 100);
}

function integer(value: number) {
  return new Intl.NumberFormat("ru-RU").format(value);
}

function plural(value: number, one: string, few: string, many: string) {
  const lastTwo = value % 100;
  if (lastTwo >= 11 && lastTwo <= 19) return many;
  const last = value % 10;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}

function triadWords(value: number, feminine: boolean) {
  const hundreds = ["", "сто", "двести", "триста", "четыреста", "пятьсот", "шестьсот", "семьсот", "восемьсот", "девятьсот"];
  const tens = ["", "", "двадцать", "тридцать", "сорок", "пятьдесят", "шестьдесят", "семьдесят", "восемьдесят", "девяносто"];
  const teens = ["десять", "одиннадцать", "двенадцать", "тринадцать", "четырнадцать", "пятнадцать", "шестнадцать", "семнадцать", "восемнадцать", "девятнадцать"];
  const ones = feminine
    ? ["", "одна", "две", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять"]
    : ["", "один", "два", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять"];
  const result = [hundreds[Math.floor(value / 100)]];
  const tail = value % 100;
  if (tail >= 10 && tail < 20) result.push(teens[tail - 10]);
  else result.push(tens[Math.floor(tail / 10)], ones[tail % 10]);
  return result.filter(Boolean).join(" ");
}

export function moneyWords(kopecks: number) {
  const rounded = Math.max(0, Math.round(kopecks));
  const whole = Math.floor(rounded / 100);
  const fractions = rounded % 100;
  if (whole > 999_999_999) return `${integer(whole)} рублей ${String(fractions).padStart(2, "0")} копеек`;
  const millions = Math.floor(whole / 1_000_000);
  const thousands = Math.floor(whole / 1_000) % 1_000;
  const units = whole % 1_000;
  const words: string[] = [];
  if (millions) words.push(triadWords(millions, false), plural(millions, "миллион", "миллиона", "миллионов"));
  if (thousands) words.push(triadWords(thousands, true), plural(thousands, "тысяча", "тысячи", "тысяч"));
  if (units || words.length === 0) words.push(triadWords(units, false) || "ноль");
  const text = words.join(" ");
  return `${text.charAt(0).toUpperCase()}${text.slice(1)} ${plural(whole, "рубль", "рубля", "рублей")} ${String(fractions).padStart(2, "0")} ${plural(fractions, "копейка", "копейки", "копеек")}`;
}

// Фиксированные формы: заполненные образцы на страницах 7 и 8 пакета от 01.10.2026.
const officialCss = `
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: white; color: black; }
  body { font-family: "Noto Serif", "DejaVu Serif", "Times New Roman", serif; font-size: 10pt; line-height: 1.19; }
  .page { width: 794px; height: 1123px; overflow: hidden; padding: 60px 67px 48px; page-break-after: always; }
  .page:last-child { page-break-after: auto; }
  @media print { .page { width: 210mm; height: 297mm; } }
  h1 { margin: 0; text-align: center; font-size: 14pt; line-height: 1.18; font-weight: 700; }
  h2 { margin: 0 0 4px; text-align: center; font-size: 11.4pt; }
  p { margin: 0 0 6px; text-align: justify; }
  .number, .city, .subtitle { text-align: center; margin: 0 0 5px; }
  .city { margin: 1px 0 7px; }
  table { border-collapse: collapse; width: 100%; margin: 7px -8px 7px; width: calc(100% + 16px); font-size: 9.2pt; }
  th, td { border: 1px solid #b4b4b4; padding: 4px 6px; vertical-align: middle; }
  th { background: #e9e9e9; text-align: left; }
  .value { width: 31%; text-align: right; white-space: nowrap; }
  .reconciliation .value { width: 30%; }
  .reconciliation-page { font-size: 10pt; margin: -16px -23px 0; }
  .reconciliation-invoices { font-size: 9.2pt; table-layout: fixed; }
  .reconciliation-invoices th, .reconciliation-invoices td { padding: 3px; overflow-wrap: anywhere; }
  .reconciliation-invoices .value { width: auto; white-space: normal; }
  .reconciliation-invoices th { text-align: center; }
  .reconciliation-daily { font-size: 8.7pt; table-layout: fixed; }
  .reconciliation-daily th, .reconciliation-daily td { padding: 2px 4px; overflow-wrap: anywhere; }
  .reconciliation-daily .value { width: auto; }
  .total { font-weight: bold; }
  .signatures { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 16px -8px 0; font-size: 9pt; page-break-inside: avoid; }
  .signature-header { min-height: 44px; }
  .signature-line { margin-top: 12px; white-space: nowrap; }
  .signature-date { margin-top: 6px; }
  .blank { border-bottom: 1px solid #777; display: inline-block; min-width: 165px; }
  .no-break { white-space: nowrap; }
  .compact { font-size: 10pt; }
`;

function wrapDocument(title: string, pages: string[]) {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=794, initial-scale=1"><title>${escapeHtml(title)}</title><style>${officialCss}</style></head><body>${pages.map((page) => `<section class="page">${page}</section>`).join("")}</body></html>`;
}

export type OfficialDocumentInput = {
  settings: DocumentSettings;
  meta: DocumentMeta;
  calculation: DocumentCalculation;
  downtimes: Downtime[];
  invoices: InvoiceLike[];
  payments: PaymentLike[];
  openingPayments?: PaymentLike[];
  expenses?: ExpenseLike[];
  entries?: EntryLike[];
};

function shortDate(value: string) {
  const [year, month, day] = value.split("-");
  return `${day}.${month}.${year}`;
}

function amountWords(kopecks: number) {
  const words = moneyWords(kopecks);
  const match = words.match(/^(.*?) (рубль|рубля|рублей) (\d\d) (копейка|копейки|копеек)$/);
  return match ? `${integer(Math.floor(kopecks / 100))} (${match[1]}) ${match[2]} ${match[3]} ${match[4]}` : words;
}

function signatures(settings: DocumentSettings) {
  return `<div class="signatures"><div><div class="signature-header"><b>Арендодатель</b><br>${escapeHtml(settings.lessorShort)}</div><div class="signature-line">________________ / ${escapeHtml(settings.lessorSignerShort)} /</div><div class="signature-date">Дата подписи: __________________</div></div><div><div class="signature-header"><b>Арендатор</b><br>${escapeHtml(settings.lesseeShort)}<br>Генеральный директор ${escapeHtml(settings.lesseeDirectorShort)}</div><div class="signature-line">________________ / ${escapeHtml(settings.lesseeDirectorShort)} /</div><div class="signature-date">Дата подписи: __________________</div></div></div>`;
}

function rentActBody(input: OfficialDocumentInput) {
  const { settings: s, meta: m } = input;
  const fuel = calculateFuelAdjustment(m.period, input.calculation, input.expenses ?? []);
  const c = fuel.calculation;
  const b = periodBounds(m.period);
  const possessionStart = s.rentalStart > b.start ? s.rentalStart : b.start;
  const possessionEnd = s.rentalEnd < b.end ? s.rentalEnd : b.end;
  const downtime = c.downtimeDays === 0
    ? "Подтверждённого технического простоя не было; P = 0 дней."
    : `${input.downtimes.filter((d) => d.startDate <= b.end && d.endDate >= b.start).map((d) => `${shortDate(d.startDate)}–${shortDate(d.endDate)}: ${d.reason}; основание: ${d.basis || "не указано"}${d.note ? `; ${d.note}` : ""}`).join("; ")}; P = ${c.downtimeDays} дней.`;
  const rows = [
    ["Календарных дней месяца D", `${c.calendarDays} ${plural(c.calendarDays, "день", "дня", "дней")}`],
    ["Дней владения автомобилем в расчётном месяце A", `${c.ownershipDays} ${plural(c.ownershipDays, "день", "дня", "дней")}`],
    ["Полных дней подтверждённого простоя P", `${c.downtimeDays} дней`],
    ["Оплачиваемых дней d = A - P", `${c.payableDays} ${plural(c.payableDays, "день", "дня", "дней")}`],
    ["Учтено единиц интенсивности N, штук", integer(c.actualUnits)],
    [fuel.fixedFuelKopecks > 0 ? "Постоянная часть Ф" : `Постоянная часть Ф = ${integer(s.baseKopecks / 100)} × d / D`, `${rubles(c.baseKopecks)} руб.`],
    [`Показатель интенсивности И = ${integer(c.rateKopecks / 100)} × N`, `${rubles(c.intensityKopecks)} руб.`],
    ["Переменная часть: И - Ф, если результат положительный", `${rubles(c.variableKopecks)} руб.`],
    ["Итого: большая из сумм Ф и И", `${rubles(c.totalKopecks)} руб.`],
    ["НДС: «Без НДС» либо ставка и сумма внутри итога", s.vatLabel],
  ];
  return `<h1>ЕЖЕМЕСЯЧНЫЙ АКТ-РАСЧЁТ</h1>
  <h2>арендной платы за ${escapeHtml(periodLabel(m.period))}</h2>
  <p class="number">№${escapeHtml(m.actNumber)}　Дата составления: ${escapeHtml(shortDate(m.documentDate))}</p>
  <p class="city">г. ${escapeHtml(s.city)}</p>
  <p>Договор № ${escapeHtml(s.contractNumber)} от ${escapeHtml(longDate(s.contractDate))}. Период аренды: с ${shortDate(possessionStart)} по ${shortDate(possessionEnd)}.</p>
  <p>Арендодатель: ${escapeHtml(s.lessorFull.replace(/^Индивидуальный предприниматель /, "ИП "))}, ИНН ${escapeHtml(s.lessorInn)}.<br>
  Арендатор: ${escapeHtml(s.lesseeFull)}, ИНН ${escapeHtml(s.lesseeInn)}, КПП ${escapeHtml(s.lesseeKpp)}, в лице генерального директора ${escapeHtml(s.lesseeDirector)}.</p>
  <p>Автомобиль: ${escapeHtml(s.vehicleModel)}, VIN ${escapeHtml(s.vehicleVin)}, госномер ${escapeHtml(s.vehiclePlate)}.</p>
  <p>За указанный период автомобиль находился во владении и пользовании Арендатора по договору аренды без экипажа. Стороны определили арендную плату следующим образом:</p>
  <table><thead><tr><th>Показатель</th><th class="value">Значение</th></tr></thead><tbody>
  ${rows.map(([label, value], i) => `<tr class="${i === 8 ? "total" : ""}"><td>${escapeHtml(label)}</td><td class="value">${escapeHtml(value)}</td></tr>`).join("")}</tbody></table>
  <p>Сумма прописью: <b>${escapeHtml(amountWords(c.totalKopecks))}, ${escapeHtml(s.vatLabel === "Без НДС" ? "без НДС" : s.vatLabel)}.</b></p>
  <p>Основание количества учётных единиц:<br>Ежедневные ведомости учёта эксплуатации автомобиля ${escapeHtml(s.vehicleModel)} за период с ${shortDate(b.start)} по ${shortDate(b.end)}; итоговое количество: ${integer(c.actualUnits)} учётных единиц.</p>
  <p>Основание и период технического простоя либо отметка «простоя не было»:<br>${escapeHtml(downtime)}</p>
  <p>Подписи подтверждают период владения и пользования автомобилем, показатель интенсивности эксплуатации, дни простоя и начисленную арендную плату. Сведения об оплате в акт-расчёт не включаются. Состояние расчётов при необходимости подтверждается отдельным актом сверки. Срок оплаты определяется договором.</p>
  <p>Замечания и согласованные корректировки: ${escapeHtml(m.adjustments?.trim() || "отсутствуют")}.</p>
  ${signatures(s)}`;
}

export function sharedBottlePeriodParts(
  first: Pick<InvoiceLike, "kind" | "bottleStartDate" | "bottleEndDate">,
  second: Pick<InvoiceLike, "kind" | "bottleStartDate" | "bottleEndDate">,
) {
  return Boolean(first.bottleStartDate && first.bottleEndDate && second.bottleStartDate && second.bottleEndDate &&
    first.bottleStartDate <= second.bottleEndDate && first.bottleEndDate >= second.bottleStartDate &&
    ((first.kind === "fixed" && second.kind === "variable") ||
      (first.kind === "variable" && second.kind === "fixed")));
}

export function fuelInvoiceForDate(invoices: InvoiceLike[], date: string) {
  const matching = invoices.filter((invoice) => invoice.bottleStartDate && invoice.bottleEndDate &&
    invoice.bottleStartDate <= date && invoice.bottleEndDate >= date);
  if (matching.length === 1) return matching[0].id;
  if (matching.length === 2 && sharedBottlePeriodParts(matching[0], matching[1])) {
    // При общем периоде топливо сначала относится к переменной части.
    return matching.find((invoice) => invoice.kind === "variable")!.id;
  }
  return undefined;
}

export function suggestInvoicePeriods(input: {
  period: string;
  kind: "fixed" | "variable" | "other";
  invoiceDate: string;
  entries: EntryLike[];
  invoices: InvoiceLike[];
  expenses: ExpenseLike[];
  settings: DocumentSettings;
  excludeInvoiceId?: number;
}) {
  type SuggestedPeriod = { startDate: string; endDate: string; units: number;
    customerFuelKopecks: number; grossKopecks: number };
  const periods: SuggestedPeriod[] = [];
  const legacyInvoiceNumbers: string[] = [];
  const result = { periods, needsReview: false, legacyInvoiceNumbers, hasRelevantDays: false };
  const validDate = (value: unknown): value is string => {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = parseIso(value);
    return !Number.isNaN(date.getTime()) && isoUtc(date) === value;
  };
  if (!validDate(`${input.period}-01`) || !validDate(input.invoiceDate)) return result;
  const bounds = periodBounds(input.period);
  const start = input.settings.rentalStart > bounds.start ? input.settings.rentalStart : bounds.start;
  const end = [bounds.end, input.invoiceDate, input.settings.rentalEnd].filter(Boolean).sort()[0];
  if (!validDate(start) || !validDate(end) || start > end) return result;

  const days = new Map<string, { units: number; fuel: number }>();
  const dayFor = (date: string) => {
    const day = days.get(date) ?? { units: 0, fuel: 0 };
    days.set(date, day);
    return day;
  };
  for (const entry of input.entries) {
    if (validDate(entry.entryDate) && entry.entryDate >= start && entry.entryDate <= end &&
        Number.isSafeInteger(entry.units) && entry.units >= 0) dayFor(entry.entryDate).units += entry.units;
  }
  for (const expense of input.expenses) {
    if (expense.category === "fuel" && expense.payer === "customer" && validDate(expense.expenseDate) &&
        expense.expenseDate >= start && expense.expenseDate <= end &&
        Number.isSafeInteger(expense.amountKopecks) && expense.amountKopecks >= 0) {
      dayFor(expense.expenseDate).fuel += expense.amountKopecks;
    }
  }
  result.hasRelevantDays = days.size > 0;
  const blockingRanges: { start: string; end: string }[] = [];
  for (const invoice of input.invoices) {
    if (invoice.id === input.excludeInvoiceId || (invoice.period && invoice.period !== input.period)) continue;
    const sharesPart = (input.kind === "fixed" && invoice.kind === "variable") ||
      (input.kind === "variable" && invoice.kind === "fixed");
    if (sharesPart) continue;
    if (!validDate(invoice.bottleStartDate) || !validDate(invoice.bottleEndDate) ||
        invoice.bottleStartDate > invoice.bottleEndDate ||
        invoice.bottleStartDate.slice(0, 7) !== input.period || invoice.bottleEndDate.slice(0, 7) !== input.period) {
      result.needsReview = true;
      const number = String(invoice.invoiceNumber ?? "").trim() || String(invoice.id);
      if (!legacyInvoiceNumbers.includes(number)) legacyInvoiceNumbers.push(number);
      continue;
    }
    // Paid and later-issued invoices still own their saved bottle periods.
    blockingRanges.push({ start: invoice.bottleStartDate, end: invoice.bottleEndDate });
  }
  let candidate: SuggestedPeriod | null = null;
  const finishSegment = () => {
    if (candidate) periods.push(candidate);
    candidate = null;
  };
  for (const cursor = parseIso(start); isoUtc(cursor) <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const date = isoUtc(cursor);
    if (blockingRanges.some((range) => range.start <= date && range.end >= date)) {
      finishSegment();
      continue;
    }
    const day = days.get(date);
    if (!day) continue;
    candidate ??= { startDate: date, endDate: date, units: 0, customerFuelKopecks: 0, grossKopecks: 0 };
    candidate.endDate = date;
    candidate.units += day.units;
    candidate.customerFuelKopecks += day.fuel;
    candidate.grossKopecks += day.units * input.settings.rateKopecks;
  }
  finishSegment();
  return result;
}

export function reconciliationDateError(meta: Pick<DocumentMeta, "period" | "documentDate" | "asOfDate">) {
  const end = periodBounds(meta.period).end;
  const asOf = meta.asOfDate || meta.documentDate;
  if (meta.documentDate && asOf && (meta.documentDate < end || asOf < end)) {
    return `Акт сверки включает весь ${periodLabel(meta.period)}. Даты составления и сверки должны быть не раньше ${shortDate(end)}. Выберите нужную дату или нажмите «Обновить даты на сегодня».`;
  }
  return null;
}

export function reconciliationSummary(input: OfficialDocumentInput) {
  const asOf = input.meta.asOfDate || input.meta.documentDate;
  const invoiceIds = new Set(input.invoices.filter((invoice) =>
    !invoice.period || invoice.period === input.meta.period).map((invoice) => invoice.id));
  const payments = input.payments.filter((payment) => invoiceIds.has(payment.invoiceId) && payment.paymentDate <= asOf);
  const paidKopecks = payments.reduce((sum, payment) => sum + payment.amountKopecks, 0);
  const bounds = periodBounds(input.meta.period);
  const opening = input.meta.openingBalanceKopecks;
  const openingPayments = (input.openingPayments ?? []).filter((payment) =>
    opening > 0 && !invoiceIds.has(payment.invoiceId) && payment.paymentDate >= bounds.start && payment.paymentDate <= asOf);
  const openingPaidKopecks = openingPayments.reduce((sum, payment) => sum + payment.amountKopecks, 0);
  const fuel = calculateFuelAdjustment(input.meta.period, input.calculation,
    (input.expenses ?? []).filter((expense) => expense.expenseDate <= asOf));
  return { payments, paidKopecks, openingPayments, openingPaidKopecks, ...fuel, opening,
    netRentKopecks: fuel.calculation.totalKopecks,
    balance: opening + fuel.calculation.totalKopecks - paidKopecks - openingPaidKopecks, asOf };
}

// amountKopecks is the amount on an issued invoice. Customer fuel is deducted
// from rent before issuing invoices, so it must not reduce that amount again.
export function calculateSettlement(
  period: string,
  calculation: DocumentCalculation,
  invoices: InvoiceLike[],
  expenses: ExpenseLike[],
) {
  const periodInvoices = invoices.filter((invoice) => !invoice.period || invoice.period === period);
  const fuel = calculateFuelAdjustment(period, calculation, expenses);
  const totalInvoicedKopecks = periodInvoices.reduce((sum, invoice) => sum + (invoice.amountKopecks ?? 0), 0);
  const netRentKopecks = fuel.calculation.totalKopecks;
  const remainingToInvoiceKopecks = Math.max(0, netRentKopecks - totalInvoicedKopecks);
  const fixedTargetKopecks = fuel.calculation.baseKopecks;
  const variableTargetKopecks = fuel.calculation.variableKopecks;
  const fixedInvoiced = periodInvoices.filter((invoice) => invoice.kind === "fixed")
    .reduce((sum, invoice) => sum + (invoice.amountKopecks ?? 0), 0);
  const variableInvoiced = periodInvoices.filter((invoice) => invoice.kind === "variable")
    .reduce((sum, invoice) => sum + (invoice.amountKopecks ?? 0), 0);
  return { ...fuel, totalInvoicedKopecks, netRentKopecks, remainingToInvoiceKopecks,
    fixedTargetKopecks, variableTargetKopecks,
    fixedRemainingKopecks: Math.min(remainingToInvoiceKopecks, Math.max(0, fixedTargetKopecks - fixedInvoiced)),
    variableRemainingKopecks: Math.min(remainingToInvoiceKopecks, Math.max(0, variableTargetKopecks - variableInvoiced)) };
}

function reconciliationPages(input: OfficialDocumentInput) {
  const dateError = reconciliationDateError(input.meta);
  if (dateError) throw new Error(dateError);
  const { settings: s, meta: m, calculation: c } = input;
  const b = periodBounds(m.period);
  const { payments, paidKopecks, openingPaidKopecks, customerFuelKopecks, fuelUnits, roundedFuelKopecks,
    roundingKopecks, fuelDeductionKopecks, netRentKopecks, opening, balance, asOf } = reconciliationSummary(input);
  const invoices = input.invoices.filter((invoice) => (!invoice.period || invoice.period === m.period) &&
    (!invoice.invoiceDate || invoice.invoiceDate <= asOf))
    .sort((a, b) => (a.bottleStartDate ?? a.invoiceDate ?? "").localeCompare(b.bottleStartDate ?? b.invoiceDate ?? "") || a.id - b.id);
  const fuelByDate = new Map<string, number>();
  for (const expense of input.expenses ?? []) {
    if (expense.category !== "fuel" || expense.payer !== "customer" ||
        expense.expenseDate < b.start || expense.expenseDate > b.end || expense.expenseDate > asOf) continue;
    fuelByDate.set(expense.expenseDate, (fuelByDate.get(expense.expenseDate) ?? 0) + expense.amountKopecks);
  }
  const validRange = (invoice: InvoiceLike) => Boolean(invoice.bottleStartDate && invoice.bottleEndDate &&
    invoice.bottleStartDate >= b.start && invoice.bottleEndDate <= b.end &&
    invoice.bottleStartDate <= invoice.bottleEndDate);
  const entriesByDate = new Map<string, number>();
  for (const entry of input.entries ?? []) {
    if (entry.entryDate < b.start || entry.entryDate > b.end ||
        (s.rentalStart && entry.entryDate < s.rentalStart) || (s.rentalEnd && entry.entryDate > s.rentalEnd)) continue;
    entriesByDate.set(entry.entryDate, (entriesByDate.get(entry.entryDate) ?? 0) + entry.units);
  }
  const rows = [
    ["Задолженность на начало периода", rubles(opening)],
    [`Начислено за ${monthNames[Number(m.period.slice(5)) - 1]} до учёта топлива, ${s.vatLabel === "Без НДС" ? "без НДС" : s.vatLabel}`, rubles(c.totalKopecks)],
    ["Вычет топлива, оплаченного заказчиком", `−${rubles(fuelDeductionKopecks)}`],
    ["Поступившие платежи", `−${rubles(paidKopecks + openingPaidKopecks)}`],
    [`Задолженность Арендатора на ${shortDate(asOf)}`, rubles(balance)],
  ];
  const invoiceRows: string[] = [];
  const dailyRows: string[] = [];
  const invoicedDates = new Set<string>();
  const shownDailyDates = new Set<string>();
  const invoiceGroups: InvoiceLike[][] = [];
  const invoiceDates = (invoice: InvoiceLike) => {
    const dates: string[] = [];
    if (validRange(invoice)) {
      for (let date = parseIso(invoice.bottleStartDate!); isoUtc(date) <= invoice.bottleEndDate!;
        date = new Date(date.getTime() + 86_400_000)) dates.push(isoUtc(date));
    }
    return dates;
  };
  for (const invoice of invoices) {
    const range = validRange(invoice);
    const dates = invoiceDates(invoice);
    dates.forEach((date) => invoicedDates.add(date));
    const invoiceAmount = invoice.amountKopecks ?? 0;
    const paid = payments.filter((payment) => payment.invoiceId === invoice.id)
      .reduce((sum, payment) => sum + payment.amountKopecks, 0);
    invoiceRows.push(`<tr><td>№ ${escapeHtml(invoice.invoiceNumber)}<br>${invoice.invoiceDate ? shortDate(invoice.invoiceDate) : ""}</td>
      <td class="value">${rubles(invoiceAmount)}</td>
      <td class="value">${rubles(paid)}</td><td class="value">${rubles(invoiceAmount - paid)}</td></tr>`);
    if (!range) continue;
    const connectedGroups = invoiceGroups.filter((group) => group.some((item) => sharedBottlePeriodParts(item, invoice)));
    if (!connectedGroups.length) invoiceGroups.push([invoice]);
    else {
      const merged = [...connectedGroups.flat(), invoice];
      for (const group of connectedGroups) invoiceGroups.splice(invoiceGroups.indexOf(group), 1);
      invoiceGroups.push(merged);
    }
  }
  invoiceGroups.sort((first, second) => first[0].bottleStartDate!.localeCompare(second[0].bottleStartDate!));
  for (const group of invoiceGroups) {
    const dates = [...new Set(group.flatMap(invoiceDates))].filter((date) =>
      (entriesByDate.has(date) || fuelByDate.has(date)) && !shownDailyDates.has(date)).sort();
    const rangeStart = group.map((item) => item.bottleStartDate!).sort()[0];
    const rangeEnd = group.map((item) => item.bottleEndDate!).sort().at(-1)!;
    const refs = group.map((item) => `№ ${escapeHtml(item.invoiceNumber)}`).join(", ");
    const units = dates.reduce((sum, date) => sum + (entriesByDate.get(date) ?? 0), 0);
    for (const date of dates) {
      const dayUnits = entriesByDate.get(date) ?? 0;
      const dayFuel = fuelByDate.get(date) ?? 0;
      shownDailyDates.add(date);
      dailyRows.push(`<tr><td>${date === dates[0] ? `${refs} · ${shortDate(rangeStart)}–${shortDate(rangeEnd)}` : ""}</td>
        <td>${shortDate(date)}</td><td class="value">${integer(dayUnits)}</td>
        <td class="value">${dayFuel ? rubles(dayFuel) : "—"}</td><td class="value">${rubles(dayUnits * c.rateKopecks)}</td></tr>`);
    }
    dailyRows.push(`<tr class="total"><td>Итого по дням ${group.length === 1 ? "счёта" : "счетов"} ${refs}${dates.length ? "" : ` · ${shortDate(rangeStart)}–${shortDate(rangeEnd)}`}</td><td></td>
      <td class="value">${integer(units)}</td><td class="value">—</td>
      <td class="value">${rubles(units * c.rateKopecks)}</td></tr>`);
  }
  // Old backups have no invoice ranges. Keep their actual daily entries visible
  // without inventing which invoice covered each date.
  const unlinkedDates = [...new Set([...entriesByDate.keys(), ...fuelByDate.keys()])]
    .filter((date) => !invoicedDates.has(date)).sort();
  for (const date of unlinkedDates) {
    const units = entriesByDate.get(date) ?? 0;
    const fuel = fuelByDate.get(date) ?? 0;
    dailyRows.push(`<tr><td>${date === unlinkedDates[0] ? "Дни без связи со счётом" : ""}</td><td>${shortDate(date)}</td>
      <td class="value">${integer(units)}</td><td class="value">${fuel ? rubles(fuel) : "—"}</td>
      <td class="value">${rubles(units * c.rateKopecks)}</td></tr>`);
  }
  const netRent = netRentKopecks;
  const dailyGross = [...entriesByDate.values()].reduce((sum, units) => sum + units * c.rateKopecks, 0);
  if (dailyGross !== c.totalKopecks) dailyRows.push(`<tr><td colspan="4">Доплата до начисления по акту-расчёту № ${escapeHtml(m.actNumber)}</td>
    <td class="value">${rubles(c.totalKopecks - dailyGross)}</td></tr>`);
  const totalInvoiced = invoices.reduce((sum, invoice) => sum + (invoice.amountKopecks ?? 0), 0);
  const visibleInvoiceIds = new Set(invoices.map((invoice) => invoice.id));
  const advances = payments.filter((payment) => !visibleInvoiceIds.has(payment.invoiceId))
    .reduce((sum, payment) => sum + payment.amountKopecks, 0);
  if (advances) invoiceRows.push(`<tr><td>Аванс до даты выставления счёта</td><td class="value">—</td>
    <td class="value">${rubles(advances)}</td><td class="value">−${rubles(advances)}</td></tr>`);
  invoiceRows.push(`<tr class="total"><td>Итого по счетам</td>
    <td class="value">${rubles(totalInvoiced)}</td>
    <td class="value">${rubles(paidKopecks)}</td><td class="value">${rubles(totalInvoiced - paidKopecks)}</td></tr>`);
  invoiceRows.push(`<tr class="total"><td colspan="3">Осталось выставить</td>
    <td class="value">${rubles(Math.max(0, netRent - totalInvoiced))}</td></tr>`);
  dailyRows.push(`<tr class="total"><td colspan="2">Начислено за ${escapeHtml(periodLabel(m.period))}</td><td class="value">${integer(c.actualUnits)}</td>
    <td class="value">${rubles(customerFuelKopecks)}</td><td class="value">${rubles(c.totalKopecks)}</td></tr>`);
  dailyRows.push(`<tr><td colspan="4">Вычет топлива заказчика за месяц${fuelUnits ? `: ${integer(fuelUnits)} ${plural(fuelUnits, "бутыль", "бутыли", "бутылей")} × ${rubles(c.rateKopecks)} руб.` : ""}${roundingKopecks ? `; округление ${rubles(roundingKopecks)} руб.` : ""}${fuelDeductionKopecks < roundedFuelKopecks ? "; в пределах начисления" : ""}</td><td class="value">−${rubles(fuelDeductionKopecks)}</td></tr>`);
  dailyRows.push(`<tr class="total"><td colspan="4">Итого к оплате за месяц после вычета топлива</td><td class="value">${rubles(netRent)}</td></tr>`);
  const invoiceHeader = `<tr><th>Счёт</th><th>К оплате</th><th>Оплачено</th><th>Остаток</th></tr>`;
  const invoiceTable = (tableRows: string[]) => `<table class="reconciliation-invoices"><colgroup><col style="width:40%"><col style="width:20%"><col style="width:20%"><col style="width:20%"></colgroup><thead>${invoiceHeader}</thead>
    <tbody>${tableRows.join("")}</tbody></table>`;
  const dailyHeader = `<tr><th>Счёт / период</th><th>Дата</th><th>Бутылей</th><th>Топливо заказчика, руб.</th><th>Итог, руб.</th></tr>`;
  const dailyTable = (tableRows: string[]) => `<table class="reconciliation-daily"><colgroup><col style="width:29%"><col style="width:19%"><col style="width:12%"><col style="width:20%"><col style="width:20%"></colgroup><thead>${dailyHeader}</thead><tbody>${tableRows.join("")}</tbody></table>`;
  const summaryRows = rows.map(([label, value], i) => `<tr class="${i === 4 ? "total" : ""}"><td>${escapeHtml(label)}</td><td class="value">${escapeHtml(value)}</td></tr>`);
  const introduction = `<h1>АКТ СВЕРКИ ВЗАИМНЫХ РАСЧЁТОВ</h1>
  <p class="number">№${escapeHtml(m.reconciliationNumber)}　Дата составления: ${shortDate(m.documentDate)}</p>
  <p class="subtitle">по аренде за ${escapeHtml(periodLabel(m.period))}, по состоянию на ${shortDate(asOf)}</p>
  <p class="city">г. ${escapeHtml(s.city)}</p>
  <p>${escapeHtml(s.lessorFull)} (Арендодатель) и ${escapeHtml(s.lesseeFull)} (Арендатор) составили настоящий акт по автомобилю ${escapeHtml(s.vehicleModel)}, госномер ${escapeHtml(s.vehiclePlate)}, по договору № ${escapeHtml(s.contractNumber)} от ${shortDate(s.contractDate)}.</p>
  <p><b>1.</b> Сверка за период ${shortDate(b.start)}–${shortDate(b.end)}, по выставленным счетам и платежам, полученным по состоянию на ${shortDate(asOf)}. Основание начисления — акт-расчёт № ${escapeHtml(m.actNumber)} за ${escapeHtml(periodLabel(m.period))}.</p>
  <table class="reconciliation"><thead><tr><th>Показатель</th><th class="value">Сумма, руб.</th></tr></thead><tbody>
  ${summaryRows.join("")}</tbody></table>
  ${openingPaidKopecks ? `<p>В поступившие платежи включены ${rubles(openingPaidKopecks)} руб. в погашение задолженности за предыдущие месяцы.</p>` : ""}
  <p><b>2.</b> Расшифровка выставленных счетов.</p>`;

  // Pack the invoice and daily tables in reading order. Reserve room for wrapped
  // cells so short acts fit one sheet and longer acts retain every daily row.
  const lineCount = (html: string, width: number, fontSize: number, bold = false) =>
    html.split(/<br\s*\/?\s*>/i).reduce((sum, line) => {
      const text = line.replace(/<[^>]*>/g, "").replace(/&[^;]+;/g, "x");
      return sum + Math.max(1, Math.ceil(text.length * fontSize * (bold ? 0.62 : 0.58) / width));
    }, 0);
  const rowHeight = (html: string, widths: number[], fontSize: number, padding: number) => {
    let column = 0;
    let lines = 1;
    for (const cell of html.matchAll(/<t[dh]([^>]*)>([\s\S]*?)<\/t[dh]>/g)) {
      const span = Number(cell[1].match(/colspan="(\d+)"/)?.[1] ?? 1);
      const width = widths.slice(column, column + span).reduce((sum, value) => sum + value, 0) * 7.06 - padding - 1;
      lines = Math.max(lines, lineCount(cell[2], width, fontSize, html.includes('class="total"') || html.includes("<th>")));
      column += span;
    }
    return lines * fontSize * 1.19 + padding + 1;
  };
  const invoiceWidths = [40, 20, 20, 20];
  const dailyWidths = [29, 19, 12, 20, 20];
  const introHeight = 24 + [...introduction.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)]
    .reduce((sum, paragraph) => sum + lineCount(paragraph[1], 690, 13.34) * 16 + 7, 0) +
    summaryRows.reduce((sum, row) => sum + rowHeight(row, [70, 30], 12.27, 8), 0) + 42;
  const pages = [{ content: introduction, remaining: 1010 - introHeight }];
  const appendTable = (tableRows: string[], widths: number[], fontSize: number, padding: number,
    header: string, render: (rows: string[]) => string, repeatFirstColumn = false) => {
    const overhead = rowHeight(header, widths, fontSize, padding) + 16;
    let start = 0;
    while (start < tableRows.length) {
      let firstRow = tableRows[start];
      if (repeatFirstColumn && firstRow.startsWith("<tr><td></td>")) {
        const label = tableRows.slice(0, start).reverse()
          .map((row) => row.match(/^<tr><td>(.+?)<\/td>/)?.[1]).find(Boolean);
        if (label) firstRow = firstRow.replace("<tr><td></td>", `<tr><td>${label}</td>`);
      }
      let page = pages[pages.length - 1];
      const firstHeight = rowHeight(firstRow, widths, fontSize, padding);
      if (page.remaining < overhead + firstHeight) {
        page = { content: "", remaining: 1010 };
        pages.push(page);
      }
      let end = start;
      let height = overhead;
      while (end < tableRows.length) {
        const nextHeight = rowHeight(end === start ? firstRow : tableRows[end], widths, fontSize, padding);
        if (end > start && height + nextHeight > page.remaining) break;
        height += nextHeight;
        end++;
      }
      page.content += render([firstRow, ...tableRows.slice(start + 1, end)]);
      page.remaining -= height;
      start = end;
    }
  };
  appendTable(invoiceRows, invoiceWidths, 12.27, 6, invoiceHeader, invoiceTable);
  appendTable(dailyRows, dailyWidths, 11.6, 4, dailyHeader, dailyTable, true);
  return pages.map((page) => `<div class="reconciliation-page">${page.content}</div>`);
}

export function buildRentActHtml(input: OfficialDocumentInput) {
  return wrapDocument(`Акт-расчёт № ${input.meta.actNumber}`, [rentActBody(input)]);
}
export function buildReconciliationHtml(input: OfficialDocumentInput) {
  return wrapDocument(`Акт сверки № ${input.meta.reconciliationNumber}`, reconciliationPages(input));
}
export function buildDocumentPackageHtml(input: OfficialDocumentInput) {
  return wrapDocument(`Документы за ${periodLabel(input.meta.period)}`, [rentActBody(input), ...reconciliationPages(input)]);
}

export function buildDailyStatementHtml(input: OfficialDocumentInput) {
  const b = periodBounds(input.meta.period);
  const entries = (input.entries ?? []).filter((e) => e.entryDate >= b.start && e.entryDate <= b.end &&
    e.entryDate >= input.settings.rentalStart && e.entryDate <= input.settings.rentalEnd)
    .sort((a, b) => a.entryDate.localeCompare(b.entryDate));
  const body = `<h1>Ежедневная ведомость учёта эксплуатации автомобиля ${escapeHtml(input.settings.vehicleModel)}</h1>
    <p class="subtitle">за период с ${shortDate(b.start)} по ${shortDate(b.end)}</p>
    <p>Договор № ${escapeHtml(input.settings.contractNumber)} от ${escapeHtml(longDate(input.settings.contractDate))}. Автомобиль: ${escapeHtml(input.settings.vehicleModel)}, VIN ${escapeHtml(input.settings.vehicleVin)}, госномер ${escapeHtml(input.settings.vehiclePlate)}.</p>
    <table><thead><tr><th>Дата</th><th>Количество учётных единиц</th><th>Примечание</th></tr></thead><tbody>
    ${entries.map((e) => `<tr><td>${shortDate(e.entryDate)}</td><td>${integer(e.units)}</td><td>${escapeHtml(e.note)}</td></tr>`).join("")}
    <tr class="total"><td>Итого</td><td>${integer(input.calculation.actualUnits)}</td><td>учётных единиц</td></tr></tbody></table>`;
  return wrapDocument("Ежедневная ведомость", [body]);
}

export function buildInternalLedgerHtml(input: OfficialDocumentInput) {
  const { invoices, payments, calculation, settings: s, meta: m } = input;
  const rows = invoices.map((i, idx) => {
    const paid = payments.filter((p) => p.invoiceId === i.id).reduce((sum, p) => sum + p.amountKopecks, 0);
    return `<tr><td>${idx + 1}</td><td>${escapeHtml(periodLabel(i.period ?? m.period))}</td><td>${escapeHtml(i.kind === "variable" ? "переменная часть" : i.kind === "fixed" ? "постоянная часть" : "другое")}</td><td>№ ${escapeHtml(i.invoiceNumber)}<br>${i.invoiceDate ? shortDate(i.invoiceDate) : ""}</td><td>${rubles(i.amountKopecks ?? 0)}</td><td>${i.actNumber ? `№ ${escapeHtml(i.actNumber)}` : "—"}</td><td>${escapeHtml(payments.filter((p) => p.invoiceId === i.id).map((p) => `${shortDate(p.paymentDate)} — ${rubles(p.amountKopecks)}`).join("; "))}</td><td>${rubles((i.amountKopecks ?? 0) - paid)}</td><td>${escapeHtml(i.note)}</td></tr>`;
  });
  const pages = [];
  for (let start = 0; start < Math.max(rows.length, 1); start += 14) {
    pages.push(`<h1>Реестр начислений и выставленных счетов по договору аренды № ${escapeHtml(s.contractNumber)}</h1>
      <p class="subtitle">${escapeHtml(periodLabel(m.period))} · внутренний документ</p>
      <p>Начислено по акту-расчёту № ${escapeHtml(m.actNumber)}: ${rubles(calculation.totalKopecks)} руб. Счета: ${rubles(invoices.reduce((sum, i) => sum + (i.amountKopecks ?? 0), 0))} руб. Оплаты: ${rubles(payments.reduce((sum, p) => sum + p.amountKopecks, 0))} руб. Остаток за период: ${rubles(calculation.totalKopecks - payments.reduce((sum, p) => sum + p.amountKopecks, 0))} руб.</p>
      <table class="compact"><thead><tr><th>№</th><th>Период</th><th>Вид</th><th>Счёт</th><th>Сумма</th><th>Акт</th><th>Платежи</th><th>Остаток</th><th>Примечание</th></tr></thead><tbody>${rows.slice(start, start + 14).join("")}</tbody></table>`);
  }
  return wrapDocument("Внутренний реестр", pages);
}
