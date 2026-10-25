---
name: trimly-dependency-policy
description: "Trimly: dependencies are always pinned exactly, never @latest or auto-updated"
metadata:
  type: feedback
---

In the Trimly project, all `package.json` dependency versions must be pinned exactly (no `^`/`~` ranges). Never install `@latest`, never run an automatic update, never bump a version — even a patch/security fix — without asking the user first and getting explicit approval. Carried over from the Maguilanote project on 2026-10-24; codified in `.claude/CLAUDE.md` and `docs/DEPENDENCIES.md`.

**Why:** an Obsidian plugin runs with filesystem access inside every user's vault, and this one handles financial data; unreviewed dependency drift is a supply-chain risk.

**How to apply:** propose the exact version and reason, wait for approval before editing `package.json`. Prefer zero runtime dependencies (crypto uses Web Crypto, built in).

Related: [[trimly-encryption-rule]], [[trimly-english-only]]
