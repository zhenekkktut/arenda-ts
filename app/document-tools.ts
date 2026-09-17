export type DocumentSettings = {
  city: string;
  contractNumber: string;
  contractDate: string;
  lessorFull: string;
  lessorShort: string;
  lessorSignerShort: string;
  lessorInn: string;
  lesseeFull: string;
  lesseeShort: string;
  lesseeInn: string;
  lesseeKpp: string;
  lesseeDirector: string;
  lesseeDirectorShort: string;
  vehicleModel: string;
  vehicleVin: string;
  vehiclePlate: string;
  baseKopecks: number;
  includedUnits: number;
  rateKopecks: number;
};

export type Downtime = {
  id: number;
  startDate: string;
  endDate: string;
  reason: string;
  note: string;
};

export type DocumentMeta = {
  period: string;
  actNumber: string;
  reconciliationNumber: string;
  documentDate: string;
  basis: string;
  openingBalanceKopecks: number;
};

export type DocumentCalculation = {
  actualUnits: number;
  includedUnits: number;
  excessUnits: number;
  baseFullKopecks: number;
  baseKopecks: number;
  baseReductionKopecks: number;
  rateKopecks: number;
  variableKopecks: number;
  totalKopecks: number;
  calendarDays: number;
  downtimeDays: number;
  payableDays: number;
};

type EntryLike = { entryDate: string; units: number };
type PaymentLike = {
  invoiceId: number;
  paymentDate: string;
  amountKopecks: number;
  method: "bank" | "cash";
  documentNumber: string;
};
type InvoiceLike = { id: number; invoiceNumber: string };
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
  contractNumber: "[НОМЕР ДОГОВОРА]",
  contractDate: "2026-08-01",
  lessorFull: "Индивидуальный предприниматель [ФИО]",
  lessorShort: "ИП [ФИО]",
  lessorSignerShort: "[ФИО]",
  lessorInn: "[ИНН]",
  lesseeFull: "ООО «[НАИМЕНОВАНИЕ]»",
  lesseeShort: "ООО «[НАИМЕНОВАНИЕ]»",
  lesseeInn: "[ИНН]",
  lesseeKpp: "[КПП]",
  lesseeDirector: "[ФИО ДИРЕКТОРА]",
  lesseeDirectorShort: "[ФИО]",
  vehicleModel: "Fiat Ducato",
  vehicleVin: "[VIN]",
  vehiclePlate: "[ГОСНОМЕР]",
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

  const actualUnits = entries
    .filter((entry) => entry.entryDate >= bounds.start && entry.entryDate <= bounds.end)
    .reduce((sum, entry) => sum + entry.units, 0);
  const downtimeDays = unavailable.size;
  const payableDays = Math.max(0, bounds.days - downtimeDays);
  // По согласованной схеме простой уменьшает постоянную часть только тогда,
  // когда месячная интенсивность ниже включённого объёма. При достижении
  // лимита постоянная часть остаётся полной, а сверх лимита начисляется ставка.
  const reduceBaseForDowntime = actualUnits < settings.includedUnits;
  const baseKopecks = reduceBaseForDowntime
    ? Math.round(settings.baseKopecks * payableDays / bounds.days)
    : settings.baseKopecks;
  const excessUnits = Math.max(0, actualUnits - settings.includedUnits);
  const variableKopecks = excessUnits * settings.rateKopecks;

  return {
    actualUnits,
    includedUnits: settings.includedUnits,
    excessUnits,
    baseFullKopecks: settings.baseKopecks,
    baseKopecks,
    baseReductionKopecks: settings.baseKopecks - baseKopecks,
    rateKopecks: settings.rateKopecks,
    variableKopecks,
    totalKopecks: baseKopecks + variableKopecks,
    calendarDays: bounds.days,
    downtimeDays,
    payableDays,
  };
}

export function periodLabel(period: string) {
  const [year, month] = period.split("-");
  return `${monthNames[Number(month) - 1]} ${year} года`;
}

export function longDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return `${day} ${monthNamesGenitive[month - 1]} ${year} года`;
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

