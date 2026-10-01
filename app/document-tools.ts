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
type InvoiceLike = { id: number; invoiceNumber: string; invoiceDate?: string; period?: string; kind?: string; actNumber?: string; amountKopecks?: number; note?: string };
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
  h1 { margin: 0; text-align: center; font-size: 14pt; line-height: 1.18; font-weight: 700; }
  h2 { margin: 0 0 4px; text-align: center; font-size: 11.4pt; }
  p { margin: 0 0 6px; text-align: justify; }
  .number, .city, .subtitle { text-align: center; margin: 0 0 5px; }
  .city { margin: 1px 0 7px; }
  table { border-collapse: collapse; width: 100%; margin: 7px -8px 7px; width: calc(100% + 16px); font-size: 9.2pt; }
  th, td { border: 1px solid #b4b4b4; padding: 4px 6px; vertical-align: middle; }
  th { background: #e9e9e9; text-align: left; }
  .value { width: 31%; text-align: right; white-space: nowrap; }
  .reconciliation .value { width: 25%; }
  .reconciliation-page { font-size: 9.5pt; }
  .total { font-weight: bold; }
  .signatures { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 16px -8px 0; font-size: 9pt; page-break-inside: avoid; }
  .signature-line { margin-top: 18px; white-space: nowrap; }
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
  return `<div class="signatures"><div><b>Арендодатель</b><br>${escapeHtml(settings.lessorShort)}<div class="signature-line">________________ / ${escapeHtml(settings.lessorSignerShort)} /</div><div class="signature-date">Дата подписи: __________________</div></div><div><b>Арендатор</b><br>${escapeHtml(settings.lesseeShort)}<br>Генеральный директор ${escapeHtml(settings.lesseeDirectorShort)}<div class="signature-line">________________ / ${escapeHtml(settings.lesseeDirectorShort)} /</div><div class="signature-date">Дата подписи: __________________</div></div></div>`;
}

function rentActBody(input: OfficialDocumentInput) {
  const { settings: s, meta: m, calculation: c } = input;
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
    [`Постоянная часть Ф = ${integer(s.baseKopecks / 100)} × d / D`, `${rubles(c.baseKopecks)} руб.`],
    [`Показатель интенсивности И = ${integer(s.rateKopecks / 100)} × N`, `${rubles(c.intensityKopecks)} руб.`],
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

export function reconciliationSummary(input: OfficialDocumentInput) {
  const asOf = input.meta.asOfDate || input.meta.documentDate;
  const invoiceIds = new Set(input.invoices.map((invoice) => invoice.id));
  const payments = input.payments.filter((payment) => invoiceIds.has(payment.invoiceId) && payment.paymentDate <= asOf);
  const paidKopecks = payments.reduce((sum, payment) => sum + payment.amountKopecks, 0);
  const opening = input.meta.openingBalanceKopecks;
  return { payments, paidKopecks, opening, balance: opening + input.calculation.totalKopecks - paidKopecks, asOf };
}

function reconciliationBody(input: OfficialDocumentInput) {
  const { settings: s, meta: m, calculation: c } = input;
  const b = periodBounds(m.period);
  const { payments, paidKopecks, opening, balance, asOf } = reconciliationSummary(input);
  const invoiceRefs = [...new Set(payments.map((payment) => input.invoices.find((invoice) => invoice.id === payment.invoiceId))
    .filter((invoice): invoice is InvoiceLike => Boolean(invoice)))];
  const refs = invoiceRefs.length
    ? ` (основание: ${invoiceRefs.map((i) => `счёт № ${i.invoiceNumber} от ${i.invoiceDate ? shortDate(i.invoiceDate) : "____________"}`).join(", ")})`
    : "";
  const rows = [
    ["Задолженность на начало периода", rubles(opening)],
    [`Начислено за ${monthNames[Number(m.period.slice(5)) - 1]} по акту-расчёту № ${m.actNumber} от ${shortDate(m.documentDate)}, ${s.vatLabel === "Без НДС" ? "без НДС" : s.vatLabel}`, rubles(c.totalKopecks)],
    [`Оплачено в счёт аренды за ${monthNames[Number(m.period.slice(5)) - 1]}${refs}`, rubles(paidKopecks)],
    [`Задолженность Арендатора на ${shortDate(asOf)}`, rubles(balance)],
  ];
  const paymentDocuments = payments.map((p) => p.documentNumber).filter(Boolean).join(", ");
  return `<div class="reconciliation-page"><h1>АКТ СВЕРКИ ВЗАИМНЫХ РАСЧЁТОВ</h1>
  <p class="number">№${escapeHtml(m.reconciliationNumber)}　Дата составления: ${shortDate(m.documentDate)}</p>
  <p class="subtitle">по аренде за ${escapeHtml(periodLabel(m.period))}, по состоянию на ${shortDate(asOf)}</p>
  <p class="city">г. ${escapeHtml(s.city)}</p>
  <p>Договор аренды транспортного средства без экипажа № ${escapeHtml(s.contractNumber)} от ${escapeHtml(longDate(s.contractDate))}.</p>
  <p>${escapeHtml(s.lessorFull)}, ИНН ${escapeHtml(s.lessorInn)} (Арендодатель), и ${escapeHtml(s.lesseeFull)}, ИНН ${escapeHtml(s.lesseeInn)}, КПП ${escapeHtml(s.lesseeKpp)}, в лице генерального директора ${escapeHtml(s.lesseeDirector)}, действующего на основании Устава (Арендатор), составили настоящий документ о нижеследующем.</p>
  <p><b>1.</b> Сверка проведена по начислению арендной платы за период с ${shortDate(b.start)} по ${shortDate(b.end)} и платежам, отнесённым к этому периоду и полученным по состоянию на ${shortDate(asOf)}. Автомобиль: ${escapeHtml(s.vehicleModel)}, VIN ${escapeHtml(s.vehicleVin)}, государственный регистрационный знак ${escapeHtml(s.vehiclePlate)}.</p>
  <table class="reconciliation"><thead><tr><th>Показатель</th><th class="value">По данным<br>Арендодателя, руб.</th><th class="value">По данным<br>Арендатора, руб.</th></tr></thead><tbody>
  ${rows.map(([label, value], i) => `<tr class="${i === 3 ? "total" : ""}"><td>${escapeHtml(label)}</td><td class="value">${escapeHtml(value)}</td><td class="value">${escapeHtml(value)}</td></tr>`).join("")}</tbody></table>
  <p>Реквизиты платёжного документа и/или банковской выписки, подтверждающих оплату ${rubles(paidKopecks)} руб.:<br>${paymentDocuments ? escapeHtml(paymentDocuments) : "________________________________________________________________________________"}<br>________________________________________________________________________________</p>
  <p><b>2.</b> Подписанием настоящего акта Стороны подтверждают результаты сверки. ${escapeHtml(s.lesseeShort)} признаёт задолженность по арендной плате за ${escapeHtml(periodLabel(m.period))} перед ${escapeHtml(s.lessorDative)} в размере <b>${escapeHtml(amountWords(balance))}</b> по состоянию на ${shortDate(asOf)}.</p>
  <p><b>3.</b> Настоящий акт не изменяет установленные договором сроки оплаты, не предоставляет отсрочку или рассрочку и не создаёт повторного начисления. Платежи после ${shortDate(asOf)} уменьшают задолженность без переоформления акта-расчёта арендной платы. При необходимости Стороны составляют новую сверку на более позднюю дату.</p>
  <p><b>4.</b> Расчёты по иным обязательствам Сторон, неустойки и другие требования в настоящую сверку не включены, если они прямо не указаны выше.</p>
  <p><b>5.</b> Документ составлен в двух экземплярах, по одному для каждой Стороны.</p>
  ${signatures(s)}</div>`;
}

export function buildRentActHtml(input: OfficialDocumentInput) {
  return wrapDocument(`Акт-расчёт № ${input.meta.actNumber}`, [rentActBody(input)]);
}
export function buildReconciliationHtml(input: OfficialDocumentInput) {
  return wrapDocument(`Акт сверки № ${input.meta.reconciliationNumber}`, [reconciliationBody(input)]);
}
export function buildDocumentPackageHtml(input: OfficialDocumentInput) {
  return wrapDocument(`Документы за ${periodLabel(input.meta.period)}`, [rentActBody(input), reconciliationBody(input)]);
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
