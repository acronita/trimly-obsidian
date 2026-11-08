import { App, TFile, normalizePath } from "obsidian";
import { t } from "./i18n";
import {
  KeyMaterial,
  decryptEnvelope,
  deriveKey,
  encryptText,
  keyForEnvelope,
  parseEnvelope,
} from "./crypto";
import { Ledger, parseLedger } from "./ledger";

export const LEDGER_FILE = "ledger.trimly";

/**
 * The only place Trimly writes to the vault. Everything that reaches disk is
 * encrypted first (see the Encryption Rule in .claude/CLAUDE.md, enforced by
 * test/encryption-rule.test.ts).
 */
export class EncryptedStore {
  private key: KeyMaterial | null = null;
  /** exact text of our last write, to tell our own modify events from a sync */
  private lastWritten: string | null = null;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private app: App, private folder: () => string) {}

  /** Encrypt text under the ledger's key, for what is kept on the device instead of in the vault. */
  async seal(text: string): Promise<string> {
    if (!this.key) throw new Error("locked");
    return encryptText(text, this.key);
  }

  /** Decrypt what `seal` wrote; null when it can't be read, as after changing the passphrase. */
  async unseal(text: string, passphrase: string): Promise<string | null> {
    try {
      const env = parseEnvelope(text);
      return await decryptEnvelope(env, await keyForEnvelope(env, passphrase, this.key));
    } catch {
      return null;
    }
  }

  get path(): string {
    return normalizePath(`${this.folder() || "Trimly"}/${LEDGER_FILE}`);
  }

  exists(): boolean {
    return this.app.vault.getAbstractFileByPath(this.path) instanceof TFile;
  }

  isOwnWrite(text: string): boolean {
    return text === this.lastWritten;
  }

  async readRaw(): Promise<string | null> {
    const file = this.app.vault.getFileByPath(this.path);
    return file ? this.app.vault.read(file) : null;
  }

  /** Decrypt the ledger. Throws WrongPassphraseError / InvalidEnvelopeError. */
  async load(passphrase: string): Promise<Ledger> {
    const text = await this.readRaw();
    if (text === null) throw new Error(t.errors.fileNotFound(this.path));
    const env = parseEnvelope(text);
    const km = await keyForEnvelope(env, passphrase, this.key);
    const ledger = parseLedger(await decryptEnvelope(env, km));
    this.key = km;
    this.lastWritten = text;
    return ledger;
  }

  /** Create a brand-new ledger file encrypted with `passphrase`. */
  async create(ledger: Ledger, passphrase: string) {
    this.key = await deriveKey(passphrase);
    await this.save(ledger);
  }

  /** Encrypt and write the ledger. Requires a prior load() or create(). */
  save(ledger: Ledger): Promise<void> {
    const run = async () => {
      if (!this.key) throw new Error(t.errors.locked);
      const text = await encryptText(JSON.stringify(ledger), this.key);
      await this.writeEncrypted(text);
    };
    this.writeQueue = this.writeQueue.then(run, run);
    return this.writeQueue;
  }

  /** Re-encrypt with a new passphrase (fresh salt). */
  async rekey(ledger: Ledger, newPassphrase: string) {
    await this.writeQueue.catch(() => undefined);
    this.key = await deriveKey(newPassphrase);
    await this.save(ledger);
  }

  lock() {
    this.key = null;
  }

  private async writeEncrypted(text: string) {
    const path = this.path;
    const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    if (dir && !this.app.vault.getAbstractFileByPath(dir)) await this.app.vault.createFolder(dir);
    this.lastWritten = text;
    const file = this.app.vault.getFileByPath(path);
    if (file) await this.app.vault.modify(file, text);
    else await this.app.vault.create(path, text);
  }
}
