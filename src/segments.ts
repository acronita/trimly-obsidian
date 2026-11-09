/**
 * What each held FII or stock is ("Logística", "Papéis", "Bancos"), filled in from
 * public data unless the user typed their own.
 *
 * Kept free of Obsidian imports so it can be unit tested in Node.
 */
import { tickerOf } from "./quotes.ts";
import { issuerOf } from "./proventos.ts";
import type { Asset, Ledger } from "./ledger.ts";

/** The CVM file changes monthly, so looking again sooner finds nothing new. */
const REFRESH_DAYS = 30;
/** Share of a fund's investments that says what it is: KNCR11 has 91% in CRI and LCI, XPSF11 88% in other FIIs. */
const MAJORITY = 0.6;
/** Labels funds pick for themselves that say nothing: Kinea's CRI fund and Pátria's logistics fund are both "Multicategoria". */
const VAGUE = new Set(["", "Multicategoria", "Outros"]);

export interface FiiLabels {
  paper: string;
  fundOfFunds: string;
}

function table(csv: string): { col: (name: string) => number; rows: string[][] } {
  const lines = csv.split(/\r?\n/).filter(Boolean);
  const head = (lines[0] ?? "").split(";");
  return { col: (name) => head.indexOf(name), rows: lines.slice(1).map((l) => l.split(";")) };
}

/**
 * Each FII's segment by issuer ("KNCR"), from the CVM monthly report's general and
 * balance-sheet files. The balance decides paper and fund-of-funds, which the funds'
 * own label hides; property funds keep their label when it is specific. A fund with
 * neither is left out, so a blank asks the user rather than a guess. Null when the
 * files are not in the expected format.
 */
export function parseFiiSegments(general: string, balance: string, labels: FiiLabels): Map<string, string> | null {
  const g = table(general);
  const b = table(balance);
  const [isin, segment, date, cnpj] = ["Codigo_ISIN", "Segmento_Atuacao", "Data_Referencia", "CNPJ_Fundo_Classe"].map(g.col);
  const [bCnpj, bDate, invested] = ["CNPJ_Fundo_Classe", "Data_Referencia", "Total_Investido"].map(b.col);
  const paperColumns = ["CRI", "CRI_CRA", "LCI", "LCI_LCA"].map(b.col);
  const fundColumn = b.col("FII");
  if ([isin, segment, date, cnpj, bCnpj, bDate, invested, fundColumn, ...paperColumns].includes(-1)) return null;

  const newestBalance = new Map<string, string[]>();
  for (const row of b.rows) {
    const seen = newestBalance.get(row[bCnpj]);
    if (!seen || row[bDate] >= seen[bDate]) newestBalance.set(row[bCnpj], row);
  }
  const newest = new Map<string, string[]>();
  for (const row of g.rows) {
    const issuer = (row[isin] ?? "").slice(2, 6);
    if (!/^[A-Z]{4}$/.test(issuer)) continue;
    const seen = newest.get(issuer);
    if (!seen || row[date] >= seen[date]) newest.set(issuer, row);
  }

  const out = new Map<string, string>();
  for (const [issuer, row] of newest) {
    const sheet = newestBalance.get(row[cnpj]);
    const total = Number(sheet?.[invested] ?? 0);
    const share = (columns: number[]) => columns.reduce((sum, c) => sum + Number(sheet?.[c] ?? 0), 0) / total;
    const label = (row[segment] ?? "").trim();
    if (total > 0 && share(paperColumns) >= MAJORITY) out.set(issuer, labels.paper);
    else if (total > 0 && share([fundColumn]) >= MAJORITY) out.set(issuer, labels.fundOfFunds);
    else if (!VAGUE.has(label)) out.set(issuer, label);
  }
  return out.size ? out : null;
}

/** A company's segment in B3's search results, which also bring others matching the text; B3 writes commas as periods. Null when it has none. */
export function companySegment(results: { issuingCompany?: string; segment?: string }[], issuer: string): string | null {
  const segment = results.find((r) => r.issuingCompany === issuer)?.segment?.trim();
  if (!segment || segment === "Não Classificados") return null;
  return segment.replace(/\s*\.\s+/g, ", ");
}

