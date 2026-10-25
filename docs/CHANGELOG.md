# Changelog

## 0.3.0 — 2026-10-25

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
