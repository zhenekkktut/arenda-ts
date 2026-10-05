export type InvoiceBottleAllocation = { date: string; amountKopecks: number };

export type AllocationInvoiceLike = {
  id: number;
  invoiceNumber: string;
  period?: string;
  invoiceDate?: string;
  kind?: string;
  amountKopecks?: number;
  bottleStartDate?: string;
  bottleEndDate?: string;
  allocationVersion?: number;
  bottleAllocations?: InvoiceBottleAllocation[];
  rentalSupplementKopecks?: number;
};

export type InvoiceAllocationInput = {
  period: string;
  invoiceDate: string;
  amountKopecks: number;
  kind: "fixed" | "variable" | "other";
  entries: { entryDate: string; units: number }[];
  invoices: AllocationInvoiceLike[];
  settings: { rentalStart: string; rentalEnd: string; rateKopecks: number };
  fixedTargetKopecks: number;
  netRentKopecks: number;
  excludeInvoiceId?: number;
  startDate?: string;
  endDate?: string;
  allowRentalSupplement?: boolean;
};

export type NormalizedInvoiceAllocation = {
  allocationVersion: 1;
  bottleAllocations: InvoiceBottleAllocation[];
  rentalSupplementKopecks: number;
};

export type InvoiceAllocationProposal = {
  bottleAllocations: InvoiceBottleAllocation[];
  rentalSupplementKopecks: number;
  coveredKopecks: number;
  uncoveredKopecks: number;
  availableKopecks: number;
  startDate: string;
  endDate: string;
  lastDayRemainingKopecks: number;
  needsReview: boolean;
  legacyInvoiceNumbers: string[];
  invalidInvoiceNumbers: string[];
  ready: boolean;
  days: { date: string; units: number; grossKopecks: number; alreadyAllocatedKopecks: number;
    amountKopecks: number; remainingKopecks: number }[];
};

const safeMoney = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const validDate = (value: unknown): value is string => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};
const checkedAdd = (first: number, second: number) => {
  const result = first + second;
  if (!Number.isSafeInteger(result)) throw new Error("Сумма слишком большая для точного расчёта");
  return result;
};
const invoiceLabel = (invoice: AllocationInvoiceLike) => String(invoice.invoiceNumber ?? "").trim() || String(invoice.id);
const order = (first: AllocationInvoiceLike, second: AllocationInvoiceLike) =>
  String(first.invoiceDate ?? "").localeCompare(String(second.invoiceDate ?? "")) || first.id - second.id;

type AllocationContext = {
  start: string;
  end: string;
  leaseStart: string;
  leaseEnd: string;
  days: Map<string, { units: number; gross: number }>;
  claims: Map<string, number>;
  supplementAvailable: number;
  faceAvailable: number;
  needsReview: boolean;
  legacyInvoiceNumbers: string[];
  invalidInvoiceNumbers: string[];
};

function normalizeCandidate(candidate: unknown, amountKopecks: number,
  bounds: { start: string; end: string }, kind: string): NormalizedInvoiceAllocation {
  if (bounds.start > bounds.end) throw new Error("Для этой даты счёта нет периода внутри выбранного месяца и срока аренды");
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new Error("Подтвердите распределение суммы счёта по датам");
  }
  const value = candidate as Record<string, unknown>;
  if (value.allocationVersion !== 1 || !Array.isArray(value.bottleAllocations)) {
    throw new Error("Неизвестный формат привязки счёта. Проверьте распределение заново");
  }
  const supplement = value.rentalSupplementKopecks ?? 0;
  if (!safeMoney(supplement) || (supplement > 0 && kind !== "fixed")) {
    throw new Error("Доплата до постоянной части допустима только в счёте постоянной части");
  }
  const dates = new Set<string>();
  const bottleAllocations: InvoiceBottleAllocation[] = [];
  let total = supplement;
  for (const row of value.bottleAllocations) {
    if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error("Проверьте строки распределения счёта");
    const item = row as Record<string, unknown>;
    if (!validDate(item.date) || item.date < bounds.start || item.date > bounds.end) {
      throw new Error("Даты распределения должны быть внутри месяца и срока аренды, не позже даты счёта");
    }
    if (dates.has(item.date)) throw new Error("Каждая дата должна встречаться в распределении счёта один раз");
    if (!safeMoney(item.amountKopecks) || item.amountKopecks === 0) {
      throw new Error("Укажите положительную сумму за каждый день в целых копейках");
    }
    dates.add(item.date);
    total = checkedAdd(total, item.amountKopecks);
    bottleAllocations.push({ date: item.date, amountKopecks: item.amountKopecks });
  }
  if (!safeMoney(amountKopecks) || amountKopecks === 0 || total !== amountKopecks) {
    throw new Error("Сумма распределения по датам и доплаты должна точно совпадать с суммой счёта");
  }
  return { allocationVersion: 1, bottleAllocations: bottleAllocations.sort((a, b) => a.date.localeCompare(b.date)),
    rentalSupplementKopecks: supplement };
}

