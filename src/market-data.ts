/**
 * Public lists the investments assistant consults: Status Invest's indicators and the
 * recommendations XP publishes. Each list is read whole and filtered here, so the sites
 * never learn which tickers were asked about. Neither address is a documented API: if
 * one changes, that source is reported as unavailable and the other still answers.
 *
 * Kept free of Obsidian imports so it can be unit tested in Node.
 */
import { articleText } from "./feeds.ts";

export type MarketRow = Record<string, string | number>;

export const STATUS_INVEST = "Status Invest";
export const XP = "XP";

export const statusInvestUrl = (category: number) => `https://statusinvest.com.br/category/advancedsearchresultexport?search=%7B%7D&CategoryType=${category}`;

/** B3 tickers end in a digit: stocks (1) and FIIs (2). The rest are US stocks (12) and REITs (13). */
export function statusInvestCategories(tickers: string[]): number[] {
  return [...new Set(tickers.flatMap((t) => (/\d$/.test(t) ? [1, 2] : [12, 13])))];
}

const cellValue = (raw: string): string | number => (/^-?\d[\d.]*(,\d+)?$/.test(raw) ? Number(raw.replace(/\./g, "").replace(",", ".")) : raw);

/** The site's CSV export, with Brazilian numbers. Empty cells are left out. */
export function parseStatusInvest(csv: string): MarketRow[] {
  const [head = "", ...lines] = csv.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  const names = head.split(";").map((n) => n.trim());
  if (names[0] !== "TICKER") throw new Error("unexpected Status Invest format");
  return lines.map((line) => {
    const cells = line.split(";").map((c) => c.trim());
    return Object.fromEntries(names.flatMap((name, i) => (cells[i] ? [[name, cellValue(cells[i])]] : [])));
  });
}

export const XP_LISTS = [
  { type: "acoes-fund", filter: "recomendacao" },
  { type: "fund-imob", filter: "categoria" },
];

export const xpListUrl = (list: (typeof XP_LISTS)[number], page: number) =>
  `https://conteudos.xpi.com.br/wp-json/xpinsights/v2/filtrar-conteudo?filter-function=xpinsights_default_destaques_tabela_filter&current_page=${page}&column_order=&post_type=${list.type}&order=&search=&${list.filter}=&pag=1`;

const XP_LABEL = /<span class="nome-coluna[^"]*">([^<]*)<\/span>/;

/** The table rows of one page of XP's lists, each cell under the label the site gives it. */
export function parseXpRows(html: string): MarketRow[] {
  const out: MarketRow[] = [];
  for (const [row] of html.matchAll(/<tr\b[\s\S]*?<\/tr>/gi)) {
    const ticker = articleText(row.match(/abs-nome-atv[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? "").match(/[A-Z]{4}\d{1,2}$/)?.[0];
    if (!ticker) continue;
    const cells: MarketRow = { TICKER: ticker };
    for (const [, cell] of row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)) {
      const label = cell.match(XP_LABEL)?.[1].trim();
      // the <b> is the risk score's explanation, repeated on every row
      if (label) cells[label] = articleText(cell.replace(XP_LABEL, "").replace(/<b\b[\s\S]*?<\/b>/i, ""));
    }
    out.push(cells);
  }
  return out;
}

export interface MarketLookup {
  results: { ticker: string; status_invest: MarketRow | null; xp: MarketRow | null }[];
  /** sources that could not be read: a null under them says nothing about the ticker */
  unavailable: string[];
}

export function marketLookup(tickers: string[], statusInvest: MarketRow[], xp: MarketRow[], unavailable: string[]): MarketLookup {
  const find = (rows: MarketRow[], ticker: string) => rows.find((r) => r.TICKER === ticker) ?? null;
  return { results: tickers.map((ticker) => ({ ticker, status_invest: find(statusInvest, ticker), xp: find(xp, ticker) })), unavailable };
}
