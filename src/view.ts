import { ItemView, Notice, Setting, WorkspaceLeaf, setIcon } from "obsidian";
import type TrimlyPlugin from "./main";
import { AccountModal, CategoryModal, ConfirmModal, RecurringModal, TransactionModal } from "./modals";
import {
  ACCOUNT_TYPE_LABELS,
  CategoryKind,
  FREQUENCY_LABELS,
  Ledger,
  Transaction,
  accountBalance,
  accountInUse,
  monthOf,
  monthSummary,
  netWorth,
  parseAmount,
  postDueRecurring,
  removeCategory,
  shiftMonth,
  sortTransactions,
  spendingByCategory,
  todayISO,
  centsToInput,
} from "./ledger";

export const VIEW_TYPE_TRIMLY = "trimly-dashboard";

type Tab = "overview" | "transactions" | "accounts" | "budgets" | "recurring" | "categories";

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "overview", label: "Overview", icon: "layout-dashboard" },
  { id: "transactions", label: "Transactions", icon: "list" },
  { id: "accounts", label: "Accounts", icon: "landmark" },
  { id: "budgets", label: "Budgets", icon: "target" },
  { id: "recurring", label: "Recurring", icon: "repeat" },
  { id: "categories", label: "Categories", icon: "tags" },
];

interface TxFilter {
  text: string;
  accountId: string;
  categoryId: string;
  type: string;
  allMonths: boolean;
}

export class TrimlyView extends ItemView {
  private tab: Tab = "overview";
  private month = monthOf(todayISO());
  private filter: TxFilter = { text: "", accountId: "", categoryId: "", type: "", allMonths: false };

  constructor(leaf: WorkspaceLeaf, private plugin: TrimlyPlugin) {
    super(leaf);
  }

  getViewType() {
    return VIEW_TYPE_TRIMLY;
  }

  getDisplayText() {
    return "Trimly";
  }

  getIcon() {
    return "wallet";
  }

  async onOpen() {
    this.render();
    if (!this.plugin.ledger) await this.plugin.unlock();
  }

  render() {
    const root = this.contentEl;
    root.empty();
    root.addClass("trimly-view");
    const ledger = this.plugin.ledger;
    if (!ledger) return this.renderLocked(root);

    this.renderHeader(root);
    const body = root.createDiv("trimly-body");
    switch (this.tab) {
      case "overview":
        return this.renderOverview(body, ledger);
      case "transactions":
        return this.renderTransactions(body, ledger);
      case "accounts":
        return this.renderAccounts(body, ledger);
      case "budgets":
        return this.renderBudgets(body, ledger);
      case "recurring":
        return this.renderRecurring(body, ledger);
      case "categories":
        return this.renderCategories(body, ledger);
    }
  }

  private money(cents: number) {
    return this.plugin.formatMoney(cents);
  }

  private renderLocked(root: HTMLElement) {
    const box = root.createDiv("trimly-locked");
    setIcon(box.createDiv("trimly-locked-icon"), "lock");
    box.createEl("h3", { text: "Trimly is locked" });
    box.createEl("p", { text: "Your financial data is encrypted. Enter your passphrase to open it." });
    const btn = box.createEl("button", { cls: "mod-cta", text: "Unlock" });
    btn.addEventListener("click", () => void this.plugin.unlock());
  }

  private renderHeader(root: HTMLElement) {
    const header = root.createDiv("trimly-header");
    const nav = header.createDiv("trimly-month-nav");
    const prev = nav.createEl("button", { cls: "clickable-icon", attr: { "aria-label": "Previous month" } });
    setIcon(prev, "chevron-left");
    prev.addEventListener("click", () => this.setMonth(shiftMonth(this.month, -1)));
    const label = nav.createEl("button", { cls: "trimly-month-label", text: this.monthLabel(this.month) });
    label.setAttr("aria-label", "Go to current month");
    label.addEventListener("click", () => this.setMonth(monthOf(todayISO())));
    const next = nav.createEl("button", { cls: "clickable-icon", attr: { "aria-label": "Next month" } });
    setIcon(next, "chevron-right");
    next.addEventListener("click", () => this.setMonth(shiftMonth(this.month, 1)));

    const actions = header.createDiv("trimly-header-actions");
    const add = actions.createEl("button", { cls: "mod-cta", text: "Add transaction" });
    add.addEventListener("click", () => this.plugin.openTransactionModal(null));
    const lock = actions.createEl("button", { cls: "clickable-icon", attr: { "aria-label": "Lock" } });
    setIcon(lock, "lock");
    lock.addEventListener("click", () => this.plugin.lock());

    const tabs = root.createDiv("trimly-tabs");
    for (const t of TABS) {
      const el = tabs.createEl("button", { cls: "trimly-tab" });
      setIcon(el.createSpan("trimly-tab-icon"), t.icon);
      el.createSpan({ text: t.label });
      if (t.id === this.tab) el.addClass("is-active");
      el.addEventListener("click", () => {
        this.tab = t.id;
        this.render();
      });
    }
  }

