/**
 * Tesouro Direto prices from the Tesouro Transparente open data, applied to manual
 * positions. The file has every bond's price of every day, so it says nothing about
 * what the user holds: nothing about the portfolio leaves the device.
 *
 * Kept free of Obsidian imports so it can be unit tested in Node.
 */
import { recordSnapshot } from "./ledger.ts";
import type { Asset, Ledger } from "./ledger.ts";

export interface TreasuryPrice {
  /** "Tesouro IPCA+" */
  type: string;
  /** maturity, YYYY-MM-DD */
  due: string;
  /** what the Treasury pays for one bond when selling it before maturity, cents */
  price: number;
}

export interface TreasuryPrices {
  /** the day these prices are from */
  date: string;
  prices: TreasuryPrice[];
}

const isoDate = (br: string) => `${br.slice(6, 10)}-${br.slice(3, 5)}-${br.slice(0, 2)}`;

/** Each bond's price on the newest day of the file: older days are history, and a bond no longer listed has no price today. */
export function parseTreasuryPrices(csv: string): TreasuryPrices | null {
  let date = "";
  let prices: TreasuryPrice[] = [];
  for (const line of csv.split(/\r?\n/)) {
    // Tipo Titulo;Data Vencimento;Data Base;Taxa Compra;Taxa Venda;PU Compra;PU Venda;PU Base
    const cols = line.split(";");
    if (cols.length < 7 || !/^\d{2}\/\d{2}\/\d{4}$/.test(cols[2])) continue;
    const day = isoDate(cols[2]);
    if (day < date) continue;
    const price = Math.round(Number(cols[6].replace(",", ".")) * 100);
    if (!Number.isFinite(price) || price <= 0) continue;
    if (day > date) {
      date = day;
      prices = [];
    }
    prices.push({ type: cols[0].trim(), due: isoDate(cols[1]), price });
  }
  return date ? { date, prices } : null;
}

const normalized = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ");

/** How a position may name a bond type; people write "Tesouro Renda+ 2065", the file adds "Aposentadoria Extra". */
const typeName = (type: string) => normalized(type).replace(" aposentadoria extra", "");

/**
 * The bond a position holds, by the type in its name and its maturity (or the year
 * in its name). Null when that isn't certain: a wrong bond would mean a wrong value.
 */
export function findBond(a: Pick<Asset, "name" | "dueDate">, prices: TreasuryPrice[]): TreasuryPrice | null {
  const name = normalized(a.name);
  const types = [...new Set(prices.map((p) => p.type))].sort((x, y) => y.length - x.length);
  // "Tesouro IPCA+ com juros" is a different bond from "Tesouro IPCA+"
  const type = types.find((t) => name.includes(typeName(t)) && (t.includes("Juros") || !name.includes("juros")));
  if (!type) return null;
  // the year in these names is when payments start (Renda+ 2065 matures in 2084), so only the exact maturity tells them apart
  if (/Renda\+|Educa\+/.test(type)) return prices.find((p) => p.type === type && p.due === a.dueDate) ?? null;
  const year = a.dueDate?.slice(0, 4) ?? name.match(/\b20\d{2}\b/)?.[0];
  if (!year) return null;
  const bonds = prices.filter((p) => p.type === type && p.due.startsWith(year));
  return bonds.find((p) => p.due === a.dueDate) ?? (bonds.length === 1 ? bonds[0] : null);
}

/** Manual Tesouro Direto positions still open; a synced one keeps the value its bank reports. */
export function manualTreasuryPositions(ledger: Ledger): Asset[] {
  return ledger.investments.assets.filter((a) => a.assetClass === "treasury" && !a.closed && !a.pluggyId);
}

export interface TreasuryUpdate {
  /** positions whose value changed */
  updated: number;
  /** positions with no price: no bond found for them, or no quantity to multiply it by */
  missing: string[];
}

/** Revalue manual positions by the prices, a market move and not money moved. Mutates the ledger. */
export function applyTreasuryPrices(ledger: Ledger, data: TreasuryPrices, today: string): TreasuryUpdate {
  const out: TreasuryUpdate = { updated: 0, missing: [] };
  for (const a of manualTreasuryPositions(ledger)) {
    const bond = findBond(a, data.prices);
    if (!bond || !a.quantity) {
      out.missing.push(a.name);
      continue;
    }
    // midday, so the date doesn't move a day in any time zone
    a.quote = { price: bond.price, time: `${data.date}T12:00:00` };
    const value = Math.round(bond.price * a.quantity);
    if (value === a.value) continue;
    a.value = value;
    a.updatedAt = data.date;
    out.updated++;
  }
  if (out.updated) recordSnapshot(ledger, today);
  return out;
}