function allocationContext(input: InvoiceAllocationInput): AllocationContext {
  if (!validDate(`${input.period}-01`) || !/^\d{4}-\d{2}$/.test(input.period) || !validDate(input.invoiceDate)) {
    throw new Error("Укажите месяц и дату выставления счёта");
  }
  if (!safeMoney(input.settings.rateKopecks) || !safeMoney(input.fixedTargetKopecks) || !safeMoney(input.netRentKopecks)) {
    throw new Error("Проверьте ставку и итоговый расчёт аренды");
  }
  const monthStart = `${input.period}-01`;
  const endDate = new Date(`${monthStart}T12:00:00Z`);
  endDate.setUTCMonth(endDate.getUTCMonth() + 1, 0);
  const monthEnd = endDate.toISOString().slice(0, 10);
  if (!validDate(input.settings.rentalStart) || !validDate(input.settings.rentalEnd) ||
      input.settings.rentalStart > input.settings.rentalEnd) throw new Error("Проверьте даты аренды в договоре");
  const leaseStart = [monthStart, input.settings.rentalStart].sort().at(-1)!;
  const leaseEnd = [monthEnd, input.settings.rentalEnd].sort()[0];
  if ((input.startDate && !validDate(input.startDate)) || (input.endDate && !validDate(input.endDate)) ||
      (input.startDate && input.endDate && input.startDate > input.endDate)) {
    throw new Error("Проверьте первый и последний день выбранного периода");
  }
  const start = [leaseStart, ...(input.startDate ? [input.startDate] : [])].sort().at(-1)!;
  const end = [leaseEnd, input.invoiceDate, ...(input.endDate ? [input.endDate] : [])].sort()[0];
  const days = new Map<string, { units: number; gross: number }>();
  let monthGross = 0;
  for (const entry of input.entries) {
    if (!validDate(entry.entryDate) || !Number.isSafeInteger(entry.units) || entry.units < 0) {
      throw new Error("В ежедневных записях есть неверная дата или количество бутылей");
    }
    if (entry.entryDate < leaseStart || entry.entryDate > leaseEnd) continue;
    const old = days.get(entry.entryDate) ?? { units: 0, gross: 0 };
    const gross = entry.units * input.settings.rateKopecks;
    if (!safeMoney(gross)) throw new Error("Стоимость бутылей слишком большая для точного расчёта");
    old.units = checkedAdd(old.units, entry.units);
    old.gross = checkedAdd(old.gross, gross);
    days.set(entry.entryDate, old);
    monthGross = checkedAdd(monthGross, gross);
  }

  const relevant = input.invoices.filter((invoice) => !invoice.period || invoice.period === input.period);
  const current = relevant.find((invoice) => invoice.id === input.excludeInvoiceId);
  const normalized = new Map<number, NormalizedInvoiceAllocation>();
  const invalid = new Set<number>();
  const legacy = new Set<number>();
  for (const invoice of relevant) {
    if (invoice.allocationVersion === undefined && invoice.bottleAllocations === undefined &&
        invoice.rentalSupplementKopecks === undefined) {
      if (!safeMoney(invoice.amountKopecks) || invoice.amountKopecks === 0) invalid.add(invoice.id);
      else legacy.add(invoice.id);
      continue;
    }
    try {
      if (!validDate(invoice.invoiceDate)) throw new Error("Неверная дата счёта");
      const allocation = normalizeCandidate(invoice, invoice.amountKopecks!,
        { start: leaseStart, end: [leaseEnd, invoice.invoiceDate].sort()[0] }, invoice.kind ?? "");
      normalized.set(invoice.id, allocation);
    } catch {
      invalid.add(invoice.id);
    }
  }
  // Check the complete saved ledger before excluding the edited invoice. Otherwise
  // two overallocated records could each appear valid in isolation and block review.
  const allClaims = new Map<string, { amount: number; ids: number[] }>();
  let allSupplements = 0;
  const supplementIds: number[] = [];
  for (const [id, allocation] of normalized) {
    for (const row of allocation.bottleAllocations) {
      const claim = allClaims.get(row.date) ?? { amount: 0, ids: [] };
      try { claim.amount = checkedAdd(claim.amount, row.amountKopecks); }
      catch { claim.amount = Infinity; }
      claim.ids.push(id);
      allClaims.set(row.date, claim);
    }
    if (allocation.rentalSupplementKopecks > 0) {
      supplementIds.push(id);
      try { allSupplements = checkedAdd(allSupplements, allocation.rentalSupplementKopecks); }
      catch { allSupplements = Infinity; }
    }
  }
  for (const [date, claim] of allClaims) {
    if (claim.amount > (days.get(date)?.gross ?? 0)) claim.ids.forEach((id) => invalid.add(id));
  }
  const supplementCeiling = Math.max(0, input.fixedTargetKopecks - monthGross);
  if (allSupplements > supplementCeiling) supplementIds.forEach((id) => invalid.add(id));

  const claims = new Map<string, number>();
  const legacyInvoiceNumbers: string[] = [];
  const invalidInvoiceNumbers: string[] = [];
  let needsReview = false;
  let otherFaces = 0;
  let sameKindFaces = 0;
  let otherSupplements = 0;
  for (const invoice of relevant) {
    if (invoice.id === input.excludeInvoiceId) continue;
    if (safeMoney(invoice.amountKopecks)) {
      otherFaces = checkedAdd(otherFaces, invoice.amountKopecks);
      if (invoice.kind === input.kind) sameKindFaces = checkedAdd(sameKindFaces, invoice.amountKopecks);
    }
    const legacyRecord = legacy.has(invoice.id);
    const invalidRecord = invalid.has(invoice.id);
    if (legacyRecord || invalidRecord) {
      const list = invalidRecord ? invalidInvoiceNumbers : legacyInvoiceNumbers;
      const label = invoiceLabel(invoice);
      if (!list.includes(label)) list.push(label);
      // Reviewing saved records proceeds chronologically. New invoices cannot
      // skip any unreviewed record. Valid later records always reserve their money.
      if (!current || order(invoice, current) <= 0) needsReview = true;
      continue;
    }
    const allocation = normalized.get(invoice.id)!;
    for (const row of allocation.bottleAllocations) {
      claims.set(row.date, checkedAdd(claims.get(row.date) ?? 0, row.amountKopecks));
    }
    otherSupplements = checkedAdd(otherSupplements, allocation.rentalSupplementKopecks);
  }
  const netAvailable = Math.max(0, input.netRentKopecks - otherFaces);
  const componentTarget = input.kind === "fixed" ? input.fixedTargetKopecks
    : input.kind === "variable" ? Math.max(0, input.netRentKopecks - input.fixedTargetKopecks) : input.netRentKopecks;
  const faceAvailable = Math.min(netAvailable, Math.max(0, componentTarget - sameKindFaces));
  return { start, end, leaseStart, leaseEnd, days, claims, faceAvailable,
    supplementAvailable: input.kind === "fixed" && input.allowRentalSupplement
      ? Math.max(0, supplementCeiling - otherSupplements) : 0,
    needsReview, legacyInvoiceNumbers, invalidInvoiceNumbers };
}

