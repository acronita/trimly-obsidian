# Changelog

## Unreleased

- 2026-11-08 — README's *Security model* catches up with the code: the full list of `data.json` toggles, public data
  fetched by default instead of "no network requests", and everything the AI assistants' tools send, plus where the
  key is kept. The 1.0.0 entry no longer lists *Várias carteiras*, removed in 0.35.0. Why: the release review found them
  out of date. Files touched: `README.md`, `docs/CHANGELOG.md`.

## 1.10.0 — 2026-11-13

- 2026-11-13 — Income tools in the *Proventos* tab. A monthly income goal ("quero R$ X por mês"): the average of the
  last 12 months against it, what is missing, and how many months of aportes (the month's Invest goal, else the
  12-month average) reinvesting the income take the portfolio to the value that pays it at today's yield. Per
  position: yield on cost, current yield and how far it is above or below the CDI net of 15% income tax. Alerts when
  a regular payer's last provento is 10% or more below its average of the previous 12 months (from B3's proventos,
  same kind only, at least three earlier payments) and when one position pays 25% or more of the income. A 12-month
  payment calendar per position. The investments overview gains *Este mês*: what is left of the month's Invest goal,
  split by the targets (previdência first), and the proventos received. New optional `investments.incomeGoal`. Why:
  asked, to follow passive income toward a goal and see where to aporte each month. Files touched: `src/income.ts`,
  `src/ledger.ts`, `src/view.ts`, `src/styles/index.css`, `src/i18n/pt-BR.ts`, `src/i18n/en.ts`,
  `test/income.test.ts`, `README.md`, `docs/ARCHITECTURE.md`, `package.json`, `manifest.json`, `versions.json`.

## 1.9.0 — 2026-11-12

