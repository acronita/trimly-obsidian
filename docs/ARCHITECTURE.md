# Architecture

## Encryption rule

Every file Trimly writes to the vault is encrypted. `src/store.ts` is the only module that calls
vault write APIs, and it only writes text produced by `encryptText`. `test/encryption-rule.test.ts`
scans `src/` and fails if any other module writes to the vault, if `store.ts` writes anything not
produced by `encryptText`, or if new fields are added to the settings (`data.json`).

## Source layout

| File | Role |
|---|---|
| `src/crypto.ts` | Web Crypto: PBKDF2 key derivation, AES-GCM encrypt/decrypt, envelope format. No Obsidian imports (unit tested in Node). |
| `src/ledger.ts` | Data model and pure finance logic: balances, month summaries, spending by category, recurring posting, amount parsing; portfolio totals, snapshots (`recordSnapshot` rebuilds today's flows from known movements plus an accumulated untracked part) and manual positions/movements (`saveAsset`, `saveManualMovement`, …, which apply movements to value, cost at average cost, and quantity). No Obsidian imports. |
| `src/store.ts` | `EncryptedStore`: loads/decrypts and encrypts/saves the ledger file; caches the derived key; serializes writes; remembers its last write to ignore its own modify events. |
| `src/passphrase.ts` | `PassphraseManager`: passphrase in memory and, optionally, in vault-scoped `localStorage` (device app data, outside the vault). |
| `src/bank-sync.ts` | Pure merge of Pluggy data into the ledger: creates synced accounts, pairs own-account transfers (card bill payments), reconciles the 90-day window (re-links transactions Pluggy re-created with a new id, removes ones it no longer returns), maps Pluggy categories, aligns balances. No Obsidian imports (unit tested in Node). |
| `src/investment-sync.ts` | Pure merge of Pluggy investment positions and their movements: upserts assets by Pluggy id, maps Pluggy type/subtype to an asset class, upserts movements (re-linking ones with a new id), closes positions an item stopped reporting (only for items whose investments loaded), records the day's portfolio snapshot with its flow and income since the previous day (from movements, or estimated from the amount invested for positions without them; a newly tracked position counts as money in). No Obsidian imports (unit tested in Node). |
| `src/pluggy.ts` | Minimal Pluggy HTTP client over Obsidian's `requestUrl`: auth, accounts per item, `GET /v2/transactions` with cursor pagination, `GET /investments` per item (plus `GET /items/{id}` for the connector name when a position has no institution) and `GET /investments/{id}/transactions` per position (paged; a failure is reported, not fatal), category tree. Only called when bank sync is configured. |
| `src/i18n/` | Interface text: `pt-BR.ts` is the source dictionary (`Strings` is its type), `en.ts` its translation, `index.ts` the active dictionary `t` and `setLanguage()`. No Obsidian imports. |
| `src/quotes.ts` | Pure quote logic: which codes are B3 tickers, applying brapi quotes to positions (display on all, revaluing manual ones with a quantity and recording a snapshot). No Obsidian imports (unit tested in Node). |
| `src/brapi.ts` | brapi.dev client over `requestUrl`: `GET /api/quote/{ticker}` with a Bearer token, one ticker per request; a rejected token or rate limit stops the run, other failures are reported per ticker. |
| `src/charts.ts` | Dependency-free charts: donut (SVG), paired income/expense bars (HTML), time-proportional lines (SVG). |
| `src/returns.ts` | Pure returns math: time-weighted portfolio index from the snapshots (their recorded flow and income; older snapshots fall back to amount-invested changes), period and monthly returns, CDI/IPCA compounding. No Obsidian imports (unit tested in Node). |
| `src/bcb.ts` | Central Bank of Brazil SGS client over `requestUrl`: CDI (series 12, daily) and IPCA (series 433, monthly); 404 = no values in range. Called from `TrimlyPlugin.benchmarks()`, which caches the result in memory for the day. |
| `src/modals.ts` | Passphrase (unlock/create/change), confirm, transaction, recurring, account, category, position (synced: name and class only) and manual movement editors. |
| `src/view.ts` | `TrimlyView` dashboard with an Accounts/Investments mode switch. Investments tabs: overview (portfolio hero, evolution chart, performance vs CDI/IPCA, allocation donut, by institution, largest positions, maturities), portfolio (positions by class, closed ones apart), performance (cumulative return chart, periods, month by month), movements (filterable, grouped by month), income (12-month totals, yield, per month, per position), targets (per-class target, gap to target, contribution planner). Clicking a position opens a details modal. Accounts tabs: overview (net worth hero, 6-month cash flow, spending donut, accounts, recent, upcoming), transactions (grouped by day), accounts, budgets, recurring, categories. Styles use container queries so it adapts to narrow panes. |
| `src/main.ts` | Plugin entry: unlock/lock flow, `mutate()` (change → re-render → encrypt → save), external-change reload, bank sync (`syncBank()`, auto on unlock), settings tab. |
| `src/styles/index.css` | Styles, bundled by esbuild into `styles.css`. |

## Encrypted file format

`<folder>/ledger.trimly` is pretty-printed JSON:

```json
{
  "trimly": 1,
  "kdf": { "name": "PBKDF2", "hash": "SHA-256", "iterations": 600000, "salt": "<base64>" },
  "cipher": { "name": "AES-GCM", "iv": "<base64>" },
  "data": "<base64 ciphertext + GCM tag>"
}
```

The salt is generated on ledger creation and on passphrase change; the IV is new on every save.
The plaintext is the JSON of `Ledger` (`src/ledger.ts`):

- `version` — currently `3` (investments). Older plugin versions refuse newer ledgers instead of dropping fields they don't know.
- `accounts[]` — `id, name, type, openingBalance, archived?, pluggyId?` (set on accounts created by bank sync; their opening balance is recomputed on each sync so the balance matches the bank)
- `categories[]` — `id, name, kind (expense|income), color, icon?` (Lucide icon name; default categories get theirs back on load)
- `transactions[]` — `id, date (YYYY-MM-DD), type (expense|income|transfer), amount, accountId, toAccountId?, categoryId?, description, notes?, recurringId?, pluggyIds?, pending?` (`pluggyIds`: the one or two Pluggy transactions an imported entry represents)
- `budgets[]` — `categoryId, limit`
- `recurring[]` — `id, description, type, amount, accountId, toAccountId?, categoryId?, frequency, startDate, nextDate, endDate?`
- `investments` — `assets[]`: `id, name, assetClass (fixed_income|treasury|stock|reit|etf|fund|retirement|other), code?, issuer?, institution?, quantity?, value (net, after taxes), grossValue?, invested?, rate?, rateType?, fixedRate?, dueDate?, updatedAt, closed?, pluggyId?, pluggyItemId?, movementsSynced?, addedOn?, subtype?, pluggyName?, renamed?, institutionEdited?` (no `pluggyId` = manual; sync replaces `name` with a readable one until `renamed`); `snapshots[]`: `date, value, invested, flow?, estimated?, income?`, oldest first, one per day, written on every sync (`flow`: net money in since the previous day's snapshot, `estimated`: the part movements don't explain — amount-invested estimates, newly tracked, closed or deleted positions — `income`: payouts in that window); `movements[]`: `id, assetId, date, type (buy|sell|income|tax|amortization|transfer), amount (net of fees), quantity?, description?, direction? (transfers: in|out), cost? (manual withdrawals: cost taken off), pluggyId?`; `targets[]`: `assetClass, pct` (percent; `rebalance()` scales them to 100%). Net worth for a past date uses the last snapshot on or before it (zero before the first one).
- `brapi?` — `token, lastUpdate?`: quote settings, encrypted like the Pluggy credentials. Positions with a B3 ticker carry `quote?: { price (cents), changePct?, time?, longName? }`.
- `pluggy?` — bank sync credentials: `clientId, clientSecret, itemIds[], lastSync?`. Lives here, encrypted, so it is never in `data.json` and follows the vault to other devices.

All amounts are positive integer cents (`type` gives the direction; opening balances may be negative).

## Lifecycle

1. Opening the dashboard (or any command) calls `unlock()`. If a remembered passphrase decrypts the
   file, it opens silently; otherwise a passphrase modal asks for it. With no file yet, the create
   modal sets a passphrase and writes a starter ledger.
2. After decrypting, due recurring occurrences are posted and saved. If bank sync is configured and
   the last sync is older than 6 hours, a sync runs in the background.
3. Every edit goes through `plugin.mutate()`, which re-renders and re-encrypts the whole ledger.
4. If the file changes on disk from outside (sync, `git pull`), it is reloaded with the in-memory
   passphrase. Concurrent edits on two devices are last-write-wins.
5. **Lock** drops the decrypted ledger, the derived key and the in-memory passphrase.

## Build

`esbuild.config.mjs` bundles `src/main.ts` → `main.js` and `src/styles/index.css` → `styles.css`.
`scripts/copy-to-vault.mjs` copies the three plugin files into `OBSIDIAN_PLUGIN_DIR` from `.env.local`.