/** Product names, the same in every language; the longer Tesouro products first, since none of them says "IPCA" or "Selic". */
const TREASURY_KINDS: [RegExp, string][] = [
  [/renda\s*\+/i, "Renda+"],
  [/educa\s*\+/i, "Educa+"],
  [/selic/i, "Selic"],
  [/ipca/i, "IPCA+"],
  [/pr[eé]-?fixado/i, "Prefixado"],
];
const INDEX_NAMES: Record<string, string> = { SELIC: "Selic", IGPM: "IGP-M" };

function indexName(a: Pick<Asset, "rateType" | "fixedRate">): string {
  if (a.rateType) return INDEX_NAMES[a.rateType.toUpperCase()] ?? a.rateType;
  return a.fixedRate ? "Prefixado" : "";
}

/** The segment to show: the stored one; for Tesouro and renda fixa, what its name or indexer says; "" when unknown. */
export function segmentOf(a: Pick<Asset, "segment" | "assetClass" | "name" | "rateType" | "fixedRate">): string {
  if (a.segment) return a.segment;
  if (a.assetClass === "treasury") return TREASURY_KINDS.find(([re]) => re.test(a.name))?.[1] ?? indexName(a);
  return a.assetClass === "fixed_income" ? indexName(a) : "";
}

export interface SegmentShare {
  /** "" = positions without a segment */
  segment: string;
  value: number;
  /** 0 to 1 of these positions' value */
  share: number;
}

/** How a group of positions splits by segment, largest first; "logistica" typed by hand joins the fetched "Logística". */
export function segmentShares(assets: Pick<Asset, "segment" | "value">[]): SegmentShare[] {
  const key = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const groups = new Map<string, { segment: string; value: number }>();
  for (const a of assets) {
    const segment = a.segment?.trim() ?? "";
    const group = groups.get(key(segment)) ?? { segment, value: 0 };
    group.value += a.value;
    groups.set(key(segment), group);
  }
  const total = assets.reduce((sum, a) => sum + a.value, 0);
  return [...groups.values()].map((g) => ({ ...g, share: total > 0 ? g.value / total : 0 })).sort((x, y) => y.value - x.value);
}

/** Open stocks and FIIs with a B3 ticker whose segment is not the user's. */
function lookedUp(ledger: Ledger): (Asset & { code: string })[] {
  return ledger.investments.assets.filter(
    (a): a is Asset & { code: string } => !a.closed && !a.segmentEdited && (a.assetClass === "stock" || a.assetClass === "reit") && !!tickerOf(a)
  );
}

/** A position never looked up doesn't wait for the monthly refresh. */
export function segmentsDue(ledger: Ledger, today: string): boolean {
  const held = lookedUp(ledger);
  if (held.length === 0) return false;
  if (held.some((a) => a.segment === undefined) || !ledger.segmentsCheckedOn) return true;
  return Date.parse(today) - Date.parse(ledger.segmentsCheckedOn) >= REFRESH_DAYS * 86_400_000;
}

/** What to fetch: the issuers of the held stocks, and whether any FII needs the CVM file. */
export function segmentLookups(ledger: Ledger): { fiis: boolean; issuers: string[] } {
  const held = lookedUp(ledger);
  return {
    fiis: held.some((a) => a.assetClass === "reit"),
    issuers: [...new Set(held.filter((a) => a.assetClass === "stock").map((a) => issuerOf(tickerOf(a) as string)))],
  };
}

/**
 * Store the segments on their positions; "" marks one looked up and not found, so it
 * isn't asked again before the next refresh. A company missing from `companies`
 * failed to load and stays due. Mutates the ledger.
 */
export function applySegments(ledger: Ledger, fiis: Map<string, string>, companies: Map<string, string | null>) {
  for (const a of lookedUp(ledger)) {
    const issuer = issuerOf(tickerOf(a) as string);
    if (a.assetClass === "reit") a.segment = fiis.get(issuer) ?? "";
    else if (companies.has(issuer)) a.segment = companies.get(issuer) ?? "";
  }
}