  private setMonth(m: string) {
    this.month = m;
    this.render();
  }

  private monthLabel(month: string) {
    const [y, m] = month.split("-").map(Number);
    return new Intl.DateTimeFormat(this.plugin.locale(), { month: "long", year: "numeric" }).format(new Date(y, m - 1, 1));
  }

  private dateLabel(date: string) {
    const [y, m, d] = date.split("-").map(Number);
    return new Intl.DateTimeFormat(this.plugin.locale(), { day: "2-digit", month: "short" }).format(new Date(y, m - 1, d));
  }

  private section(parent: HTMLElement, title: string, action?: { label: string; onClick: () => void }) {
    const sec = parent.createDiv("trimly-section");
    const head = sec.createDiv("trimly-section-head");
    head.createEl("h4", { text: title });
    if (action) {
      const b = head.createEl("button", { text: action.label });
      b.addEventListener("click", action.onClick);
    }
    return sec;
  }

  // ---- overview ----

  private renderOverview(body: HTMLElement, ledger: Ledger) {
    const monthEnd = `${this.month}-31`;
    const sum = monthSummary(ledger, this.month);
    const stats = body.createDiv("trimly-stats");
    this.stat(stats, "Income", sum.income, "is-income");
    this.stat(stats, "Expenses", sum.expense, "is-expense");
    this.stat(stats, "Net", sum.net, sum.net >= 0 ? "is-income" : "is-expense");
    this.stat(stats, "Net worth", netWorth(ledger, monthEnd), "");

    const grid = body.createDiv("trimly-grid");

    const accSec = this.section(grid, "Accounts", { label: "Manage", onClick: () => this.goTab("accounts") });
    const accList = accSec.createDiv("trimly-list");
    for (const a of ledger.accounts.filter((x) => !x.archived)) {
      const row = accList.createDiv("trimly-row");
      const main = row.createDiv("trimly-row-main");
      main.createDiv({ cls: "trimly-row-title", text: a.name });
      main.createDiv({ cls: "trimly-row-sub", text: ACCOUNT_TYPE_LABELS[a.type] });
      this.amountEl(row, accountBalance(ledger, a.id, monthEnd), true);
    }

    const spendSec = this.section(grid, "Spending by category", { label: "Budgets", onClick: () => this.goTab("budgets") });
    const spending = spendingByCategory(ledger, this.month);
    if (spending.size === 0) spendSec.createDiv({ cls: "trimly-empty", text: "No expenses this month." });
    const max = Math.max(0, ...spending.values());
    const entries = [...spending.entries()].sort((a, b) => b[1] - a[1]);
    for (const [catId, spent] of entries) {
      const cat = ledger.categories.find((c) => c.id === catId);
      const budget = ledger.budgets.find((b) => b.categoryId === catId);
      this.barRow(spendSec, cat?.name ?? "Uncategorized", cat?.color ?? "#888888", spent, budget?.limit, max);
    }

    const recentSec = this.section(grid, "Recent transactions", { label: "See all", onClick: () => this.goTab("transactions") });
    const recent = sortTransactions(ledger.transactions.filter((t) => monthOf(t.date) === this.month)).slice(0, 8);
    if (recent.length === 0) recentSec.createDiv({ cls: "trimly-empty", text: "No transactions this month." });
    const list = recentSec.createDiv("trimly-list");
    for (const tx of recent) this.txRow(list, ledger, tx);
  }

  private goTab(t: Tab) {
    this.tab = t;
    this.render();
  }

