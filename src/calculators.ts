/**
 * Calculators, on the device with no network: money in cents, rates in percent a
 * year. They assume a constant rate, so they simulate and don't predict. Nothing
 * here is stored.
 *
 * Kept free of Obsidian imports so it can be unit tested in Node.
 */
import { accountBalance, contributionsInMonth, monthOf, monthSummary, portfolioValue, shiftMonth, toBase } from "./ledger.ts";
import type { Ledger } from "./ledger.ts";

/** Past this, "how long" has no useful answer. */
const MAX_MONTHS = 1200;

const monthlyRate = (annualPct: number) => (1 + annualPct / 100) ** (1 / 12) - 1;

export interface CompoundResult {
  final: number;
  /** what was put in, starting amount included */
  invested: number;
  interest: number;
}

/** Monthly contributions made at the end of each month. */
export function compound(start: number, monthly: number, annualPct: number, months: number): CompoundResult {
  const i = monthlyRate(annualPct);
  const growth = (1 + i) ** months;
  const final = Math.round(start * growth + (i === 0 ? monthly * months : (monthly * (growth - 1)) / i));
  const invested = start + monthly * months;
  return { final, invested, interest: final - invested };
}

/** Months until reaching `target`: 0 if it is already there, null if it isn't reached within 100 years. */
export function monthsToReach(start: number, monthly: number, annualPct: number, target: number): number | null {
  if (start >= target) return 0;
  const i = monthlyRate(annualPct);
  let balance = start;
  for (let m = 1; m <= MAX_MONTHS; m++) {
    balance = balance * (1 + i) + monthly;
    if (balance >= target) return m;
  }
  return null;
}

/** Contribution per month to reach `target` in `months`; 0 when what is there already gets there alone. */
export function monthlyToReach(start: number, annualPct: number, months: number, target: number): number {
  const i = monthlyRate(annualPct);
  const growth = (1 + i) ** months;
  const missing = target - start * growth;
  if (missing <= 0) return 0;
  return Math.ceil(i === 0 ? missing / months : (missing * i) / (growth - 1));
}

/** Wealth whose yearly withdrawal at `withdrawalPct` pays `monthlyIncome` a month. */
export function wealthForIncome(monthlyIncome: number, withdrawalPct: number): number {
  return Math.round((monthlyIncome * 12) / (withdrawalPct / 100));
}

/** Income tax on fixed income by days held (Lei 11.033/2004, art. 1), in percent. IOF, under 30 days, is left out. */
export function fixedIncomeTax(days: number): number {
  if (days <= 180) return 22.5;
  if (days <= 360) return 20;
  if (days <= 720) return 17.5;
  return 15;
}

export interface CdbLciResult {
  /** net gain over the period, percent */
  cdbNet: number;
  lciNet: number;
  /** % of the CDI a CDB would have to pay to match the LCI/LCA after tax */
  breakEvenCdb: number;
}

/** A taxed CDB against a tax-free LCI/LCA, both paying a share of the same CDI over `days`. */
export function compareCdbLci(cdiPct: number, cdbOfCdi: number, lciOfCdi: number, days: number): CdbLciResult {
  const tax = fixedIncomeTax(days);
  const gain = (ofCdi: number) => (((1 + (cdiPct * ofCdi) / 10_000) ** (days / 365)) - 1) * 100;
  return {
    cdbNet: gain(cdbOfCdi) * (1 - tax / 100),
    lciNet: gain(lciOfCdi),
    breakEvenCdb: (((gain(lciOfCdi) / 100 / (1 - tax / 100) + 1) ** (365 / days) - 1) * 10_000) / cdiPct,
  };
}

/** Real numbers to start the fields from, all in the settings' currency. */
export interface CalculatorDefaults {
  wealth: number;
  /** average aporte a month over the last 12 closed months */
  contribution: number;
  /** income movements of the last 12 closed months, a month */
  passiveIncome: number;
  /** average expenses a month over the last 6 closed months */
  expense: number;
  /** what accounts other than cards hold */
  cash: number;
}

export function calculatorDefaults(ledger: Ledger, today: string): CalculatorDefaults {
  const month = monthOf(today);
  const closed = (count: number) => Array.from({ length: count }, (_, i) => shiftMonth(month, -1 - i));
  const year = closed(12);
  const passive = ledger.investments.movements.filter((m) => m.type === "income" && year.includes(monthOf(m.date))).reduce((s, m) => s + m.amount, 0);
  return {
    wealth: Math.round(portfolioValue(ledger)),
    contribution: Math.round(year.reduce((s, m) => s + contributionsInMonth(ledger, m), 0) / 12),
    passiveIncome: Math.round(passive / 12),
    expense: Math.round(closed(6).reduce((s, m) => s + monthSummary(ledger, m).expense, 0) / 6),
    cash: Math.max(0, ledger.accounts.filter((a) => a.type !== "credit" && !a.archived).reduce((s, a) => s + toBase(ledger, accountBalance(ledger, a.id), a.currency), 0)),
  };
}
