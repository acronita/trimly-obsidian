import { RequestUrlResponse, requestUrl } from "obsidian";
import type { BankData, PluggyAccount, PluggyBill, PluggyCategory, PluggyTransaction } from "./bank-sync";
import type { PluggyInvestment, PluggyInvestmentTransaction } from "./investment-sync";
import { t } from "./i18n";
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
  return new PluggyError(t.errors.failed(what, res.status, detail));
}

async function authenticate(config: PluggyConfig): Promise<string> {
  const res = await requestUrl({
    url: `${BASE}/auth`,
    method: "POST",
    contentType: "application/json",
    body: JSON.stringify({ clientId: config.clientId, clientSecret: config.clientSecret }),
    throw: false,
  });
  if (res.status === 401 || res.status === 403) throw new PluggyError(t.errors.pluggyRejected);
  if (res.status >= 300) throw failure(res, t.errors.pluggySignIn);
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
    const page = await get<{ results: PluggyTransaction[]; next: string | null }>(apiKey, "/v2/transactions", params, t.errors.loadingTransactions);
    out.push(...page.results);
    const after = page.next ? new URL(page.next, BASE).searchParams.get("after") : null;
    if (!after) break;
    params.after = after;
  }
  return out;
}

/** A credit card's bills; empty when the bank does not report them. */
async function fetchBills(apiKey: string, accountId: string): Promise<PluggyBill[]> {
  const out: PluggyBill[] = [];
  try {
    for (let page = 1; page <= MAX_PAGES; page++) {
      const res = await get<{ results: PluggyBill[]; totalPages?: number }>(apiKey, "/bills", { accountId, page: String(page) }, t.errors.loadingBills);
      out.push(...res.results.map((b) => ({ ...b, accountId })));
      if (!res.totalPages || page >= res.totalPages) break;
    }
  } catch {
    // the card's closing and due days stand in
  }
  return out;
}

/** Category tree; empty when the Pluggy plan does not include categorization. */
async function fetchCategories(apiKey: string): Promise<PluggyCategory[]> {
  try {
    const res = await get<{ results: PluggyCategory[] } | PluggyCategory[]>(apiKey, "/categories", {}, t.errors.loadingCategories);
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
      t.errors.loadingInvestments(itemId)
    );
    out.push(...res.results);
    if (!res.totalPages || page >= res.totalPages) break;
  }
  return out;
}

/**
 * Name of the institution behind an item, to label positions Pluggy reports
 * without one. Undefined when unknown, or when the item is a MeuPluggy link,
 * whose connector name says nothing about the bank.
 */
async function connectorName(apiKey: string, itemId: string): Promise<string | undefined> {
  try {
    const item = await get<{ connector?: { name?: string } }>(apiKey, `/items/${encodeURIComponent(itemId)}`, {}, t.errors.loadingItem);
    const name = item.connector?.name?.trim();
    return name && !/meu\s*pluggy/i.test(name) ? name : undefined;
  } catch {
    return undefined;
  }
}

async function fetchInvestmentTransactions(apiKey: string, investment: PluggyInvestment): Promise<PluggyInvestmentTransaction[]> {
  const out: PluggyInvestmentTransaction[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await get<{ results: PluggyInvestmentTransaction[]; totalPages?: number }>(
      apiKey,
      `/investments/${encodeURIComponent(investment.id)}/transactions`,
      { page: String(page) },
      t.errors.loadingMovements(investment.name)
    );
    out.push(...res.results);
    if (!res.totalPages || page >= res.totalPages) break;
  }
  return out;
}

/**
 * Accounts of every configured item plus their transactions dated `dateFrom` or
 * later, the cards' bills, and the items' investment positions. A failure loading investments
 * (e.g. the item has no investments product) does not fail the bank sync.
 */
export async function fetchBankData(config: PluggyConfig, dateFrom: string): Promise<SyncData> {
  const apiKey = await authenticate(config);
  const accounts: PluggyAccount[] = [];
  const transactions: PluggyTransaction[] = [];
  const bills: PluggyBill[] = [];
  const investments: InvestmentData = { investments: [], itemIds: [], errors: [] };
  for (const itemId of config.itemIds) {
    const page = await get<{ results: PluggyAccount[] }>(apiKey, "/accounts", { itemId }, t.errors.loadingAccounts(itemId));
    for (const acc of page.results) {
      accounts.push(acc);
      transactions.push(...(await fetchTransactions(apiKey, acc.id, dateFrom)));
      if (acc.type === "CREDIT") bills.push(...(await fetchBills(apiKey, acc.id)));
    }
    let positions: PluggyInvestment[];
    try {
      positions = await fetchInvestments(apiKey, itemId);
      investments.itemIds.push(itemId);
    } catch (e) {
      investments.errors.push((e as Error).message);
      continue;
    }
    const bank = positions.some((p) => !p.institution?.name) ? await connectorName(apiKey, itemId) : undefined;
    for (const p of positions) {
      if (!p.institution?.name && bank) p.institution = { name: bank };
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
  return { bank: { accounts, transactions, bills, categories: await fetchCategories(apiKey) }, investments };
}
