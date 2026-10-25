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
  posted automatically when their date arrives.
- **Categories** — default expense/income categories, fully editable, with colors and icons.
- Amount input accepts `1234.56`, `1.234,56` or `1,234.56`; any ISO currency code (BRL by default).

## Security model

- Data lives in `<folder>/ledger.trimly` (default folder `Trimly/`). The file is JSON containing
  only the KDF parameters, IV and ciphertext — no account names, amounts or dates in the clear.
- Key derivation: PBKDF2-SHA256, 600,000 iterations, random 16-byte salt. Cipher: AES-256-GCM with a
  fresh 12-byte IV on every save. A wrong passphrase or a tampered file fails to open.
- The passphrase is **never** stored in the vault. With *Remember passphrase on this device* on
  (default), it is kept in Obsidian's local storage for this vault on this device (app data, outside
  the vault folder). Turn it off to be asked once per session.
- The plugin's `data.json` (inside the vault) only holds the folder, currency and that toggle.
- **If you lose the passphrase, the data cannot be recovered.** Save it in a password manager.

## Install (manual)

Copy `main.js`, `manifest.json` and `styles.css` from a
[release](https://github.com/is-cout/trimly-obsidian/releases) into
`<vault>/.obsidian/plugins/trimly/`, then enable **Trimly** in *Settings → Community plugins*.

## Usage

Click the wallet icon in the ribbon (or run **Trimly: Open dashboard**). The first time, you'll be
asked to create a passphrase; the encrypted ledger is created with a starter account and categories.
Commands: **Open dashboard**, **Add transaction**, **Lock**.

## Development

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## License

[GPL-3.0](LICENSE)
