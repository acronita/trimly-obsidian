import { RequestUrlResponse, requestUrl } from "obsidian";
import type { BankData, PluggyAccount, PluggyCategory, PluggyTransaction } from "./bank-sync";
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

/** Accounts of every configured item plus their transactions dated `dateFrom` or later. */
export async function fetchBankData(config: PluggyConfig, dateFrom: string): Promise<BankData> {
  const apiKey = await authenticate(config);
  const accounts: PluggyAccount[] = [];
  const transactions: PluggyTransaction[] = [];
  for (const itemId of config.itemIds) {
    const page = await get<{ results: PluggyAccount[] }>(apiKey, "/accounts", { itemId }, `Loading accounts of item ${itemId}`);
    for (const acc of page.results) {
      accounts.push(acc);
      transactions.push(...(await fetchTransactions(apiKey, acc.id, dateFrom)));
    }
  }
  return { accounts, transactions, categories: await fetchCategories(apiKey) };
}
