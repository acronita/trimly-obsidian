import { test } from "node:test";
import assert from "node:assert/strict";
import type { App } from "obsidian";
import { ChatStore, trimChats } from "../src/chat-store.ts";
import type { SavedChat } from "../src/chat-store.ts";
import { decryptEnvelope, deriveKey, encryptText, keyForEnvelope, parseEnvelope, randomBytes } from "../src/crypto.ts";

function device() {
  const stored = new Map<string, unknown>();
  return {
    stored,
    app: { loadLocalStorage: (k: string) => stored.get(k) ?? null, saveLocalStorage: (k: string, v: unknown) => stored.set(k, v) } as unknown as App,
  };
}

async function sessionStore(app: App, passphrase: string, salt: Uint8Array) {
  const key = await deriveKey(passphrase, salt, 1000);
  const store = {
    seal: (text: string) => encryptText(text, key),
    unseal: async (text: string, given: string) => {
      try {
        const env = parseEnvelope(text);
        return await decryptEnvelope(env, await keyForEnvelope(env, given));
      } catch {
        return null;
      }
    },
  };
  return (given = passphrase) => new ChatStore(app, store, () => given);
}

function chat(id: string, updatedAt: string, text = "Quanto gastei com mercado?"): SavedChat {
  return { id, kind: "accounts", title: text.slice(0, 60), updatedAt, messages: [], log: [{ role: "user", text }], tokens: 0 };
}

test("a conversation saved before closing Obsidian is there after reopening, unreadable in storage", async () => {
  const { app, stored } = device();
  const salt = randomBytes(16);
  const before = await sessionStore(app, "senha", salt);
  await before().save([chat("a", "2026-11-08T10:00:00Z")]);
  assert.ok(![...stored.values()].some((v) => String(v).includes("mercado")));

  const reopened = await sessionStore(app, "senha", salt);
  assert.deepEqual((await reopened().load()).map((c) => c.id), ["a"]);
});

test("conversations that can't be decrypted read as none instead of breaking the assistant", async () => {
  const { app } = device();
  const store = await sessionStore(app, "senha", randomBytes(16));
  await store().save([chat("a", "2026-11-08T10:00:00Z")]);
  assert.deepEqual(await store("outra").load(), []);
});

test("a full history drops the oldest conversations, so the newest always gets saved", () => {
  const big = "x".repeat(1_500_000);
  const kept = trimChats([chat("oldest", "2026-11-01T10:00:00Z", big), chat("newest", "2026-11-03T10:00:00Z", big), chat("middle", "2026-11-02T10:00:00Z", big), chat("older", "2026-10-30T10:00:00Z", big)]);
  // each is about 1.5 MB: two fit under the cap and a third doesn't
  assert.deepEqual(kept.map((c) => c.id), ["newest", "middle"]);
});
