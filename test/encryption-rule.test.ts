// Enforces the plugin's core rule: every file written to the vault is encrypted.
// The only module allowed to touch vault write APIs is src/store.ts, which
// encrypts before writing. Anything else writing directly would risk
// plaintext financial data landing in a vault that gets pushed to GitHub.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const WRITE_APIS =
  /\b(vault\s*\.\s*(create|createBinary|modify|modifyBinary|append|process|copy)|adapter\s*\.\s*(write|writeBinary|append|copy|mkdir)|fileManager\s*\.\s*processFrontMatter|writeFile(Sync)?|appendFile(Sync)?|saveLocalStorage)\s*\(/;

const ALLOWED: Record<string, RegExp> = {
  // the encrypted store: writes only ciphertext
  "store.ts": /\bvault\s*\.\s*(create|modify)\s*\(/,
  // the passphrase lives in device localStorage, outside the vault, by design
  "passphrase.ts": /\bsaveLocalStorage\s*\(/,
};

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? sources(join(dir, e.name)) : e.name.endsWith(".ts") ? [join(dir, e.name)] : []
  );
}

test("only the encrypted store writes to the vault", () => {
  const offenders: string[] = [];
  for (const file of sources("src")) {
    const name = file.split(/[\\/]/).pop() ?? "";
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, i) => {
        if (!WRITE_APIS.test(line)) return;
        if (ALLOWED[name]?.test(line)) return;
        offenders.push(`${file}:${i + 1}: ${line.trim()}`);
      });
  }
  assert.deepEqual(offenders, [], "unencrypted write paths found");
});

test("store.ts only writes text produced by encryptText", () => {
  const src = readFileSync("src/store.ts", "utf8");
  assert.match(src, /const text = await encryptText\(/);
  assert.match(src, /await this\.writeEncrypted\(text\)/);
  const calls = src.match(/writeEncrypted\(/g) ?? [];
  assert.equal(calls.length, 2, "writeEncrypted must have exactly one caller (plus its definition)");
});

test("settings (data.json, inside the vault) never hold the passphrase or financial data", () => {
  const main = readFileSync("src/main.ts", "utf8");
  const settings = main.slice(main.indexOf("export interface TrimlySettings"), main.indexOf("const DEFAULT_SETTINGS"));
  assert.ok(settings.length > 0);
  const fields = [...settings.matchAll(/^\s*(\w+)\s*:/gm)].map((m) => m[1]);
  assert.deepEqual(fields.sort(), ["benchmarks", "currency", "disabledFeeds", "feeds", "folder", "hideValues", "language", "proventos", "rememberPassphrase", "reminders", "treasuryPrices"]);
});