- 2026-11-13 — The sale calculator moves into *Calculadoras*, behind a *Simuladores | Venda* switch, so the investments
  tab bar fits a narrow pane again. It also takes fixed income and Tesouro: type the gross amount to redeem and it
  takes the oldest applications first, each taxed by the regressive table for its days (22,5% to 15%) after IOF under
  30 days; LCI, LCA, CRI, CRA and LIG pay no income tax. The applications come from the movements (scaled to the
  position's invested amount); with none, one application dated when Trimly started tracking it. Each application's
  gain is an estimate, as if all grew alike. The selling-order rule counts a tax-free or loss-making fixed income
  position of the class as one to redeem first. Why: asked; the extra tab cut the tab bar, and early redemptions
  are sales too. Files touched: `src/sale.ts`, `src/view.ts`, `src/i18n/pt-BR.ts`, `src/i18n/en.ts`,
  `test/sale.test.ts`, `README.md`, `docs/ARCHITECTURE.md`.
- 2026-11-12 — New *Venda* tab in Investments: a sale calculator. Given a stock, BDR, ETF or FII and a quantity it shows
  the sale value, the average cost from the IR tab, the gross gain, the estimated income tax by class (FII 20% with no
  exemption, stocks 15% exempt up to R$ 20.000 of sales in the month, ETFs and BDRs 15% with none), the losses offset
  per group, the costs (B3's 0,03% to start), the net amount, the proventos of the last 12 months given up and the
  allocation before and after against the targets. It then evaluates the sale against seven rules (rebalancing band,
  selling order, maximum cost, exempt income, destination below target, emergency reserve, prefer contributing) and
  says which pass and which fail, without deciding; each can be turned off and its limit changed. *Sem vender* shows
  how many months of a monthly aporte reach the targets without selling. The tax comes from replaying the IR tab with
  the sale added, so it matches what the IR tab would show after it. New optional `investments.saleRules`, version
  unchanged. Why: asked, to weigh rebalancing sales by targets, tax and where the money goes. Files touched:
  `src/sale.ts`, `src/ledger.ts`, `src/view.ts`, `src/styles/index.css`, `src/i18n/pt-BR.ts`, `src/i18n/en.ts`,
  `test/sale.test.ts`, `README.md`, `docs/ARCHITECTURE.md`, `package.json`, `manifest.json`, `versions.json`.

## 1.8.0 — 2026-11-12

- 2026-11-12 — Money into or out of investments from a bank account (a brokerage note settled, "OPERAÇÕES EM BOLSA",
  an application, a redemption, or anything Pluggy puts under *Investments* except dividends) syncs as a transfer with
  the new `PORTFOLIO` side ("Carteira de investimentos") instead of an expense or income; the transaction editor offers
  it as a transfer side too. Ledgers already synced are corrected by the next sync. Why: paying for a purchase of
  investments showed as uncategorized spending, while the aporte was already counted from the positions. Files
  touched: `src/bank-sync.ts`, `src/ledger.ts`, `src/modals.ts`, `src/view.ts`, `src/export.ts`, `src/i18n/pt-BR.ts`,
  `src/i18n/en.ts`, `test/bank-sync.test.ts`, `README.md`, `docs/ARCHITECTURE.md`.
- 2026-11-12 — The *Investir* goal counts net aportes: buys minus sells of the month. Why: a brokerage note that sells
  FIIs to buy ETFs counted the whole purchase as new money. The calculators' default monthly contribution follows.
  Files touched: `src/ledger.ts`, `src/view.ts`, `test/ledger.test.ts`, `README.md`.
- 2026-11-12 — Previdência stays apart from the allocation targets, like the emergency reserve: PGBL/VGBL and any
  position with *Conta nas metas como: Previdência* (now an option, e.g. a Tesouro Renda+). *Metas* gets a
  *Previdência* card with its positions and *Parte de cada aporte*, a percent or a fixed amount, which the contribution
  planner sends to previdência before splitting the rest by the targets. The planner starts from what is left of the
  month's *Investir* goal. New optional `investments.pensionShare`, version unchanged. Why: asked, to keep previdência
  separate and fund it with a fixed slice. Files touched: `src/ledger.ts`, `src/view.ts`, `src/modals.ts`,
  `src/i18n/pt-BR.ts`, `src/i18n/en.ts`, `test/rebalance.test.ts`, `README.md`, `docs/ARCHITECTURE.md`, `docs/FAQ.md`.
- 2026-11-12 — A fund's, FII's or stock's issuer (the product itself, e.g. "CSHG RENDA URBANA - FDO INV IMOB - FII") no
  longer stands in for a missing institution; only a fixed income issuer, a bank, does. Such an institution already
  saved, even spread to the whole connection, goes back to sync. Empty "SAIDA" redemptions (no money, no shares) are
  no longer kept, and old ones are removed by the next sync. Why: *Por instituição* showed an FII as the institution
  of 84% of the portfolio, and *Movimentações* listed R$ 0,00 redemptions. Files touched: `src/investment-sync.ts`,
  `test/investment-sync.test.ts`, `package.json`, `manifest.json`, `versions.json`.

## 1.7.1 — 2026-11-09

- 2026-11-09 — Money passing through an account (Nubank -> Rico Conta -> investment account) pairs each hop whatever
  order the bank lists the movements in: bank debits with the fewest possible credits pair first. Why: the first debit
  could take the last hop's credit, leaving the middle debit with no partner, so the same amount became a transfer, a
  false income and a false expense. Ledgers already affected are corrected by the next sync. Files touched:
  `src/bank-sync.ts`, `test/bank-sync.test.ts`, `package.json`, `manifest.json`, `versions.json`.

## 1.7.0 — 2026-11-08

- 2026-11-08 — The investments assistant gets `market_data`: current indicators from Status Invest and XP's
  recommendation, target price and risk score, for any ticker, held or not. The full public lists are downloaded when it
  is called, kept in memory for an hour and filtered on the device, so no ticker goes to those sites. It follows
  *Notícias e carteiras*, and XP's part also follows XP's switch. Why: asked, so answers use today's data instead of what
  the model remembers. BTG has no public list with content, and product shelves need a login, so neither is read. Files
  touched: `src/market-data.ts`, `src/market-data-fetch.ts`, `src/assistant.ts`, `src/view.ts`, `src/i18n/pt-BR.ts`,
  `src/i18n/en.ts`, `test/market-data.test.ts`, `test/assistant.test.ts`, `README.md`, `docs/ARCHITECTURE.md`,
  `docs/AI-ASSISTANT.md`, `package.json`, `manifest.json`, `versions.json`.

## 1.6.0 — 2026-11-08

- 2026-11-08 — *Carteira* shows every class as a table sortable by column (asset, segment, price and quantity, or rate
  and maturity for Tesouro and renda fixa, or value and cost without a price; % of the class, % of the portfolio), under
  bars with how much of the class each segment holds. Segments come monthly from B3 (stocks) and the CVM monthly report
  (FIIs: the balance sheet tells Papéis and Fundo de Fundos, specific labels are kept, vague ones stay blank); Tesouro
  groups by product and renda fixa by indexer, without fetching; the position form edits them. New `segment?`, `segmentEdited?` on positions and
  `segmentsCheckedOn?` on the ledger, version unchanged; new *Segmentos dos ativos* switch. Why: to see what kind of asset
  each position is and how a class is split. Files touched: `src/segments.ts`, `src/cvm.ts`, `src/b3.ts`,
  `src/spreadsheet.ts`, `src/ledger.ts`, `src/main.ts`, `src/modals.ts`, `src/view.ts`, `src/styles/index.css`,
  `src/i18n/pt-BR.ts`, `src/i18n/en.ts`, `test/segments.test.ts`, `test/encryption-rule.test.ts`, `README.md`,
  `docs/ARCHITECTURE.md`, `package.json`, `manifest.json`, `versions.json`.

## 1.5.0 — 2026-11-08

- 2026-11-08 — With an emergency reserve set, the dashboard's allocation card shows two charts: with the reserve as a
  slice, and without it, where the shares sit next to the targets. Why: to see the portfolio on its own. Files touched:
  `src/view.ts`, `src/i18n/pt-BR.ts`, `src/i18n/en.ts`, `package.json`, `manifest.json`, `versions.json`.

## 1.4.0 — 2026-11-08

- 2026-11-08 — A position's details have clipboard buttons to copy its name and, when it has one, its code. Why: asked
  for while looking up positions elsewhere. Files touched: `src/view.ts`, `src/styles/index.css`, `src/i18n/pt-BR.ts`,
  `src/i18n/en.ts`, `package.json`, `manifest.json`, `versions.json`.

## 1.3.0 — 2026-11-08

- 2026-11-08 — Allocation targets exist only for Tesouro, Renda fixa, FIIs, Ações, Exterior, Ouro and Cripto. Fundos,
  Previdência and Outros join ETF as product classes: saved targets for them are dropped on load, the others rescale, and
  their positions are listed in *Metas* until *Conta nas metas como* says what they expose you to. Why: a fund target
  tracks the wrapper and hides what is inside it. Files touched: `src/ledger.ts`, `src/view.ts`, `src/modals.ts`,
  `src/assistant.ts`, `src/i18n/pt-BR.ts`, `src/i18n/en.ts`, `test/rebalance.test.ts`, `test/assistant.test.ts`,
  `README.md`, `docs/FAQ.md`, `docs/ARCHITECTURE.md`, `package.json`, `manifest.json`, `versions.json`.

## 1.2.0 — 2026-11-08

- 2026-11-08 — Allocation targets gain the classes Exterior (foreign currency included), Ouro and Cripto, and ETF no
  longer takes a target, since it names a product and overlapped with them; a saved ETF target is dropped on load, and
  the other targets rescale. A position counts under another class in the targets through the new optional `targetClass`
  field (*Conta nas metas como*), so an IVVB11 counts as Exterior and stays an ETF for income tax; ETFs not yet
  classified are listed in *Metas*. New optional ledger field `investments.reserve` (amount and positions)
  separates the emergency fund: up to the amount leaves the portfolio, proportionally across the marked positions, and
  targets, contribution plan, by-asset weights and the allocation chart's percentages look at the rest. The investments
  assistant gets the `emergency_reserve` tool, and `portfolio_summary` now reports each position's product, index, rate
  and share in the reserve, so it can judge whether those positions work as a reserve. Why: the targets had no room for
  those classes, and the reserve inflated the fixed income share. Files touched: `src/ledger.ts`, `src/view.ts`,
  `src/modals.ts`, `src/assistant.ts`, `src/i18n/pt-BR.ts`, `src/i18n/en.ts`, `test/rebalance.test.ts`,
  `test/assistant.test.ts`, `README.md`, `docs/FAQ.md`, `docs/ARCHITECTURE.md`, `docs/AI-ASSISTANT.md`, `package.json`,
  `manifest.json`, `versions.json`.

## 1.1.0 — 2026-11-08

- 2026-11-08 — Movements from the bank or a spreadsheet can be deleted (trash icon on the row) and stay deleted across
  syncs and re-imports, in the new optional ledger field `investments.dismissedMovements`; the position's value stays what
  the bank reports. Repeats are also removed on their own at each sync: a spreadsheet row gives way to the bank's record
  of the same trade, now matched by date and quantity because the bank's amount includes fees, and a closed position's
  movements give way to exact copies in an open position with the same bank name, due date and class. A purchase or sale
  recorded on two days up to 5 apart, as fills on one and a single settlement on the other, counts once when the two days'
  totals match and the trades add up to more shares than the position holds. Import looks for a repeat in every position
  of the ticker and adds new rows to an open one. Why: test notes about repeated movements that couldn't be deleted;
  Pluggy was reporting one Tesouro Selic twice, open and closed, and FII purchases appeared on 5 and 9 January. Files touched: `src/ledger.ts`,
  `src/investment-import.ts`, `src/investment-sync.ts`, `src/view.ts`, `src/i18n/pt-BR.ts`, `src/i18n/en.ts`,
  `test/investment-import.test.ts`, `test/investment-sync.test.ts`, `README.md`, `docs/ARCHITECTURE.md`, `package.json`,
  `manifest.json`, `versions.json`.

## 1.0.0 — 2026-11-08

- 2026-11-08 — First stable release: the ledger format and the plugin API are now considered stable, so a breaking
  change to either bumps MAJOR. No code changes against 0.39.0. First published release since 0.20.0, so it also brings
  everything from 0.21.0 to 0.39.0 below: savings goals, income tax for variable income, 60-day balance forecast, reports
  over any period, asset weights inside each class, calculators, Tesouro Direto revaluation from open data, json and csv
  export outside the vault, debt planning, transfers between currencies, recommended portfolios, headlines for the positions held, optional AI assistants with read-only tools and history import from
  spreadsheets. Why: requested by the owner after the test rounds. Files touched: `package.json`, `manifest.json`,
  `versions.json`, `docs/CHANGELOG.md`.
- 2026-11-05 — New `docs/AI-ASSISTANT.md`: the research and proposed design for the roadmap's optional AI
  assistant, which is not built, and the decisions needed first. README gets a *Quotes* section on the brapi
  token. Why: the roadmap asks for research first and for setup steps in the README. Files touched:
  `docs/AI-ASSISTANT.md`, `README.md`.
- 2026-11-01 — README gets a *Screenshots* section with eight screens (overview, accounts, obrigações,
  recurring, investments, returns, allocation targets, proventos), flagged as fictitious values.
  Why: the screenshots taken on 2026-10-27 never made it into the README, and their test ledger uses
  amounts much higher than a typical one. Files touched: `README.md`, `docs/screenshots/*.jpg`.
- 2026-11-01 — README states up front that Trimly is built for Brazil (Open Finance, B3, CDI/IPCA,
  DAS MEI/IRPF) and that users outside Brazil may get little from it. Why: set expectations before
  someone abroad installs it. Files touched: `README.md`.

## 0.39.0 — 2026-11-08

- 2026-11-08 — *Carteiras recomendadas* read XP's own portfolios from its public feeds, one per asset class (company
  portfolios left out), with their own switch *XP*, and can be narrowed to one house. Houses in press articles are read
  from the title. New card *Páginas das casas* links XP, BTG Pactual, Genial and Itaú, which show portfolios on their own
  sites with no feed. At most 12 articles per type now. Why: test note asking for the portfolios of XP, BTG, AUVP and
  others. BTG loads its list with JavaScript and has no feed, Genial's feed fails, and no public AUVP portfolio was found,
  so none of them is read automatically; nothing behind a login is. Files touched: `src/feeds.ts`, `src/assistant.ts`,
  `src/view.ts`, `src/i18n/pt-BR.ts`, `src/i18n/en.ts`, `test/feeds.test.ts`, `README.md`, `package.json`, `manifest.json`,
  `versions.json`.

## 0.38.0 — 2026-11-08

- 2026-11-08 — *Carteiras recomendadas* reach back a year instead of 60 days and are grouped by type (diversified, stocks,
  FIIs, fixed income, funds, ETFs, abroad, crypto), at most eight each, folded. Since the sites' portfolio tags are almost
  all about stocks, InvestNews and InfoMoney are also searched with fixed terms (the only two whose feeds honor a search),
  keeping only titles that recommend something of a known type. New card *Carteiras clássicas* with five well-known
  allocation models. The assistant's `recommended_portfolios` returns the same groups. Why: test note, the list only had
  stock portfolios. Against the real feeds on this date, funds had nothing in the last year and titles are classified by
  words, so some articles land in the wrong group or aren't really recommendations. Files touched: `src/feeds.ts`,
  `src/assistant.ts`, `src/view.ts`, `src/i18n/pt-BR.ts`, `src/i18n/en.ts`, `test/feeds.test.ts`, `test/assistant.test.ts`,
  `README.md`, `package.json`, `manifest.json`, `versions.json`.

## 0.37.0 — 2026-11-08

- 2026-11-08 — The assistants open on a clickable list of past conversations, replacing the dropdown; opening one shows
  it whole and a button goes back. A conversation is saved when asked, not only when answered, and saved conversations
  are capped by size so a full localStorage can't stop every later save. New toggle *Ligar o assistente* (`assistant` in
  `data.json`, off by default): off hides both tabs; turning it on first warns what goes to Anthropic. Why: test note,
  a conversation was gone after reopening Obsidian (none was stored on the device) and the dropdown hid the history; and
  sharing data with an AI company has to be an explicit choice. After updating, the assistant stays hidden until turned on.
  Files touched: `src/view.ts`, `src/chat-store.ts`, `src/main.ts`, `src/modals.ts`, `src/i18n/pt-BR.ts`, `src/i18n/en.ts`,
  `test/chat-store.test.ts`, `test/encryption-rule.test.ts`, `README.md`, `docs/AI-ASSISTANT.md`, `package.json`,
  `manifest.json`, `versions.json`.

