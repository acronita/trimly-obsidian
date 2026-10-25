import { App, Modal, Setting, setIcon } from "obsidian";
import { t } from "./i18n";
import {
  Account,
  Asset,
  AssetClass,
  CATEGORY_ICONS,
  AccountType,
  Category,
  CategoryKind,
  Frequency,
  Ledger,
  Movement,
  MovementType,
  Recurring,
  Transaction,
  TxType,
  centsToInput,
  newId,
  parseAmount,
  todayISO,
} from "./ledger";

const TYPE_ICONS: Record<TxType, string> = { expense: "arrow-up-right", income: "arrow-down-left", transfer: "arrow-left-right" };

export type PassphraseMode = "unlock" | "create" | "change";

/**
 * Asks for the passphrase. `submit` validates it (e.g. by trying to decrypt)
 * and returns an error message to show, or null to close.
 */
export class PassphraseModal extends Modal {
  private value = "";
  private confirm = "";
  private errorEl!: HTMLElement;
  private firstInput: HTMLInputElement | null = null;

  constructor(
    app: App,
    private mode: PassphraseMode,
    private submit: (passphrase: string) => Promise<string | null>,
    private onCancel: () => void = () => {}
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("trimly-modal");
    this.setTitle(t.modals.passphrase[this.mode]);

    if (this.mode !== "unlock") {
      contentEl.createEl("p", {
        cls: "trimly-warning",
        text: t.modals.passphrase.warning,
      });
    }

    new Setting(contentEl).setName(this.mode === "change" ? t.modals.passphrase.newPassphrase : t.modals.passphrase.passphrase).addText((text) => {
      text.inputEl.type = "password";
      text.inputEl.autocomplete = "off";
      text.onChange((v) => (this.value = v));
      this.firstInput = text.inputEl;
    });
    if (this.mode !== "unlock") {
      new Setting(contentEl).setName(t.modals.passphrase.confirm).addText((text) => {
        text.inputEl.type = "password";
        text.inputEl.autocomplete = "off";
        text.onChange((v) => (this.confirm = v));
      });
    }
    this.errorEl = contentEl.createEl("p", { cls: "trimly-error" });

    const go = () => void this.trySubmit();
    contentEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        go();
      }
    });
    new Setting(contentEl).addButton((b) =>
      b
        .setButtonText(this.mode === "unlock" ? t.modals.passphrase.unlockButton : t.common.save)
        .setCta()
        .onClick(go)
    );
    window.setTimeout(() => this.firstInput?.focus(), 0);
  }

  private submitted = false;

  private async trySubmit() {
    if (this.mode !== "unlock") {
      if (this.value.length < 8) return this.showError(t.modals.passphrase.tooShort);
      if (this.value !== this.confirm) return this.showError(t.modals.passphrase.mismatch);
    } else if (!this.value) {
      return this.showError(t.modals.passphrase.enter);
    }
    this.showError(this.mode === "unlock" ? t.modals.passphrase.unlocking : t.modals.passphrase.encrypting);
    const err = await this.submit(this.value);
    if (err) return this.showError(err);
    this.submitted = true;
    this.close();
  }

  private showError(msg: string) {
    this.errorEl.setText(msg);
  }

  onClose() {
    this.contentEl.empty();
    if (!this.submitted) this.onCancel();
  }
}

export class ConfirmModal extends Modal {
  constructor(app: App, private message: string, private cta: string, private onConfirm: () => void) {
    super(app);
  }

  onOpen() {
    this.contentEl.createEl("p", { text: this.message });
    new Setting(this.contentEl)
      .addButton((b) => b.setButtonText(t.common.cancel).onClick(() => this.close()))
      .addButton((b) =>
        b
          .setButtonText(this.cta)
          .setWarning()
          .onClick(() => {
            this.close();
            this.onConfirm();
          })
      );
  }

  onClose() {
    this.contentEl.empty();
  }
}

function dateSetting(container: HTMLElement, name: string, initial: string, onChange: (v: string) => void) {
  new Setting(container).setName(name).addText((text) => {
    text.inputEl.type = "date";
    text.setValue(initial);
    text.onChange(onChange);
  });
}

function accountOptions(ledger: Ledger, current?: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of ledger.accounts) if (!a.archived || a.id === current) out[a.id] = a.name;
  return out;
}

