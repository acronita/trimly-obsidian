# Changelog

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