export function proposeInvoiceAllocation(input: InvoiceAllocationInput): InvoiceAllocationProposal {
  const target = safeMoney(input.amountKopecks) ? input.amountKopecks : 0;
  const result: InvoiceAllocationProposal = { bottleAllocations: [], rentalSupplementKopecks: 0,
    coveredKopecks: 0, uncoveredKopecks: target, availableKopecks: 0, startDate: "", endDate: "",
    lastDayRemainingKopecks: 0, needsReview: false, legacyInvoiceNumbers: [], invalidInvoiceNumbers: [],
    ready: false, days: [] };
  let context: AllocationContext;
  try { context = allocationContext(input); }
  catch { return { ...result, needsReview: true }; }
  const { start, end, days, claims } = context;
  result.needsReview = context.needsReview;
  result.legacyInvoiceNumbers = context.legacyInvoiceNumbers;
  result.invalidInvoiceNumbers = context.invalidInvoiceNumbers;
  let dailyAvailable = 0;
  try {
    for (const [date, day] of [...days].sort(([a], [b]) => a.localeCompare(b))) {
      if (date < start || date > end) continue;
      const alreadyAllocatedKopecks = claims.get(date) ?? 0;
      const remainingKopecks = Math.max(0, day.gross - alreadyAllocatedKopecks);
      dailyAvailable = checkedAdd(dailyAvailable, remainingKopecks);
      result.days.push({ date, units: day.units, grossKopecks: day.gross, alreadyAllocatedKopecks,
        amountKopecks: 0, remainingKopecks });
    }
    result.availableKopecks = start <= end
      ? Math.min(context.faceAvailable, checkedAdd(dailyAvailable, context.supplementAvailable)) : 0;
  } catch { return { ...result, needsReview: true, availableKopecks: 0, days: [] }; }
  // Even a blocked proposal can show its available daily basis for review, but
  // cannot be accepted or silently turn an old invoice into a new allocation.
  let remaining = Math.min(target, result.availableKopecks);
  for (const day of result.days) {
    const amount = Math.min(remaining, day.remainingKopecks);
    if (amount > 0) {
      result.bottleAllocations.push({ date: day.date, amountKopecks: amount });
      day.amountKopecks = amount;
      day.remainingKopecks -= amount;
      remaining -= amount;
      result.lastDayRemainingKopecks = day.remainingKopecks;
    }
  }
  result.rentalSupplementKopecks = Math.min(remaining, context.supplementAvailable);
  result.coveredKopecks = Math.min(target, result.availableKopecks);
  result.uncoveredKopecks = target - result.coveredKopecks;
  result.startDate = result.bottleAllocations[0]?.date ?? "";
  result.endDate = result.bottleAllocations.at(-1)?.date ?? "";
  result.ready = safeMoney(input.amountKopecks) && target > 0 && !result.needsReview && result.uncoveredKopecks === 0;
  return result;
}