  private stat(parent: HTMLElement, label: string, cents: number, cls: string) {
    const el = parent.createDiv("trimly-stat");
    el.createDiv({ cls: "trimly-stat-label", text: label });
    el.createDiv({ cls: `trimly-stat-value ${cls}`, text: this.money(cents) });
  }

  private amountEl(parent: HTMLElement, cents: number, signedColor: boolean) {
    const el = parent.createDiv({ cls: "trimly-amount", text: this.money(cents) });
    if (signedColor && cents < 0) el.addClass("is-expense");
    return el;
  }

  private barRow(parent: HTMLElement, name: string, color: string, spent: number, limit: number | undefined, max: number) {
    const row = parent.createDiv("trimly-bar-row");
    const top = row.createDiv("trimly-bar-top");
    const label = top.createDiv("trimly-bar-label");
    label.createSpan("trimly-dot").setCssProps({ "--trimly-color": color });
    label.createSpan({ text: name });
    top.createDiv({
      cls: "trimly-bar-value",
      text: limit ? `${this.money(spent)} / ${this.money(limit)}` : this.money(spent),
    });
    const track = row.createDiv("trimly-bar-track");
    const denom = limit ?? max;
    const pct = denom > 0 ? Math.min(100, (spent / denom) * 100) : 0;
    const fill = track.createDiv("trimly-bar-fill");
    fill.setCssProps({ "--trimly-pct": `${pct}%`, "--trimly-color": color });
    if (limit && spent > limit) fill.addClass("is-over");
  }

  private txRow(list: HTMLElement, ledger: Ledger, tx: Transaction) {
    const row = list.createDiv("trimly-row is-clickable");
    row.createDiv({ cls: "trimly-row-date", text: this.dateLabel(tx.date) });
    const main = row.createDiv("trimly-row-main");
    main.createDiv({ cls: "trimly-row-title", text: tx.description });
    const sub = main.createDiv("trimly-row-sub");
    const acc = (id?: string) => ledger.accounts.find((a) => a.id === id)?.name ?? "?";
    if (tx.type === "transfer") {
      sub.setText(`${acc(tx.accountId)} → ${acc(tx.toAccountId)}`);
    } else {
      const cat = ledger.categories.find((c) => c.id === tx.categoryId);
      const chip = sub.createSpan("trimly-chip");
      chip.createSpan("trimly-dot").setCssProps({ "--trimly-color": cat?.color ?? "#888888" });
      chip.createSpan({ text: cat?.name ?? "Uncategorized" });
      sub.createSpan({ text: ` · ${acc(tx.accountId)}` });
    }
    const sign = tx.type === "expense" ? -1 : 1;
    const amt = row.createDiv({ cls: "trimly-amount", text: this.money(sign * tx.amount) });
    amt.addClass(tx.type === "expense" ? "is-expense" : tx.type === "income" ? "is-income" : "is-transfer");
    if (tx.recurringId) setIcon(row.createDiv({ cls: "trimly-row-flag", attr: { "aria-label": "Recurring" } }), "repeat");
    row.addEventListener("click", () => this.plugin.openTransactionModal(tx));
  }

  // ---- transactions ----

  private renderTransactions(body: HTMLElement, ledger: Ledger) {
    const bar = body.createDiv("trimly-filters");
    const search = bar.createEl("input", { type: "search", placeholder: "Search" });
    search.value = this.filter.text;
    const select = (options: Record<string, string>, value: string, onChange: (v: string) => void) => {
      const s = bar.createEl("select", { cls: "dropdown" });
      for (const [k, v] of Object.entries(options)) s.createEl("option", { value: k, text: v });
      s.value = value;
      s.addEventListener("change", () => onChange(s.value));
    };
    const accounts: Record<string, string> = { "": "All accounts" };
    for (const a of ledger.accounts) accounts[a.id] = a.name;
    const categories: Record<string, string> = { "": "All categories", none: "Uncategorized" };
    for (const c of ledger.categories) categories[c.id] = c.name;

    const listWrap = body.createDiv();
    const renderList = () => this.renderTxList(listWrap, ledger);

    search.addEventListener("input", () => {
      this.filter.text = search.value;
      renderList();
    });
    select(accounts, this.filter.accountId, (v) => ((this.filter.accountId = v), renderList()));
    select(categories, this.filter.categoryId, (v) => ((this.filter.categoryId = v), renderList()));
    select(
      { "": "All types", expense: "Expenses", income: "Income", transfer: "Transfers" },
      this.filter.type,
      (v) => ((this.filter.type = v), renderList())
    );
    const allLabel = bar.createEl("label", { cls: "trimly-check" });
    const all = allLabel.createEl("input", { type: "checkbox" });
    all.checked = this.filter.allMonths;
    allLabel.appendText("All months");
    all.addEventListener("change", () => ((this.filter.allMonths = all.checked), renderList()));
    renderList();
  }

