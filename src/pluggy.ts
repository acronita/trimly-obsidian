import { RequestUrlResponse, requestUrl } from "obsidian";
import type { BankData, PluggyAccount, PluggyCategory, PluggyTransaction } from "./bank-sync";
import type { PluggyInvestment, PluggyInvestmentTransaction } from "./investment-sync";
import type { PluggyConfig } from "./ledger";

/**
 * Minimal Pluggy API client (https://docs.pluggy.ai). Uses Obsidian's
 * requestUrl, which is not subject to CORS. Only called when the user has
 * set up bank sync; without credentials Trimly makes no network requests.
 */
const BASE = "https://api.pluggy.ai";
/** guard against a cursor that never ends */
const MAX_PAGES = 100;

export class PluggyError extends Error {}

function failure(res: RequestUrlResponse, what: string): PluggyError {
  let detail = "";
  try {
    detail = (res.json as { message?: string })?.message ?? "";
  } catch {
    // body was not JSON
  }
  return new PluggyError(`${what} failed (HTTP ${res.status})${detail ? `: ${detail}` : ""}`);
}

async function authenticate(config: PluggyConfig): Promise<string> {
  const res = await requestUrl({
    url: `${BASE}/auth`,
    method: "POST",
    contentType: "application/json",
    body: JSON.stringify({ clientId: config.clientId, clientSecret: config.clientSecret }),
    throw: false,
  });
  if (res.status === 401 || res.status === 403) throw new PluggyError("Pluggy rejected the client ID or secret");
  if (res.status >= 300) throw failure(res, "Pluggy sign-in");
  return (res.json as { apiKey: string }).apiKey;
}

async function get<T>(apiKey: string, path: string, params: Record<string, string>, what: string): Promise<T> {
  const query = new URLSearchParams(params).toString();
  const res = await requestUrl({ url: `${BASE}${path}${query ? `?${query}` : ""}`, headers: { "X-API-KEY": apiKey }, throw: false });
  if (res.status >= 300) throw failure(res, what);
  return res.json as T;
}

async function fetchTransactions(apiKey: string, accountId: string, dateFrom: string): Promise<PluggyTransaction[]> {
  const out: PluggyTransaction[] = [];
  const params: Record<string, string> = { accountId, dateFrom };
  for (let i = 0; i < MAX_PAGES; i++) {
    const page = await get<{ results: PluggyTransaction[]; next: string | null }>(apiKey, "/v2/transactions", params, "Loading transactions");
    out.push(...page.results);
    const after = page.next ? new URL(page.next, BASE).searchParams.get("after") : null;
    if (!after) break;
    params.after = after;
  }
  return out;
}

/** Category tree; empty when the Pluggy plan does not include categorization. */
async function fetchCategories(apiKey: string): Promise<PluggyCategory[]> {
  try {
    const res = await get<{ results: PluggyCategory[] } | PluggyCategory[]>(apiKey, "/categories", {}, "Loading categories");
    return Array.isArray(res) ? res : res.results;
  } catch {
    return [];
  }
}

export interface InvestmentData {
  investments: PluggyInvestment[];
  /** items whose investments loaded; only their positions may be closed as gone */
  itemIds: string[];
  /** one message per item whose investments could not be loaded */
  errors: string[];
}

export interface SyncData {
  bank: BankData;
  investments: InvestmentData;
}

async function fetchInvestments(apiKey: string, itemId: string): Promise<PluggyInvestment[]> {
  const out: PluggyInvestment[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await get<{ results: PluggyInvestment[]; totalPages?: number }>(
      apiKey,
      "/investments",
      { itemId, page: String(page) },
      `Loading investments of item ${itemId}`
    );
    out.push(...res.results);
    if (!res.totalPages || page >= res.totalPages) break;
  }
  return out;
}

async function fetchInvestmentTransactions(apiKey: string, investment: PluggyInvestment): Promise<PluggyInvestmentTransaction[]> {
  const out: PluggyInvestmentTransaction[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await get<{ results: PluggyInvestmentTransaction[]; totalPages?: number }>(
      apiKey,
      `/investments/${encodeURIComponent(investment.id)}/transactions`,
      { page: String(page) },
      `Loading movements of ${investment.name}`
    );
    out.push(...res.results);
    if (!res.totalPages || page >= res.totalPages) break;
  }
  return out;
}

/**
 * Accounts of every configured item plus their transactions dated `dateFrom` or
 * later, and the items' investment positions. A failure loading investments
 * (e.g. the item has no investments product) does not fail the bank sync.
 */
export async function fetchBankData(config: PluggyConfig, dateFrom: string): Promise<SyncData> {
  const apiKey = await authenticate(config);
  const accounts: PluggyAccount[] = [];
  const transactions: PluggyTransaction[] = [];
  const investments: InvestmentData = { investments: [], itemIds: [], errors: [] };
  for (const itemId of config.itemIds) {
    const page = await get<{ results: PluggyAccount[] }>(apiKey, "/accounts", { itemId }, `Loading accounts of item ${itemId}`);
    for (const acc of page.results) {
      accounts.push(acc);
      transactions.push(...(await fetchTransactions(apiKey, acc.id, dateFrom)));
    }
    let positions: PluggyInvestment[];
    try {
      positions = await fetchInvestments(apiKey, itemId);
      investments.itemIds.push(itemId);
    } catch (e) {
      investments.errors.push((e as Error).message);
      continue;
    }
    for (const p of positions) {
      // only the separately fetched list counts: missing movements fall back to estimates
      delete p.transactions;
      try {
        p.transactions = await fetchInvestmentTransactions(apiKey, p);
      } catch (e) {
        investments.errors.push((e as Error).message);
      }
      investments.investments.push(p);
    }
  }
  return { bank: { accounts, transactions, categories: await fetchCategories(apiKey) }, investments };
}
