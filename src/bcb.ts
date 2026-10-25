import { requestUrl } from "obsidian";
import type { Benchmarks, Rate } from "./returns";

/**
 * Public CDI and IPCA series from the Central Bank of Brazil's SGS API. No key,
 * and nothing about the user is sent: only the series code and a date range.
 */
const SGS = "https://api.bcb.gov.br/dados/serie/bcdata.sgs";
const CDI_DAILY = 12;
const IPCA_MONTHLY = 433;

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
  if (res.status >= 300) throw new Error(`Central Bank series ${code} failed (HTTP ${res.status})`);
  return (res.json as { data: string; valor: string }[]).map((r) => ({ date: fromBr(r.data), rate: Number(r.valor) }));
}

/** CDI and IPCA from `from` to `to`. The daily series accepts at most 10 years per request. */
export async function fetchBenchmarks(from: string, to: string): Promise<Benchmarks> {
  const [cdi, ipca] = await Promise.all([series(CDI_DAILY, from, to), series(IPCA_MONTHLY, `${from.slice(0, 7)}-01`, to)]);
  return { cdi, ipca };
}
