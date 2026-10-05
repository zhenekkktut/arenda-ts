type NumberedInvoice = { invoiceNumber: string };
type RentalDates = { rentalStart: string; rentalEnd: string };
type RecordedDay = { entryDate: string };
type DowntimeDates = { startDate: string; endDate: string };

/** Suggest a number from the full phone history without rewriting saved numbers. */
export function nextInvoiceNumber(invoices: NumberedInvoice[]): string {
  if (!invoices.length) return "1";
  let maximum: number | null = null;
  for (const invoice of invoices) {
    if (!invoice || typeof invoice.invoiceNumber !== "string") return "";
    const value = invoice.invoiceNumber.trim();
    if (!/^\d+$/.test(value)) continue;
    const number = Number(value);
    // A numeric sequence outside the safe range needs a manual number.
    if (!Number.isSafeInteger(number)) return "";
    maximum = Math.max(maximum ?? 0, number);
  }
  if (maximum === null || maximum >= Number.MAX_SAFE_INTEGER) return "";
  return String(maximum + 1);
}

function isoDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value
    ? null : parsed;
}

/** Days which still need a record, within the lease and up to today. */
export function missingEntryDates(
  period: string,
  today: string,
  settings: RentalDates,
  entries: RecordedDay[],
  downtimes: DowntimeDates[],
): string[] {
  if (!/^\d{4}-\d{2}$/.test(period) || !isoDate(today) ||
      !isoDate(settings.rentalStart) || !isoDate(settings.rentalEnd) ||
      settings.rentalStart > settings.rentalEnd) return [];
  const monthStart = `${period}-01`;
  const monthEndDate = isoDate(monthStart);
  if (!monthEndDate) return [];
  monthEndDate.setUTCMonth(monthEndDate.getUTCMonth() + 1, 0);
  const monthEnd = monthEndDate.toISOString().slice(0, 10);
  const start = settings.rentalStart > monthStart ? settings.rentalStart : monthStart;
  const end = [monthEnd, settings.rentalEnd, today].sort()[0];
  if (start > end) return [];
  const recorded = new Set(entries.map((entry) => entry.entryDate));
  const confirmedDowntimes = downtimes.filter((downtime) =>
    isoDate(downtime.startDate) && isoDate(downtime.endDate) &&
    downtime.startDate <= downtime.endDate);
  const missing: string[] = [];
  const endTime = isoDate(end)!.getTime();
  for (const date = isoDate(start)!; date.getTime() <= endTime;
       date.setUTCDate(date.getUTCDate() + 1)) {
    const value = date.toISOString().slice(0, 10);
    if (date.getUTCDay() === 0 || recorded.has(value) ||
        confirmedDowntimes.some((downtime) => downtime.startDate <= value && downtime.endDate >= value)) continue;
    missing.push(value);
  }
  return missing;
}

/** Keep a separately chosen reconciliation date when the document date changes. */
export function linkedAsOfDate(nextDocumentDate: string, previousDocumentDate: string, asOfDate: string): string {
  return asOfDate === previousDocumentDate ? nextDocumentDate : asOfDate;
}
