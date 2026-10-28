# FAQ

**I forgot my passphrase. Can I recover my data?**
No. The ledger is encrypted with a key derived from the passphrase and nothing else can open it.
Keep the passphrase in a password manager.

**Is it safe to push my vault to GitHub?**
`Trimly/ledger.trimly` contains only ciphertext. Its size and modification times are visible, the
contents are not. The passphrase is never in the vault (unless you put it there yourself).

**How do I use Trimly on another device?**
Sync the vault as usual, open Trimly and type the same passphrase. Each device remembers it
separately (toggle in settings).

**Where is the passphrase stored when "Remember passphrase on this device" is on?**
In Obsidian's local storage for that vault on that device — app data, not a vault file. Anyone with
access to your unlocked computer account could read it; turn the toggle off to keep it in memory only.

**Can I move the ledger to another folder?**
Change *Folder* in settings, then move `ledger.trimly` into the new folder yourself.

**Can Trimly import my bank transactions automatically?**
Yes, optionally, through Pluggy — see *Bank sync* in the README. Credit card purchases may show as
pending until the bank settles them; they update in place on a later sync.

**A purchase abroad or a dollar account shows in dollars. Where does the conversion come from?**
A purchase made abroad shows in the currency it was made in, with what the card charged under it
(the bank's own conversion, from Pluggy). An account in another currency keeps its balance in that
currency, with its value in your currency under it. Totals use the day's reference rates of the
European Central Bank (via frankfurter.dev), fetched at most once a day while some account or
purchase is in another currency. To convert into another currency, change *Moeda* in settings.

**My investments don't show up.**
They come from bank sync. The connected Pluggy item must include the investments product; if
loading them fails, the sync shows a notice with Pluggy's error. Positions only have history from
your first sync on, since Pluggy reports current values only.

**How do I switch Trimly to English?**
*Settings → Trimly → Idioma*. Starter categories you haven't renamed are renamed too; command
names change after restarting Obsidian.

**How do quotes work?**
Create a token at brapi.dev and paste it in *Settings → Trimly → Cotações*. Positions whose code is a
B3 ticker (PETR4, HGLG11, BOVA11…) get their price on every sync. For a manual position, fill in the
ticker and the quantity and its value follows the quote. Synced positions keep the value their bank
reports. The details of a quoted position also show its 3-month chart, 52-week range, P/E, EPS,
market cap and your average price against the quote. The company logo is loaded from
icons.brapi.dev when you open the details. brapi's free plan quotes one ticker per request and has a monthly limit; when it is
reached, the sync says so.

**How do I add an investment bank sync doesn't see (crypto, a foreign broker)?**
In investments mode, *Add → New position* with its current value, then record contributions,
withdrawals and income with *Add → New movement*. Update the position's value from time to time
by clicking it; that change counts as gain or loss, while movements count as money moved.

**How does the contribution planner split the money?**
It never sells. Classes below their target get the money first, in proportion to how far behind
they are once the contribution is counted; whatever is left is split by target weight. Classes
without a target count as 0%, so they never get new money.

**How are investment returns calculated?**
Time-weighted, from the daily snapshots each sync records: deposits and withdrawals don't count as
gains or losses, and dividends, JCP, interest and coupons paid out do count as gains. The money
moved comes from each position's movements; for a position whose movements Pluggy doesn't return,
it is estimated from the change in amount invested, which is approximate when a deposit and a
market move happen between the same two syncs. CDI and IPCA come from the Central Bank of Brazil; IPCA
only counts months that are over and published.

**I deleted an imported transaction and it came back.**
Synced accounts mirror the bank for the last 90 days (12 months are imported), so the next sync
restores anything the bank still lists. Recategorize or edit the description instead; those changes are kept.

**Transfers between my own banks show up as income and expense.**
Trimly only pairs a move between two banks into a transfer when Pluggy categorizes it as a
same-person transfer (card bill payments are paired by amount and date). Without Pluggy's
categorization, edit the two entries by hand: delete one and turn the other into a transfer.

**My credit card bill amount looks wrong.**
Set the card's closing day (the day the bank closes the bill; that day's purchases already go to
the next one) and due day in its account modal: without it the bill follows the calendar month.
Synced cards follow the bank's own closing and due date for each bill it reports (some banks move
the closing day every month), and use the two days only for the months the bank gives no date
for; they take both days from the bank when blank, and their limit on every sync. A payment only counts when it is
a transfer from another account into the card; a bill paid from a bank Trimly doesn't sync shows
as income on the card and lowers the open bill instead. Turn it into a transfer from the paying
account to fix that.

**My installment purchase doesn't show its future installments.**
Synced cards take the installment from Pluggy, or from a mark at the end of the description
("LOJA 03/10", "PARC 3/10", "Parcela 3 de 10") when the bank sends none. A purchase whose
charges carry neither is a plain charge. The remaining installments are projected at the latest
charge's amount, one per bill after its bill (dated on the day each bill opens), and replaced by the real charges as the bank sends them.
Banks that date every installment on the purchase day (Rico) have each one after the 1st shown
on the day its bill opens, so it lands on the right bill. Some banks only ever report the first installment: the projected ones still count in their bills,
closed ones included, so the bill totals stay right.

**Why didn't I get an obligation reminder on my phone?**
Reminders come from Trimly itself, so they only fire while Obsidian is open and Trimly is
unlocked (obligations live inside the encrypted ledger): on unlock and every hour after. A plugin
can't send push notifications while the app is closed. Choose how they show in Settings →
*Lembretes de obrigações*; the system notification works on desktop only and leaves the names out.

**My subscription on the synced card shows twice.**
Rules on synced accounts stopped posting their own transactions in 0.4.0; they link the charge
from the bank instead. Copies posted before that stay: delete them by hand (the one without the
bank's description).

**Two devices edited at the same time. What happens?**
The last save wins. Avoid editing on two devices before a sync completes.
