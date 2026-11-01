import { requestUrl } from "obsidian";
import { t } from "./i18n";
import { fetchIndexCloses } from "./b3";
import type { Benchmarks, Rate } from "./returns";

/**
 * Public CDI, IPCA and poupança series from the Central Bank of Brazil's SGS API.
 * No key, and nothing about the user is sent: only the series code and a date range.
 */
const SGS = "https://api.bcb.gov.br/dados/serie/bcdata.sgs";
const CDI_DAILY = 12;
const IPCA_MONTHLY = 433;
/** poupança (rules since 2012-05-04): one value per anniversary day, each the yield until the same day next month */
const POUPANCA = 195;

/** "2026-10-25" -> "25/10/2026" and back */
function toBr(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function fromBr(br: string): string {
  const [d, m, y] = br.split("/");
  return `${y}-${m}-${d}`;
}

async function series(code: number, from: string, to: string): Promise<Rate[]> {
  const res = await requestUrl({
    url: `${SGS}.${code}/dados?formato=json&dataInicial=${toBr(from)}&dataFinal=${toBr(to)}`,
    throw: false,
  });
  // SGS answers 404 when the range has no values yet (e.g. this month's IPCA)
  if (res.status === 404) return [];
  if (res.status >= 300) throw new Error(t.errors.bcbSeries(code, res.status));
  // to a browser user agent (Obsidian's) errors come back as 200 with an object instead of the list
  const body = res.json as { data: string; valor: string }[] | { error?: string; erro?: string | { statusCode?: number; detail?: string } };
  if (!Array.isArray(body)) {
    const err = body.erro;
    if (typeof err === "object" && err.statusCode === 404) return [];
    throw new Error(t.errors.bcbSeriesBody(code, body.error ?? (typeof err === "object" ? (err.detail ?? "") : (err ?? ""))));
  }
  return body.map((r) => ({ date: fromBr(r.data), rate: Number(r.valor) }));
}

/**
 * CDI, IPCA and poupança from `from` to `to` (the daily series accept at most 10
 * years per request), plus IBOV and IFIX from B3. B3 failing leaves the BCB
 * series standing, with the error in `indexError`.
 */
export async function fetchBenchmarks(from: string, to: string): Promise<Benchmarks> {
  const monthStart = `${from.slice(0, 7)}-01`;
  const indexes = Promise.all([fetchIndexCloses("IBOV", from, to), fetchIndexCloses("IFIX", from, to)]).then(
    ([ibov, ifix]) => ({ ibov, ifix }),
    (e: Error) => ({ ibov: null, ifix: null, indexError: e.message })
  );
  const [cdi, ipca, poupanca, idx] = await Promise.all([
    series(CDI_DAILY, from, to),
    series(IPCA_MONTHLY, monthStart, to),
    // the deposit made on the 1st stands for the whole month. Starting at `from` keeps this daily
    // series inside its 10-year window, and loses nothing: a month only counts when it starts after `from`
    series(POUPANCA, from, to).then((rates) => rates.filter((r) => r.date.endsWith("-01"))),
    indexes,
  ]);
  return { cdi, ipca, poupanca, ...idx };
}