## 0.36.0 — 2026-11-08

- 2026-11-08 — *Importar planilha* in Movements: the B3 investor area's statements or any broker's spreadsheet, in Excel
  or CSV, recognized by column names (new `src/investment-import.ts`, `src/spreadsheet.ts`, which reads .xlsx with no new
  dependency). It previews what it found, reads the file in memory only, and adds buys, sales and income as read-only
  movements, skipping what is already recorded even days apart. With all the buys of a synced position, its cost becomes
  the real one. Splits, bonus shares and transfers between brokers are listed as not imported, and tickers with no
  position are named. Bank sync now also estimates the cost from Pluggy's `amountProfit` when `amountOriginal` is missing.
  Why: banks don't report what FII shares cost, and no public API can know it. Written from the statements' known layout,
  without a real file to test against. Files touched: `src/investment-import.ts`, `src/spreadsheet.ts`, `src/investment-sync.ts`,
  `src/income-tax.ts`, `src/ledger.ts`, `src/modals.ts`, `src/view.ts`, `src/i18n/pt-BR.ts`, `src/i18n/en.ts`,
  `test/investment-import.test.ts`, `test/investment-sync.test.ts`, `README.md`, `docs/ARCHITECTURE.md`, `docs/FAQ.md`,
  `package.json`, `manifest.json`, `versions.json`.

## 0.35.0 — 2026-11-08

- 2026-11-08 — First test round. *IR*: the bank reports no cost for FIIs, so what isn't known shows "—" instead of
  R$ 0,00, and the average price can be typed in the table (new optional `costEdited` on positions, which sync
  respects), counting there, in the portfolio and in the assistant. Funds with no institution show the manager in
  their own name. *Projeção de saldo* adds up all accounts, since bills have no account and came out of each one.
  *Metas de poupança* take a list of accounts and positions (`accountIds`, `assetIds`; old goals open as a list of
  one) and an optional date: with none, or after it, a goal is a level to keep. *Várias carteiras* was removed: synced
  positions left nothing to organize, and its `portfolios` and `portfolioId` are dropped when the ledger opens. The
  independence calculator explains its two rates and shows the time at 3% and 7%. News links go through
  `window.open`, so Surfing opens them in a tab. The periods table no longer cuts its date. The assistant's tab is its
  icon. Conversations are several and kept, encrypted with the ledger's key, in this device's localStorage and outside
  the vault (new `src/chat-store.ts`). Its box grows with the text and answers can be selected. New tools:
  `portfolio_history`, `position_movements`, `recommended_portfolios` and `read_article`, the last two reading public
  pages on the device, only from the feed sites. The investments prompt now reasons with the user's actual positions
  instead of refusing. Why: the user's test notes. Files touched: `src/ledger.ts`, `src/investment-sync.ts`,
  `src/income-tax.ts`, `src/quotes.ts`, `src/assistant.ts`, `src/chat-store.ts`, `src/store.ts`, `src/feeds.ts`,
  `src/feeds-fetch.ts`, `src/export.ts`, `src/modals.ts`, `src/view.ts`, `src/main.ts`, `src/styles/index.css`, `styles.css`,
  `src/i18n/pt-BR.ts`, `src/i18n/en.ts`, `test/*`, `README.md`, `docs/ARCHITECTURE.md`, `docs/AI-ASSISTANT.md`,
  `package.json`, `manifest.json`, `versions.json`.

## 0.34.0 — 2026-11-06

- 2026-11-06 — Optional AI assistants: an *Assistente* tab in each mode, one for accounts and one for investments,
  off until the user adds their own Anthropic API key in the settings (new optional `ai` on the ledger, encrypted,
  left out of exports; version unchanged). The model never gets the ledger: it calls read-only tools (new
  `src/assistant.ts`, `src/assistant-fetch.ts`) that answer with Trimly's own math, and each result can be opened
  in the chat. Descriptions of past transactions aren't sent; recurring, bill and future transaction names are, as data the
  prompt says not to obey. Conversations stay in memory, are gone on lock, stop at 150 thousand tokens, and don't show while values
  are hidden. Claude only for now, through `requestUrl` with no new dependency. Tested with a fake transport,
  never against the real API. Why: the roadmap's *Assistente de IA*; see `docs/AI-ASSISTANT.md`. Files touched:
  `src/assistant.ts`, `src/assistant-fetch.ts`, `src/ledger.ts`, `src/export.ts`, `src/main.ts`, `src/view.ts`,
  `src/styles/index.css`, `styles.css`, `src/i18n/pt-BR.ts`, `src/i18n/en.ts`, `test/assistant.test.ts`,
  `README.md`, `docs/AI-ASSISTANT.md`, `docs/ARCHITECTURE.md`, `package.json`, `manifest.json`, `versions.json`.

## 0.33.0 — 2026-11-05

- 2026-11-05 — The *Notícias* tab opens with *Da sua carteira*: headlines naming the tickers of the open
  positions, any share class of the company (new `newsForTickers`). Asking a site for news on a ticker
  would tell it what the user holds, so the latest pages of InfoMoney, Money Times and Seu Dinheiro are read
  whole and filtered on the device, which reaches back about a day. Not there: filings. Fundos.NET lists
  every FII's documents, but answers automated clients with a redirect loop, and CVM's data comes zipped,
  so those are left for later rather than working around the site. Why: the roadmap's *Notícias e
  relatórios*. Files touched: `src/feeds.ts`, `src/main.ts`, `src/view.ts`, `src/i18n/pt-BR.ts`,
  `src/i18n/en.ts`, `test/feeds.test.ts`, `README.md`, `package.json`, `manifest.json`, `versions.json`.

## 0.32.0 — 2026-11-05

- 2026-11-05 — New *Notícias* tab in the investments mode, opening with *Carteiras recomendadas*: public
  articles on the portfolios brokers publish, with date, source and a link, from the RSS of Money Times,
  InvestNews and InfoMoney (new `src/feeds.ts`, `src/feeds-fetch.ts`), fetched when the tab opens and at most
  once a day, kept in memory. New settings: *Notícias e carteiras* and a switch per source (new `feeds` and
  `disabledFeeds` keys in `data.json`). Only each feed's address is requested. Titles are plain text and
  only https links are kept. RSS instead of scraping pages, so a site's change doesn't break it and no paid
  report is reproduced; that also means *what changed since the last one* isn't there, only what the
  headline says. Why: the roadmap's *Feed de carteiras recomendadas*. Files touched: `src/feeds.ts`,
  `src/feeds-fetch.ts`, `src/main.ts`, `src/view.ts`, `src/i18n/pt-BR.ts`, `src/i18n/en.ts`,
  `test/feeds.test.ts`, `test/encryption-rule.test.ts`, `README.md`, `docs/ARCHITECTURE.md`, `package.json`,
  `manifest.json`, `versions.json`.

## 0.31.0 — 2026-11-05