function categoryOptions(ledger: Ledger, kind: CategoryKind): Record<string, string> {
  const out: Record<string, string> = { "": t.common.uncategorized };
  for (const c of ledger.categories) if (c.kind === kind) out[c.id] = c.name;
  return out;
}

/** Shared editor for anything shaped like a transaction (transactions and recurring rules). */
interface TxLike {
  type: TxType;
  amount: number;
  accountId: string;
  toAccountId?: string;
  categoryId?: string;
  description: string;
}

function validateTxLike(d: TxLike): string | null {
  if (!d.description.trim()) return t.modals.tx.addDescription;
  if (!(d.amount > 0)) return t.common.amountPositive;
  if (!d.accountId) return t.modals.tx.pickAccount;
  if (d.type === "transfer" && (!d.toAccountId || d.toAccountId === d.accountId)) {
    return t.modals.tx.pickOtherAccount;
  }
  return null;
}

function renderTxLikeFields(container: HTMLElement, ledger: Ledger, draft: TxLike, rerender: () => void) {
  const hero = container.createDiv(`trimly-tx-hero is-${draft.type}`);
  const seg = hero.createDiv("trimly-segmented");
  for (const type of Object.keys(TYPE_ICONS) as TxType[]) {
    const b = seg.createEl("button", { cls: `is-${type}` });
    setIcon(b.createSpan("trimly-seg-icon"), TYPE_ICONS[type]);
    b.createSpan({ text: t.labels.txType[type] });
    if (type === draft.type) b.addClass("is-active");
    b.addEventListener("click", () => {
      if (draft.type === type) return;
      draft.type = type;
      draft.categoryId = undefined;
      rerender();
    });
  }
  const amount = hero.createEl("input", { cls: "trimly-amount-input", type: "text", placeholder: "0,00" });
  amount.inputMode = "decimal";
  if (draft.amount) amount.value = centsToInput(draft.amount);
  amount.addEventListener("input", () => {
    const cents = parseAmount(amount.value);
    amount.toggleClass("trimly-invalid", cents === null && amount.value.trim() !== "");
    if (cents !== null) draft.amount = Math.abs(cents);
  });
  window.setTimeout(() => amount.focus(), 0);

  new Setting(container).setName(t.modals.tx.description).addText((text) =>
    text
      .setPlaceholder(
        draft.type === "income" ? t.modals.tx.placeholderIncome : draft.type === "transfer" ? t.modals.tx.placeholderTransfer : t.modals.tx.placeholderExpense
      )
      .setValue(draft.description)
      .onChange((v) => (draft.description = v))
  );
  new Setting(container).setName(draft.type === "transfer" ? t.modals.tx.fromAccount : t.modals.tx.account).addDropdown((d) =>
    d
      .addOptions(accountOptions(ledger, draft.accountId))
      .setValue(draft.accountId)
      .onChange((v) => (draft.accountId = v))
  );
  if (draft.type === "transfer") {
    if (!draft.toAccountId) draft.toAccountId = ledger.accounts.find((a) => a.id !== draft.accountId && !a.archived)?.id;
    new Setting(container).setName(t.modals.tx.toAccount).addDropdown((d) =>
      d
        .addOptions(accountOptions(ledger, draft.toAccountId))
        .setValue(draft.toAccountId ?? "")
        .onChange((v) => (draft.toAccountId = v))
    );
  } else {
    new Setting(container).setName(t.modals.tx.category).addDropdown((d) =>
      d
        .addOptions(categoryOptions(ledger, draft.type as CategoryKind))
        .setValue(draft.categoryId ?? "")
        .onChange((v) => (draft.categoryId = v || undefined))
    );
  }
}

function footer(
  container: HTMLElement,
  errorEl: HTMLElement,
  onSave: () => string | null,
  onDelete: (() => void) | null,
  close: () => void
) {
  const s = new Setting(container);
  if (onDelete) {
    s.addButton((b) =>
      b
        .setButtonText(t.common.delete)
        .setWarning()
        .onClick(() => {
          close();
          onDelete();
        })
    );
  }
  s.addButton((b) =>
    b
      .setButtonText(t.common.save)
      .setCta()
      .onClick(() => {
        const err = onSave();
        if (err) errorEl.setText(err);
        else close();
      })
  );
}

export class TransactionModal extends Modal {
  private draft: Transaction;

