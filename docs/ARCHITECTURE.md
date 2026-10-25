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
| `src/ledger.ts` | Data model and pure finance logic: balances, month summaries, spending by category, recurring posting, amount parsing. No Obsidian imports. |
| `src/store.ts` | `EncryptedStore`: loads/decrypts and encrypts/saves the ledger file; caches the derived key; serializes writes; remembers its last write to ignore its own modify events. |
| `src/passphrase.ts` | `PassphraseManager`: passphrase in memory and, optionally, in vault-scoped `localStorage` (device app data, outside the vault). |
| `src/charts.ts` | Dependency-free charts: donut (SVG) and paired income/expense bars (HTML). |
| `src/modals.ts` | Passphrase (unlock/create/change), confirm, transaction, recurring, account and category editors. |
| `src/view.ts` | `TrimlyView` dashboard with tabs: overview (net worth hero, 6-month cash flow, spending donut, accounts, recent, upcoming), transactions (grouped by day), accounts, budgets, recurring, categories. Styles use container queries so it adapts to narrow panes. |
| `src/main.ts` | Plugin entry: unlock/lock flow, `mutate()` (change → re-render → encrypt → save), external-change reload, settings tab. |
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

- `accounts[]` — `id, name, type, openingBalance, archived?`
- `categories[]` — `id, name, kind (expense|income), color, icon?` (Lucide icon name; default categories get theirs back on load)
- `transactions[]` — `id, date (YYYY-MM-DD), type (expense|income|transfer), amount, accountId, toAccountId?, categoryId?, description, notes?, recurringId?`
- `budgets[]` — `categoryId, limit`
- `recurring[]` — `id, description, type, amount, accountId, toAccountId?, categoryId?, frequency, startDate, nextDate, endDate?`

All amounts are positive integer cents (`type` gives the direction; opening balances may be negative).

## Lifecycle

1. Opening the dashboard (or any command) calls `unlock()`. If a remembered passphrase decrypts the
   file, it opens silently; otherwise a passphrase modal asks for it. With no file yet, the create
   modal sets a passphrase and writes a starter ledger.
2. After decrypting, due recurring occurrences are posted and saved.
3. Every edit goes through `plugin.mutate()`, which re-renders and re-encrypts the whole ledger.
4. If the file changes on disk from outside (sync, `git pull`), it is reloaded with the in-memory
   passphrase. Concurrent edits on two devices are last-write-wins.
5. **Lock** drops the decrypted ledger, the derived key and the in-memory passphrase.

## Build

`esbuild.config.mjs` bundles `src/main.ts` → `main.js` and `src/styles/index.css` → `styles.css`.
`scripts/copy-to-vault.mjs` copies the three plugin files into `OBSIDIAN_PLUGIN_DIR` from `.env.local`.