- 2026-11-05 — A manual transfer between accounts in different currencies takes both amounts: the new
  *Valor recebido* field appears when the currencies differ, and left empty it uses the day's rate (new
  optional `toAmount` on transactions and recurring rules; version unchanged). Each balance moves in its
  own currency, and the difference is the exchange cost. Older transfers keep moving one amount on both
  sides. Why: the roadmap's *Transferência entre moedas*, pending since 0.9.0. Still pending: paired bank
  transfers keep one amount, and positions in another currency. Files touched: `src/ledger.ts`,
  `src/modals.ts`, `src/view.ts`, `src/export.ts`, `src/i18n/pt-BR.ts`, `src/i18n/en.ts`,
  `test/fx-transfers.test.ts`, `README.md`, `docs/ARCHITECTURE.md`, `package.json`, `manifest.json`,
  `versions.json`.

## 0.30.0 — 2026-11-05

- 2026-11-05 — Planning gets *Dívidas*: a loan or financing with its balance on a date, interest per month
  and monthly payment shows today's balance, when it ends, the interest still to pay, and what paying
  extra would change (new optional `debts` on the ledger; version unchanged; new `debtPayoff`,
  `debtBalance`). A payment that doesn't cover the interest says it never ends. Today's balance assumes
  the payments were made, and updating the balance corrects it. Debts stay apart from accounts and net
  worth, and the extra is only a simulation, never saved. Why: the roadmap's *Planejador de dívidas*. Files
  touched: `src/ledger.ts`, `src/modals.ts`, `src/view.ts`, `src/i18n/pt-BR.ts`, `src/i18n/en.ts`,
  `test/debts.test.ts`, `README.md`, `docs/ARCHITECTURE.md`, `package.json`, `manifest.json`, `versions.json`.

## 0.29.0 — 2026-11-05

- 2026-11-05 — New *Exportar dados* section in the settings: the whole ledger as JSON, and transactions,
  positions and movements as CSV for Excel in Brazil (semicolons, decimal commas, BOM), through the system
  download and never written to the vault (new `src/export.ts`). The Pluggy credentials and the brapi token
  stay out, text that a spreadsheet would run as a formula stays text, and a confirmation warns the file
  isn't encrypted. Desktop only, since the download isn't reliable on mobile. No import back. Trimly can't
  stop the user from picking a folder inside the vault in the save dialog, so the warning asks them not to.
  Why: the roadmap's *Exportar dados*. Files touched: `src/export.ts`, `src/main.ts`, `src/i18n/pt-BR.ts`,
  `src/i18n/en.ts`, `test/export.test.ts`, `README.md`, `docs/ARCHITECTURE.md`, `docs/FAQ.md`,
  `package.json`, `manifest.json`, `versions.json`.

## 0.28.0 — 2026-11-05

- 2026-11-05 — Positions can be set apart in portfolios by objective (retirement, emergency fund), each
  with its own allocation targets, weights and contribution plan (new optional `portfolios` on
  `investments` and `portfolioId` on positions; version unchanged). The Targets tab picks the portfolio,
  and creates, renames and deletes them; a position's modal picks where it goes, and the Portfolio tab
  lists each one's value. What is in no portfolio is the main one, so nothing changes until one is
  created; deleting one returns its positions there and deletes its targets. Deliberately not split by
  portfolio: returns, evolution, proventos and income tax stay those of the whole, because snapshots
  only exist for the whole. Why: the roadmap's *Várias carteiras*. Files touched: `src/ledger.ts`,
  `src/modals.ts`, `src/view.ts`, `src/i18n/pt-BR.ts`, `src/i18n/en.ts`, `test/portfolios.test.ts`,
  `README.md`, `docs/ARCHITECTURE.md`, `package.json`, `manifest.json`, `versions.json`.

## 0.27.0 — 2026-11-05

- 2026-11-05 — Manual Tesouro Direto positions are revalued from the Tesouro Transparente open data: the
  newest day's selling price × quantity, a market move like a brapi quote, at most once a day (new
  `src/treasury.ts`, `src/treasury-fetch.ts`, new optional `treasuryCheckedOn` on the ledger; version
  unchanged). A position is matched by the type in its name and its maturity or year; when that isn't
  certain it keeps its value and a notice names it (Renda+ and Educa+ need the exact maturity: Renda+ 2065
  matures in 2084). New setting *Preços do Tesouro Direto* (on by default;
  new `treasuryPrices` key in `data.json`). The file is about 15 MB, ignores byte ranges and lagged several days
  business days when checked, so it is fetched only with such a position, and it holds every bond, so nothing about
  the user's is sent. Why: the roadmap's *Cotação do Tesouro Direto*, which brapi only has on its Pro plan.
  Files touched: `src/treasury.ts`, `src/treasury-fetch.ts`, `src/ledger.ts`, `src/main.ts`,
  `src/i18n/pt-BR.ts`, `src/i18n/en.ts`, `test/treasury.test.ts`, `test/encryption-rule.test.ts`,
  `README.md`, `docs/ARCHITECTURE.md`, `package.json`, `manifest.json`, `versions.json`.

## 0.26.0 — 2026-11-05

- 2026-11-05 — New *Calculadoras* tab in the investments mode: financial independence (wealth needed for
  an income and the time to reach it), compound interest with contributions, how much to contribute to a
  goal, emergency fund, and CDB against a tax-free LCI/LCA after income tax. Fields start from real
  data when possible: wealth, average aporte of the last 12 closed months, income movements of the same
  months, average expenses of the last 6 and the balance of the accounts (new `calculatorDefaults`). Rates
  start empty, since the device doesn't fetch them. Everything runs on the device; what is typed lasts
  until the view closes and is never saved, and money fields are masked while values are hidden. Why: the
  roadmap's *Calculadoras*. Files touched: `src/calculators.ts`, `src/view.ts`, `src/styles/index.css`,
  `styles.css`, `src/i18n/pt-BR.ts`, `src/i18n/en.ts`, `test/calculators.test.ts`, `README.md`,
  `docs/ARCHITECTURE.md`, `package.json`, `manifest.json`, `versions.json`.

## 0.25.0 — 2026-11-05

- 2026-11-05 — New *Relatórios* tab: any period, by preset or free dates, optionally limited to one
  account or category, against the period before or the same period a year earlier (whole months compare
  with whole months). It shows income, expenses and net with their change, bars and a table over the
  period (by year when it spans more than 24 months), expenses and income by category, and each account.
  Same counting as the overview: transfers are out. Computed on the device and never stored; the filters
  last until the view closes (new `src/reports.ts`). Why: the roadmap's *Relatórios*; only the overview
  existed, with its 6 months. Files touched: `src/reports.ts`, `src/view.ts`, `src/i18n/pt-BR.ts`,
  `src/i18n/en.ts`, `test/reports.test.ts`, `README.md`, `docs/ARCHITECTURE.md`, `package.json`,
  `manifest.json`, `versions.json`.

## 0.24.0 — 2026-11-05

- 2026-11-05 — The Targets tab gets *Por ativo*: in each class with more than one position, a weight or
  score per asset, on any scale (new optional `weight` on positions; version unchanged). *Planejar um
  aporte* then splits the class's share among its positions, furthest behind their weight first and
  never asking to sell (new `assetTargets`); a position with no weight gets nothing, and a class with no
  weights stops at the class as before. Trimly's own weight, not the method of any other tool. Why: the
  roadmap's *Meta por ativo*; the suggestion stopped at the class. `rebalance` now shares
  `splitContribution` with it. Files touched: `src/ledger.ts`, `src/view.ts`, `src/styles/index.css`,
  `styles.css`, `src/i18n/pt-BR.ts`, `src/i18n/en.ts`, `test/rebalance.test.ts`, `test/investment-sync.test.ts`, `README.md`, `docs/ARCHITECTURE.md`,
  `package.json`, `manifest.json`, `versions.json`.

## 0.23.0 — 2026-11-05

- 2026-11-05 — The Accounts tab gets *Projeção de saldo*: one account's balance over the next 60 days,
  with a chart, the balance at the end, its lowest point, the first day below zero and each event with
  the balance after it (new `balanceForecast`). It adds future transactions and recurring occurrences
  on the account, plus open bills and card bills, which have no account of their own and so leave the
  chosen one. It opens on the most used checking account (new `mainAccount`), and the pick lasts until
  the view closes; nothing is stored. A bill paid by a recurring rule, or a card paid by a recurring
  transfer, counts once; a bill with no known amount is named, not counted as zero; overdue bills count
  today. Not in: purchases to come and installments on later card bills. Why: the roadmap's *Projeção
  de saldo*; recurring rules, bills and card bills were already there, only the sum was missing. Files
  touched: `src/ledger.ts`, `src/view.ts`, `src/i18n/pt-BR.ts`, `src/i18n/en.ts`,
  `test/forecast.test.ts`, `README.md`, `package.json`, `manifest.json`, `versions.json`.

## 0.22.0 — 2026-11-05

