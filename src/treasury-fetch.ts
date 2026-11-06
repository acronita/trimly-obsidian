import { requestUrl } from "obsidian";
import { t } from "./i18n";
import { parseTreasuryPrices } from "./treasury";
import type { TreasuryPrices } from "./treasury";

/** Tesouro Transparente's open data: every bond on every day, about 15 MB. No key, and nothing about the user is sent. */
const URL = "https://www.tesourotransparente.gov.br/ckan/dataset/df56aa42-484a-4a59-8184-7676580c81e3/resource/796d2059-14e9-44e3-80c9-2d9e30b405c1/download/precotaxatesourodireto.csv";

export async function fetchTreasuryPrices(): Promise<TreasuryPrices> {
  const res = await requestUrl({ url: URL, throw: false });
  if (res.status >= 300) throw new Error(t.errors.treasuryPrices(res.status));
  const data = parseTreasuryPrices(res.text);
  if (!data) throw new Error(t.errors.treasuryFormat);
  return data;
}
