# Changelog

## 0.6.0 — 2026-10-25

- 2026-10-25 — Credit cards show bills instead of a balance. A card's balance added up its whole
  history and stayed negative, so it said nothing about what is due. Cards now have an optional
  closing day and due day (account modal; filled from Pluggy's `creditData` on sync when blank, a
  day set by hand stays): the card tile shows the open bill and its closing date, the last closed
  bill with what is left to pay and its due date (or *paga*), and the total owed; the overview's
  account list shows the open bill. Card payments (transfers into the card) after the closing pay
  the closed bill first, the rest goes to the open one; refunds lower their own cycle. Without a
  closing day a bill follows the calendar month. Net worth still subtracts the full card debt.
  New optional `closingDay` / `dueDay` on accounts (no format bump). The account modal also gets
  *Ver transações*, which opens Transactions filtered by that account across all months, and the
  Accounts tab gets an *Investimentos* tile (value, number of positions) that opens the
  investments mode. Files touched: `src/ledger.ts`, `src/bank-sync.ts`, `src/modals.ts`,
  `src/view.ts`, `src/i18n/*`, `test/card-bills.test.ts`, `test/bank-sync.test.ts`, `README.md`,
  `docs/ARCHITECTURE.md`, `docs/FAQ.md`.

## 0.5.0 — 2026-10-25

- 2026-10-25 — New *Obrigações* tab: a checklist of what has to be done by hand by a due date,
  bills to pay (electricity, water, health plan, card bill, DAS MEI) and documents to issue or file
  (IRPF, DASN-SIMEI, invoices). Each obligation repeats weekly, monthly or yearly; each occurrence
  is marked done (optionally linking the transaction that paid it, picked from suggestions near the
  due date) or "none this time" (no water bill that month), and can be undone. Overdue ones stay
  listed until dealt with. The tab shows overdue / due in 7 days / amount to pay this month, the
  pending list, every obligation and what was done recently. Reminders: an Obsidian notice on
  unlock and every hour while unlocked, once a day per occurrence, starting `remindDays` before the
  due date; optionally also a system notification on desktop, which only says how many there are,
  since it shows outside Obsidian. New setting *Lembretes de obrigações* (`reminders` in
  `data.json`: `off`, `app` (default) or `system`). There is no push with Obsidian closed: a plugin
  can't send one without a server. Ledger format bumped to version 4 (new `obligations`): older
  plugin versions refuse the ledger instead of dropping them on save, so update Trimly on every
  device. Files touched: `src/ledger.ts`, `src/main.ts`, `src/modals.ts`, `src/view.ts`,
  `src/i18n/*`, `test/obligations.test.ts`, `test/ledger.test.ts`, `test/investment-sync.test.ts`,
  `test/encryption-rule.test.ts`, `README.md`, `docs/ARCHITECTURE.md`, `docs/FAQ.md`.

## 0.4.0 — 2026-10-25

- 2026-10-25 — Subscriptions, and recurring rules that no longer double-count on synced accounts.
  A recurring rule on a bank-synced account used to post its own transaction while sync imported
  the real charge, so it counted twice. Now such a rule posts nothing: the imported charge closest
  to the due date (within 7 days, same name or amount within 20%) is linked to it, takes the rule's
  category, and the rule follows the charge's amount, so a price increase is matched next time.
  A month with no charge 7 days past the due date, counted up to the last sync, is skipped.
  Duplicates already posted before this change are not removed; delete them by hand. Recurring
  expenses can be marked as a subscription (`Recurring.subscription`, optional): the Recurring tab
  lists them apart with their yearly cost, last charge and price change, and the total per month
  and per year. Why: seeing what services cost per year helps decide whether to keep them, and the
  card they are charged to is usually synced. Files touched: `src/ledger.ts`, `src/bank-sync.ts`,
  `src/main.ts`, `src/modals.ts`, `src/view.ts`, `src/i18n/*`, `test/bank-sync.test.ts`, `README.md`,
  `docs/ARCHITECTURE.md`.

## 0.3.0 — 2026-10-25

- 2026-10-25 — Eye button in the dashboard header hides every money amount (shown as `••••••`,
  charts and tooltips included; percentages stay), for using Trimly with someone looking at the
  screen. The choice is kept in `data.json` (`hideValues`, off by default) — a display preference,
  not financial data. The sync button now spins as soon as it is clicked: the view re-rendered
  before the sync was marked as running, so it only spun after switching tabs. Files touched:
  `src/main.ts`, `src/view.ts`, `src/i18n/*`, `test/encryption-rule.test.ts`.

