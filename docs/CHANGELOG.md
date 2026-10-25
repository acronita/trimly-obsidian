# Changelog

## 0.3.0 — 2026-10-25

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