  constructor(
    app: App,
    private ledger: Ledger,
    existing: Transaction | null,
    private onSave: (tx: Transaction) => void,
    private onDelete: ((tx: Transaction) => void) | null
  ) {
    super(app);
    const firstAccount = ledger.accounts.find((a) => !a.archived)?.id ?? "";
    this.draft = existing
      ? { ...existing }
      : { id: newId(), date: todayISO(), type: "expense", amount: 0, accountId: firstAccount, description: "" };
  }

  onOpen() {
    this.setTitle(this.onDelete ? t.modals.tx.editTitle : t.modals.tx.newTitle);
    this.render();
  }

  private render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("trimly-modal");
    renderTxLikeFields(contentEl, this.ledger, this.draft, () => this.render());
    dateSetting(contentEl, t.modals.tx.date, this.draft.date, (v) => (this.draft.date = v));
    new Setting(contentEl).setName(t.modals.tx.notes).addTextArea((text) =>
      text.setValue(this.draft.notes ?? "").onChange((v) => (this.draft.notes = v || undefined))
    );
    const errorEl = contentEl.createEl("p", { cls: "trimly-error" });
    footer(
      contentEl,
      errorEl,
      () => {
        const err = validateTxLike(this.draft) ?? (this.draft.date ? null : t.common.pickDate);
        if (err) return err;
        if (this.draft.type !== "transfer") delete this.draft.toAccountId;
        else delete this.draft.categoryId;
        this.draft.description = this.draft.description.trim();
        this.onSave(this.draft);
        return null;
      },
      this.onDelete ? () => this.onDelete?.(this.draft) : null,
      () => this.close()
    );
  }

  onClose() {
    this.contentEl.empty();
  }
}

export class RecurringModal extends Modal {
  private draft: Recurring;

  constructor(
    app: App,
    private ledger: Ledger,
    existing: Recurring | null,
    private onSave: (r: Recurring) => void,
    private onDelete: ((r: Recurring) => void) | null
  ) {
    super(app);
    const firstAccount = ledger.accounts.find((a) => !a.archived)?.id ?? "";
    const today = todayISO();
    this.draft = existing
      ? { ...existing }
      : {
          id: newId(),
          description: "",
          type: "expense",
          amount: 0,
          accountId: firstAccount,
          frequency: "monthly",
          startDate: today,
          nextDate: today,
        };
  }

  onOpen() {
    this.setTitle(this.onDelete ? t.modals.tx.editRecurring : t.modals.tx.newRecurring);
    this.render();
  }

  private render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("trimly-modal");
    renderTxLikeFields(contentEl, this.ledger, this.draft, () => this.render());
    new Setting(contentEl).setName(t.modals.tx.repeats).addDropdown((d) =>
      d
        .addOptions(t.labels.frequency)
        .setValue(this.draft.frequency)
        .onChange((v) => (this.draft.frequency = v as Frequency))
    );
    const isNew = !this.onDelete;
    dateSetting(contentEl, isNew ? t.modals.tx.firstDate : t.modals.tx.nextDate, isNew ? this.draft.startDate : this.draft.nextDate, (v) => {
      if (isNew) this.draft.startDate = v;
      this.draft.nextDate = v;
    });
    dateSetting(contentEl, t.modals.tx.endDate, this.draft.endDate ?? "", (v) => (this.draft.endDate = v || undefined));
    contentEl.createEl("p", {
      cls: "setting-item-description",
      text: t.modals.tx.recurringHint,
    });
    const errorEl = contentEl.createEl("p", { cls: "trimly-error" });
    footer(
      contentEl,
      errorEl,
      () => {
        const err = validateTxLike(this.draft) ?? (this.draft.nextDate ? null : t.common.pickDate);
        if (err) return err;
        if (this.draft.type !== "transfer") delete this.draft.toAccountId;
        else delete this.draft.categoryId;
        this.draft.description = this.draft.description.trim();
        this.onSave(this.draft);
        return null;
      },
      this.onDelete ? () => this.onDelete?.(this.draft) : null,
      () => this.close()
    );
  }

  onClose() {
    this.contentEl.empty();
  }
}

export class AccountModal extends Modal {
  private draft: Account;