const officialCss = `
  @page { size: A4; margin: 15mm 17mm 15mm; }
  * { box-sizing: border-box; }
  body { margin: 0; color: #000; background: #fff; font-family: "Noto Serif", "Times New Roman", serif; font-size: 10.6pt; line-height: 1.3; }
  .page { width: 100%; }
  .page + .page { page-break-before: always; break-before: page; }
  h1 { margin: 0 0 3mm; text-align: center; font-size: 14pt; line-height: 1.2; text-transform: uppercase; }
  .number, .city { margin: 0 0 2.5mm; text-align: center; }
  p { margin: 0 0 2.2mm; text-align: justify; }
  .contract { margin-bottom: 2.5mm; }
  table { width: 100%; margin: 3mm 0; border-collapse: collapse; font-size: 9.7pt; }
  th, td { padding: 2.1mm 2mm; border: 0.25mm solid #999; vertical-align: top; }
  th { background: #eee; text-align: left; font-weight: 700; }
  td.money, th.money { width: 31%; text-align: right; white-space: nowrap; }
  .reconciliation th, .reconciliation td { padding: 1.7mm 1.5mm; font-size: 8.7pt; }
  .reconciliation .date { width: 15%; white-space: nowrap; }
  .reconciliation .sum { width: 15%; text-align: right; white-space: nowrap; }
  .total td { font-weight: 700; }
  .words { margin-top: 3mm; font-weight: 700; }
  .signatures { display: grid; grid-template-columns: 1fr 1fr; gap: 12mm; margin-top: 10mm; page-break-inside: avoid; }
  .signature-title { font-weight: 700; }
  .signature-line { margin-top: 13mm; white-space: nowrap; }
  .signature-date { margin-top: 5mm; }
  .muted { font-size: 9pt; }
  .nowrap { white-space: nowrap; }
  @media screen {
    html, body { width: 794px; min-width: 794px; }
    .page { width: 794px; height: 1123px; padding: 57px 64px; overflow: hidden; }
  }
`;

function wrapDocument(title: string, pages: string[]) {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=794, initial-scale=1"><title>${escapeHtml(title)}</title><style>${officialCss}</style></head><body>${pages.map((page) => `<section class="page">${page}</section>`).join("")}</body></html>`;
}

type OfficialDocumentInput = {
  settings: DocumentSettings;
  meta: DocumentMeta;
  calculation: DocumentCalculation;
  downtimes: Downtime[];
  invoices: InvoiceLike[];
  payments: PaymentLike[];
  expenses: ExpenseLike[];
};

function parties(settings: DocumentSettings) {
  return `${escapeHtml(settings.lessorFull)}, ИНН ${escapeHtml(settings.lessorInn)} (Арендодатель), и ${escapeHtml(settings.lesseeFull)}, ИНН ${escapeHtml(settings.lesseeInn)}, КПП ${escapeHtml(settings.lesseeKpp)}, в лице генерального директора ${escapeHtml(settings.lesseeDirector)}, действующего на основании Устава (Арендатор)`;
}

function signatures(settings: DocumentSettings) {
  return `<div class="signatures"><div><div class="signature-title">Арендодатель</div><div>${escapeHtml(settings.lessorShort)}</div><div class="signature-line">____________ / ${escapeHtml(settings.lessorSignerShort)} /</div><div class="signature-date">Дата подписи: ____________</div></div><div><div class="signature-title">Арендатор</div><div>Генеральный директор ${escapeHtml(settings.lesseeShort)}</div><div class="signature-line">____________ / ${escapeHtml(settings.lesseeDirectorShort)} /</div><div class="signature-date">Дата подписи: ____________</div></div></div>`;
}