export function validateInvoiceAllocation(input: InvoiceAllocationInput, candidate: unknown): NormalizedInvoiceAllocation {
  const context = allocationContext(input);
  if (context.needsReview) {
    const numbers = [...context.legacyInvoiceNumbers, ...context.invalidInvoiceNumbers].join(", ");
    throw new Error(`Сначала проверьте привязку ранее выставленных счетов${numbers ? `: № ${numbers}` : ""}`);
  }
  if (!safeMoney(input.amountKopecks) || input.amountKopecks === 0) throw new Error("Укажите положительную сумму счёта в целых копейках");
  const normalized = normalizeCandidate(candidate, input.amountKopecks,
    { start: context.start, end: context.end }, input.kind);
  if (input.amountKopecks > context.faceAvailable) {
    throw new Error("Сумма счёта превышает оставшуюся сумму этой части аренды или итог за месяц");
  }
  if (normalized.rentalSupplementKopecks > context.supplementAvailable) {
    throw new Error("Доплата превышает разницу между постоянной частью аренды и стоимостью всех бутылей месяца");
  }
  for (const row of normalized.bottleAllocations) {
    const capacity = Math.max(0, (context.days.get(row.date)?.gross ?? 0) - (context.claims.get(row.date) ?? 0));
    if (row.amountKopecks > capacity) throw new Error(`За ${row.date} включено больше свободной суммы, чем подтверждено бутылями`);
  }
  return normalized;
}