  constructor(
    app: App,
    existing: Account | null,
    private onSave: (a: Account) => void,
    private onDelete: ((a: Account) => void) | null
  ) {
    super(app);
    this.draft = existing ? { ...existing } : { id: newId(), name: "", type: "checking", openingBalance: 0 };
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("trimly-modal");
    this.setTitle(this.onDelete ? t.modals.account.editTitle : t.modals.account.newTitle);
    new Setting(contentEl).setName(t.modals.account.name).addText((text) => text.setValue(this.draft.name).onChange((v) => (this.draft.name = v)));
    new Setting(contentEl).setName(t.modals.account.type).addDropdown((d) =>
      d
        .addOptions(t.labels.accountType)
        .setValue(this.draft.type)
        .onChange((v) => (this.draft.type = v as AccountType))
    );
    new Setting(contentEl)
      .setName(t.modals.account.opening)
      .setDesc(t.modals.account.openingDesc)
      .addText((text) => {
        text.inputEl.inputMode = "decimal";
        text.setValue(centsToInput(this.draft.openingBalance)).onChange((v) => {
          const c = parseAmount(v);
          if (c !== null) this.draft.openingBalance = c;
        });
      });
    new Setting(contentEl)
      .setName(t.modals.account.archived)
      .setDesc(t.modals.account.archivedDesc)
      .addToggle((tg) => tg.setValue(!!this.draft.archived).onChange((v) => (this.draft.archived = v || undefined)));
    const errorEl = contentEl.createEl("p", { cls: "trimly-error" });
    footer(
      contentEl,
      errorEl,
      () => {
        if (!this.draft.name.trim()) return t.common.addName;
        this.draft.name = this.draft.name.trim();
        this.onSave(this.draft);
        return null;
      },
      this.onDelete ? () => this.onDelete?.(this.draft) : null,
      () => this.close()
    );
  }

  onClose() {
    this.contentEl.empty();
  }
}

const rateTypes = (): Record<string, string> => ({
  "": t.modals.asset.indexNone,
  CDI: "CDI",
  SELIC: "Selic",
  IPCA: "IPCA",
  IGPM: "IGP-M",
  DOLAR: t.modals.asset.indexDollar,
});

