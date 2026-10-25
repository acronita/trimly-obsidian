import { App, Notice, Plugin, PluginSettingTab, Setting, TFile, moment } from "obsidian";
import { InvalidEnvelopeError, WrongPassphraseError } from "./crypto";
import { Ledger, Transaction, defaultLedger, formatMoney, postDueRecurring, todayISO } from "./ledger";
import { ConfirmModal, PassphraseModal } from "./modals";
import { PassphraseManager } from "./passphrase";
import { EncryptedStore } from "./store";
import { TrimlyView, VIEW_TYPE_TRIMLY, openTransactionModal } from "./view";

/** Non-sensitive preferences only: this file (data.json) lives inside the vault. */
export interface TrimlySettings {
  /** vault folder holding the encrypted ledger */
  folder: string;
  /** ISO 4217 currency code */
  currency: string;
  /** keep the passphrase in this device's local storage (outside the vault) */
  rememberPassphrase: boolean;
}

const DEFAULT_SETTINGS: TrimlySettings = {
  folder: "Trimly",
  currency: "BRL",
  rememberPassphrase: true,
};

export default class TrimlyPlugin extends Plugin {
  settings!: TrimlySettings;
  ledger: Ledger | null = null;
  passphrases!: PassphraseManager;
  store!: EncryptedStore;
  private unlocking: Promise<boolean> | null = null;

  async onload() {
    await this.loadSettings();
    this.passphrases = new PassphraseManager(this.app, () => this.settings.rememberPassphrase);
    this.store = new EncryptedStore(this.app, () => this.settings.folder);

    this.registerView(VIEW_TYPE_TRIMLY, (leaf) => new TrimlyView(leaf, this));
    this.addRibbonIcon("wallet", "Open Trimly", () => void this.openDashboard());
    this.addCommand({ id: "open-dashboard", name: "Open dashboard", callback: () => void this.openDashboard() });
    this.addCommand({
      id: "add-transaction",
      name: "Add transaction",
      callback: async () => {
        if (await this.unlock()) this.openTransactionModal(null);
      },
    });
    this.addCommand({ id: "lock", name: "Lock", callback: () => this.lock() });
    this.addSettingTab(new TrimlySettingTab(this.app, this));

    // the ledger changed on disk without us (vault sync, git pull): reload it
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (file instanceof TFile && file.path === this.store.path && this.ledger) void this.reloadIfExternal();
      })
    );
  }

  onunload() {
    this.store?.lock();
    this.ledger = null;
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, (await this.loadData()) as Partial<TrimlySettings>);
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  locale(): string {
    return moment.locale() || "en";
  }

  formatMoney(cents: number): string {
    return formatMoney(cents, this.settings.currency, this.locale());
  }

  async openDashboard() {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_TRIMLY)[0];
    const leaf = existing ?? this.app.workspace.getLeaf("tab");
    if (!existing) await leaf.setViewState({ type: VIEW_TYPE_TRIMLY, active: true });
    await this.app.workspace.revealLeaf(leaf);
  }

  openTransactionModal(tx: Transaction | null) {
    openTransactionModal(this, tx);
  }

  refreshViews() {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_TRIMLY)) {
      if (leaf.view instanceof TrimlyView) leaf.view.render();
    }
  }

  /** Make sure the ledger is decrypted, prompting for the passphrase if needed. */
  unlock(): Promise<boolean> {
    if (this.ledger) return Promise.resolve(true);
    if (!this.unlocking) {
      this.unlocking = this.doUnlock().finally(() => {
        this.unlocking = null;
        this.refreshViews();
      });
    }
    return this.unlocking;
  }

  private async doUnlock(): Promise<boolean> {
    if (this.store.exists()) {
      const stored = this.passphrases.get();
      if (stored && (await this.tryLoad(stored)) === null) {
        this.passphrases.set(stored);
        return true;
      }
      return new Promise((resolve) => {
        new PassphraseModal(
          this.app,
          "unlock",
          async (p) => {
            const err = await this.tryLoad(p);
            if (err === null) {
              this.passphrases.set(p);
              resolve(true);
            }
            return err;
          },
          () => resolve(false)
        ).open();
      });
    }
    return new Promise((resolve) => {
      new PassphraseModal(
        this.app,
        "create",
        async (p) => {
          const ledger = defaultLedger();
          try {
            await this.store.create(ledger, p);
          } catch (e) {
            return `Could not create ${this.store.path}: ${(e as Error).message}`;
          }
          this.ledger = ledger;
          this.passphrases.set(p);
          new Notice(`Trimly ledger created at ${this.store.path}.`);
          resolve(true);
          return null;
        },
        () => resolve(false)
      ).open();
    });
  }

  /** Try to decrypt with `passphrase`; returns an error message or null on success. */
  private async tryLoad(passphrase: string): Promise<string | null> {
    try {
      const ledger = await this.store.load(passphrase);
      this.ledger = ledger;
      const posted = postDueRecurring(ledger, todayISO());
      if (posted) {
        await this.store.save(ledger);
        new Notice(`Posted ${posted} recurring transaction${posted === 1 ? "" : "s"}.`);
      }
      return null;
    } catch (e) {
      if (e instanceof WrongPassphraseError) return "Wrong passphrase.";
      if (e instanceof InvalidEnvelopeError) return e.message;
      return `Could not open the ledger: ${(e as Error).message}`;
    }
  }

  private async reloadIfExternal() {
    const text = await this.store.readRaw();
    if (text === null || this.store.isOwnWrite(text)) return;
    const pass = this.passphrases.get();
    if (!pass || (await this.tryLoad(pass)) !== null) {
      this.lock();
      new Notice("Trimly: the ledger changed on disk and could not be reopened. Unlock it again.");
      return;
    }
    this.refreshViews();
  }

  lock() {
    this.ledger = null;
    this.store.lock();
    this.passphrases.clearMemory();
    this.refreshViews();
  }

  /** Apply a change to the ledger, then encrypt and save it. */
  async mutate(fn: (ledger: Ledger) => void) {
    if (!this.ledger) return;
    fn(this.ledger);
    this.refreshViews();
    try {
      await this.store.save(this.ledger);
    } catch (e) {
      new Notice(`Trimly: could not save: ${(e as Error).message}`);
    }
  }

  changePassphrase() {
    if (!this.ledger) {
      new Notice("Unlock Trimly first.");
      return;
    }
    new PassphraseModal(this.app, "change", async (p) => {
      if (!this.ledger) return "Trimly was locked.";
      try {
        await this.store.rekey(this.ledger, p);
      } catch (e) {
        return `Could not re-encrypt: ${(e as Error).message}`;
      }
      this.passphrases.set(p);
      new Notice("Passphrase changed. Store the new one somewhere safe.");
      return null;
    }).open();
  }
}

class TrimlySettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: TrimlyPlugin) {
    super(app, plugin);
  }

  display() {
    const { containerEl } = this;
    const p = this.plugin;
    containerEl.empty();

    new Setting(containerEl).setName("Security").setHeading();
    containerEl.createEl("p", {
      cls: "trimly-warning",
      text:
        "Everything Trimly saves in your vault is encrypted with AES-GCM using your passphrase. " +
        "If you lose the passphrase, the data cannot be recovered.",
    });

    new Setting(containerEl)
      .setName("Status")
      .setDesc(p.ledger ? `Unlocked: ${p.store.path}` : p.store.exists() ? "Locked" : "No ledger yet")
      .addButton((b) =>
        p.ledger
          ? b.setButtonText("Lock now").onClick(() => {
              p.lock();
              this.display();
            })
          : b
              .setButtonText(p.store.exists() ? "Unlock" : "Create ledger")
              .setCta()
              .onClick(async () => {
                await p.unlock();
                this.display();
              })
      );

    new Setting(containerEl)
      .setName("Remember passphrase on this device")
      .setDesc(
        "Keeps the passphrase in this device's local app storage, outside the vault, so it is never synced or committed. " +
          "Turn off to be asked once per session."
      )
      .addToggle((t) =>
        t.setValue(p.settings.rememberPassphrase).onChange(async (v) => {
          p.settings.rememberPassphrase = v;
          await p.saveSettings();
          p.passphrases.syncRemember();
        })
      );

    new Setting(containerEl)
      .setName("Change passphrase")
      .setDesc("Re-encrypts the ledger with a new passphrase.")
      .addButton((b) => b.setButtonText("Change").onClick(() => p.changePassphrase()));

    new Setting(containerEl)
      .setName("Forget passphrase on this device")
      .setDesc("Removes the stored passphrase from this device and locks Trimly. Your data stays encrypted in the vault.")
      .addButton((b) =>
        b
          .setButtonText("Forget")
          .setWarning()
          .onClick(() =>
            new ConfirmModal(this.app, "Forget the passphrase on this device? Make sure you have it saved elsewhere.", "Forget", () => {
              p.passphrases.forget();
              p.lock();
              this.display();
            }).open()
          )
      );

    new Setting(containerEl).setName("Storage").setHeading();

    new Setting(containerEl)
      .setName("Folder")
      .setDesc("Vault folder for the encrypted ledger file. Changing it locks Trimly; move the existing file yourself.")
      .addText((t) =>
        t
          .setPlaceholder("Trimly")
          .setValue(p.settings.folder)
          .onChange(async (v) => {
            p.settings.folder = v.trim().replace(/^\/+|\/+$/g, "") || "Trimly";
            await p.saveSettings();
            p.lock();
          })
      );

    new Setting(containerEl)
      .setName("Currency")
      .setDesc("Three-letter currency code, e.g. BRL, USD, EUR.")
      .addText((t) =>
        t.setValue(p.settings.currency).onChange(async (v) => {
          const code = v.trim().toUpperCase();
          if (!/^[A-Z]{3}$/.test(code)) return;
          p.settings.currency = code;
          await p.saveSettings();
          p.refreshViews();
        })
      );
  }
}
