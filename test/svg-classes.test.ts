// Obsidian's createSvg adds `cls` with classList.add, which throws on a string
// holding several space-separated classes; the chart then breaks the whole view
// or modal it is drawn in. Several classes must be passed as an array.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

test("createSvg never gets several classes in one string", () => {
  const offenders: string[] = [];
  for (const name of readdirSync("src").filter((f) => f.endsWith(".ts"))) {
    const file = join("src", name);
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, i) => {
        const m = line.match(/createSvg\([^)]*cls:\s*(["'`])((?:(?!\1).)*)\1/);
        if (m && /\s|\$\{/.test(m[2])) offenders.push(`${file}:${i + 1}: ${line.trim()}`);
      });
  }
  assert.deepEqual(offenders, []);
});
