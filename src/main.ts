import { App, Notice, Plugin, PluginSettingTab, Setting, TFile, moment } from "obsidian";
import { SYNC_WINDOW_DAYS, applyBankData } from "./bank-sync";
import { InvalidEnvelopeError, WrongPassphraseError } from "./crypto";
import { applyInvestments } from "./investment-sync";
import { Ledger, Transaction, defaultLedger, formatMoney, localeForCurrency, postDueRecurring, toISODate, todayISO } from "./ledger";
import { ConfirmModal, PassphraseModal } from "./modals";
import { PassphraseManager } from "./passphrase";
import { fetchBankData } from "./pluggy";
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

/** Unlocking syncs the bank again only when the last sync is older than this. */
const AUTO_SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000;

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
  private syncing: Promise<void> | null = null;

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
    this.addCommand({
      id: "sync-bank",
      name: "Sync bank accounts",
      callback: async () => {
        if (await this.unlock()) await this.syncBank();
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
    return formatMoney(cents, this.settings.currency, localeForCurrency(this.settings.currency, this.locale()));
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
        if (this.ledger) this.autoSyncBank();
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

  private autoSyncBank() {
    const last = this.ledger?.pluggy?.lastSync;
    if (this.ledger?.pluggy && (!last || Date.now() - Date.parse(last) > AUTO_SYNC_INTERVAL_MS)) void this.syncBank(true);
  }

  /** Pull accounts and transactions from Pluggy. `quiet` skips the notice when nothing changed. */
  syncBank(quiet = false): Promise<void> {
    if (!this.syncing) {
      this.syncing = this.doSyncBank(quiet).finally(() => {
        this.syncing = null;
        this.refreshViews();
      });
    }
    return this.syncing;
  }

  isSyncing(): boolean {
    return this.syncing !== null;
  }

  private async doSyncBank(quiet: boolean) {
    const config = this.ledger?.pluggy;
    if (!config) {
      new Notice("Set up bank sync in Trimly's settings first.");
      return;
    }
    this.refreshViews();
    const now = new Date();
    const windowStart = toISODate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - SYNC_WINDOW_DAYS));
    let data;
    try {
      data = await fetchBankData(config, windowStart);
    } catch (e) {
      new Notice(`Trimly: bank sync failed: ${(e as Error).message}`);
      return;
    }
    let summary = "";
    await this.mutate((ledger) => {
      if (!ledger.pluggy) return;
      const r = applyBankData(ledger, data.bank, windowStart, todayISO(now));
      const inv = applyInvestments(ledger, data.investments.investments, data.investments.itemIds, todayISO(now));
      ledger.pluggy.lastSync = now.toISOString();
      const parts = [
        r.accountsCreated && `${r.accountsCreated} new account${r.accountsCreated === 1 ? "" : "s"}`,
        r.added && `${r.added} new`,
        r.updated && `${r.updated} updated`,
        r.removed && `${r.removed} removed`,
        inv.added && `${inv.added} new investment${inv.added === 1 ? "" : "s"}`,
        inv.closed && `${inv.closed} investment${inv.closed === 1 ? "" : "s"} closed`,
      ].filter(Boolean);
      summary = parts.length ? `Bank sync: ${parts.join(", ")}.` : quiet ? "" : "Bank sync: everything up to date.";
    });
    if (summary) new Notice(summary);
    // investments are optional per item, but a failure must not pass silently
    if (data.investments.errors.length) new Notice(`Trimly: investments not updated: ${data.investments.errors.join("; ")}`);
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

    this.displayBankSync();
  }

  private displayBankSync() {
    const { containerEl } = this;
    const p = this.plugin;
    new Setting(containerEl).setName("Bank sync (optional)").setHeading();
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text:
        "Imports accounts and transactions from your banks through Pluggy (pluggy.ai), so you don't have to type them in. " +
        "Optional: without it Trimly works fully offline and makes no network requests. When on, Trimly contacts " +
        "api.pluggy.ai to fetch your data; the credentials are stored inside the encrypted ledger.",
    });
    if (!p.ledger) {
      new Setting(containerEl).setDesc("Unlock Trimly to set up bank sync.");
      return;
    }

    const config = p.ledger.pluggy;
    const draft = {
      clientId: config?.clientId ?? "",
      clientSecret: config?.clientSecret ?? "",
      itemIds: config?.itemIds.join(", ") ?? "",
    };
    new Setting(containerEl)
      .setName("Client ID")
      .setDesc("Shown when you create an application in the dashboard at pluggy.ai.")
      .addText((t) => t.setValue(draft.clientId).onChange((v) => (draft.clientId = v.trim())));
    new Setting(containerEl).setName("Client secret").addText((t) => {
      t.inputEl.type = "password";
      t.setValue(draft.clientSecret).onChange((v) => (draft.clientSecret = v.trim()));
    });
    new Setting(containerEl)
      .setName("Item IDs")
      .setDesc("One per connected bank, separated by commas.")
      .addText((t) => t.setValue(draft.itemIds).onChange((v) => (draft.itemIds = v)));

    new Setting(containerEl)
      .setName(config ? "Status" : "Connect")
      .setDesc(
        config
          ? config.lastSync
            ? `Last synced ${new Date(config.lastSync).toLocaleString()}.`
            : "Not synced yet."
          : "Saves the credentials and runs the first sync."
      )
      .addButton((b) =>
        b
          .setButtonText(config ? "Save and sync" : "Connect")
          .setCta()
          .onClick(async () => {
            const itemIds = draft.itemIds.split(/[\s,]+/).filter(Boolean);
            if (!draft.clientId || !draft.clientSecret || !itemIds.length) {
              new Notice("Fill in the client ID, client secret and at least one item ID.");
              return;
            }
            await p.mutate((l) => {
              l.pluggy = { ...l.pluggy, clientId: draft.clientId, clientSecret: draft.clientSecret, itemIds };
            });
            await p.syncBank();
            this.display();
          })
      );

    if (!config) return;
    new Setting(containerEl)
      .setName("Disconnect")
      .setDesc("Stops syncing and removes the credentials. Imported accounts and transactions stay.")
      .addButton((b) =>
        b
          .setButtonText("Disconnect")
          .setWarning()
          .onClick(() =>
            new ConfirmModal(this.app, "Disconnect bank sync and remove the Pluggy credentials?", "Disconnect", () => {
              void p.mutate((l) => delete l.pluggy).then(() => this.display());
            }).open()
          )
      );
  }
}