  private renderTxList(wrap: HTMLElement, ledger: Ledger) {
    wrap.empty();
    const f = this.filter;
    const q = f.text.trim().toLowerCase();
    const txs = sortTransactions(
      ledger.transactions.filter((t) => {
        if (!f.allMonths && monthOf(t.date) !== this.month) return false;
        if (f.accountId && t.accountId !== f.accountId && t.toAccountId !== f.accountId) return false;
        if (f.categoryId === "none" ? t.type === "transfer" || !!t.categoryId : f.categoryId && t.categoryId !== f.categoryId) {
          return false;
        }
        if (f.type && t.type !== f.type) return false;
        if (q && !`${t.description} ${t.notes ?? ""}`.toLowerCase().includes(q)) return false;
        return true;
      })
    );
    let income = 0;
    let expense = 0;
    for (const t of txs) {
      if (t.type === "income") income += t.amount;
      else if (t.type === "expense") expense += t.amount;
    }
    const totals = wrap.createDiv("trimly-totals");
    totals.createSpan({ text: `${txs.length} transaction${txs.length === 1 ? "" : "s"}` });
    totals.createSpan({ cls: "is-income", text: `+${this.money(income)}` });
    totals.createSpan({ cls: "is-expense", text: `−${this.money(expense)}` });
    if (txs.length === 0) wrap.createDiv({ cls: "trimly-empty", text: "No transactions match." });
    const list = wrap.createDiv("trimly-list");
    for (const tx of txs.slice(0, 500)) this.txRow(list, ledger, tx);
    if (txs.length > 500) wrap.createDiv({ cls: "trimly-empty", text: `Showing the newest 500 of ${txs.length}. Narrow the filters to see more.` });
  }

  // ---- accounts ----

  private renderAccounts(body: HTMLElement, ledger: Ledger) {
    const sec = this.section(body, "Accounts", { label: "Add account", onClick: () => this.editAccount(null) });
    const list = sec.createDiv("trimly-list");
    for (const a of ledger.accounts) {
      const row = list.createDiv("trimly-row is-clickable");
      if (a.archived) row.addClass("is-archived");
      const main = row.createDiv("trimly-row-main");
      main.createDiv({ cls: "trimly-row-title", text: a.name });
      main.createDiv({ cls: "trimly-row-sub", text: ACCOUNT_TYPE_LABELS[a.type] + (a.archived ? " · archived" : "") });
      this.amountEl(row, accountBalance(ledger, a.id), true);
      row.addEventListener("click", () => this.editAccount(a.id));
    }
    sec.createDiv({ cls: "trimly-total-line", text: `Net worth: ${this.money(netWorth(ledger))}` });
  }

  private editAccount(id: string | null) {
    const ledger = this.plugin.ledger;
    if (!ledger) return;
    const existing = ledger.accounts.find((a) => a.id === id) ?? null;
    new AccountModal(
      this.app,
      existing,
      (acc) =>
        void this.plugin.mutate((l) => {
          const i = l.accounts.findIndex((a) => a.id === acc.id);
          if (i >= 0) l.accounts[i] = acc;
          else l.accounts.push(acc);
        }),
      existing
        ? (acc) => {
            if (accountInUse(ledger, acc.id)) {
              new Notice("This account has transactions. Archive it instead, or delete its transactions first.");
              return;
            }
            new ConfirmModal(this.app, `Delete account "${acc.name}"?`, "Delete", () =>
              void this.plugin.mutate((l) => {
                l.accounts = l.accounts.filter((a) => a.id !== acc.id);
              })
            ).open();
          }
        : null
    ).open();
  }

