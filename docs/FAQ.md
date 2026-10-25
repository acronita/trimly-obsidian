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

**My investments don't show up.**
They come from bank sync. The connected Pluggy item must include the investments product; if
loading them fails, the sync shows a notice with Pluggy's error. Positions only have history from
your first sync on, since Pluggy reports current values only.

**How do I add an investment bank sync doesn't see (crypto, a foreign broker)?**
In investments mode, *Add → New position* with its current value, then record contributions,
withdrawals and income with *Add → New movement*. Update the position's value from time to time
by clicking it; that change counts as gain or loss, while movements count as money moved.

**How are investment returns calculated?**
Time-weighted, from the daily snapshots each sync records: deposits and withdrawals don't count as
gains or losses, and dividends, JCP, interest and coupons paid out do count as gains. The money
moved comes from each position's movements; for a position whose movements Pluggy doesn't return,
it is estimated from the change in amount invested, which is approximate when a deposit and a
market move happen between the same two syncs. CDI and IPCA come from the Central Bank of Brazil; IPCA
only counts months that are over and published.

**I deleted an imported transaction and it came back.**
Synced accounts mirror the bank for the last 90 days, so the next sync restores anything the bank
still lists. Recategorize or edit the description instead; those changes are kept.

**Transfers between my own banks show up as income and expense.**
Trimly only pairs a move between two banks into a transfer when Pluggy categorizes it as a
same-person transfer (card bill payments are paired by amount and date). Without Pluggy's
categorization, edit the two entries by hand: delete one and turn the other into a transfer.

**Two devices edited at the same time. What happens?**
The last save wins. Avoid editing on two devices before a sync completes.
