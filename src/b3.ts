import { requestUrl } from "obsidian";
import { t } from "./i18n";
import type { Close } from "./returns";

/**
 * IBOV and IFIX daily closes from the B3 website's public index statistics.
 * Not a documented API: it is what the site's "estatísticas históricas" page
 * calls, so it can change without notice. No key, and nothing about the user is
 * sent: only the index and the year.
 */
const BASE = "https://sistemaswebb3-listados.b3.com.br/indexStatisticsProxy/IndexCall/GetPortfolioDay";

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
