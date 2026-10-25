import { requestUrl } from "obsidian";
import { t } from "./i18n";
import type { FxRates } from "./ledger";

/**
 * Daily reference exchange rates from Frankfurter (European Central Bank data).
 * No key, and nothing about the user is sent: only currency codes.
 */
const FRANKFURTER = "https://api.frankfurter.dev/v1/latest";

/** Latest rates of `symbols` against `base`; currencies the ECB does not publish are left out. */
export async function fetchRates(base: string, symbols: string[], today: string): Promise<FxRates> {
  const res = await requestUrl({ url: `${FRANKFURTER}?base=${base}&symbols=${symbols.join(",")}`, throw: false });
  if (res.status >= 300) throw new Error(t.errors.fxRates(res.status));
  const body = res.json as { date: string; rates: Record<string, number> };
  return { base, date: body.date, fetched: today, rates: body.rates };
}
