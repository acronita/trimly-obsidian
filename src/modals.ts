import { App, Modal, Setting, setIcon } from "obsidian";
import {
  ACCOUNT_TYPE_LABELS,
  Account,
  CATEGORY_ICONS,
  AccountType,
  Category,
  CategoryKind,
  FREQUENCY_LABELS,
  Frequency,
  Ledger,
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
