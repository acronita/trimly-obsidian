import { test } from "node:test";
import assert from "node:assert/strict";
import {
  InvalidEnvelopeError,
  WrongPassphraseError,
  decryptEnvelope,
  deriveKey,
  encryptText,
  keyForEnvelope,
  parseEnvelope,
} from "../src/crypto.ts";

// low iteration count keeps the suite fast; production uses KDF_ITERATIONS
const ITER = 1000;
const SECRET = '{"accounts":[{"name":"Main bank","openingBalance":123456}]}';

test("round-trips data with the right passphrase", async () => {
  const km = await deriveKey("correct horse", undefined, ITER);
  const text = await encryptText(SECRET, km);
  const env = parseEnvelope(text);
  const again = await keyForEnvelope(env, "correct horse");
  assert.equal(await decryptEnvelope(env, again), SECRET);
});

test("the file on disk leaks none of the plaintext", async () => {
  // the whole point of the plugin: a vault pushed to GitHub must not reveal finances
  const km = await deriveKey("pw", undefined, ITER);
  const text = await encryptText(SECRET, km);
  assert.ok(!text.includes("Main bank"));
  assert.ok(!text.includes("123456"));
  assert.ok(!text.includes("accounts"));
});

test("a wrong passphrase is rejected, not decoded into garbage", async () => {
  const km = await deriveKey("right", undefined, ITER);
  const env = parseEnvelope(await encryptText(SECRET, km));
  const wrong = await keyForEnvelope(env, "wrong");
  await assert.rejects(decryptEnvelope(env, wrong), WrongPassphraseError);
});

test("a tampered file is rejected", async () => {
  const km = await deriveKey("pw", undefined, ITER);
  const env = parseEnvelope(await encryptText(SECRET, km));
  const bytes = Buffer.from(env.data, "base64");
  bytes[0] ^= 1;
  env.data = bytes.toString("base64");
  await assert.rejects(decryptEnvelope(env, km), WrongPassphraseError);
});

test("every save uses a fresh IV, so identical data never produces identical files", async () => {
  const km = await deriveKey("pw", undefined, ITER);
  const a = parseEnvelope(await encryptText(SECRET, km));
  const b = parseEnvelope(await encryptText(SECRET, km));
  assert.notEqual(a.cipher.iv, b.cipher.iv);
  assert.notEqual(a.data, b.data);
});

test("cached key is reused only when the salt matches", async () => {
  const km = await deriveKey("pw", undefined, ITER);
  const env = parseEnvelope(await encryptText(SECRET, km));
  assert.equal(await keyForEnvelope(env, "pw", km), km);
  const other = await deriveKey("pw", undefined, ITER);
  assert.notEqual(await keyForEnvelope(env, "pw", other), other);
});

test("non-Trimly files are refused", () => {
  assert.throws(() => parseEnvelope("# just a note"), InvalidEnvelopeError);
  assert.throws(() => parseEnvelope('{"trimly":99}'), InvalidEnvelopeError);
});
