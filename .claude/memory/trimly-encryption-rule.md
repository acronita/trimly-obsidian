---
name: trimly-encryption-rule
description: "Trimly: every file written to the vault must be encrypted; passphrase never in data.json"
metadata:
  type: project
---

The user's core requirement (2026-10-24): every file Trimly generates and saves must be encrypted, because the vault is pushed to a GitHub repo and the files hold sensitive financial data. The passphrase lives locally on the device (localStorage, outside the vault) — if it's lost the data is unrecoverable, and the user accepts that.

**Why:** a plaintext leak into the vault ends up in git history permanently.

**How to apply:** route every vault write through `src/store.ts`; never add plaintext export/cache/log files; keep `test/encryption-rule.test.ts` passing; never store the passphrase or financial data in `data.json`.

Related: [[trimly-dependency-policy]], [[trimly-english-only]]