  // ---- budgets ----

  private renderBudgets(body: HTMLElement, ledger: Ledger) {
    const sec = this.section(body, `Monthly budgets · ${this.monthLabel(this.month)}`);
    sec.createDiv({
      cls: "setting-item-description",
      text: "Set a monthly limit per expense category. Leave empty for no limit.",
    });
    const spending = spendingByCategory(ledger, this.month);
    let totalLimit = 0;
    let totalSpent = 0;
    for (const cat of ledger.categories.filter((c) => c.kind === "expense")) {
      const budget = ledger.budgets.find((b) => b.categoryId === cat.id);
      const spent = spending.get(cat.id) ?? 0;
      if (budget) {
        totalLimit += budget.limit;
        totalSpent += spent;
      }
      const wrap = sec.createDiv("trimly-budget");
      this.barRow(wrap, cat.name, cat.color, spent, budget?.limit, Math.max(spent, 1));
      new Setting(wrap).setName("Limit").addText((t) => {
        t.inputEl.inputMode = "decimal";
        t.setPlaceholder("No limit");
        if (budget) t.setValue(centsToInput(budget.limit));
        t.inputEl.addEventListener("change", () => {
          const v = t.getValue().trim();
          const cents = v ? parseAmount(v) : 0;
          if (cents === null) {
            new Notice("Not a valid amount.");
            return;
          }
          void this.plugin.mutate((l) => {
            l.budgets = l.budgets.filter((b) => b.categoryId !== cat.id);
            if (cents > 0) l.budgets.push({ categoryId: cat.id, limit: cents });
          });
        });
      });
      if (budget && spent > budget.limit) {
        wrap.createDiv({ cls: "trimly-over", text: `Over budget by ${this.money(spent - budget.limit)}` });
      }
    }
    if (totalLimit > 0) {
      sec.createDiv({
        cls: "trimly-total-line",
        text: `Budgeted categories: ${this.money(totalSpent)} of ${this.money(totalLimit)} (${this.money(totalLimit - totalSpent)} left)`,
      });
    }
  }

  // ---- recurring ----

  private renderRecurring(body: HTMLElement, ledger: Ledger) {
    const sec = this.section(body, "Recurring transactions", { label: "Add recurring", onClick: () => this.editRecurring(null) });
    sec.createDiv({
      cls: "setting-item-description",
      text: "Bills, subscriptions and salaries. Each occurrence is posted automatically when its date arrives.",
    });
    if (ledger.recurring.length === 0) sec.createDiv({ cls: "trimly-empty", text: "No recurring transactions yet." });
    const list = sec.createDiv("trimly-list");
    const sorted = [...ledger.recurring].sort((a, b) => (a.nextDate < b.nextDate ? -1 : 1));
    let monthlyOut = 0;
    let monthlyIn = 0;
    for (const r of sorted) {
      const factor = r.frequency === "weekly" ? 52 / 12 : r.frequency === "yearly" ? 1 / 12 : 1;
      if (r.type === "expense") monthlyOut += r.amount * factor;
      if (r.type === "income") monthlyIn += r.amount * factor;
      const ended = !!r.endDate && r.nextDate > r.endDate;
      const row = list.createDiv("trimly-row is-clickable");
      if (ended) row.addClass("is-archived");
      const main = row.createDiv("trimly-row-main");
      main.createDiv({ cls: "trimly-row-title", text: r.description });
      main.createDiv({
        cls: "trimly-row-sub",
        text: `${FREQUENCY_LABELS[r.frequency]} · ${ended ? "ended" : `next ${this.dateLabel(r.nextDate)} ${r.nextDate.slice(0, 4)}`}`,
      });
      const sign = r.type === "expense" ? -1 : 1;
      const amt = row.createDiv({ cls: "trimly-amount", text: this.money(sign * r.amount) });
      amt.addClass(r.type === "expense" ? "is-expense" : r.type === "income" ? "is-income" : "is-transfer");
      row.addEventListener("click", () => this.editRecurring(r.id));
    }
    if (sorted.length) {
      sec.createDiv({
        cls: "trimly-total-line",
        text: `Per month, about: +${this.money(Math.round(monthlyIn))} / −${this.money(Math.round(monthlyOut))}`,
      });
    }
  }

