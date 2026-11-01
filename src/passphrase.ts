import { App } from "obsidian";

const STORAGE_KEY = "trimly-passphrase";

/**
 * Holds the ledger passphrase. It lives in memory for the session and,
 * when "remember on this device" is on, in this vault's localStorage — which
 * is app data on the device, outside the vault folder, so it never syncs or
 * gets committed with the vault. It is never written to data.json.
 */
export class PassphraseManager {
  private memory: string | null = null;

  constructor(private app: App, private remember: () => boolean) {}

  get(): string | null {
    if (this.memory) return this.memory;
    const stored: unknown = this.app.loadLocalStorage(STORAGE_KEY);
    return typeof stored === "string" && stored ? stored : null;
  }

  set(passphrase: string) {
    this.memory = passphrase;
    this.app.saveLocalStorage(STORAGE_KEY, this.remember() ? passphrase : null);
  }

  /** Re-apply the "remember" preference to whatever passphrase is in memory. */
  syncRemember() {
    this.app.saveLocalStorage(STORAGE_KEY, this.remember() && this.memory ? this.memory : null);
  }

  /** Remove it from this device and from memory. */
  forget() {
    this.memory = null;
    this.app.saveLocalStorage(STORAGE_KEY, null);
  }

  /** Clear the in-memory copy only. */
  clearMemory() {
    this.memory = null;
  }

  isRemembered(): boolean {
    return typeof this.app.loadLocalStorage(STORAGE_KEY) === "string";
  }
}
