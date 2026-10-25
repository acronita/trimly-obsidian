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

**Two devices edited at the same time. What happens?**
The last save wins. Avoid editing on two devices before a sync completes.