function rentActBody(input: OfficialDocumentInput) {
  const { settings, meta, calculation } = input;
  const bounds = periodBounds(meta.period);
  const variableFormula = calculation.excessUnits > 0
    ? `(${integer(calculation.actualUnits)} - ${integer(calculation.includedUnits)}) × ${rubles(calculation.rateKopecks)} руб.`
    : `превышение отсутствует`;
  const baseLabel = calculation.downtimeDays > 0
    ? `Постоянная часть: ${rubles(calculation.baseFullKopecks)} × ${calculation.payableDays} / ${calculation.calendarDays} дней`
    : `Постоянная часть за полный месяц (до ${integer(calculation.includedUnits)} бутылей)`;
  const downtimeText = calculation.downtimeDays > 0
    ? ` Исключено ${calculation.downtimeDays} ${plural(calculation.downtimeDays, "календарный день", "календарных дня", "календарных дней")} простоя автомобиля.`
    : "";

  return `
    <h1>Акт аренды и расчёт арендной платы</h1>
    <p class="number">№ ${escapeHtml(meta.actNumber)} от ${escapeHtml(longDate(meta.documentDate))}</p>
    <p class="city">г. ${escapeHtml(settings.city)}</p>
    <p class="contract">Договор аренды транспортного средства без экипажа № ${escapeHtml(settings.contractNumber)} от ${escapeHtml(longDate(settings.contractDate))}.</p>
    <p>${parties(settings)}, составили настоящий акт о нижеследующем.</p>
    <p>1. В период с ${escapeHtml(longDate(bounds.start))} по ${escapeHtml(longDate(bounds.end))} автомобиль ${escapeHtml(settings.vehicleModel)}, VIN ${escapeHtml(settings.vehicleVin)}, государственный регистрационный знак ${escapeHtml(settings.vehiclePlate)}, находился во временном владении и пользовании Арендатора на условиях аренды без экипажа.</p>
    <p>2. Стороны подтверждают показатель использования автомобиля за указанный период: <strong>${integer(calculation.actualUnits)} полных бутылей объёмом 18,9-19 литров</strong>, учитываемых по договору. Оплачиваемый период составляет ${calculation.payableDays} ${plural(calculation.payableDays, "календарный день", "календарных дня", "календарных дней")} из ${calculation.calendarDays} дней месяца.${downtimeText}</p>
    <p>Основание расчёта количества: ${escapeHtml(meta.basis || "ежедневный реестр показателей использования автомобиля")}.</p>
    <p>3. Арендная плата за ${escapeHtml(periodLabel(meta.period))}:</p>
    <table><thead><tr><th>Состав арендной платы</th><th class="money">Сумма, руб.</th></tr></thead><tbody>
      <tr><td>${baseLabel}</td><td class="money">${rubles(calculation.baseKopecks)}</td></tr>
      <tr><td>Переменная часть: ${variableFormula}</td><td class="money">${rubles(calculation.variableKopecks)}</td></tr>
      <tr class="total"><td>Итого начислено, без НДС</td><td class="money">${rubles(calculation.totalKopecks)}</td></tr>
    </tbody></table>
    <p class="words">Всего начислено: ${rubles(calculation.totalKopecks)} (${escapeHtml(moneyWords(calculation.totalKopecks))}), без НДС.</p>
    <p>4. Сведения об оплате, зачётах и остатке задолженности за указанный период оформляются отдельным актом сверки взаимных расчётов № ${escapeHtml(meta.reconciliationNumber)} от ${escapeHtml(longDate(meta.documentDate))}.</p>
    <p>5. Подписи сторон подтверждают период аренды, показатель использования автомобиля и размер начисленной платы. Настоящий акт не удостоверяет оплату аренды и не прекращает неисполненные денежные обязательства.</p>
    <p>6. Акт составлен в двух экземплярах, по одному для каждой стороны.</p>
    ${signatures(settings)}
  `;
}

function reconciliationData(input: OfficialDocumentInput) {
  const rows: { date: string; text: string; debit: number; credit: number; balance: number }[] = [];
  let balance = input.meta.openingBalanceKopecks;
  if (balance !== 0) rows.push({ date: periodBounds(input.meta.period).start, text: "Сальдо на начало периода", debit: Math.max(0, balance), credit: Math.max(0, -balance), balance });
  balance += input.calculation.totalKopecks;
  rows.push({
    date: input.meta.documentDate,
    text: `Акт аренды № ${input.meta.actNumber}. Арендная плата за ${periodLabel(input.meta.period)}`,
    debit: input.calculation.totalKopecks,
    credit: 0,
    balance,
  });
  for (const payment of [...input.payments].sort((a, b) => a.paymentDate.localeCompare(b.paymentDate))) {
    const invoice = input.invoices.find((item) => item.id === payment.invoiceId);
    balance -= payment.amountKopecks;
    const document = payment.documentNumber ? `, документ ${payment.documentNumber}` : "";
    rows.push({ date: payment.paymentDate, text: `Оплата${invoice ? ` по счёту № ${invoice.invoiceNumber}` : ""} (${payment.method === "bank" ? "безналичные" : "наличные"}${document})`, debit: 0, credit: payment.amountKopecks, balance });
  }
  for (const expense of input.expenses.filter((item) => item.category === "fuel" && item.payer === "customer").sort((a, b) => a.expenseDate.localeCompare(b.expenseDate))) {
    balance -= expense.amountKopecks;
    const details = [expense.documentNumber && `документ ${expense.documentNumber}`, expense.note].filter(Boolean).join(", ");
    rows.push({ date: expense.expenseDate, text: `Зачёт расходов на топливо, оплаченных Арендатором${details ? ` (${details})` : ""}`, debit: 0, credit: expense.amountKopecks, balance });
  }
  return { rows, balance };
}

