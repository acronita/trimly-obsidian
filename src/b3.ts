import { requestUrl } from "obsidian";
import { t } from "./i18n";
import { parseCashDividends } from "./proventos";
import type { CashDividend, Provento } from "./proventos";
import type { Close } from "./returns";

/**
 * Data from the B3 website's public pages: IBOV and IFIX daily closes (index
 * statistics) and announced proventos (listed companies, FIIs included). Not a
 * documented API: it is what the site's pages call, so it can change without
 * notice. No key; only the index and year, or the issuer code ("PETR"), is sent.
 */
const BASE = "https://sistemaswebb3-listados.b3.com.br/indexStatisticsProxy/IndexCall/GetPortfolioDay";
const COMPANY = "https://sistemaswebb3-listados.b3.com.br/listedCompaniesProxy/CompanyCall/GetListedSupplementCompany";

/** One row per day of the month; rateValue1..12 are that day's close in each month ("3.311,48"), null without trading. */
type DayRow = { day: number } & Record<string, string | null | number>;

function parseBr(value: string): number {
  return Number(value.replace(/\./g, "").replace(",", "."));
}

async function year(index: string, y: number): Promise<Close[]> {
  const query = btoa(JSON.stringify({ index, language: "pt-br", year: String(y) }));
  const res = await requestUrl({ url: `${BASE}/${query}`, throw: false });
  if (res.status >= 300) throw new Error(t.errors.b3Index(index, res.status));
  const rows = (res.json as { results?: DayRow[] }).results ?? [];
  const out: Close[] = [];
  for (let m = 1; m <= 12; m++) {
    for (const row of rows) {
      const v = row[`rateValue${m}`];
      if (typeof v !== "string") continue;
      out.push({ date: `${y}-${String(m).padStart(2, "0")}-${String(row.day).padStart(2, "0")}`, close: parseBr(v) });
    }
  }
  return out;
}

/** Closes of `index` ("IBOV", "IFIX") in the years from `from` to `to`, oldest first; one request per year. */
export async function fetchIndexCloses(index: string, from: string, to: string): Promise<Close[]> {
  const years: number[] = [];
  for (let y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y++) years.push(y);
  const all = await Promise.all(years.map((y) => year(index, y)));
  return all.flat().filter((c) => c.date <= to);
}

export interface ProventoFetch {
  proventos: Provento[];
  /** one message per issuer that could not be read */
  errors: string[];
}

/** Announced proventos of each issuer ("PETR", "HGLG"), one request each. */
export async function fetchProventos(issuers: string[]): Promise<ProventoFetch> {
  const out: ProventoFetch = { proventos: [], errors: [] };
  await Promise.all(
    issuers.map(async (issuer) => {
      const query = btoa(JSON.stringify({ issuingCompany: issuer, language: "pt-br" }));
      const res = await requestUrl({ url: `${COMPANY}/${query}`, throw: false });
      if (res.status >= 300) return void out.errors.push(t.errors.b3Proventos(issuer, res.status));
      const body = res.json as { cashDividends?: CashDividend[] }[] | null;
      out.proventos.push(...parseCashDividends((Array.isArray(body) ? body[0]?.cashDividends : undefined) ?? []));
    })
  );
  return out;
}
