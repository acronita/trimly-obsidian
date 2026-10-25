# Trimly

Personal finance manager for [Obsidian](https://obsidian.md), with **everything encrypted at rest**.

Your vault may be synced or pushed to a Git remote; your finances shouldn't be readable there. Trimly
stores all of its data in a single file encrypted with AES-256-GCM, using a key derived from a
passphrase that never leaves your device.

## Features

- **Overview** — net worth, the month's income, expenses and savings rate, a 6-month cash-flow chart,
  spending by category (donut), account balances, recent activity and upcoming bills. Navigate month
  by month.
- **Transactions** — expenses, income and transfers between accounts, with category, account, date
  and notes. Search and filter by account, category, type and month.
- **Accounts** — checking, savings, credit card, cash, investment; opening balances; archive old ones
  without losing history.
- **Budgets** — monthly limit per expense category with progress bars and over-budget warnings.
- **Recurring** — bills, subscriptions and salaries (weekly, monthly, yearly, optional end date),
  posted automatically when their date arrives. On bank-synced accounts nothing is posted: the
  charge imported from the bank is linked to the rule instead, so it is never counted twice.
- **Subscriptions** — mark a recurring expense as a subscription to list it apart with its yearly
  cost, last charge and price changes, to judge whether it is still worth paying for.
- **Obrigações (obligations)** — a checklist of what you must do by hand by a due date: bills to
  pay (electricity, water, health plan, card bill, DAS MEI) and documents to issue or file (IRPF,
  DASN-SIMEI, invoices). Mark each month (or year) as done, optionally linking the transaction that
  paid it, or as "none this time". Overdue ones stay listed until dealt with. Reminders show as an
  Obsidian notice, and optionally a system notification on desktop, while Trimly is unlocked.
- **Categories** — default expense/income categories, fully editable, with colors and icons.
- **Investments** — a switch at the top toggles the dashboard to investments: portfolio value,
  profit, allocation by class and institution, upcoming maturities, every position grouped by
  class, an evolution chart, time-weighted returns (month by month, 12 months, since start)
  compared with CDI and IPCA, every contribution, withdrawal and tax, and the income (dividends,
  JCP, interest, coupons) per month and per position. Positions come from bank sync or are added by
  hand (crypto, foreign brokers, anything outside Open Finance), with their own contributions,
  withdrawals, income and taxes. Click a position for its details. Set a target share per asset
  class to see how far you are from it and how to split your next contribution. Positions are imported by bank sync; net worth in the accounts view includes them.
- **Hide values** — the eye button in the header masks every amount on screen; click again to show
  them.
- **Bank sync (optional)** — import accounts and transactions automatically from Brazilian banks
  through [Pluggy](https://pluggy.ai) (Open Finance). Card bill payments are recognized as transfers so
  purchases aren't counted twice. Off by default; see [Bank sync](#bank-sync-optional).
- **Quotes (optional)** — with a [brapi.dev](https://brapi.dev) token, stocks, real estate funds, ETFs and
  BDRs show their price, daily change and company name, and manual positions with a ticker and
  quantity follow the market.
- **Language** — Brazilian Portuguese by default, English in settings.
- Amount input accepts `1234.56`, `1.234,56` or `1,234.56`; any ISO currency code (BRL by default).

## Security model

- Data lives in `<folder>/ledger.trimly` (default folder `Trimly/`). The file is JSON containing
  only the KDF parameters, IV and ciphertext — no account names, amounts or dates in the clear.
- Key derivation: PBKDF2-SHA256, 600,000 iterations, random 16-byte salt. Cipher: AES-256-GCM with a
  fresh 12-byte IV on every save. A wrong passphrase or a tampered file fails to open.
- The passphrase is **never** stored in the vault. With *Remember passphrase on this device* on
  (default), it is kept in Obsidian's local storage for this vault on this device (app data, outside
  the vault folder). Turn it off to be asked once per session.
- The plugin's `data.json` (inside the vault) only holds the folder, currency, language, that toggle,
  the benchmarks toggle, the hide-values toggle and how obligation reminders are shown.
- **Network:** Trimly makes no network requests unless you set up bank sync. With bank sync on, it
  contacts `api.pluggy.ai` to fetch your accounts and transactions; your banking data then also
  passes through Pluggy. The Pluggy credentials are stored inside the encrypted ledger. With
  investments that have history, the investments view also fetches the public CDI and IPCA series
  from `api.bcb.gov.br` (Central Bank of Brazil); only the series and a date range are requested.
  Turn off *Compare with CDI and IPCA* in settings to stop it. With a brapi token, Trimly sends the
  tickers of your positions (nothing else) to `brapi.dev` to fetch quotes; the token is stored inside
  the encrypted ledger.
- **If you lose the passphrase, the data cannot be recovered.** Save it in a password manager.

## Install (manual)

Copy `main.js`, `manifest.json` and `styles.css` from a
[release](https://github.com/is-cout/trimly-obsidian/releases) into
`<vault>/.obsidian/plugins/trimly/`, then enable **Trimly** in *Settings → Community plugins*.

## Usage

Click the wallet icon in the ribbon (or run **Trimly: Open dashboard**). The first time, you'll be
asked to create a passphrase; the encrypted ledger is created with a starter account and categories.
Commands: **Open dashboard**, **Add transaction**, **Sync bank accounts**, **Lock**.

## Bank sync (optional)

Trimly can pull transactions from your banks through Pluggy's free personal route, *Meu Pluggy*.
Everything still works fully manually if you skip this.

1. Sign up at [meu.pluggy.ai](https://meu.pluggy.ai) and connect your banks there.
2. Create an account in the [Pluggy dashboard](https://dashboard.pluggy.ai), add the **MeuPluggy**
   connector, and create an application to get a **client ID** and **client secret**. The developer
   account starts with a 15-day trial: link Meu Pluggy during it (see
   [meu-pluggy](https://github.com/pluggyai/meu-pluggy)).
3. In the application's demo, connect your Meu Pluggy account once per bank and copy each
   **Item ID**.
4. In *Settings → Trimly → Bank sync*, enter the client ID, secret and item IDs, then **Connect**.

Each sync fetches the last 90 days. Trimly creates one account per bank account or card, keeps its
balance equal to the bank's, and treats the bank as the source of truth for those 90 days: entries
the bank no longer lists are removed, and a manually deleted imported entry comes back. Your category,
description and notes on an imported entry are kept. The dashboard syncs on unlock (at most every
6 hours) and from the refresh button. Categories are filled in only while your Pluggy plan includes
categorization.

Bank sync also imports the investment positions of each item (fixed income, treasury, stocks, real
estate funds, funds, ETFs, retirement plans) when the item includes Pluggy's investments product.
Each sync overwrites their values, imports their movements, and records the day's portfolio total
with the money moved and the income paid since the day before, so the history starts with your
first sync. A position the item stops reporting is shown as closed.

## Development

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## License

[GPL-3.0](LICENSE)
