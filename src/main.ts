import { App, Notice, Plugin, PluginSettingTab, Setting, TFile } from "obsidian";
import { SYNC_WINDOW_DAYS, applyBankData } from "./bank-sync";
import { fetchQuotes } from "./brapi";
import { InvalidEnvelopeError, WrongPassphraseError } from "./crypto";
import { fetchBenchmarks } from "./bcb";
import { LANGUAGES, LANGUAGE_NAMES, Language, setLanguage, t } from "./i18n";
import { applyInvestments } from "./investment-sync";
import { Ledger, Transaction, defaultLedger, formatMoney, localeForCurrency, postDueRecurring, toISODate, todayISO, translateDefaults } from "./ledger";
import { ConfirmModal, PassphraseModal } from "./modals";
import { PassphraseManager } from "./passphrase";
import { fetchBankData } from "./pluggy";
import { applyQuotes, quoteTickers } from "./quotes";
import type { Benchmarks } from "./returns";
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
  /** fetch public CDI/IPCA series from the Central Bank to compare investments with */
  benchmarks: boolean;
  /** interface language; Brazilian Portuguese first */
  language: Language;
  /** mask money amounts on screen (eye button in the header) */
  hideValues: boolean;
}

/** Unlocking syncs the bank again only when the last sync is older than this. */
const AUTO_SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** Unlocking refreshes quotes only when the last update is older than this. */
const QUOTES_INTERVAL_MS = 60 * 60 * 1000;
/** After a failed benchmark fetch, wait this long before trying again. */
const BENCHMARK_RETRY_MS = 60 * 60 * 1000;
/** The daily CDI series accepts at most 10 years per request. */
const BENCHMARK_MAX_DAYS = 3650;

const DEFAULT_SETTINGS: TrimlySettings = {
  folder: "Trimly",
  currency: "BRL",
  rememberPassphrase: true,
  benchmarks: true,
  language: "pt-BR",
  hideValues: false,
};

function olderThan(iso: string | undefined, ms: number): boolean {
  return !iso || Date.now() - Date.parse(iso) > ms;
}

export default class TrimlyPlugin extends Plugin {
  settings!: TrimlySettings;
  ledger: Ledger | null = null;
  passphrases!: PassphraseManager;
  store!: EncryptedStore;
  private unlocking: Promise<boolean> | null = null;
  private syncing: Promise<void> | null = null;
  /** public data, so it is only cached in memory for the day */
  private benchmarkCache: { from: string; day: string; data: Benchmarks } | null = null;
  private benchmarkLoading = false;
  private benchmarkFailedAt = 0;
  benchmarkError: string | null = null;
  /** set when data.json predates the language setting: the ledger's starter names are still English */
  private translateOnUnlock = false;

  async onload() {
    await this.loadSettings();
    // command and ribbon names are fixed at load: a language change applies to them after a restart
    setLanguage(this.settings.language);
    this.passphrases = new PassphraseManager(this.app, () => this.settings.rememberPassphrase);
    this.store = new EncryptedStore(this.app, () => this.settings.folder);

    this.registerView(VIEW_TYPE_TRIMLY, (leaf) => new TrimlyView(leaf, this));
    this.addRibbonIcon("wallet", t.commands.ribbon, () => void this.openDashboard());
    this.addCommand({ id: "open-dashboard", name: t.commands.open, callback: () => void this.openDashboard() });
    this.addCommand({
      id: "add-transaction",
      name: t.commands.addTransaction,
      callback: async () => {
        if (await this.unlock()) this.openTransactionModal(null);
      },
    });
    this.addCommand({
      id: "sync-bank",
      name: t.commands.sync,
      callback: async () => {
        if (await this.unlock()) await this.sync();
      },
    });
    this.addCommand({ id: "lock", name: t.commands.lock, callback: () => this.lock() });
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
    const saved = (await this.loadData()) as Partial<TrimlySettings> | null;
    this.translateOnUnlock = !!saved && !saved.language;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, saved);
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  locale(): string {
    return t.locale;
  }