- 2026-11-05 — New *IR* tab in the investments mode, with the month picker: average price per asset,
  each month's sales, result and DARF (code 6015, due the last business day of the next month; under
  R$ 10 it waits for the next one), the R$ 20.000 stock exemption meter, losses carried forward (stocks,
  BDRs and ETFs apart from FIIs) and the costs for *Bens e direitos* at the two year-ends the return
  asks for. Rates are 15% for stocks, BDRs and ETFs and 20% for FIIs. Everything is computed from the
  movements on the device (new `src/income-tax.ts`); nothing is stored or sent, and no DARF is issued.
  Positions whose numbers are uncertain (no quantity, shares from before the movements, transfers,
  amortizations, possible day trades) are listed to check, and a sale with no known cost marks its month
  incomplete instead of counting a made-up gain. Not covered: day trades, options, fixed income ETFs,
  FI-Infra, splits and bonus shares. Group and code are shown for stocks (03-01) and FIIs (07-03) only,
  since the sources disagree on ETFs. Why: the roadmap's *Apoio ao IR de renda variável*, the main
  reason people pay for Investidor10 or myProfit. Files touched: `src/income-tax.ts`, `src/view.ts`,
  `src/i18n/pt-BR.ts`, `src/i18n/en.ts`, `test/income-tax.test.ts`, `README.md`, `docs/ARCHITECTURE.md`,
  `package.json`, `manifest.json`, `versions.json`.

## 0.21.0 — 2026-11-05

- 2026-11-05 — Planning gets *Metas de poupança*: a goal has a name, an amount, a date and one account
  or position it is measured by (new optional `goals` on the ledger; version unchanged). Each tile shows
  how much is saved, from today's balance, and how much to save per month until the date, or that the
  goal was reached or is past due (new `goalProgress`). Goals sharing an account or position are flagged,
  since the balance counts in full in each; a goal whose account was deleted or position closed asks
  for another link. `progress` in the view takes an optional `warn`, so a goal near its end doesn't turn
  amber. Why: the roadmap's *Metas de poupança*; only allocation targets and the monthly investment goal
  existed. Files touched: `src/ledger.ts`, `src/modals.ts`, `src/view.ts`, `src/i18n/pt-BR.ts`,
  `src/i18n/en.ts`, `test/goals.test.ts`, `README.md`, `docs/ARCHITECTURE.md`, `package.json`,
  `manifest.json`, `versions.json`.

## 0.20.0 — 2026-11-01

- 2026-11-01 — *Próximos proventos* forecasts next month's income of a FII that pays every month and
  hasn't announced yet (last two payments about a month apart, the last within 45 days): same value
  per share, one month after the last payment, marked *previsto*, replaced by the announcement once
  B3 lists it (new `monthlyForecast`). The income tab also estimates what was received for positions
  the bank sync brings no income for, from B3's proventos × today's quantity, counting only payments
  whose data-com is on or after the position's first movement (new `estimatedPayouts`), in the
  12-month totals, yield, per-month bars, per position and latest payments, marked *estimado pela
  B3*. `incomeByMonth` in `ledger.ts` was folded into the view. Why: B3 lists the FIIs' month-end
  announcements days later, so the card was empty right when the next payment was most expected,
  and Pluggy reports no FII income, so received proventos showed nothing. Files touched:
  `src/proventos.ts`, `src/ledger.ts`, `src/view.ts`, `src/styles/index.css`,
  `src/i18n/pt-BR.ts`, `src/i18n/en.ts`, `test/proventos.test.ts`, `README.md`, `docs/FAQ.md`,
  `docs/ARCHITECTURE.md`.
- 2026-11-01 — The income tab's monthly bars are clickable: a click picks the month and lists its
  proventos under the chart (received and estimated), the current month by default (`bars` takes an
  optional `onSelect`). Why: the bars showed totals but no way to see what made up another month.
  Files touched: `src/charts.ts`, `src/view.ts`, `src/styles/index.css`, `src/i18n/pt-BR.ts`,
  `src/i18n/en.ts`.

## 0.19.0 — 2026-11-01

- 2026-11-01 — The income tab opens with *Próximos proventos*: dividends, JCP and FII income B3 has
  announced for the open positions with a B3 ticker, grouped by payment month, each with data-com,
  payment date, value per share and an estimate by today's quantity (JCP net of the 15% withheld),
  plus the total expected. They come from the B3 website's listed-company page data (new
  `fetchProventos` in `src/b3.ts`, one request per issuer, FIIs included), matched to the ticker by
  the ISIN's share type (new `src/proventos.ts`), cached in memory for the day and never written to
  the vault. New setting *Agenda de proventos* (on by default; new `proventos` key in `data.json`).
  Why: the roadmap's *Agenda de proventos futuros*, dropped in October because brapi's free plan has
  no dividends; B3 lists them without a key. Files touched: `src/b3.ts`, `src/proventos.ts`,
  `src/main.ts`, `src/view.ts`, `src/i18n/pt-BR.ts`, `src/i18n/en.ts`, `test/proventos.test.ts`,
  `test/encryption-rule.test.ts`, `README.md`, `docs/ARCHITECTURE.md`.
- 2026-11-01 — *Próximos proventos* lists which tickers were looked up on B3 and the latest provento
  paid for each (new `lastPaidProventos`), open when nothing is upcoming. Why: an empty card didn't
  say whether the lookup ran. Files touched: `src/proventos.ts`, `src/view.ts`,
  `src/styles/index.css`, `src/i18n/pt-BR.ts`, `src/i18n/en.ts`, `test/proventos.test.ts`.
- 2026-11-01 — The release workflow only signs build provenance attestations on a public repository.
  Why: GitHub refuses them on a private repository without a paid plan, which failed the 0.18.0
  release before it was published. Files touched: `.github/workflows/release.yml`.

## 0.18.0 — 2026-11-01

- 2026-11-01 — Returns compare with poupança, IBOV and IFIX besides CDI and IPCA, in the periods
  and month-by-month tables and the cumulative chart. Poupança is the Central Bank's SGS series 195
  (the deposit made on the 1st; a month counts once it is over). IBOV and IFIX are B3's daily closes
  from its website's index statistics (new `src/b3.ts`, one request per index per year, no key);
  brapi's free plan has no IFIX history and only 90 days per request. That address is not a
  documented API, so if it fails only those two columns go empty, with a notice. The setting is now
  *Comparar com índices* (same `benchmarks` key). `ipcaReturn` became `monthlyRateReturn`; new
  `closeReturn`. Why: the roadmap's *Mais benchmarks*; CDI and IPCA alone don't say whether a stock
  or FII portfolio beat its market. Files touched: `src/b3.ts`, `src/bcb.ts`, `src/returns.ts`,
  `src/view.ts`, `src/styles/index.css`, `src/i18n/pt-BR.ts`, `src/i18n/en.ts`,
  `test/returns.test.ts`, `README.md`, `docs/FAQ.md`, `docs/ARCHITECTURE.md`.
- 2026-11-01 — Fix: every benchmark failed with "res.json.map is not a function" when the period had
  no IPCA published yet (e.g. a portfolio started last month, on the 1st of the next). To Obsidian's
  user agent the Central Bank answers "no values" with HTTP 200 and an error object instead of a 404;
  that now counts as no values, and its other errors show their message. Poupança is fetched from the
  first snapshot's date instead of the 1st of its month, so it stays inside the daily series' 10-year
  window. Files touched: `src/bcb.ts`, `src/i18n/pt-BR.ts`, `src/i18n/en.ts`.
- 2026-11-01 — The performance tab explains the benchmarks. Dragging across the cumulative chart
  marks a stretch and shows the portfolio's and each benchmark's change over it (`lineChart` takes an
  optional `range`); a click clears it. A *Comparação* card puts the last 12 months (or since the
  start, when shorter) in words: share of the CDI, real gain or loss over the IPCA, and points ahead
  of or behind poupança, IBOV and IFIX, with a note while the history is under 3 months. *Sobre os
  índices* says what each one is. IPCA and poupança now show "—" instead of +0% for a period with
  no closed month (`monthlyRateReturn` returns null). Why: the numbers alone didn't say what each
  index is or how the portfolio did against them, and platforms like Status Invest let you inspect a
  stretch of the chart. Files touched: `src/charts.ts`, `src/returns.ts`, `src/view.ts`,
  `src/styles/index.css`, `src/i18n/pt-BR.ts`, `src/i18n/en.ts`, `test/returns.test.ts`,
  `README.md`, `docs/ARCHITECTURE.md`.

## 0.17.0 — 2026-10-30

