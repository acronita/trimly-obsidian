/**
 * Encryption for every file Trimly writes to the vault.
 *
 * AES-256-GCM with a key derived from the user's passphrase via
 * PBKDF2-SHA256. Uses only the Web Crypto API, so it runs the same on
 * desktop and mobile with no dependencies. GCM authenticates the ciphertext:
 * a wrong passphrase or a tampered file fails to decrypt instead of
 * producing garbage.
 *
 * Kept free of Obsidian and local imports so it can be unit tested in Node.
 */

export const ENVELOPE_VERSION = 1;
export const KDF_ITERATIONS = 600_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

/** On-disk shape of an encrypted file (JSON text, so git treats it as text). */
export interface Envelope {
  trimly: number;
  kdf: { name: "PBKDF2"; hash: "SHA-256"; iterations: number; salt: string };
  cipher: { name: "AES-GCM"; iv: string };
  data: string;
}

/** A derived key plus the salt it was derived with. */
export interface KeyMaterial {
  key: CryptoKey;
  salt: Uint8Array;
  iterations: number;
}

export class WrongPassphraseError extends Error {
  constructor() {
    super("Wrong passphrase, or the file is corrupted");
    this.name = "WrongPassphraseError";
  }
}

export class InvalidEnvelopeError extends Error {
  constructor(reason: string) {
    super(`Not a Trimly encrypted file: ${reason}`);
    this.name = "InvalidEnvelopeError";
  }
}

export function randomBytes(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n));
}

export async function deriveKey(
  passphrase: string,
  salt: Uint8Array = randomBytes(SALT_BYTES),
  iterations = KDF_ITERATIONS
): Promise<KeyMaterial> {
  const base = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
  return { key, salt, iterations };
}

export async function encryptText(plaintext: string, km: KeyMaterial): Promise<string> {
  const iv = randomBytes(IV_BYTES);
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    km.key,
    new TextEncoder().encode(plaintext)
  );
  const envelope: Envelope = {
    trimly: ENVELOPE_VERSION,
    kdf: { name: "PBKDF2", hash: "SHA-256", iterations: km.iterations, salt: toBase64(km.salt) },
    cipher: { name: "AES-GCM", iv: toBase64(iv) },
    data: toBase64(new Uint8Array(ct)),
  };
  return JSON.stringify(envelope, null, 2);
}

export function parseEnvelope(text: string): Envelope {
  let env: Envelope;
  try {
    env = JSON.parse(text) as Envelope;
  } catch {
    throw new InvalidEnvelopeError("not JSON");
  }
  if (env?.trimly !== ENVELOPE_VERSION) throw new InvalidEnvelopeError("unknown version");
  if (env.kdf?.name !== "PBKDF2" || env.kdf.hash !== "SHA-256") throw new InvalidEnvelopeError("unsupported KDF");
  if (env.cipher?.name !== "AES-GCM") throw new InvalidEnvelopeError("unsupported cipher");
  if (typeof env.data !== "string" || typeof env.cipher.iv !== "string" || typeof env.kdf.salt !== "string") {
    throw new InvalidEnvelopeError("missing fields");
  }
  return env;
}

/** Key material matching this envelope's salt, reusing `cached` when it already matches. */
export async function keyForEnvelope(
  env: Envelope,
  passphrase: string,
  cached?: KeyMaterial | null
): Promise<KeyMaterial> {
  const salt = fromBase64(env.kdf.salt);
  if (cached && cached.iterations === env.kdf.iterations && bytesEqual(cached.salt, salt)) return cached;
  return deriveKey(passphrase, salt, env.kdf.iterations);
}

export async function decryptEnvelope(env: Envelope, km: KeyMaterial): Promise<string> {
  try {
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64(env.cipher.iv) },
      km.key,
      fromBase64(env.data)
    );
    return new TextDecoder().decode(pt);
  } catch {
    throw new WrongPassphraseError();
  }
}

export function toBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