/** Plain decimal like "110", "5,5" or "0.25"; undefined when empty, null when not a number. */
function parseDecimal(input: string): number | undefined | null {
  const s = input.trim().replace(",", ".");
  if (!s) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function decimalSetting(
  container: HTMLElement,
  name: string,
  desc: string,
  initial: number | undefined,
  onChange: (v: number | undefined | null) => void
) {
  new Setting(container)
    .setName(name)
    .setDesc(desc)
    .addText((text) => {
      text.inputEl.inputMode = "decimal";
      text.setValue(initial === undefined ? "" : String(initial)).onChange((v) => onChange(parseDecimal(v)));
    });
}

function moneySetting(
  container: HTMLElement,
  name: string,
  desc: string,
  initial: number | undefined,
  onChange: (cents: number | undefined | null) => void
) {
  new Setting(container)
    .setName(name)
    .setDesc(desc)
    .addText((text) => {
      text.inputEl.inputMode = "decimal";
      text.setPlaceholder("0,00");
      text.setValue(initial === undefined ? "" : centsToInput(initial)).onChange((v) => onChange(v.trim() ? parseAmount(v) : undefined));
    });
}

/** Edits a position. Synced positions only allow renaming and reclassifying; their numbers come from bank sync. */
export class AssetModal extends Modal {
  private draft: Asset;
  /** fields whose text is not a valid number */
  private invalid = new Set<string>();

  constructor(
    app: App,
    existing: Asset | null,
    private onSave: (a: Asset) => void,
    private onDelete: ((a: Asset) => void) | null
  ) {
    super(app);
    this.draft = existing ? { ...existing } : { id: newId(), name: "", assetClass: "fixed_income", value: 0, updatedAt: todayISO() };
  }

  private field<T>(key: string, v: T | null, set: (v: T) => void) {
    if (v === null) this.invalid.add(key);
    else {
      this.invalid.delete(key);
      set(v);
    }
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("trimly-modal");
    const d = this.draft;
    const synced = !!d.pluggyId;
    const a = t.modals.asset;
    this.setTitle(this.onDelete || synced ? a.editTitle : a.newTitle);
    new Setting(contentEl)
      .setName(a.name)
      .addText((text) => text.setPlaceholder(a.namePlaceholder).setValue(d.name).onChange((v) => (d.name = v)));
    new Setting(contentEl).setName(a.class).addDropdown((dd) =>
      dd
        .addOptions(t.labels.assetClass)
        .setValue(d.assetClass)
        .onChange((v) => (d.assetClass = v as AssetClass))
    );
    if (synced) {
      contentEl.createEl("p", {
        cls: "setting-item-description",
        text: a.syncedNote,
      });
    } else {
      new Setting(contentEl)
        .setName(a.code)
        .setDesc(a.codeDesc)
        .addText((text) =>
          text
            .setPlaceholder(a.optional)
            .setValue(d.code ?? "")
            .onChange((v) => (d.code = v.trim().toUpperCase() || undefined))
        );
      new Setting(contentEl)
        .setName(a.institution)
        .addText((text) =>
          text
            .setPlaceholder(a.institutionPlaceholder)
            .setValue(d.institution ?? "")
            .onChange((v) => (d.institution = v.trim() || undefined))
        );
      moneySetting(contentEl, a.value, a.valueDesc, this.onDelete ? d.value : undefined, (c) =>
        this.field("value", c === undefined ? null : c, (v) => (d.value = Math.abs(v)))
      );
      moneySetting(contentEl, a.invested, a.investedDesc, d.invested, (c) =>
        this.field("invested", c, (v) => (d.invested = v === undefined ? undefined : Math.abs(v)))
      );
      decimalSetting(contentEl, a.quantity, a.quantityDesc, d.quantity, (n) => this.field("quantity", n, (v) => (d.quantity = v)));
      new Setting(contentEl)
        .setName(a.index)
        .setDesc(a.indexDesc)
        .addDropdown((dd) =>
          dd
            .addOptions(rateTypes())
            .setValue(d.rateType ?? "")
            .onChange((v) => (d.rateType = v || undefined))
        );
      decimalSetting(contentEl, a.rate, a.rateDesc, d.rate, (n) => this.field("rate", n, (v) => (d.rate = v)));
      decimalSetting(contentEl, a.fixedRate, a.fixedRateDesc, d.fixedRate, (n) =>
        this.field("fixedRate", n, (v) => (d.fixedRate = v))
      );
      dateSetting(contentEl, a.maturity, d.dueDate ?? "", (v) => (d.dueDate = v || undefined));
      if (this.onDelete) {
        new Setting(contentEl)
          .setName(a.closed)
          .setDesc(a.closedDesc)
          .addToggle((tg) => tg.setValue(!!d.closed).onChange((v) => (d.closed = v || undefined)));
      }
    }
    const errorEl = contentEl.createEl("p", { cls: "trimly-error" });
    footer(
      contentEl,
      errorEl,
      () => {
        if (!d.name.trim()) return t.common.addName;
        if (this.invalid.size) return t.common.fixInvalidNumbers;
        if (!synced && !this.onDelete && !(d.value > 0)) return a.enterValue;
        d.name = d.name.trim();
        this.onSave(d);
        return null;
      },
      this.onDelete ? () => this.onDelete?.(d) : null,
      () => this.close()
    );
  }

  onClose() {
    this.contentEl.empty();
  }
}

/** Records a movement on a manual position. */
export class MovementModal extends Modal {
  private draft: Movement;

  constructor(
    app: App,
    private ledger: Ledger,
    existing: Movement | null,
    private onSave: (m: Movement) => void,
    private onDelete: ((m: Movement) => void) | null,
    assetId?: string
  ) {
    super(app);
    const first = assetId ?? ledger.investments.assets.find((a) => !a.pluggyId && !a.closed)?.id ?? "";
    this.draft = existing ? { ...existing } : { id: newId(), assetId: first, date: todayISO(), type: "buy", amount: 0 };
  }

  onOpen() {
    this.setTitle(this.onDelete ? t.modals.movement.editTitle : t.modals.movement.newTitle);
    this.render();
  }

  private render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("trimly-modal");
    const d = this.draft;
    const m = t.modals.movement;
    const positions: Record<string, string> = {};
    for (const a of this.ledger.investments.assets) if (!a.pluggyId && (!a.closed || a.id === d.assetId)) positions[a.id] = a.name;
    new Setting(contentEl).setName(m.position).addDropdown((dd) =>
      dd
        .addOptions(positions)
        .setValue(d.assetId)
        .onChange((v) => (d.assetId = v))
    );
    new Setting(contentEl).setName(m.type).addDropdown((dd) =>
      dd
        .addOptions(t.labels.movement)
        .setValue(d.type)
        .onChange((v) => {
          d.type = v as MovementType;
          if (d.type === "transfer") d.direction = d.direction ?? "in";
          else delete d.direction;
          this.render();
        })
    );
    if (d.type === "transfer") {
      new Setting(contentEl).setName(m.direction).addDropdown((dd) =>
        dd
          .addOptions({ in: m.into, out: m.outOf })
          .setValue(d.direction ?? "in")
          .onChange((v) => (d.direction = v as "in" | "out"))
      );
    }
    let amountInvalid = false;
    moneySetting(contentEl, m.amount, m.amountDesc, d.amount || undefined, (c) => {
      amountInvalid = c === null;
      if (c) d.amount = Math.abs(c);
    });
    let quantityInvalid = false;
    if (d.type !== "income" && d.type !== "tax") {
      decimalSetting(contentEl, m.quantity, m.quantityDesc, d.quantity, (n) => {
        quantityInvalid = n === null;
        if (n !== null) d.quantity = n === undefined ? undefined : Math.abs(n);
      });
    }
    dateSetting(contentEl, m.date, d.date, (v) => (d.date = v));
    new Setting(contentEl)
      .setName(m.description)
      .addText((text) => text.setValue(d.description ?? "").onChange((v) => (d.description = v.trim() || undefined)));
    contentEl.createEl("p", {
      cls: "setting-item-description",
      text: d.type === "income" ? m.incomeHint : m.effectHint,
    });
    const errorEl = contentEl.createEl("p", { cls: "trimly-error" });
    footer(
      contentEl,
      errorEl,
      () => {
        if (!d.assetId) return m.addManualFirst;
        if (amountInvalid || quantityInvalid) return t.common.fixInvalidNumbers;
        if (!(d.amount > 0)) return t.common.amountPositive;
        if (!d.date) return t.common.pickDate;
        if (d.type === "income" || d.type === "tax") delete d.quantity;
        this.onSave(d);
        return null;
      },
      this.onDelete ? () => this.onDelete?.(d) : null,
      () => this.close()
    );
  }

  onClose() {
    this.contentEl.empty();
  }
}