- 2026-10-30 — Planning shows whether spending and investing follow the plan, then what the month
  can really invest. The top has two meters, spending so far against what was planned (bills plus
  limits) and aportes against the investment goal, and below them the forecast: *Pela previsão do mês
  dá pra investir R$ X*, and whether the goal fits. The month's plan gets three columns, *Planejado*,
  *Até agora* and *Previsto*: the forecast adds to what happened the recurring occurrences and bill
  occurrences still due in the month and, until the month ends, what is left of each category's
  limit (`monthPlan` takes `today`; new `pendingRecurring` for any rule type). Investing moved below
  *Disponível pra investir*, so *Sobra* says whether the plan leaves money after the goal. *Dia a
  dia* is now *Gastos por categoria*; the donuts became two bars of where the income goes (planned
  and forecast, one scale), plus two more on the same scale that split category spending by
  category with the rest greyed (new `spendingByCategory` on the plan); and the category tiles are
  three per row. Why: the
  plan showed what was set, not whether the month was following it or could reach the investment
  goal. Files touched: `src/ledger.ts`, `src/view.ts`, `src/styles/index.css`, `src/i18n/pt-BR.ts`,
  `src/i18n/en.ts`, `test/ledger.test.ts`, `README.md`, `docs/ARCHITECTURE.md`.

## 0.16.0 — 2026-10-30

- 2026-10-30 — A category can be marked *Categoria padrão* (new optional `isDefault` on categories;
  at most one per kind, version unchanged). Uncategorized income/expense transactions and recurring
  rules of that kind go to it on every save and when the ledger opens, so existing ones are fixed
  too; the category pickers drop *Sem categoria* for that kind, deleting another category moves its
  transactions there, and the tile shows *Padrão*. With no default, things stay uncategorized as
  before. Why: *Outras despesas* / *Outras receitas* already play that role, so *Sem categoria* was
  a second bucket for the same thing. Files touched: `src/ledger.ts`, `src/main.ts`,
  `src/modals.ts`, `src/view.ts`, `src/i18n/pt-BR.ts`, `src/i18n/en.ts`, `test/ledger.test.ts`,
  `README.md`.
- 2026-10-30 — Bills to pay (payment obligations) take *Valor fixo* (new optional `fixed`) and a
  *Categoria* (new optional `categoryId`, filled from the first linked payment's category). Planning
  counts fixed-amount bills with the fixed costs and variable ones as variable bills, and adds each
  bill to its category's committed part, so a health plan paid as an obligation is no longer counted
  against the health limit; the Recurring tab's chips split them the same way and its card becomes
  *Contas a pagar*. Months already marked paid by hand now get their payment linked too, without
  changing the bill's usual amount. Transactions also say which bill they pay in any month (new
  optional `obligationId`; `null` once unlinked by hand), matched by the words of the bill's name,
  learned payment or linked payments, an amount within 50% of the expected one (or, with no amount
  known, the bill's own category) and no conflicting category, so payments from before the bill
  was registered are its too; the transaction modal shows it, and Planning counts by it. "Efetuado"
  joins the generic bank wording ("Pagamento efetuado|X" names nobody). A bill with linked payments
  but no learned description learns the latest one's, so its next months link themselves. Why: Planning only knew recurring rules, so a bill paid by hand
  landed in the category's extra, only the last month of a bill was linked to its payment, and
  payments from before the bill existed were never recognized.
  Files touched: `src/ledger.ts`, `src/modals.ts`, `src/view.ts`, `src/i18n/pt-BR.ts`,
  `src/i18n/en.ts`, `test/obligations.test.ts`, `test/ledger.test.ts`, `README.md`,
  `docs/ARCHITECTURE.md`.
- 2026-10-30 — Changing a transaction's category moves every other transaction with the same
  description (ignoring digits, accents and generic bank wording) and learns a rule (new optional
  `categoryRules` on the ledger; version unchanged) that bank sync applies to new transactions before
  the bank's own category. Why: recategorizing one charge left its past and future look-alikes
  behind. Files touched: `src/ledger.ts`, `src/bank-sync.ts`, `src/view.ts`, `src/i18n/pt-BR.ts`,
  `src/i18n/en.ts`, `test/ledger.test.ts`, `test/bank-sync.test.ts`, `README.md`,
  `docs/ARCHITECTURE.md`.
- 2026-10-30 — Categories can be reordered by dragging one onto another in the Categories tab; the
  order is the ledger's, so lists and dropdowns follow it. Files touched: `src/view.ts`,
  `src/styles/index.css`, `README.md`.
- 2026-10-30 — *Orçamentos* becomes *Planejamento*, the month's plan, planned against actual:
  *Receitas fixas* − *Custos fixos* (expense rules) − *Contas variáveis* = *Livre pra planejar*;
  − *Dia a dia* (category limits) − *Investir* = *Não alocado*. Actuals split the month's
  transactions the same way: linked to a rule are fixed, settling an obligation are bills, the rest
  is day to day. Two donuts show the plan and what happened. A category's limit is now the extra on
  top of its fixed costs (the tile adds them), so a health plan paid by a rule no longer has to be
  repeated in the health limit; a category without a limit counts as zero and shows once it has
  spending. A new *Investir* tile sets a monthly investment goal, tracked by the month's aportes,
  which never count as spending. Limits and goal are kept per month (new optional `plans` on the
  ledger, keyed "YYYY-MM"; version unchanged): a month without its own plan starts from the latest
  earlier one, and editing a month saves its own copy, so past months stay as planned. Limits saved
  before stay in `budgets` as the plan of every month before the first saved one.
  Why: recurring rules and budgets were two plans that did not see each other, so it was unclear
  what to budget for a category with a fixed bill and impossible to see how much of the income is
  left to invest, save or spend. Files touched: `src/ledger.ts` (`monthPlan`, `fixedMonthlyIncome`,
  `contributionsInMonth`), `src/view.ts`, `src/styles/index.css`, `src/i18n/pt-BR.ts`,
  `src/i18n/en.ts`, `test/ledger.test.ts`, `README.md`, `docs/ARCHITECTURE.md`.
## 0.15.0 — 2026-10-28

- 2026-10-28 — The Recurring tab's summary adds *Custos variáveis / mês* (the monthly total of
  *Contas variáveis*), and *Sobra / mês* (was *Sobra após fixos*) now subtracts it too. Why: the
  leftover only counted fixed rules, so bills paid by hand made the month look better than it is.
  Files touched: `src/view.ts`, `src/i18n/pt-BR.ts`, `src/i18n/en.ts`, `README.md`.
- 2026-10-28 — The Overview's projected savings no longer shows *Realizado até agora* under it.
  Why: the line was unclear next to the projection and ran past the card's edge; what already
  happened is in the income and expense stats beside it. Files touched: `src/view.ts`,
  `src/styles/index.css`, `src/i18n/pt-BR.ts`, `src/i18n/en.ts`.
- 2026-10-28 — The month browsed goes back to this month when switching tabs or modes, or opening
  Trimly again while it is already open. Why: browsing September in Transactions left the
  Dashboard on September too, where positions synced later counted as zero, so investments looked
  missing from the net worth. Files touched: `src/view.ts`, `src/main.ts`, `README.md`.

## 0.14.1 — 2026-10-28

- 2026-10-28 — A recurring rule on a synced account no longer links a charge just because it shares
  generic bank wording ("Transferência Recebida", "Pix", "Compra", "Débito"…), and a charge that
  shares the name must still be within 50% of the rule's amount. Why: making a R$ 4.210 *Transferência
  Recebida* recurring linked a R$ 1.000 transfer from someone else days before the next occurrence,
  and the rule took its amount. Deleting a rule now also unlinks its transactions (they stay), so
  a wrong link is fixed by deleting the rule and making it again. Files touched: `src/ledger.ts`,
  `src/view.ts`, `test/bank-sync.test.ts`, `test/ledger.test.ts`, `docs/ARCHITECTURE.md`.

## 0.14.0 — 2026-10-28