  formatMoney(cents: number): string {
    return formatMoney(cents, this.settings.currency, localeForCurrency(this.settings.currency, this.locale()));
  }

  /** Large amounts in currency units, abbreviated (R$ 788,9 bi). */
  formatCompactMoney(units: number): string {
    try {
      return new Intl.NumberFormat(localeForCurrency(this.settings.currency, this.locale()), {
        style: "currency",
        currency: this.settings.currency,
        notation: "compact",
        maximumFractionDigits: 1,
      }).format(units);
    } catch {
      return `${units} ${this.settings.currency}`;
    }
  }

  formatDateTime(iso: string): string {
    return new Date(iso).toLocaleString(this.locale());
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

  /** Switch the interface language, renaming starter categories that still have their default name. */
  async setLanguage(lang: Language) {
    const from = t;
    this.settings.language = lang;
    setLanguage(lang);
    await this.saveSettings();
    if (this.ledger) await this.mutate((l) => translateDefaults(l, from, t));
    else this.refreshViews();
  }

  /** Make sure the ledger is decrypted, prompting for the passphrase if needed. */
  unlock(): Promise<boolean> {
    if (this.ledger) return Promise.resolve(true);
    if (!this.unlocking) {
      this.unlocking = this.doUnlock().finally(() => {
        this.unlocking = null;
        this.refreshViews();
        if (this.ledger) void this.afterUnlock();
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
            return t.notices.createFailed(this.store.path, (e as Error).message);
          }
          this.ledger = ledger;
          this.passphrases.set(p);
          new Notice(t.notices.ledgerCreated(this.store.path));
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
        new Notice(t.recurring.posted(posted));
      }
      return null;
    } catch (e) {
      if (e instanceof WrongPassphraseError) return t.notices.wrongPassphrase;
      if (e instanceof InvalidEnvelopeError) return t.notices.invalidFile(e.message);
      return t.notices.openFailed((e as Error).message);
    }
  }

  private async reloadIfExternal() {
    const text = await this.store.readRaw();
    if (text === null || this.store.isOwnWrite(text)) return;
    const pass = this.passphrases.get();
    if (!pass || (await this.tryLoad(pass)) !== null) {
      this.lock();
      new Notice(t.notices.reloadFailed);
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
      new Notice(t.notices.saveFailed((e as Error).message));
    }
  }

  /** Whether anything can be synced: bank sync or quotes are set up. */
  canSync(): boolean {
    return !!(this.ledger?.pluggy || this.ledger?.brapi);
  }

  private async afterUnlock() {
    if (this.translateOnUnlock) {
      // ledgers created before the language setting have English starter names
      this.translateOnUnlock = false;
      await this.mutate((l) => translateDefaults(l, LANGUAGES.en, t));
      await this.saveSettings();
    }
    this.autoSync();
  }

  private autoSync() {
    const l = this.ledger;
    if (!l) return;
    // no snapshot = investments never synced (e.g. right after upgrading), so don't wait for the interval
    const bankDue = !!l.pluggy && (l.investments.snapshots.length === 0 || olderThan(l.pluggy.lastSync, AUTO_SYNC_INTERVAL_MS));
    const quotesDue = !!l.brapi && olderThan(l.brapi.lastUpdate, QUOTES_INTERVAL_MS);
    if (bankDue || quotesDue) void this.sync(true, bankDue);
  }

  /**
   * Pull bank data from Pluggy (when `bank`) and then quotes from brapi, for
   * whichever is set up. `quiet` skips the notices when nothing changed.
   */
  sync(quiet = false, bank = true): Promise<void> {
    if (!this.syncing) {
      this.syncing = (async () => {
        if (!this.canSync()) {
          new Notice(t.notices.setupSyncFirst);
          return;
        }
        if (bank && this.ledger?.pluggy) await this.syncBank(quiet);
        if (this.ledger?.brapi) await this.refreshQuotes(quiet);
      })().finally(() => {
        this.syncing = null;
        this.refreshViews();
      });
      // render only once `this.syncing` is set, so the button starts spinning right away
      this.refreshViews();
    }
    return this.syncing;
  }

  isSyncing(): boolean {
    return this.syncing !== null;
  }

  private async syncBank(quiet: boolean) {
    const config = this.ledger?.pluggy;
    if (!config) return;
    const now = new Date();
    const windowStart = toISODate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - SYNC_WINDOW_DAYS));
    let data;
    try {
      data = await fetchBankData(config, windowStart);
    } catch (e) {
      new Notice(t.notices.syncFailed((e as Error).message));
      return;
    }
    let summary = "";
    await this.mutate((ledger) => {
      if (!ledger.pluggy) return;
      const r = applyBankData(ledger, data.bank, windowStart, todayISO(now));
      const inv = applyInvestments(ledger, data.investments.investments, data.investments.itemIds, todayISO(now));
      ledger.pluggy.lastSync = now.toISOString();
      const n = t.notices;
      const parts = [
        r.accountsCreated && n.newAccounts(r.accountsCreated),
        r.added && n.added(r.added),
        r.updated && n.updated(r.updated),
        r.removed && n.removed(r.removed),
        inv.added && n.newInvestments(inv.added),
        inv.closed && n.closedInvestments(inv.closed),
        inv.movements && n.investmentMovements(inv.movements),
      ].filter((x): x is string => !!x);
      // say when Pluggy reports no investments at all, so an empty Investments tab is explainable
      if (!quiet && !data.investments.errors.length && data.investments.investments.length === 0) {
        parts.push(n.noInvestments(data.investments.itemIds.length));
      }
      summary = parts.length ? n.syncSummary(parts) : quiet ? "" : n.syncUpToDate;
    });
    if (summary) new Notice(summary);
    // investments are optional per item, but a failure must not pass silently
    if (data.investments.errors.length) new Notice(t.notices.investmentErrors(data.investments.errors.join("; ")));
  }

  /** Quote every open position with a B3 ticker. */
  private async refreshQuotes(quiet: boolean) {
    const config = this.ledger?.brapi;
    if (!config || !this.ledger) return;
    const tickers = quoteTickers(this.ledger);
    let result;
    try {
      result = tickers.length ? await fetchQuotes(config.token, tickers) : { quotes: [], errors: [] };
    } catch (e) {
      new Notice(t.notices.quotesFailed((e as Error).message));
      return;
    }
    const now = new Date();
    let changed = 0;
    await this.mutate((l) => {
      changed = applyQuotes(l, result.quotes, todayISO(now));
      if (l.brapi) l.brapi.lastUpdate = now.toISOString();
    });
    if (!quiet && changed) new Notice(t.notices.quotesUpdated(changed));
    if (result.errors.length) new Notice(t.notices.quotesFailed(result.errors.join("; ")));
  }

  /**
   * CDI/IPCA since `from`, cached for the day. When missing, starts a fetch that
   * re-renders the views when it lands, and returns what it has meanwhile (null
   * when turned off or never loaded).
   */
  benchmarks(from: string): Benchmarks | null {
    if (!this.settings.benchmarks) return null;
    const today = todayISO();
    const cached = this.benchmarkCache;
    if (cached && cached.day === today && cached.from <= from) return cached.data;
    if (!this.benchmarkLoading && Date.now() - this.benchmarkFailedAt > BENCHMARK_RETRY_MS) void this.loadBenchmarks(from, today);
    return cached?.data ?? null;
  }

  private async loadBenchmarks(from: string, today: string) {
    this.benchmarkLoading = true;
    const floor = toISODate(new Date(Date.now() - BENCHMARK_MAX_DAYS * 86_400_000));
    try {
      this.benchmarkCache = { from, day: today, data: await fetchBenchmarks(from < floor ? floor : from, today) };
      this.benchmarkError = null;
    } catch (e) {
      this.benchmarkFailedAt = Date.now();
      this.benchmarkError = (e as Error).message;
    } finally {
      this.benchmarkLoading = false;
      this.refreshViews();
    }
  }

  changePassphrase() {
    if (!this.ledger) {
      new Notice(t.notices.unlockFirst);
      return;
    }
    new PassphraseModal(this.app, "change", async (p) => {
      if (!this.ledger) return t.notices.lockedWhileChanging;
      try {
        await this.store.rekey(this.ledger, p);
      } catch (e) {
        return t.notices.reencryptFailed((e as Error).message);
      }
      this.passphrases.set(p);
      new Notice(t.notices.passphraseChanged);
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
    const s = t.settings;
    containerEl.empty();

    new Setting(containerEl)
      .setName(s.language)
      .setDesc(s.languageDesc)
      .addDropdown((d) =>
        d
          .addOptions(LANGUAGE_NAMES)
          .setValue(p.settings.language)
          .onChange(async (v) => {
            await p.setLanguage(v as Language);
            this.display();
          })
      );

    new Setting(containerEl).setName(s.security).setHeading();
    containerEl.createEl("p", { cls: "trimly-warning", text: s.securityWarning });

    new Setting(containerEl)
      .setName(s.status)
      .setDesc(p.ledger ? s.unlockedAt(p.store.path) : p.store.exists() ? s.locked : s.noLedger)
      .addButton((b) =>
        p.ledger
          ? b.setButtonText(s.lockNow).onClick(() => {
              p.lock();
              this.display();
            })
          : b
              .setButtonText(p.store.exists() ? s.unlock : s.createLedger)
              .setCta()
              .onClick(async () => {
                await p.unlock();
                this.display();
              })
      );

    new Setting(containerEl)
      .setName(s.remember)
      .setDesc(s.rememberDesc)
      .addToggle((tg) =>
        tg.setValue(p.settings.rememberPassphrase).onChange(async (v) => {
          p.settings.rememberPassphrase = v;
          await p.saveSettings();
          p.passphrases.syncRemember();
        })
      );

    new Setting(containerEl)
      .setName(s.change)
      .setDesc(s.changeDesc)
      .addButton((b) => b.setButtonText(s.changeButton).onClick(() => p.changePassphrase()));

    new Setting(containerEl)
      .setName(s.forget)
      .setDesc(s.forgetDesc)
      .addButton((b) =>
        b
          .setButtonText(s.forgetButton)
          .setWarning()
          .onClick(() =>
            new ConfirmModal(this.app, s.forgetConfirm, s.forgetButton, () => {
              p.passphrases.forget();
              p.lock();
              this.display();
            }).open()
          )
      );

    new Setting(containerEl).setName(s.storage).setHeading();

    new Setting(containerEl)
      .setName(s.folder)
      .setDesc(s.folderDesc)
      .addText((text) =>
        text
          .setPlaceholder("Trimly")
          .setValue(p.settings.folder)
          .onChange(async (v) => {
            p.settings.folder = v.trim().replace(/^\/+|\/+$/g, "") || "Trimly";
            await p.saveSettings();
            p.lock();
          })
      );

    new Setting(containerEl)
      .setName(s.currency)
      .setDesc(s.currencyDesc)
      .addText((text) =>
        text.setValue(p.settings.currency).onChange(async (v) => {
          const code = v.trim().toUpperCase();
          if (!/^[A-Z]{3}$/.test(code)) return;
          p.settings.currency = code;
          await p.saveSettings();
          p.refreshViews();
        })
      );

    new Setting(containerEl).setName(s.investments).setHeading();
    new Setting(containerEl)
      .setName(s.benchmarks)
      .setDesc(s.benchmarksDesc)
      .addToggle((tg) =>
        tg.setValue(p.settings.benchmarks).onChange(async (v) => {
          p.settings.benchmarks = v;
          await p.saveSettings();
          p.refreshViews();
        })
      );

    this.displayQuotes();
    this.displayBankSync();
  }

  private displayQuotes() {
    const { containerEl } = this;
    const p = this.plugin;
    const s = t.settings;
    new Setting(containerEl).setName(s.quotes).setHeading();
    containerEl.createEl("p", { cls: "setting-item-description", text: s.quotesIntro });
    if (!p.ledger) {
      new Setting(containerEl).setDesc(s.unlockForSync);
      return;
    }
    const config = p.ledger.brapi;
    let token = config?.token ?? "";
    new Setting(containerEl)
      .setName(s.quotesToken)
      .setDesc(s.quotesTokenDesc)
      .addText((text) => {
        text.inputEl.type = "password";
        text.setValue(token).onChange((v) => (token = v.trim()));
      });
    new Setting(containerEl)
      .setName(s.status)
      .setDesc(s.quotesStatus(config?.lastUpdate ? p.formatDateTime(config.lastUpdate) : null))
      .addButton((b) =>
        b
          .setButtonText(s.quotesSave)
          .setCta()
          .onClick(async () => {
            if (!token) {
              new Notice(t.notices.fillBrapi);
              return;
            }
            await p.mutate((l) => {
              l.brapi = { ...l.brapi, token };
            });
            await p.sync(false, false);
            this.display();
          })
      );
    if (!config) return;
    new Setting(containerEl)
      .setName(s.quotesRemove)
      .setDesc(s.quotesRemoveDesc)
      .addButton((b) =>
        b
          .setButtonText(s.quotesRemove)
          .setWarning()
          .onClick(() =>
            new ConfirmModal(this.app, s.quotesRemoveConfirm, s.quotesRemove, () => {
              void p.mutate((l) => delete l.brapi).then(() => this.display());
            }).open()
          )
      );
  }

  private displayBankSync() {
    const { containerEl } = this;
    const p = this.plugin;
    const s = t.settings;
    new Setting(containerEl).setName(s.bankSync).setHeading();
    containerEl.createEl("p", { cls: "setting-item-description", text: s.bankSyncIntro });
    if (!p.ledger) {
      new Setting(containerEl).setDesc(s.unlockForSync);
      return;
    }

    const config = p.ledger.pluggy;
    const draft = {
      clientId: config?.clientId ?? "",
      clientSecret: config?.clientSecret ?? "",
      itemIds: config?.itemIds.join(", ") ?? "",
    };
    new Setting(containerEl)
      .setName(s.clientId)
      .setDesc(s.clientIdDesc)
      .addText((text) => text.setValue(draft.clientId).onChange((v) => (draft.clientId = v.trim())));
    new Setting(containerEl).setName(s.clientSecret).addText((text) => {
      text.inputEl.type = "password";
      text.setValue(draft.clientSecret).onChange((v) => (draft.clientSecret = v.trim()));
    });
    new Setting(containerEl)
      .setName(s.itemIds)
      .setDesc(s.itemIdsDesc)
      .addText((text) => text.setValue(draft.itemIds).onChange((v) => (draft.itemIds = v)));

    new Setting(containerEl)
      .setName(config ? s.status : s.connect)
      .setDesc(config ? (config.lastSync ? s.lastSynced(p.formatDateTime(config.lastSync)) : s.notSynced) : s.connectDesc)
      .addButton((b) =>
        b
          .setButtonText(config ? s.saveAndSync : s.connect)
          .setCta()
          .onClick(async () => {
            const itemIds = draft.itemIds.split(/[\s,]+/).filter(Boolean);
            if (!draft.clientId || !draft.clientSecret || !itemIds.length) {
              new Notice(t.notices.fillPluggy);
              return;
            }
            await p.mutate((l) => {
              l.pluggy = { ...l.pluggy, clientId: draft.clientId, clientSecret: draft.clientSecret, itemIds };
            });
            await p.sync();
            this.display();
          })
      );

    if (!config) return;
    new Setting(containerEl)
      .setName(s.disconnect)
      .setDesc(s.disconnectDesc)
      .addButton((b) =>
        b
          .setButtonText(s.disconnect)
          .setWarning()
          .onClick(() =>
            new ConfirmModal(this.app, s.disconnectConfirm, s.disconnect, () => {
              void p.mutate((l) => delete l.pluggy).then(() => this.display());
            }).open()
          )
      );
  }
}
