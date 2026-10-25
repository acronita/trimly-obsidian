import { App, Modal, Setting, setIcon } from "obsidian";
import {
  ACCOUNT_TYPE_LABELS,
  ASSET_CLASS_LABELS,
  Account,
  Asset,
  AssetClass,
  CATEGORY_ICONS,
  AccountType,
  Category,
  CategoryKind,
  FREQUENCY_LABELS,
  Frequency,
  Ledger,
  MOVEMENT_LABELS,
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

const TYPE_LABELS: Record<TxType, string> = { expense: "Expense", income: "Income", transfer: "Transfer" };
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
    const titles: Record<PassphraseMode, string> = {
      unlock: "Unlock Trimly",
      create: "Create a passphrase",
      change: "Change passphrase",
    };
    this.setTitle(titles[this.mode]);

    if (this.mode !== "unlock") {
      contentEl.createEl("p", {
        cls: "trimly-warning",
        text:
          "Your financial data is encrypted with this passphrase. Save it somewhere safe, like a password manager: " +
          "if you lose it, your data cannot be recovered by anyone.",
      });
    }

    new Setting(contentEl).setName(this.mode === "change" ? "New passphrase" : "Passphrase").addText((t) => {
      t.inputEl.type = "password";
      t.inputEl.autocomplete = "off";
      t.onChange((v) => (this.value = v));
      this.firstInput = t.inputEl;
    });
    if (this.mode !== "unlock") {
      new Setting(contentEl).setName("Confirm passphrase").addText((t) => {
        t.inputEl.type = "password";
        t.inputEl.autocomplete = "off";
        t.onChange((v) => (this.confirm = v));
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
        .setButtonText(this.mode === "unlock" ? "Unlock" : "Save")
        .setCta()
        .onClick(go)
    );
    window.setTimeout(() => this.firstInput?.focus(), 0);
  }

  private submitted = false;

  private async trySubmit() {
    if (this.mode !== "unlock") {
      if (this.value.length < 8) return this.showError("Use at least 8 characters.");
      if (this.value !== this.confirm) return this.showError("Passphrases don't match.");
    } else if (!this.value) {
      return this.showError("Enter your passphrase.");
    }
    this.showError(this.mode === "unlock" ? "Unlocking…" : "Encrypting…");
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
      .addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
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
  new Setting(container).setName(name).addText((t) => {
    t.inputEl.type = "date";
    t.setValue(initial);
    t.onChange(onChange);
  });
}

function accountOptions(ledger: Ledger, current?: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of ledger.accounts) if (!a.archived || a.id === current) out[a.id] = a.name;
  return out;
}

function categoryOptions(ledger: Ledger, kind: CategoryKind): Record<string, string> {
  const out: Record<string, string> = { "": "Uncategorized" };
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

function validateTxLike(t: TxLike): string | null {
  if (!t.description.trim()) return "Add a description.";
  if (!(t.amount > 0)) return "Amount must be greater than zero.";
  if (!t.accountId) return "Pick an account.";
  if (t.type === "transfer" && (!t.toAccountId || t.toAccountId === t.accountId)) {
    return "Pick a different destination account.";
  }
  return null;
}

function renderTxLikeFields(container: HTMLElement, ledger: Ledger, draft: TxLike, rerender: () => void) {
  const hero = container.createDiv(`trimly-tx-hero is-${draft.type}`);
  const seg = hero.createDiv("trimly-segmented");
  for (const type of Object.keys(TYPE_LABELS) as TxType[]) {
    const b = seg.createEl("button", { cls: `is-${type}` });
    setIcon(b.createSpan("trimly-seg-icon"), TYPE_ICONS[type]);
    b.createSpan({ text: TYPE_LABELS[type] });
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

  new Setting(container).setName("Description").addText((t) =>
    t
      .setPlaceholder(draft.type === "income" ? "e.g. Salary" : draft.type === "transfer" ? "e.g. Savings" : "e.g. Supermarket")
      .setValue(draft.description)
      .onChange((v) => (draft.description = v))
  );
  new Setting(container).setName(draft.type === "transfer" ? "From account" : "Account").addDropdown((d) =>
    d
      .addOptions(accountOptions(ledger, draft.accountId))
      .setValue(draft.accountId)
      .onChange((v) => (draft.accountId = v))
  );
  if (draft.type === "transfer") {
    if (!draft.toAccountId) draft.toAccountId = ledger.accounts.find((a) => a.id !== draft.accountId && !a.archived)?.id;
    new Setting(container).setName("To account").addDropdown((d) =>
      d
        .addOptions(accountOptions(ledger, draft.toAccountId))
        .setValue(draft.toAccountId ?? "")
        .onChange((v) => (draft.toAccountId = v))
    );
  } else {
    new Setting(container).setName("Category").addDropdown((d) =>
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
        .setButtonText("Delete")
        .setWarning()
        .onClick(() => {
          close();
          onDelete();
        })
    );
  }
  s.addButton((b) =>
    b
      .setButtonText("Save")
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
    this.setTitle(this.onDelete ? "Edit transaction" : "New transaction");
    this.render();
  }

  private render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("trimly-modal");
    renderTxLikeFields(contentEl, this.ledger, this.draft, () => this.render());
    dateSetting(contentEl, "Date", this.draft.date, (v) => (this.draft.date = v));
    new Setting(contentEl).setName("Notes").addTextArea((t) =>
      t.setValue(this.draft.notes ?? "").onChange((v) => (this.draft.notes = v || undefined))
    );
    const errorEl = contentEl.createEl("p", { cls: "trimly-error" });
    footer(
      contentEl,
      errorEl,
      () => {
        const err = validateTxLike(this.draft) ?? (this.draft.date ? null : "Pick a date.");
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
    this.setTitle(this.onDelete ? "Edit recurring transaction" : "New recurring transaction");
    this.render();
  }

  private render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("trimly-modal");
    renderTxLikeFields(contentEl, this.ledger, this.draft, () => this.render());
    new Setting(contentEl).setName("Repeats").addDropdown((d) =>
      d
        .addOptions(FREQUENCY_LABELS)
        .setValue(this.draft.frequency)
        .onChange((v) => (this.draft.frequency = v as Frequency))
    );
    const isNew = !this.onDelete;
    dateSetting(contentEl, isNew ? "First date" : "Next date", isNew ? this.draft.startDate : this.draft.nextDate, (v) => {
      if (isNew) this.draft.startDate = v;
      this.draft.nextDate = v;
    });
    dateSetting(contentEl, "End date (optional)", this.draft.endDate ?? "", (v) => (this.draft.endDate = v || undefined));
    contentEl.createEl("p", {
      cls: "setting-item-description",
      text: "Occurrences are posted as transactions automatically when their date arrives.",
    });
    const errorEl = contentEl.createEl("p", { cls: "trimly-error" });
    footer(
      contentEl,
      errorEl,
      () => {
        const err = validateTxLike(this.draft) ?? (this.draft.nextDate ? null : "Pick a date.");
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
    this.setTitle(this.onDelete ? "Edit account" : "New account");
    new Setting(contentEl).setName("Name").addText((t) => t.setValue(this.draft.name).onChange((v) => (this.draft.name = v)));
    new Setting(contentEl).setName("Type").addDropdown((d) =>
      d
        .addOptions(ACCOUNT_TYPE_LABELS)
        .setValue(this.draft.type)
        .onChange((v) => (this.draft.type = v as AccountType))
    );
    new Setting(contentEl)
      .setName("Opening balance")
      .setDesc("Balance before your first recorded transaction. Use a negative value for debt.")
      .addText((t) => {
        t.inputEl.inputMode = "decimal";
        t.setValue(centsToInput(this.draft.openingBalance)).onChange((v) => {
          const c = parseAmount(v);
          if (c !== null) this.draft.openingBalance = c;
        });
      });
    new Setting(contentEl)
      .setName("Archived")
      .setDesc("Hide from pickers and the overview. History is kept.")
      .addToggle((t) => t.setValue(!!this.draft.archived).onChange((v) => (this.draft.archived = v || undefined)));
    const errorEl = contentEl.createEl("p", { cls: "trimly-error" });
    footer(
      contentEl,
      errorEl,
      () => {
        if (!this.draft.name.trim()) return "Add a name.";
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

const RATE_TYPES: Record<string, string> = { "": "None", CDI: "CDI", SELIC: "Selic", IPCA: "IPCA", IGPM: "IGP-M", DOLAR: "Dollar" };

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
    .addText((t) => {
      t.inputEl.inputMode = "decimal";
      t.setValue(initial === undefined ? "" : String(initial)).onChange((v) => onChange(parseDecimal(v)));
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
    .addText((t) => {
      t.inputEl.inputMode = "decimal";
      t.setPlaceholder("0,00");
      t.setValue(initial === undefined ? "" : centsToInput(initial)).onChange((v) => onChange(v.trim() ? parseAmount(v) : undefined));
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
    this.setTitle(this.onDelete || synced ? "Edit position" : "New position");
    new Setting(contentEl)
      .setName("Name")
      .addText((t) => t.setPlaceholder("Name of the investment").setValue(d.name).onChange((v) => (d.name = v)));
    new Setting(contentEl).setName("Class").addDropdown((dd) =>
      dd
        .addOptions(ASSET_CLASS_LABELS)
        .setValue(d.assetClass)
        .onChange((v) => (d.assetClass = v as AssetClass))
    );
    if (synced) {
      contentEl.createEl("p", {
        cls: "setting-item-description",
        text: "This position comes from bank sync: its values and movements are updated on every sync.",
      });
    } else {
      new Setting(contentEl)
        .setName("Ticker or code")
        .addText((t) => t.setPlaceholder("Optional").setValue(d.code ?? "").onChange((v) => (d.code = v.trim() || undefined)));
      new Setting(contentEl)
        .setName("Institution")
        .addText((t) => t.setPlaceholder("Broker or bank").setValue(d.institution ?? "").onChange((v) => (d.institution = v.trim() || undefined)));
      moneySetting(contentEl, "Current value", "What the position is worth now, net of taxes.", this.onDelete ? d.value : undefined, (c) =>
        this.field("value", c === undefined ? null : c, (v) => (d.value = Math.abs(v)))
      );
      moneySetting(contentEl, "Amount invested", "What you paid for it. Leave empty if unknown.", d.invested, (c) =>
        this.field("invested", c, (v) => (d.invested = v === undefined ? undefined : Math.abs(v)))
      );
      decimalSetting(contentEl, "Quantity", "Shares or units, optional.", d.quantity, (n) => this.field("quantity", n, (v) => (d.quantity = v)));
      new Setting(contentEl)
        .setName("Index")
        .setDesc("Benchmark of a fixed-income product, optional.")
        .addDropdown((dd) =>
          dd
            .addOptions(RATE_TYPES)
            .setValue(d.rateType ?? "")
            .onChange((v) => (d.rateType = v || undefined))
        );
      decimalSetting(contentEl, "Percent of index", "For example 110 for 110% of CDI.", d.rate, (n) => this.field("rate", n, (v) => (d.rate = v)));
      decimalSetting(contentEl, "Fixed rate (% a year)", "For example 6 for IPCA + 6%, or 12 for a 12% prefixed bond.", d.fixedRate, (n) =>
        this.field("fixedRate", n, (v) => (d.fixedRate = v))
      );
      dateSetting(contentEl, "Maturity date (optional)", d.dueDate ?? "", (v) => (d.dueDate = v || undefined));
      if (this.onDelete) {
        new Setting(contentEl)
          .setName("Closed")
          .setDesc("Fully withdrawn. Kept for history, left out of totals.")
          .addToggle((t) => t.setValue(!!d.closed).onChange((v) => (d.closed = v || undefined)));
      }
    }
    const errorEl = contentEl.createEl("p", { cls: "trimly-error" });
    footer(
      contentEl,
      errorEl,
      () => {
        if (!d.name.trim()) return "Add a name.";
        if (this.invalid.size) return "Fix the fields that are not valid numbers.";
        if (!synced && !this.onDelete && !(d.value > 0)) return "Enter the current value.";
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
    this.setTitle(this.onDelete ? "Edit movement" : "New movement");
    this.render();
  }

  private render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("trimly-modal");
    const d = this.draft;
    const positions: Record<string, string> = {};
    for (const a of this.ledger.investments.assets) if (!a.pluggyId && (!a.closed || a.id === d.assetId)) positions[a.id] = a.name;
    new Setting(contentEl).setName("Position").addDropdown((dd) =>
      dd
        .addOptions(positions)
        .setValue(d.assetId)
        .onChange((v) => (d.assetId = v))
    );
    new Setting(contentEl).setName("Type").addDropdown((dd) =>
      dd
        .addOptions(MOVEMENT_LABELS)
        .setValue(d.type)
        .onChange((v) => {
          d.type = v as MovementType;
          if (d.type === "transfer") d.direction = d.direction ?? "in";
          else delete d.direction;
          this.render();
        })
    );
    if (d.type === "transfer") {
      new Setting(contentEl).setName("Direction").addDropdown((dd) =>
        dd
          .addOptions({ in: "Into the position", out: "Out of the position" })
          .setValue(d.direction ?? "in")
          .onChange((v) => (d.direction = v as "in" | "out"))
      );
    }
    let amountInvalid = false;
    moneySetting(contentEl, "Amount", "Net of fees.", d.amount || undefined, (c) => {
      amountInvalid = c === null;
      if (c) d.amount = Math.abs(c);
    });
    let quantityInvalid = false;
    if (d.type !== "income" && d.type !== "tax") {
      decimalSetting(contentEl, "Quantity", "Shares or units, optional.", d.quantity, (n) => {
        quantityInvalid = n === null;
        if (n !== null) d.quantity = n === undefined ? undefined : Math.abs(n);
      });
    }
    dateSetting(contentEl, "Date", d.date, (v) => (d.date = v));
    new Setting(contentEl)
      .setName("Description")
      .addText((t) => t.setValue(d.description ?? "").onChange((v) => (d.description = v.trim() || undefined)));
    contentEl.createEl("p", {
      cls: "setting-item-description",
      text:
        d.type === "income"
          ? "Income is recorded as paid out: it does not change the position's value."
          : "Updates the position's value, amount invested and quantity. Editing or deleting the movement reverts that.",
    });
    const errorEl = contentEl.createEl("p", { cls: "trimly-error" });
    footer(
      contentEl,
      errorEl,
      () => {
        if (!d.assetId) return "Add a manual position first.";
        if (amountInvalid || quantityInvalid) return "Fix the fields that are not valid numbers.";
        if (!(d.amount > 0)) return "Amount must be greater than zero.";
        if (!d.date) return "Pick a date.";
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
    this.setTitle(this.onDelete ? "Edit category" : "New category");
    new Setting(contentEl).setName("Name").addText((t) => t.setValue(this.draft.name).onChange((v) => (this.draft.name = v)));
    new Setting(contentEl).setName("Kind").addDropdown((d) =>
      d
        .addOptions({ expense: "Expense", income: "Income" })
        .setValue(this.draft.kind)
        .onChange((v) => (this.draft.kind = v as CategoryKind))
    );
    new Setting(contentEl).setName("Color").addColorPicker((c) =>
      c.setValue(this.draft.color).onChange((v) => {
        this.draft.color = v;
        grid.setCssProps({ "--trimly-color": v });
      })
    );
    new Setting(contentEl).setName("Icon").setClass("trimly-icon-setting");
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
        if (!this.draft.name.trim()) return "Add a name.";
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