export class CategoryModal extends Modal {
  private draft: Category;

  constructor(
    app: App,
    existing: Category | null,
    kind: CategoryKind,
    private onSave: (c: Category) => void,
    private onDelete: ((c: Category) => void) | null
  ) {
    super(app);
    this.draft = existing ? { ...existing } : { id: newId(), name: "", kind, color: "#5b8def", icon: "tag" };
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("trimly-modal");
    this.setTitle(this.onDelete ? t.modals.category.editTitle : t.modals.category.newTitle);
    new Setting(contentEl).setName(t.modals.category.name).addText((text) => text.setValue(this.draft.name).onChange((v) => (this.draft.name = v)));
    new Setting(contentEl).setName(t.modals.category.kind).addDropdown((d) =>
      d
        .addOptions({ expense: t.modals.category.kindExpense, income: t.modals.category.kindIncome })
        .setValue(this.draft.kind)
        .onChange((v) => (this.draft.kind = v as CategoryKind))
    );
    new Setting(contentEl).setName(t.modals.category.color).addColorPicker((c) =>
      c.setValue(this.draft.color).onChange((v) => {
        this.draft.color = v;
        grid.setCssProps({ "--trimly-color": v });
      })
    );
    new Setting(contentEl).setName(t.modals.category.icon).setClass("trimly-icon-setting");
    const grid = contentEl.createDiv("trimly-icon-grid");
    grid.setCssProps({ "--trimly-color": this.draft.color });
    for (const icon of CATEGORY_ICONS) {
      const b = grid.createEl("button", { cls: "trimly-icon-choice", attr: { "aria-label": icon } });
      setIcon(b, icon);
      if ((this.draft.icon ?? "tag") === icon) b.addClass("is-active");
      b.addEventListener("click", () => {
        this.draft.icon = icon;
        grid.querySelectorAll(".is-active").forEach((el) => el.removeClass("is-active"));
        b.addClass("is-active");
      });
    }
    const errorEl = contentEl.createEl("p", { cls: "trimly-error" });
    footer(
      contentEl,
      errorEl,
      () => {
        if (!this.draft.name.trim()) return t.common.addName;
        this.draft.name = this.draft.name.trim();
        this.onSave(this.draft);
        return null;
      },
      this.onDelete ? () => this.onDelete?.(this.draft) : null,
      () => this.close()
    );
  }

  onClose() {
    this.contentEl.empty();
  }
}