function reconciliationBody(input: OfficialDocumentInput) {
  const { settings, meta, calculation } = input;
  const { rows, balance } = reconciliationData(input);
  const totalDebit = Math.max(0, meta.openingBalanceKopecks) + calculation.totalKopecks;
  const totalCredit = Math.max(0, -meta.openingBalanceKopecks) + input.payments.reduce((sum, item) => sum + item.amountKopecks, 0) + input.expenses.filter((item) => item.category === "fuel" && item.payer === "customer").reduce((sum, item) => sum + item.amountKopecks, 0);
  const conclusion = balance > 0
    ? `задолженность Арендатора в пользу Арендодателя составляет ${rubles(balance)} руб. (${moneyWords(balance)})`
    : balance < 0
      ? `аванс Арендатора составляет ${rubles(Math.abs(balance))} руб. (${moneyWords(Math.abs(balance))})`
      : "задолженность между сторонами отсутствует";

  return `
    <h1>Акт сверки взаимных расчётов</h1>
    <p class="number">№ ${escapeHtml(meta.reconciliationNumber)} от ${escapeHtml(longDate(meta.documentDate))}</p>
    <p class="city">г. ${escapeHtml(settings.city)}</p>
    <p class="contract">по договору аренды транспортного средства без экипажа № ${escapeHtml(settings.contractNumber)} от ${escapeHtml(longDate(settings.contractDate))}</p>
    <p>${parties(settings)}, составили настоящий акт сверки взаимных расчётов за ${escapeHtml(periodLabel(meta.period))}.</p>
    <table class="reconciliation"><thead><tr><th class="date">Дата</th><th>Документ и операция</th><th class="sum">Начислено, руб.</th><th class="sum">Оплачено / зачтено, руб.</th><th class="sum">Сальдо, руб.</th></tr></thead><tbody>
      ${rows.map((row) => `<tr><td class="date">${escapeHtml(row.date.split("-").reverse().join("."))}</td><td>${escapeHtml(row.text)}</td><td class="sum">${row.debit ? rubles(row.debit) : ""}</td><td class="sum">${row.credit ? rubles(row.credit) : ""}</td><td class="sum">${rubles(row.balance)}</td></tr>`).join("")}
      <tr class="total"><td colspan="2">Итого за период</td><td class="sum">${rubles(totalDebit)}</td><td class="sum">${rubles(totalCredit)}</td><td class="sum">${rubles(balance)}</td></tr>
    </tbody></table>
    <p class="words">По состоянию на ${escapeHtml(longDate(meta.documentDate))} ${escapeHtml(conclusion)}.</p>
    <p>Стороны подтверждают приведённые сведения о начислениях, оплатах и согласованных зачётах. При наличии расхождений сторона, обнаружившая их, направляет другой стороне подтверждающие документы.</p>
    <p>Акт составлен в двух экземплярах, по одному для каждой стороны.</p>
    ${signatures(settings)}
  `;
}

export function buildRentActHtml(input: OfficialDocumentInput) {
  return wrapDocument(`Акт аренды № ${input.meta.actNumber}`, [rentActBody(input)]);
}

export function buildReconciliationHtml(input: OfficialDocumentInput) {
  return wrapDocument(`Акт сверки № ${input.meta.reconciliationNumber}`, [reconciliationBody(input)]);
}

export function buildDocumentPackageHtml(input: OfficialDocumentInput) {
  return wrapDocument(`Документы по аренде за ${periodLabel(input.meta.period)}`, [rentActBody(input), reconciliationBody(input)]);
}