  private editRecurring(id: string | null) {
    const ledger = this.plugin.ledger;
    if (!ledger) return;
    if (!ledger.accounts.some((a) => !a.archived)) {
      new Notice("Add an account first.");
      return;
    }
    const existing = ledger.recurring.find((r) => r.id === id) ?? null;
    new RecurringModal(
      this.app,
      ledger,
      existing,
      (rec) =>
        void this.plugin.mutate((l) => {
          const i = l.recurring.findIndex((r) => r.id === rec.id);
          if (i >= 0) l.recurring[i] = rec;
          else l.recurring.push(rec);
          const posted = postDueRecurring(l, todayISO());
          if (posted) new Notice(`Posted ${posted} recurring transaction${posted === 1 ? "" : "s"}.`);
        }),
      existing
        ? (rec) =>
            new ConfirmModal(
              this.app,
              `Delete recurring "${rec.description}"? Transactions it already posted are kept.`,
              "Delete",
              () =>
                void this.plugin.mutate((l) => {
                  l.recurring = l.recurring.filter((r) => r.id !== rec.id);
                })
            ).open()
        : null
    ).open();
  }

  // ---- categories ----

  private renderCategories(body: HTMLElement, ledger: Ledger) {
    const kinds: { kind: CategoryKind; title: string }[] = [
      { kind: "expense", title: "Expense categories" },
      { kind: "income", title: "Income categories" },
    ];
    for (const { kind, title } of kinds) {
      const sec = this.section(body, title, { label: "Add category", onClick: () => this.editCategory(null, kind) });
      const list = sec.createDiv("trimly-list");
      for (const c of ledger.categories.filter((x) => x.kind === kind)) {
        const row = list.createDiv("trimly-row is-clickable");
        const main = row.createDiv("trimly-row-main");
        const t = main.createDiv("trimly-row-title");
        t.createSpan("trimly-dot").setCssProps({ "--trimly-color": c.color });
        t.createSpan({ text: c.name });
        const used = ledger.transactions.filter((tx) => tx.categoryId === c.id).length;
        row.createDiv({ cls: "trimly-row-sub", text: `${used} transaction${used === 1 ? "" : "s"}` });
        row.addEventListener("click", () => this.editCategory(c.id, kind));
      }
    }
  }

  private editCategory(id: string | null, kind: CategoryKind) {
    const ledger = this.plugin.ledger;
    if (!ledger) return;
    const existing = ledger.categories.find((c) => c.id === id) ?? null;
    new CategoryModal(
      this.app,
      existing,
      kind,
      (cat) =>
        void this.plugin.mutate((l) => {
          const i = l.categories.findIndex((c) => c.id === cat.id);
          if (i >= 0) {
            // a category that changes kind no longer fits transactions of the old kind
            if (l.categories[i].kind !== cat.kind) {
              for (const tx of l.transactions) if (tx.categoryId === cat.id) delete tx.categoryId;
              l.budgets = l.budgets.filter((b) => b.categoryId !== cat.id);
            }
            l.categories[i] = cat;
          } else l.categories.push(cat);
        }),
      existing
        ? (cat) =>
            new ConfirmModal(
              this.app,
              `Delete category "${cat.name}"? Its transactions become uncategorized.`,
              "Delete",
              () => void this.plugin.mutate((l) => removeCategory(l, cat.id))
            ).open()
        : null
    ).open();
  }
}

export function openTransactionModal(plugin: TrimlyPlugin, tx: Transaction | null) {
  const ledger = plugin.ledger;
  if (!ledger) return;
  if (!ledger.accounts.some((a) => !a.archived)) {
    new Notice("Add an account first.");
    return;
  }
  new TransactionModal(
    plugin.app,
    ledger,
    tx,
    (saved) =>
      void plugin.mutate((l) => {
        const i = l.transactions.findIndex((t) => t.id === saved.id);
        if (i >= 0) l.transactions[i] = saved;
        else l.transactions.push(saved);
      }),
    tx
      ? (del) =>
          new ConfirmModal(plugin.app, `Delete "${del.description}"?`, "Delete", () =>
            void plugin.mutate((l) => {
              l.transactions = l.transactions.filter((t) => t.id !== del.id);
            })
          ).open()
      : null
  ).open();
}