- 2026-10-28 — Installment purchases (*compras parceladas*). A card charge keeps which installment
  it is (new optional `installment: { number, total }` on transactions; ledger version unchanged),
  from Pluggy's `creditCardMetadata` or, when the bank sends none, a mark at the end of the
  description ("03/10", "PARC 3/10", "Parcela 3 de 10"). The installments still to come are
  projected, one per bill after the latest charge's bill (dated on the day that bill opens), into the open bill (when not charged yet) and
  the next ones, closed bills included, since some banks only ever report the first installment:
  the bill view now browses up to 12 bills ahead, with a *Parcelas previstas* list and chip, and
  the card tile shows *Parcelas futuras*. Synced card charges keep the bill the bank put them on
  (new optional `billMonth` on transactions: the month the bill closes, from Pluggy's
  `billForecastDate`; when a later installment carries the purchase's month, as at Rico, it is moved
  one month per installment after the 1st, while Nubank gives each installment its own), and bills count charges by it instead of by date, so Rico's fees posted on the
  closing day stay on the bill that closes and installments dated on the purchase day land on
  their own bill. A bill is now named after the month it is due, as the banks do (*Fatura de novembro* is
  due in November). Transactions show
  a 3/10 badge and their modal says how much is left. On cards that are not synced, a new purchase
  takes a number of installments (the amount is the total; the 1st installment takes the cents that
  don't split) and each installment is posted on unlock when its date comes. Why: buying in
  installments is common in Brazil, and without it future bills were understated (roadmap,
  *Agora*). Files touched: `src/ledger.ts`, `src/bank-sync.ts`, `src/view.ts`, `src/modals.ts`,
  `src/main.ts`, `src/i18n/*`, `styles.css`, `test/installments.test.ts`, `README.md`,
  `docs/FAQ.md`, `docs/ARCHITECTURE.md`.
- 2026-10-28 — Bank sync fetches the last 12 months instead of 90 days, so older history reaches
  the ledger; only the last 90 days are reconciled (entries the bank no longer lists are removed),
  and a transaction Pluggy re-created with a new id is re-linked at any date. Why: Pluggy had
  transactions back to November of the year before that never got imported. Files touched:
  `src/bank-sync.ts`, `src/main.ts`, `test/bank-sync.test.ts`, `README.md`, `docs/FAQ.md`,
  `docs/ARCHITECTURE.md`.
- 2026-10-28 — A card bill payment whose only record on the card is under Pluggy's *Transfers*
  category (C6's *Inclusao de Pagamento Ciclo Corrente*, in months Pluggy builds no *Pagamento
  recebido*) now pairs with the bank's debit. Why: it stayed as income on the card, so the bill it
  paid showed as unpaid and the next one as smaller. Files touched: `src/bank-sync.ts`,
  `test/bank-sync.test.ts`, `docs/ARCHITECTURE.md`.
- 2026-10-28 — The transactions tab of accounts other than cards has its own month navigation
  above the list (previous, next, back to this month), like a card's bills; it moves the same
  month as the header. Why: the header's was easy to miss, so it looked like only this month or all
  months could be seen. Files touched: `src/view.ts`.
- 2026-10-28 — The project instructions link the roadmap and the competitor research (Google
  Docs). Files touched: `.claude/CLAUDE.md`.

## 0.13.0 — 2026-10-27

- 2026-10-27 — Synced cards follow the bank's own bill dates. Bank sync fetches each card's bills
  (Pluggy `GET /bills`), plus the open bill's dates from the card's `creditData`, and keeps their
  closing and due dates on the account (`billDates`, new optional field); a bill uses the bank's dates for its month, and the closing and due days only
  stand in for months the bank gives no date for, or for banks that do not report bills. The
  setting is *Dia de fechamento* again and means the bank's closing day: that day's purchases go to
  the next bill and a payment made on it pays the bill that just closed (as in 0.12.1). Why: some
  banks (Rico) move the closing day every month, and the bank's closing day, not the day before, is
  what both the user and Pluggy know. Files touched: `src/ledger.ts`, `src/bank-sync.ts`,
  `src/pluggy.ts`, `src/view.ts`, `src/i18n/*`, `test/card-bills.test.ts`,
  `test/bank-sync.test.ts`, `docs/FAQ.md`, `docs/ARCHITECTURE.md`.

## 0.12.4 — 2026-10-27

- 2026-10-27 — The card's *Dia de fechamento* setting is now *Último dia da fatura*, and its
  description says to use the day before when the bank's closing day already sends purchases to
  the next bill (as at Nubank). Why: the field holds the last day of the cycle, but its name read
  as the bank's closing day, so a Nubank card set to its closing day put the bill payment made that
  day on the previous bill. Files touched: `src/i18n/*`, `docs/FAQ.md`.

## 0.12.3 — 2026-10-27

- 2026-10-27 — Reverts 0.12.1: a card bill's cycle again includes its closing day, so a purchase on
  that day stays in the bill closing, which only shows as closed the next day. Why: that matches
  the user's cards after all. Files touched: `src/ledger.ts`, `src/view.ts`,
  `test/card-bills.test.ts`, `docs/FAQ.md`, `docs/ARCHITECTURE.md`.

## 0.12.2 — 2026-10-27

- 2026-10-27 — A card bill payment that the bank reports twice on the card is counted once. Some
  banks (C6, Nubank) list the paid amount on the card a second time, uncategorized (C6:
  *Inclusao de Pagamento Ciclo Corrente*), next to the payment that pairs with the checking
  debit; that copy was imported as income. Bank sync now drops a credit on a card with the same
  amount as a paired bill payment on that card within 5 days, whatever its category (Pluggy
  categorizes C6's copy but not Nubank's), and the copies already imported are removed on the
  next sync. Why: the
  payment counted as income in the month and lowered the open bill like a refund. Files touched:
  `src/bank-sync.ts`, `test/bank-sync.test.ts`, `docs/ARCHITECTURE.md`.

## 0.12.1 — 2026-10-27

- 2026-10-27 — A card bill now closes on its closing day: the cycle runs from the previous closing
  day to the day before the next one, so a purchase on the closing day goes to the next bill, and
  payments from the closing day on pay the bill that just closed. Bills gain an `end` field (last
  day of the cycle), used for the period shown and the bill's month. A card with no closing day
  still follows the calendar month. Why: on its closing day the bill still showed as open and was
  not counted as an obligation, unlike Brazilian banks, where the closing day is the best day to
  buy. Files touched: `src/ledger.ts`, `src/view.ts`, `test/card-bills.test.ts`, `docs/FAQ.md`,
  `docs/ARCHITECTURE.md`.

## 0.12.0 — 2026-10-26

- 2026-10-26 — The *Recorrentes* tab gets a read-only *Contas variáveis* card below *Assinaturas*:
  every active payment obligation with its expected amount (yearly ones also shown per month,
  `estimatedBills`), costliest first, and a monthly and yearly total at the bottom; a row opens the
  obligation, the header links to *Obrigações*. Card bills are left out (their purchases are already
  transactions), and so is a bill whose linked payment was posted by a recurring rule, so nothing is
  counted twice. No recurring rule or transaction is created from obligations, and the summary chips
  still show recurring rules only. Why: the tab is where the monthly outflow is forecast, and bills
  paid by hand were missing from it. Files touched: `src/ledger.ts`, `src/view.ts`, `src/i18n/*`,
  `test/obligations.test.ts`, `README.md`.
- 2026-10-26 — The *Recorrentes* tab gets the same action bar as *Obrigações*: under the summary
  chips, a one-line hint of what the tab is for and a *+ Nova recorrente* button, which replaces the
  small *Adicionar* link in the list's card header. Why: the add action was easy to miss and the two
  tabs looked different for the same action. Files touched: `src/view.ts`, `src/i18n/*`.
- 2026-10-26 — The overview's savings stat counts recurring income still due this month (occurrences
  not yet posted or linked, `pendingRecurringIncome`): while a salary is pending it reads *Poupança
  prevista · X%* with the projected amount, and *Realizado até agora: …* under it; once the income is
  received it goes back to *Poupado · X%*. Income, expenses, the spent bar and the cash-flow chart
  still show only what happened. Why: with a salary paid on the last (or second-to-last) day of the
  month, the stat was negative all month until payday. Files touched: `src/ledger.ts`, `src/view.ts`,
  `src/styles/index.css`, `src/i18n/*`, `test/ledger.test.ts`, `README.md`.

## 0.11.0 — 2026-10-26