- 2026-10-25 — Line charts show the value under the pointer: hovering or touching a chart (evolution,
  cumulative return, a position's 3 months) draws a guide line, a dot on each series and a tooltip
  with the date and values. Tesouro Direto positions without an institution show "Tesouro Nacional"
  (their issuer; marked "(emissor)" in the details). Setting the institution of a synced position can
  also fill it into the positions of the same bank connection that have none (on by default in
  *Editar ativo*), since funds have no free data source to infer it from. Files touched:
  `src/charts.ts`, `src/quotes.ts`, `src/ledger.ts`, `src/modals.ts`, `src/view.ts`, `src/i18n/*`,
  `src/styles/index.css`, `test/quotes.test.ts`, `test/investment-sync.test.ts`.

- 2026-10-25 — Line charts no longer break the view they are in: SVG classes were passed as one
  space-separated string, which Obsidian's `createSvg` rejects, so every position with a brapi price
  history failed to open (and the evolution and performance charts would have failed the same way).
  `test/svg-classes.test.ts` guards it. Positions without an institution are now shown under the
  company or fund name from their brapi quote, marked "(pela brapi)" in the details; display only,
  the stored institution is unchanged and one set by hand still wins. Files touched:
  `src/charts.ts`, `src/quotes.ts`, `src/view.ts`, `src/i18n/*`, `test/svg-classes.test.ts`,
  `test/quotes.test.ts`.

- 2026-10-25 — Positions open from everywhere they are listed. Rows in the Income tab (by position,
  recent payments) and movements of synced positions now open the position details; before, they
  did nothing, which is where real estate funds mostly show up. If the details fail to render, a
  notice says why instead of the click doing nothing. Files touched: `src/view.ts`, `src/i18n/*`.

- 2026-10-25 — More from brapi quotes, at no extra requests. Each quote request now also asks for 3
  months of daily history (allowed on the free plan) and keeps the 52-week low and high, P/E, EPS,
  market cap and logo. The position details show them, a 3-month price chart with the average price
  as a dashed line, and the average price paid (amount invested ÷ quantity) against the quote. Rows
  of positions named by their ticker show the company name. `Asset.quote` gains `low52`, `high52`,
  `pe`, `eps`, `marketCap`, `logo` and `history`. Why: a ticker alone didn't say what the position
  was or how it was doing. Files touched: `src/brapi.ts`, `src/quotes.ts`, `src/ledger.ts`,
  `src/view.ts`, `src/main.ts`, `src/i18n/*`, `src/styles/index.css`, `test/quotes.test.ts`.

- 2026-10-25 — Fewer positions without an institution. A position Pluggy reports without one takes
  the institution most other positions of the same Pluggy item report (an item is one bank
  connection), before falling back to the issuer. Synced positions can now have their institution
  set by hand in *Editar ativo*, and sync keeps it (`Asset.institutionEdited`). The rest are grouped
  as "Não informada". Files touched: `src/investment-sync.ts`, `src/ledger.ts`, `src/modals.ts`,
  `src/i18n/*`, `test/investment-sync.test.ts`.

- 2026-10-25 — Interface in Brazilian Portuguese, with English as an option. All interface text now
  lives in `src/i18n/` with pt-BR as the source language and English as a translation; new setting
  *Idioma / Language* (`language` in `data.json`, default `pt-BR`). Switching language renames the
  starter categories and the starter account that still have their default name, and the first
  unlock after upgrading translates the English starter names of existing ledgers. Bank sync maps
  Pluggy categories to starter categories by key instead of by English name. Dates and numbers
  follow the interface language. Why: Trimly is for Brazil, and Brazilian financial terms read
  badly in translation. Files touched: `src/i18n/*`, every module with interface text,
  `test/bank-sync.test.ts`, `test/encryption-rule.test.ts`, `.claude/CLAUDE.md`, `README.md`,
  `docs/`.

- 2026-10-25 — Quotes from brapi.dev (optional). With a brapi token (stored inside the encrypted
  ledger), each sync, and unlocking at most once an hour, quotes every open position whose code is a
  B3 ticker (one request per ticker): price, daily change and company name, shown on the row and in
  the details. Manual positions with a quantity get their value recalculated, which counts as market
  return. The sync button and command now cover bank sync and quotes. Tesouro Direto bonds Pluggy
  names by code (LFT, LTN, NTN-B…) are named "Tesouro Selic 2027" and the like. Ledger v3 gains
  `brapi` and `Asset.quote`. Why: positions named by code were unrecognizable, and manual stocks had
  no way to follow the market. Files touched: `src/brapi.ts`, `src/quotes.ts`, `src/main.ts`,
  `src/investment-sync.ts`, `src/ledger.ts`, `src/view.ts`, `test/quotes.test.ts`,
  `test/investment-sync.test.ts`.

- 2026-10-25 — Investments mode, phase 5: allocation targets. New Targets tab: a target percentage
  per asset class (scaled to 100% when they don't add up), each class's current share and how much
  to buy or sell to reach its target, and a contribution planner that splits an amount across
  underweight classes first, without selling. The overview's allocation legend shows each class's
  target. Ledger v3 gains `investments.targets[]`. Why: knowing the allocation is only useful
  against the allocation you want. Files touched: `src/ledger.ts`, `src/view.ts`,
  `src/styles/index.css`, `test/rebalance.test.ts`, `README.md`, `docs/`.

- 2026-10-25 — Investment fixes from testing. The Accounts/Investments switch no longer looks
  offset: the active pill used Obsidian's `--shadow-s`, which drops a shadow 15px below it.
  Positions show their name instead of the product code in front of it, and a Pluggy name that is
  a bare code (e.g. `CDB224AXYZ1`) becomes "CDB · issuer" until you rename the position. Positions
  Pluggy reports without an institution take the item's connector name (unless it is MeuPluggy)
  or the issuer, instead of "Unknown". Clicking a position opens its details (value, cost, profit,
  taxes due, quantity, unit value, rate, maturity, institution, issuer, code, product, recent
  movements) with *Edit*, *Add movement* and *All movements*. Ledger v3 gains `Asset.subtype`,
  `pluggyName` and `renamed`. Files touched: `src/investment-sync.ts`, `src/pluggy.ts`,
  `src/ledger.ts`, `src/view.ts`, `src/styles/index.css`, `test/investment-sync.test.ts`.

- 2026-10-25 — Investments mode, phase 4: manual entry. An *Add* button in investments mode opens
  a new position (name, class, code, institution, current value, amount invested, quantity, index,
  percent of index, fixed rate, maturity) or a new movement on a manual position (contribution,
  withdrawal, income, tax, amortization, transfer in/out). Movements update the position's value,
  amount invested (withdrawals at average cost) and quantity; editing or deleting one reverts that.
  Clicking any position edits it (synced ones: name and class only); clicking a manual movement
  edits it. Snapshot flows are now rebuilt the same way by the sync and by manual edits: movements
  of every position whose movements are known, plus a stored part for money they don't explain
  (estimates, newly tracked positions, closing or deleting a manual one), so the two don't
  overwrite each other on the same day; a backdated manual movement counts as money moved today.
  Ledger v3 gains `Asset.movementsSynced`/`addedOn` and `Movement.cost`. Why: assets outside Open
  Finance (crypto, foreign brokers) had no way in. Files touched: `src/ledger.ts`,
  `src/investment-sync.ts`, `src/modals.ts`, `src/view.ts`, `test/manual-investments.test.ts`,
  `README.md`, `docs/`.

- 2026-10-25 — Investments mode, phase 3: movements and income. Bank sync also fetches each
  position's movements from Pluggy (`/investments/{id}/transactions`: contributions, withdrawals,
  dividends/JCP/interest/coupons, taxes, amortizations, transfers), re-linking ones that come back
  with a new id. New Movements tab (filter by position, type and period; totals put in, taken out,
  net, income) and Income tab (last 12 months, monthly average, yield, income per month, by
  position, recent payments). Each snapshot now records the money moved and the income paid since
  the previous day's snapshot, from real movements where Pluggy has them and estimated from the
  amount invested otherwise, so returns include dividends and no longer guess flows; a position
  first seen after history started counts as money in, not gain. Ledger v3 gains
  `investments.movements[]` and snapshot `flow`/`estimated`/`income`. Why: dividends are part of
  the return, and the cost-based estimate was off whenever a deposit and a market move fell between
  the same two syncs. Files touched: `src/investment-sync.ts`, `src/pluggy.ts`, `src/ledger.ts`,
  `src/returns.ts`, `src/charts.ts`, `src/main.ts`, `src/view.ts`, `test/investment-sync.test.ts`,
  `test/ledger.test.ts`, `README.md`, `docs/`.

- 2026-10-25 — Investments mode, phase 2: evolution and returns. The investments overview gets an
  Evolution chart (portfolio value vs amount invested over the daily snapshots) and a Performance
  card (this month, 12 months, since the first snapshot), and a new Performance tab adds a
  cumulative return chart and month-by-month returns. Returns are time-weighted from the snapshots:
  the change in amount invested stands in for deposits and withdrawals (withdrawals scaled by
  value/cost) until individual movements arrive in phase 3. Each figure is compared with CDI and
  IPCA from the Central Bank of Brazil's public SGS API (series 12 and 433), fetched only when the
  investments view has history to compare, cached in memory for the day, retried after an hour on
  failure. New setting *Compare with benchmarks* (on by default) turns those requests off. Why:
  a portfolio value alone doesn't say whether it is doing well. Files touched: `src/returns.ts`,
  `src/bcb.ts`, `src/charts.ts`, `src/main.ts`, `src/view.ts`, `src/styles/index.css`,
  `test/returns.test.ts`, `test/encryption-rule.test.ts`, `README.md`, `docs/`.

- 2026-10-25 — Unlocking syncs right away when investments were never synced, instead of waiting
  for the 6-hour interval; a manual sync that finds no investments says so. Why: after upgrading,
  the Investments tab stayed empty until the next scheduled sync. Files touched: `src/main.ts`.

- 2026-10-25 — Investments mode, phase 1. A switch at the top of the dashboard toggles between
  *Accounts* (the existing tabs) and *Investments*, which has its own tabs: Overview (portfolio
  value, amount invested, profit, taxes and fees due, allocation by class, value by institution,
  largest positions, maturities in the next 12 months) and Portfolio (positions grouped by class,
  with rate, maturity and profit; closed positions listed apart). Bank sync now also fetches each
  item's positions from Pluggy's `/investments` and records one portfolio snapshot per day, which
  later phases chart. A failure loading an item's investments shows a notice and does not fail the
  bank sync or close that item's positions. Net worth in Accounts mode now includes investments
  (from the snapshots for past months). Ledger format bumped to version 3 (new `investments` with
  `assets[]` and `snapshots[]`); 0.2.0 refuses v3 ledgers. Why: Pluggy already has the investment
  data and Trimly showed none of it. Files touched: `src/investment-sync.ts`, `src/pluggy.ts`,
  `src/ledger.ts`, `src/main.ts`, `src/view.ts`, `src/styles/index.css`,
  `test/investment-sync.test.ts`, `test/ledger.test.ts`, `README.md`, `docs/`.

## 0.2.0 — 2026-10-25

- 2026-10-25 — Optional bank sync through Pluggy (Open Finance / Meu Pluggy). Imports accounts and the
  last 90 days of transactions, creates one Trimly account per bank account or card with the bank's
  balance, pairs card bill payments (and Pluggy-tagged same-person transfers) into transfers, maps
  Pluggy categories onto the default ones, and re-links credit card transactions Pluggy re-creates
  with a new id so user edits survive. Syncs on unlock (at most every 6 hours), from a dashboard
  button and the **Sync bank accounts** command. Off by default; no network requests without it.
  Credentials live inside the encrypted ledger. Ledger format bumped to version 2 (new optional
  fields `pluggy`, `Account.pluggyId`, `Transaction.pluggyIds`/`pending`); 0.1.0 refuses v2 ledgers
  rather than silently dropping the credentials. `tsconfig.json` allows `.ts` import specifiers so
  `src/bank-sync.ts` can import `src/ledger.ts` under Node's test runner. Why: typing every
  transaction by hand doesn't scale. Files touched: `src/bank-sync.ts`, `src/pluggy.ts`,
  `src/ledger.ts`, `src/main.ts`, `src/view.ts`, `src/styles/index.css`, `test/bank-sync.test.ts`,
  `tsconfig.json`, `README.md`, `docs/`.

## 0.1.0 — 2026-10-24

- 2026-10-25 — Release workflow runs on Node 22 instead of 20. Why: `npm test` uses
  `--experimental-strip-types`, which needs Node 22.6+, so the release build could not pass on 20.
  Files touched: `.github/workflows/release.yml`, `docs/DEVELOPMENT.md`.

- 2026-10-24 — Dashboard redesign: net worth hero with month income/expenses/saved, 6-month cash-flow
  chart, spending donut, upcoming recurring, transactions grouped by day, account and budget tiles,
  category icons with an icon picker, and a transaction modal with a type switch and large amount
  field. Money is formatted the way the currency expects (R$ 1.234,56 for BRL). Why: the first UI
  was a grid of identical grey boxes with no hierarchy. Files touched: `src/view.ts`, `src/charts.ts`,
  `src/modals.ts`, `src/ledger.ts`, `src/main.ts`, `src/styles/index.css`.

- 2026-10-24 — Initial release: dashboard with overview, transactions, accounts, budgets, recurring
  transactions and categories. All data stored in one AES-256-GCM encrypted file (`ledger.trimly`),
  key derived from a passphrase kept only on the device. Why: the vault is pushed to GitHub and the
  data is sensitive. Files touched: everything (new project).
- 2026-10-24 — Project tooling copied from Maguilanote: `.claude/` instructions and release skill,
  release workflow (now also runs `npm test`), lint config, auto-copy build into the vault via
  `.env.local`.
