# Development

Requires Node 20+ (CI uses 20; local development tested on 24).

```bash
npm ci
npm test        # unit tests, incl. the encryption-rule check
npm run lint    # Obsidian scorecard lint rules
npm run build   # typecheck, bundle, copy into your vault
```

## Auto-copy into a vault

Create `.env.local` (git-ignored) pointing at the plugin folder inside a test vault:

```
OBSIDIAN_PLUGIN_DIR=C:\Users\<you>\Documents\ObsidianVault\.obsidian\plugins\trimly
```

`npm run build` copies `main.js`, `manifest.json` and `styles.css` there. Reload Obsidian (or toggle the
plugin) to pick up the new build. Without `.env.local` the copy step is skipped.

## Releases

Pushing a bare `x.y.z` tag runs `.github/workflows/release.yml`: tests, build, provenance attestation
and a GitHub Release with the three plugin files. See `.claude/skills/release/SKILL.md`.

## Verifying a change

- `npm test` and `npm run build` pass.
- In a real vault: create/unlock the ledger, add a transaction, then open `Trimly/ledger.trimly` in a
  text editor and confirm nothing readable leaked.