- 2026-10-26 — The *Obrigações* tab is split by a switch into *A fazer* (what is due in the next 30
  days, in *Atrasadas*, *Próximos 7 dias* and *De 8 a 30 dias* cards, with *Feitas recentemente*
  folded below) and *Cadastradas* (everything registered, to edit, in *Faturas de cartão*, *Contas a
  pagar* and *Documentos* cards, alphabetical in each), each with a one-line hint, and a
  *Nova obrigação* button beside the switch. The summary chips show amounts, not just counts:
  overdue, due in 7 days and *A pagar neste mês*, card bills and projections included; amounts
  there and in both lists are red when there is something to pay and neutral at R$ 0,00. *A fazer*
  is a timeline: each item by the next date that matters (a document's window opening while it is
  ahead, else the due date), soonest first. The month total is what is left to pay of everything due by the month's end (overdue
  ones included), with what was already paid of this month's bills under it (*R$ … já pago*: linked
  transactions, else the expected amount, plus card bill payments), so the month's whole cost is
  visible (`monthPayments`). A bill is
  projected at its usual amount, which now follows its last linked payment (linking a payment sets
  it), else at its last linked payment's amount, else at an explicit R$ 0,00. A card's open bill
  shows up too, as a projection (*previsão, fatura ainda aberta*) at what was charged so far, and is
  not reminded of until it closes. The closed bill box on cards puts its label on its own line and
  wraps the amount and due date, so it fits narrow panes. The header's *+ Nova transação* is now a
  *+* button that opens a menu: transaction, recurring, obligation, account or category
  (investments: position or movement). Why: the tab mixed what to do with what is registered, the
  totals were 0 without usual amounts and left out what was already paid, open card bills were missing, the add button was easy to
  miss, and the closed bill box was cut in narrow panes. Files touched: `src/ledger.ts`,
  `src/view.ts`, `src/styles/index.css`, `src/i18n/*`, `test/obligations.test.ts`,
  `test/card-bills.test.ts`, `README.md`, `docs/ARCHITECTURE.md`, `manifest.json`, `package.json`, `versions.json`.
- 2026-10-26 — A transaction can be linked as the payment of a bill from the transaction editor
  (*Pagamento de obrigação*, shown for every expense or transfer: each bill offers its occurrence
  due closest to the transaction, within 45 days, or the field says no bill is due nearby; a linked
  transaction can be unlinked there), besides the bill's own
  *Transação do pagamento* field. A linked bill remembers the transaction's description (new
  optional `payee` field on obligations; ledger version unchanged) and its next payments that look
  like it — sharing a word with it, outgoing, within 15 days of the due date — are linked by
  themselves on unlock, after bank sync and when a transaction is saved, with a notice saying how
  many. The similarity check is now one generic function (`matchScore`/`bestMatch`) used by synced
  recurring rules, payment suggestions and this. Credit cards with a due day now appear in
  *Obrigações*: the last closed bill while part of it is unpaid, with what is left, reminded 3
  days before; clicking it opens the bill, and paying it removes it. *Feitas recentemente* is
  folded by default, and the other two lists are renamed *A fazer nos próximos 30 dias* and
  *Obrigações cadastradas*. In *Contas* and the overview, a card's closed bill still to pay is a
  tinted box (orange, red once overdue) with its amount and due date, instead of a muted line;
  clicking it opens that bill. Why: linking each month's bill by hand was repetitive, card bills were
  missing from the checklist, the tab was crowded and its lists easy to mix up, and an unpaid closed bill was easy to miss. Files touched:
  `src/ledger.ts`, `src/main.ts`, `src/modals.ts`, `src/view.ts`, `src/styles/index.css`,
  `src/i18n/*`, `test/obligations.test.ts`, `test/card-bills.test.ts`, `README.md`,
  `docs/ARCHITECTURE.md`.
## 0.10.0 — 2026-10-25

- 2026-10-25 — Obligations are set by day, not by date. Bills take a due day; documents a start
  and an end day (the window to send them, due on the end day); yearly ones take a month and day
  for each, so a window can span months (IRPF: March 23 to May 29). The year
  and month are always the current ones, so the *Primeiro vencimento* and *Data final* dates are
  gone; an *Encerrada* toggle in the editor stops an obligation instead. *Marcar como paga* /
  *Marcar como enviado* record today, and clicking the entry under *Feitas recentemente* changes
  that day (or undoes it). A new obligation starts with the current month (yearly: the current
  year), so one already done this period, like an IRPF sent in March, shows up to be recorded with
  its real date; a bill marked on a weekend or national bank
  holiday (Carnaval, Sexta-feira Santa and Corpus Christi included) is recorded as scheduled for
  the next business day, shows *agendada para …* until then, and *paga* after. Ledger format
  bumped to version 5 (`day`, `endDay?`, `month?`, `endMonth?`, `since`, `archived?` replace `startDate` and
  `endDate`): version 4 ledgers migrate on load (day and month from the first due date, a past end
  date archives it, weekly ones become monthly), and 0.9.0 refuses version 5 ledgers instead of
  breaking. Why: typing full dates for something that happens every month was confusing, and a
  bill paid on a Saturday is only debited on Monday. Files touched: `src/business-days.ts` (new),
  `src/ledger.ts`, `src/modals.ts`, `src/view.ts`, `src/i18n/*`, `test/obligations.test.ts`,
  `README.md`, `docs/ARCHITECTURE.md`, `manifest.json`, `package.json`, `versions.json`.

## 0.9.0 — 2026-10-25

- 2026-10-25 — The subscriptions total stands out: instead of a small muted line under the list,
  the card ends with a separated footer, *Total em assinaturas* on the left and the monthly cost in
  large type on the right with the yearly cost under it. Why: the sum was easy to miss, and it is
  the number that tells whether subscriptions are worth it. Files touched: `src/view.ts`,
  `src/styles/index.css`, `src/i18n/*`.

- 2026-10-25 — Amounts in other currencies. Pluggy reports purchases abroad in their own currency
  (`currencyCode`, e.g. USD) with the charge in the account's currency in `amountInAccountCurrency`,
  and some accounts (e.g. dollar accounts) are in another currency; Trimly read every `amount` as
  the settings' currency, so US$ 10 showed and counted as R$ 10. Now synced accounts take their
  `currency` from Pluggy, a purchase abroad stores what the account was charged as its amount and
  the purchase amount in a new optional `original: { currency, amount }`, and the transaction list
  shows the amount in the currency it was made in with the charge (or its value in the settings'
  currency) under it. Account and card tiles show balances, bills and limits in the account's
  currency. Totals (net worth, month summary, spending by category and budgets, transaction list
  sums, recurring and subscription totals) convert with daily reference rates from Frankfurter (ECB
  data, no key), fetched at most once a day and only when another currency is in use, stored in a
  new optional `fx` field of the encrypted ledger (no format bump). Without a rate amounts stay
  unconverted. Not covered yet: investment positions in other currencies, and manual transfers
  between accounts in different currencies (one amount for both sides). Why: purchases abroad were
  shown in the wrong currency and inflated or deflated every total. Files touched: `src/ledger.ts`,
  `src/bank-sync.ts`, `src/fx.ts` (new), `src/main.ts`, `src/view.ts`, `src/styles/index.css`,
  `src/i18n/*`, `test/currencies.test.ts` (new), `README.md`, `docs/ARCHITECTURE.md`, `docs/FAQ.md`.

## 0.8.0 — 2026-10-25

- 2026-10-25 — *Tornar recorrente* in the transaction editor: an existing transaction can become a
  recurring rule in one step. It saves the transaction, opens the recurring editor prefilled from it
  (description, type, amount, account, category, its date as the first date, monthly), and on save
  links the transaction as the first occurrence (`recurringId`) and moves the rule past its date, so
  that occurrence is neither posted again nor matched to another synced charge. A transaction that
  already belongs to a rule shows *Ver recorrente* instead. Why: subscriptions and bills usually
  show up as a transaction first, and recreating them by hand was tedious. Files touched:
  `src/ledger.ts`, `src/modals.ts`, `src/view.ts`, `src/i18n/*`, `test/ledger.test.ts`, `README.md`.

## 0.7.0 — 2026-10-25

- 2026-10-25 — Credit cards get their own views. The Accounts tab is split into *Contas*,
  *Cartões de crédito* and *Investimentos* groups. A card tile is now compact: current bill, when it
  closes, a bar of the limit used with what is available, and one line for a closed bill still
  unpaid (red when overdue). Transactions filtered by a card show one bill at a time instead of a
  month: arrows step through bills, a status (open, closed, paid, overdue), total / paid / to pay /
  due date, the bill's purchases by day and, for closed bills, the payments that paid it. The
  account modal gets a *Limite* field and shows *Ver faturas* for cards. Synced cards take the
  limit from Pluggy's `creditData.creditLimit` on every sync (the bank raises limits, so its value
  wins). New `cardBill(ledger, card, today, offset)` returns any bill; payments made after a bill
  closes, until the next closing, pay that bill, and the excess goes to the next one. New optional
  `creditLimit` on accounts (no format bump). The overview gets a *Cartões de crédito* card: per
  card the current bill, a closed bill still unpaid (red when overdue) or when the current one
  closes, and the limit bar; clicking a card opens its bills. Cards left the overview's *Contas*
  card. Files touched: `src/ledger.ts`, `src/bank-sync.ts`,
  `src/modals.ts`, `src/view.ts`, `src/styles/index.css`, `src/i18n/*`, `test/card-bills.test.ts`,
  `test/bank-sync.test.ts`, `README.md`, `docs/ARCHITECTURE.md`, `docs/FAQ.md`.

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
