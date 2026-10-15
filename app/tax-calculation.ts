export type TaxAdjustment = {
  id: number;
  date: string;
  amountKopecks: number;
  kind: "income" | "tax_paid";
  note: string;
};

export type TaxYearOptions = {
  year: number;
  deductionKopecks: number;
  hasWorkers: boolean;
};

export function calculateTaxYear(
  year: number,
  quarter: number,
  payments: { paymentDate: string; amountKopecks: number }[],
  adjustments: TaxAdjustment[],
  options: TaxYearOptions,
) {
  const endMonth = String(quarter * 3).padStart(2, "0");
  const through = `${year}-${endMonth}-31`;
  const from = `${year}-01-01`;
  const inPeriod = (date: string) => date >= from && date <= through;
  const rentalKopecks = payments.filter((item) => inPeriod(item.paymentDate))
    .reduce((sum, item) => sum + item.amountKopecks, 0);
  const otherKopecks = adjustments.filter((item) => item.kind === "income" && inPeriod(item.date))
    .reduce((sum, item) => sum + item.amountKopecks, 0);
  const incomeKopecks = rentalKopecks + otherKopecks;
  const annualEnd = `${year}-12-31`;
  const annualIncomeKopecks = payments.filter((item) => item.paymentDate >= from && item.paymentDate <= annualEnd)
    .reduce((sum, item) => sum + item.amountKopecks, 0) +
    adjustments.filter((item) => item.kind === "income" && item.date >= from && item.date <= annualEnd)
      .reduce((sum, item) => sum + item.amountKopecks, 0);
  const grossKopecks = Math.round(incomeKopecks * 0.06);
  const deductionKopecks = Math.min(grossKopecks, Math.max(0,
    Math.min(options.deductionKopecks, options.hasWorkers ? Math.floor(grossKopecks / 2) : grossKopecks),
  ));
  const taxKopecks = grossKopecks - deductionKopecks;
  const paidKopecks = adjustments.filter((item) => item.kind === "tax_paid" && inPeriod(item.date))
    .reduce((sum, item) => sum + item.amountKopecks, 0);
  const currentQuarter = `${year}-${String((quarter - 1) * 3 + 1).padStart(2, "0")}-01`;
  const quarterIncomeKopecks = payments.filter((item) => item.paymentDate >= currentQuarter && inPeriod(item.paymentDate))
    .reduce((sum, item) => sum + item.amountKopecks, 0) +
    adjustments.filter((item) => item.kind === "income" && item.date >= currentQuarter && inPeriod(item.date))
      .reduce((sum, item) => sum + item.amountKopecks, 0);
  return {
    rentalKopecks, otherKopecks, incomeKopecks, quarterIncomeKopecks,
    reserveKopecks: Math.round(quarterIncomeKopecks * 0.06),
    grossKopecks, deductionKopecks, taxKopecks, paidKopecks,
    outstandingKopecks: Math.max(0, taxKopecks - paidKopecks),
    extraInsuranceKopecks: Math.max(0, Math.round((annualIncomeKopecks - 30_000_000) * 0.01)),
  };
}
