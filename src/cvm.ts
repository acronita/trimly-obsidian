import { requestUrl } from "obsidian";
import { t } from "./i18n";
import { parseFiiSegments } from "./segments";
import { unzip } from "./spreadsheet";

/** CVM's open data: every FII's monthly report for a year, about 1.3 MB. No key, and nothing about the user is sent. */
const url = (year: number) => `https://dados.cvm.gov.br/dados/FII/DOC/INF_MENSAL/DADOS/inf_mensal_fii_${year}.zip`;

/** Segments by issuer. In January the year's file may not exist yet, so the previous year's stands in. */
export async function fetchFiiSegments(year: number): Promise<Map<string, string>> {
  for (const y of [year, year - 1]) {
    const res = await requestUrl({ url: url(y), throw: false });
    if (res.status === 404) continue;
    if (res.status >= 300) throw new Error(t.errors.fiiSegments(res.status));
    const files = await unzip(new Uint8Array(res.arrayBuffer), (name) => /_(geral|ativo_passivo)_\d{4}\.csv$/.test(name), "latin1");
    const file = (kind: string) => files.get(`inf_mensal_fii_${kind}_${y}.csv`) ?? "";
    const segments = parseFiiSegments(file("geral"), file("ativo_passivo"), { paper: t.inv.table.paper, fundOfFunds: t.inv.table.fundOfFunds });
    if (segments) return segments;
  }
  throw new Error(t.errors.fiiFormat);
}
