import { ItemView, Notice, WorkspaceLeaf, setIcon } from "obsidian";
import type TrimlyPlugin from "./main";
import { cashFlowBars, donut } from "./charts";
import { AccountModal, CategoryModal, ConfirmModal, RecurringModal, TransactionModal } from "./modals";
import {
  ACCOUNT_TYPE_ICONS,
  ACCOUNT_TYPE_LABELS,
  ASSET_CLASS_COLORS,
  ASSET_CLASS_ICONS,
  ASSET_CLASS_LABELS,
  Asset,
  AssetClass,
  Category,
  CategoryKind,
  FREQUENCY_LABELS,
  Ledger,
  Recurring,
  Transaction,
  TxType,
  accountBalance,
  accountInUse,
  allocationByClass,
  centsToInput,
  monthOf,
  monthSummary,
  monthlyHistory,
  netWorth,
  openAssets,
  parseAmount,
  portfolioInvested,
  portfolioValue,
  postDueRecurring,
  removeCategory,
  shiftMonth,
  sortTransactions,
  spendingByCategory,
  todayISO,
  toISODate,
  upcomingRecurring,
} from "./ledger";

export const VIEW_TYPE_TRIMLY = "trimly-dashboard";

type Mode = "accounts" | "investments";
type Tab = "overview" | "transactions" | "accounts" | "budgets" | "recurring" | "categories" | "inv-overview" | "portfolio";

const MODES: { id: Mode; label: string; icon: string }[] = [
  { id: "accounts", label: "Accounts", icon: "wallet" },
  { id: "investments", label: "Investments", icon: "trending-up" },
];

const TABS: Record<Mode, { id: Tab; label: string; icon: string }[]> = {
  accounts: [
    { id: "overview", label: "Overview", icon: "layout-dashboard" },
    { id: "transactions", label: "Transactions", icon: "arrow-left-right" },
    { id: "accounts", label: "Accounts", icon: "landmark" },
    { id: "budgets", label: "Budgets", icon: "target" },
    { id: "recurring", label: "Recurring", icon: "repeat" },
    { id: "categories", label: "Categories", icon: "tags" },
  ],
  investments: [
    { id: "inv-overview", label: "Overview", icon: "layout-dashboard" },
    { id: "portfolio", label: "Portfolio", icon: "briefcase" },
  ],
};

/** Maturities shown on the investments overview. */
const MATURITY_HORIZON_DAYS = 365;

const NEUTRAL = "#8a8a8a";

interface TxFilter {
  text: string;
  accountId: string;
  categoryId: string;
  type: string;
  allMonths: boolean;
}

export class TrimlyView extends ItemView {
  private mode: Mode = "accounts";
  /** active tab of each mode, so switching back returns to it */
  private tabs: Record<Mode, Tab> = { accounts: "overview", investments: "inv-overview" };
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
    const scroll = root.scrollTop;
    root.empty();
    root.addClass("trimly-view");
    const ledger = this.plugin.ledger;
    if (!ledger) return this.renderLocked(root);

    const page = root.createDiv("trimly-page");
    this.renderHeader(page);
    const body = page.createDiv("trimly-body");
    switch (this.tabs[this.mode]) {
      case "overview":
        this.renderOverview(body, ledger);
        break;
      case "transactions":
        this.renderTransactions(body, ledger);
        break;
      case "accounts":
        this.renderAccounts(body, ledger);
        break;
      case "budgets":
        this.renderBudgets(body, ledger);
        break;
      case "recurring":
        this.renderRecurring(body, ledger);
        break;
      case "categories":
        this.renderCategories(body, ledger);
        break;
      case "inv-overview":
        this.renderInvestmentsOverview(body, ledger);
        break;
      case "portfolio":
        this.renderPortfolio(body, ledger);
        break;
    }
    root.scrollTop = scroll;
  }

  // ---- shared bits ----

  private money(cents: number) {
    return this.plugin.formatMoney(cents);
  }

  private signedMoney(cents: number, type: TxType) {
    if (type === "expense") return `−${this.money(cents)}`;
    if (type === "income") return `+${this.money(cents)}`;
    return this.money(cents);
  }

  private fmt(opts: Intl.DateTimeFormatOptions, date: Date) {
    return new Intl.DateTimeFormat(this.plugin.locale(), opts).format(date);
  }

  private parseDate(iso: string) {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d || 1);
  }

  private monthLabel(month: string) {
    return this.fmt({ month: "long", year: "numeric" }, this.parseDate(month));
  }

  private shortMonth(month: string) {
    return this.fmt({ month: "short" }, this.parseDate(month));
  }

  private dayHeading(iso: string) {
    const today = todayISO();
    const d = this.parseDate(iso);
    if (iso === today) return "Today";
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    if (iso === toISODate(yesterday)) return "Yesterday";
    return this.fmt({ weekday: "long", day: "numeric", month: "long" }, d);
  }

  private shortDate(iso: string) {
    return this.fmt({ day: "numeric", month: "short" }, this.parseDate(iso));
  }

  private category(ledger: Ledger, id?: string): Category | undefined {
    return ledger.categories.find((c) => c.id === id);
  }

  private iconTile(parent: HTMLElement, icon: string, color: string, cls = "") {
    const tile = parent.createDiv(`trimly-icon-tile ${cls}`);
    tile.setCssProps({ "--trimly-color": color });
    setIcon(tile, icon);
    return tile;
  }

  private card(parent: HTMLElement, title: string, link?: { label: string; onClick: () => void }) {
    const card = parent.createDiv("trimly-card");
    const head = card.createDiv("trimly-card-head");
    head.createDiv({ cls: "trimly-card-title", text: title });
    if (link) {
      const a = head.createEl("button", { cls: "trimly-link" });
      a.createSpan({ text: link.label });
      setIcon(a.createSpan("trimly-link-icon"), "chevron-right");
      a.addEventListener("click", link.onClick);
    }
    return card;
  }

  private empty(parent: HTMLElement, icon: string, text: string, cta?: { label: string; onClick: () => void }) {
    const el = parent.createDiv("trimly-empty");
    setIcon(el.createDiv("trimly-empty-icon"), icon);
    el.createDiv({ cls: "trimly-empty-text", text });
    if (cta) {
      const b = el.createEl("button", { text: cta.label });
      b.addEventListener("click", cta.onClick);
    }
  }

  private goTab(t: Tab) {
    this.tabs[this.mode] = t;
    this.contentEl.scrollTop = 0;
    this.render();
  }

  private setMode(m: Mode) {
    this.mode = m;
    this.contentEl.scrollTop = 0;
    this.render();
  }

  // ---- locked ----

  private renderLocked(root: HTMLElement) {
    const box = root.createDiv("trimly-locked");
    setIcon(box.createDiv("trimly-locked-icon"), "lock");
    box.createDiv({ cls: "trimly-locked-title", text: "Trimly is locked" });
    box.createDiv({ cls: "trimly-locked-text", text: "Your finances are encrypted. Enter your passphrase to open them." });
    const btn = box.createEl("button", { cls: "mod-cta", text: "Unlock" });
    btn.addEventListener("click", () => void this.plugin.unlock());
  }

  // ---- header ----

  private renderHeader(page: HTMLElement) {
    const top = page.createDiv("trimly-topbar");
    const left = top.createDiv("trimly-top-left");
    const modes = left.createDiv("trimly-segmented");
    for (const m of MODES) {
      const b = modes.createEl("button", { attr: { "aria-label": m.label } });
      setIcon(b.createSpan("trimly-seg-icon"), m.icon);
      b.createSpan({ text: m.label });
      if (m.id === this.mode) b.addClass("is-active");
      b.addEventListener("click", () => this.setMode(m.id));
    }
    if (this.mode === "accounts") this.renderMonthNav(left);

    const actions = top.createDiv("trimly-top-actions");
    if (this.plugin.ledger?.pluggy) {
      const syncing = this.plugin.isSyncing();
      const sync = actions.createEl("button", {
        cls: "clickable-icon",
        attr: { "aria-label": syncing ? "Syncing bank accounts…" : "Sync bank accounts" },
      });
      setIcon(sync, "refresh-cw");
      sync.toggleClass("trimly-spin", syncing);
      sync.disabled = syncing;
      sync.addEventListener("click", () => void this.plugin.syncBank());
    }
    const lock = actions.createEl("button", { cls: "clickable-icon", attr: { "aria-label": "Lock Trimly" } });
    setIcon(lock, "lock");
    lock.addEventListener("click", () => this.plugin.lock());
    if (this.mode === "accounts") {
      const add = actions.createEl("button", { cls: "mod-cta trimly-add" });
      setIcon(add.createSpan("trimly-add-icon"), "plus");
      add.createSpan({ text: "New transaction" });
      add.addEventListener("click", () => this.plugin.openTransactionModal(null));
    }

    const tabs = page.createDiv("trimly-tabs");
    for (const t of TABS[this.mode]) {
      const el = tabs.createEl("button", { cls: "trimly-tab" });
      setIcon(el.createSpan("trimly-tab-icon"), t.icon);
      el.createSpan({ text: t.label });
      if (t.id === this.tabs[this.mode]) el.addClass("is-active");
      el.addEventListener("click", () => this.goTab(t.id));
    }
  }

  private renderMonthNav(parent: HTMLElement) {
    const nav = parent.createDiv("trimly-month-nav");
    const prev = nav.createEl("button", { cls: "clickable-icon", attr: { "aria-label": "Previous month" } });
    setIcon(prev, "chevron-left");
    prev.addEventListener("click", () => this.setMonth(shiftMonth(this.month, -1)));
    nav.createDiv({ cls: "trimly-month-label", text: this.monthLabel(this.month) });
    const next = nav.createEl("button", { cls: "clickable-icon", attr: { "aria-label": "Next month" } });
    setIcon(next, "chevron-right");
    next.addEventListener("click", () => this.setMonth(shiftMonth(this.month, 1)));
    const current = monthOf(todayISO());
    if (this.month !== current) {
      const today = nav.createEl("button", { cls: "trimly-pill", text: "This month" });
      today.addEventListener("click", () => this.setMonth(current));
    }
  }

  private setMonth(m: string) {
    this.month = m;
    this.render();
  }

  // ---- overview ----

  private renderOverview(body: HTMLElement, ledger: Ledger) {
    const monthEnd = `${this.month}-31`;
    const sum = monthSummary(ledger, this.month);
    const activeAccounts = ledger.accounts.filter((a) => !a.archived);
    const positions = openAssets(ledger).length;
    const invested = portfolioValue(ledger, monthEnd);

    // hero: net worth + this month's flow
    const hero = body.createDiv("trimly-hero");
    const left = hero.createDiv("trimly-hero-main");
    left.createDiv({ cls: "trimly-eyebrow", text: "Net worth" });
    left.createDiv({ cls: "trimly-hero-value", text: this.money(netWorth(ledger, monthEnd)) });
    left.createDiv({
      cls: "trimly-muted",
      text:
        `Across ${activeAccounts.length} account${activeAccounts.length === 1 ? "" : "s"}` +
        (invested ? ` and ${this.money(invested)} invested` : "") +
        `, end of ${this.monthLabel(this.month)}`,
    });
    const stats = hero.createDiv("trimly-hero-stats");
    this.heroStat(stats, "Income", sum.income, "arrow-down-left", "is-income");
    this.heroStat(stats, "Expenses", sum.expense, "arrow-up-right", "is-expense");
    const rate = sum.income > 0 ? Math.round((sum.net / sum.income) * 100) : null;
    this.heroStat(stats, rate === null ? "Net" : `Saved · ${rate}%`, sum.net, "piggy-bank", sum.net >= 0 ? "is-accent" : "is-expense");
    if (sum.income > 0 || sum.expense > 0) {
      const flow = hero.createDiv("trimly-flow");
      const spentPct = sum.income > 0 ? Math.min(100, (sum.expense / sum.income) * 100) : 100;
      flow.createDiv("trimly-flow-fill").setCssProps({ "--trimly-pct": `${spentPct}%` });
      if (sum.expense > sum.income) flow.addClass("is-over");
      hero.createDiv({
        cls: "trimly-flow-caption",
        text: sum.income > 0 ? `${Math.round((sum.expense / sum.income) * 100)}% of income spent` : "No income recorded this month",
      });
    }

    const row1 = body.createDiv("trimly-grid");
    this.renderCashFlowCard(row1, ledger);
    this.renderSpendingCard(row1, ledger);

    const row2 = body.createDiv("trimly-grid trimly-grid-3");
    const accCard = this.card(row2, "Accounts", { label: "Manage", onClick: () => this.goTab("accounts") });
    if (activeAccounts.length === 0) this.empty(accCard, "landmark", "No accounts yet.");
    for (const a of activeAccounts) {
      const row = accCard.createDiv("trimly-row is-clickable");
      this.iconTile(row, ACCOUNT_TYPE_ICONS[a.type], "var(--interactive-accent)");
      const main = row.createDiv("trimly-row-main");
      main.createDiv({ cls: "trimly-row-title", text: a.name });
      main.createDiv({ cls: "trimly-row-sub", text: ACCOUNT_TYPE_LABELS[a.type] });
      const bal = accountBalance(ledger, a.id, monthEnd);
      row.createDiv({ cls: `trimly-amount ${bal < 0 ? "is-expense" : ""}`, text: this.money(bal) });
      row.addEventListener("click", () => this.editAccount(a.id));
    }
    if (positions) {
      const row = accCard.createDiv("trimly-row is-clickable");
      this.iconTile(row, "trending-up", "var(--interactive-accent)");
      const main = row.createDiv("trimly-row-main");
      main.createDiv({ cls: "trimly-row-title", text: "Investments" });
      main.createDiv({ cls: "trimly-row-sub", text: `${positions} position${positions === 1 ? "" : "s"}` });
      row.createDiv({ cls: "trimly-amount", text: this.money(invested) });
      row.addEventListener("click", () => this.setMode("investments"));
    }

    const recentCard = this.card(row2, "Recent activity", { label: "All", onClick: () => this.goTab("transactions") });
    const recent = sortTransactions(ledger.transactions.filter((t) => monthOf(t.date) === this.month)).slice(0, 6);
    if (recent.length === 0) {
      this.empty(recentCard, "receipt", "Nothing recorded this month.", {
        label: "Add transaction",
        onClick: () => this.plugin.openTransactionModal(null),
      });
    }
    for (const tx of recent) this.txRow(recentCard, ledger, tx, true);

    const upCard = this.card(row2, "Upcoming", { label: "Recurring", onClick: () => this.goTab("recurring") });
    const today = todayISO();
    const horizon = toISODate(new Date(Date.now() + 30 * 86400000));
    const upcoming = upcomingRecurring(ledger, today, horizon).slice(0, 6);
    if (upcoming.length === 0) this.empty(upCard, "calendar", "No bills or income due in the next 30 days.");
    for (const r of upcoming) this.recurringRow(upCard, ledger, r);
  }

  private heroStat(parent: HTMLElement, label: string, cents: number, icon: string, cls: string) {
    const el = parent.createDiv(`trimly-hero-stat ${cls}`);
    setIcon(el.createDiv("trimly-hero-stat-icon"), icon);
    const txt = el.createDiv();
    txt.createDiv({ cls: "trimly-eyebrow", text: label });
    txt.createDiv({ cls: "trimly-hero-stat-value", text: this.money(cents) });
  }

  private renderCashFlowCard(parent: HTMLElement, ledger: Ledger) {
    const card = this.card(parent, "Cash flow");
    const legend = card.createDiv("trimly-legend-inline");
    legend.createSpan("trimly-key is-income").createSpan({ text: "Income" });
    legend.createSpan("trimly-key is-expense").createSpan({ text: "Expenses" });
    const hist = monthlyHistory(ledger, this.month, 6);
    cashFlowBars(
      card,
      hist.map((h) => ({ label: this.shortMonth(h.month), income: h.income, expense: h.expense, current: h.month === this.month })),
      (g) => `${g.label}: +${this.money(g.income)} / −${this.money(g.expense)}`
    );
    const avgExpense = hist.reduce((s, h) => s + h.expense, 0) / hist.length;
    card.createDiv({ cls: "trimly-muted trimly-card-foot", text: `6-month average spending: ${this.money(Math.round(avgExpense))}` });
  }

  private renderSpendingCard(parent: HTMLElement, ledger: Ledger) {
    const card = this.card(parent, "Spending by category", { label: "Budgets", onClick: () => this.goTab("budgets") });
    const spending = [...spendingByCategory(ledger, this.month).entries()].sort((a, b) => b[1] - a[1]);
    const total = spending.reduce((s, [, v]) => s + v, 0);
    if (total === 0) {
      this.empty(card, "pie-chart", "No expenses this month.");
      return;
    }
    const wrap = card.createDiv("trimly-spending");
    const top = spending.slice(0, 6);
    const rest = spending.slice(6).reduce((s, [, v]) => s + v, 0);
    const slices = top.map(([id, value]) => ({ value, color: this.category(ledger, id)?.color ?? NEUTRAL }));
    if (rest) slices.push({ value: rest, color: NEUTRAL });
    donut(wrap, slices, (c) => {
      c.createDiv({ cls: "trimly-eyebrow", text: "Spent" });
      c.createDiv({ cls: "trimly-donut-value", text: this.money(total) });
    });
    const legend = wrap.createDiv("trimly-legend");
    const item = (name: string, color: string, value: number) => {
      const row = legend.createDiv("trimly-legend-row");
      row.createSpan("trimly-dot").setCssProps({ "--trimly-color": color });
      row.createSpan({ cls: "trimly-legend-name", text: name });
      row.createSpan({ cls: "trimly-legend-pct", text: `${Math.round((value / total) * 100)}%` });
      row.createSpan({ cls: "trimly-amount", text: this.money(value) });
    };
    for (const [id, value] of top) {
      const cat = this.category(ledger, id);
      item(cat?.name ?? "Uncategorized", cat?.color ?? NEUTRAL, value);
    }
    if (rest) item("Other", NEUTRAL, rest);
  }

  private txRow(parent: HTMLElement, ledger: Ledger, tx: Transaction, showDate: boolean) {
    const row = parent.createDiv("trimly-row is-clickable");
    const cat = this.category(ledger, tx.categoryId);
    if (tx.type === "transfer") this.iconTile(row, "arrow-left-right", NEUTRAL);
    else this.iconTile(row, cat?.icon ?? "tag", cat?.color ?? NEUTRAL);
    const main = row.createDiv("trimly-row-main");
    const title = main.createDiv({ cls: "trimly-row-title", text: tx.description });
    if (tx.recurringId) setIcon(title.createSpan({ cls: "trimly-inline-icon", attr: { "aria-label": "Recurring" } }), "repeat");
    const acc = (id?: string) => ledger.accounts.find((a) => a.id === id)?.name ?? "?";
    const parts =
      tx.type === "transfer"
        ? [`${acc(tx.accountId)} → ${acc(tx.toAccountId)}`]
        : [cat?.name ?? "Uncategorized", acc(tx.accountId)];
    if (showDate) parts.unshift(this.shortDate(tx.date));
    main.createDiv({ cls: "trimly-row-sub", text: parts.join(" · ") });
    row.createDiv({ cls: `trimly-amount is-${tx.type}`, text: this.signedMoney(tx.amount, tx.type) });
    row.addEventListener("click", () => this.plugin.openTransactionModal(tx));
  }

  private recurringRow(parent: HTMLElement, ledger: Ledger, r: Recurring) {
    const row = parent.createDiv("trimly-row is-clickable");
    const cat = this.category(ledger, r.categoryId);
    if (r.type === "transfer") this.iconTile(row, "arrow-left-right", NEUTRAL);
    else this.iconTile(row, cat?.icon ?? "tag", cat?.color ?? NEUTRAL);
    const ended = !!r.endDate && r.nextDate > r.endDate;
    if (ended) row.addClass("is-archived");
    const main = row.createDiv("trimly-row-main");
    main.createDiv({ cls: "trimly-row-title", text: r.description });
    main.createDiv({
      cls: "trimly-row-sub",
      text: ended ? `${FREQUENCY_LABELS[r.frequency]} · ended` : `${FREQUENCY_LABELS[r.frequency]} · next ${this.shortDate(r.nextDate)}`,
    });
    row.createDiv({ cls: `trimly-amount is-${r.type}`, text: this.signedMoney(r.amount, r.type) });
    row.addEventListener("click", () => this.editRecurring(r.id));
  }

  // ---- transactions ----

  private renderTransactions(body: HTMLElement, ledger: Ledger) {
    const bar = body.createDiv("trimly-filters");
    const searchWrap = bar.createDiv("trimly-search");
    setIcon(searchWrap.createSpan("trimly-search-icon"), "search");
    const search = searchWrap.createEl("input", { type: "search", placeholder: "Search descriptions and notes" });
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
    const allLabel = bar.createEl("label", { cls: "trimly-toggle-pill" });
    const all = allLabel.createEl("input", { type: "checkbox" });
    all.checked = this.filter.allMonths;
    allLabel.createSpan({ text: "All months" });
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
    const summary = wrap.createDiv("trimly-summary-chips");
    const chip = (label: string, value: string, cls: string) => {
      const c = summary.createDiv(`trimly-summary-chip ${cls}`);
      c.createDiv({ cls: "trimly-eyebrow", text: label });
      c.createDiv({ cls: "trimly-summary-value", text: value });
    };
    chip("Transactions", String(txs.length), "");
    chip("In", `+${this.money(income)}`, "is-income");
    chip("Out", `−${this.money(expense)}`, "is-expense");
    chip("Net", this.money(income - expense), income - expense >= 0 ? "is-income" : "is-expense");

    if (txs.length === 0) {
      const card = wrap.createDiv("trimly-card");
      this.empty(card, "search-x", "No transactions match these filters.");
      return;
    }
    const shown = txs.slice(0, 500);
    let currentDay = "";
    let group: HTMLElement | null = null;
    for (const tx of shown) {
      if (tx.date !== currentDay) {
        currentDay = tx.date;
        const day = wrap.createDiv("trimly-day");
        const head = day.createDiv("trimly-day-head");
        head.createSpan({ text: this.dayHeading(tx.date) });
        const net = shown
          .filter((t) => t.date === tx.date)
          .reduce((s, t) => s + (t.type === "income" ? t.amount : t.type === "expense" ? -t.amount : 0), 0);
        if (net !== 0) head.createSpan({ cls: net > 0 ? "is-income" : "is-expense", text: (net > 0 ? "+" : "−") + this.money(Math.abs(net)) });
        group = day.createDiv("trimly-card trimly-day-card");
      }
      if (group) this.txRow(group, ledger, tx, false);
    }
    if (txs.length > 500) {
      wrap.createDiv({ cls: "trimly-muted", text: `Showing the newest 500 of ${txs.length}. Narrow the filters to see more.` });
    }
  }

  // ---- accounts ----

  private renderAccounts(body: HTMLElement, ledger: Ledger) {
    const head = body.createDiv("trimly-page-head");
    const t = head.createDiv();
    t.createDiv({ cls: "trimly-eyebrow", text: "Net worth" });
    t.createDiv({ cls: "trimly-page-value", text: this.money(netWorth(ledger)) });
    const invested = portfolioValue(ledger);
    if (invested) t.createDiv({ cls: "trimly-muted", text: `Includes ${this.money(invested)} in investments` });

    const grid = body.createDiv("trimly-tiles");
    const sorted = [...ledger.accounts].sort((a, b) => Number(!!a.archived) - Number(!!b.archived));
    for (const a of sorted) {
      const tile = grid.createDiv("trimly-tile is-clickable");
      if (a.archived) tile.addClass("is-archived");
      const top = tile.createDiv("trimly-tile-top");
      this.iconTile(top, ACCOUNT_TYPE_ICONS[a.type], "var(--interactive-accent)");
      top.createDiv({ cls: "trimly-tile-tag", text: a.archived ? "Archived" : ACCOUNT_TYPE_LABELS[a.type] });
      tile.createDiv({ cls: "trimly-tile-name", text: a.name });
      const bal = accountBalance(ledger, a.id);
      tile.createDiv({ cls: `trimly-tile-value ${bal < 0 ? "is-expense" : ""}`, text: this.money(bal) });
      const count = ledger.transactions.filter((tx) => tx.accountId === a.id || tx.toAccountId === a.id).length;
      tile.createDiv({ cls: "trimly-muted", text: `${count} transaction${count === 1 ? "" : "s"}` });
      tile.addEventListener("click", () => this.editAccount(a.id));
    }
    this.addTile(grid, "Add account", () => this.editAccount(null));
  }

  private addTile(grid: HTMLElement, label: string, onClick: () => void) {
    const add = grid.createDiv("trimly-tile trimly-tile-add is-clickable");
    setIcon(add.createDiv("trimly-tile-add-icon"), "plus");
    add.createDiv({ text: label });
    add.addEventListener("click", onClick);
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
    const spending = spendingByCategory(ledger, this.month);
    const expenseCats = ledger.categories.filter((c) => c.kind === "expense");
    const budgeted = expenseCats.filter((c) => ledger.budgets.some((b) => b.categoryId === c.id));
    const unbudgeted = expenseCats.filter((c) => !budgeted.includes(c));

    let totalLimit = 0;
    let totalSpent = 0;
    for (const c of budgeted) {
      totalLimit += ledger.budgets.find((b) => b.categoryId === c.id)?.limit ?? 0;
      totalSpent += spending.get(c.id) ?? 0;
    }
    const head = body.createDiv("trimly-page-head");
    const t = head.createDiv();
    t.createDiv({ cls: "trimly-eyebrow", text: `Budget · ${this.monthLabel(this.month)}` });
    if (totalLimit > 0) {
      const left = totalLimit - totalSpent;
      t.createDiv({ cls: `trimly-page-value ${left < 0 ? "is-expense" : ""}`, text: left >= 0 ? `${this.money(left)} left` : `${this.money(-left)} over` });
      t.createDiv({ cls: "trimly-muted", text: `${this.money(totalSpent)} spent of ${this.money(totalLimit)}` });
      this.progress(head, totalSpent, totalLimit, "var(--interactive-accent)");
    } else {
      t.createDiv({ cls: "trimly-page-value", text: "No budgets yet" });
      t.createDiv({ cls: "trimly-muted", text: "Set a monthly limit on a category below to start tracking." });
    }

    if (budgeted.length) {
      const grid = body.createDiv("trimly-tiles");
      for (const c of budgeted) {
        const limit = ledger.budgets.find((b) => b.categoryId === c.id)?.limit ?? 0;
        const spent = spending.get(c.id) ?? 0;
        const tile = grid.createDiv("trimly-tile");
        const top = tile.createDiv("trimly-tile-top");
        this.iconTile(top, c.icon ?? "tag", c.color);
        const pct = limit > 0 ? Math.round((spent / limit) * 100) : 0;
        top.createDiv({ cls: `trimly-tile-tag ${spent > limit ? "is-expense" : ""}`, text: `${pct}%` });
        tile.createDiv({ cls: "trimly-tile-name", text: c.name });
        const left = limit - spent;
        tile.createDiv({
          cls: `trimly-tile-value ${left < 0 ? "is-expense" : ""}`,
          text: left >= 0 ? `${this.money(left)} left` : `${this.money(-left)} over`,
        });
        this.progress(tile, spent, limit, c.color);
        const foot = tile.createDiv("trimly-tile-foot");
        foot.createSpan({ cls: "trimly-muted", text: `${this.money(spent)} of` });
        this.limitInput(foot, c.id, limit);
      }
    }

    if (unbudgeted.length) {
      const card = this.card(body, "Without a budget");
      for (const c of unbudgeted) {
        const row = card.createDiv("trimly-row");
        this.iconTile(row, c.icon ?? "tag", c.color);
        const main = row.createDiv("trimly-row-main");
        main.createDiv({ cls: "trimly-row-title", text: c.name });
        main.createDiv({ cls: "trimly-row-sub", text: `${this.money(spending.get(c.id) ?? 0)} spent this month` });
        this.limitInput(row, c.id, 0);
      }
    }
  }

  private progress(parent: HTMLElement, value: number, max: number, color: string) {
    const track = parent.createDiv("trimly-progress");
    const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
    const fill = track.createDiv("trimly-progress-fill");
    fill.setCssProps({ "--trimly-pct": `${pct}%`, "--trimly-color": color });
    if (value > max) fill.addClass("is-over");
    else if (pct >= 85) fill.addClass("is-warn");
  }

  private limitInput(parent: HTMLElement, categoryId: string, limit: number) {
    const input = parent.createEl("input", { cls: "trimly-limit-input", type: "text", placeholder: "Set limit" });
    input.inputMode = "decimal";
    if (limit) input.value = centsToInput(limit);
    input.addEventListener("click", (e) => e.stopPropagation());
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") input.blur();
    });
    input.addEventListener("change", () => {
      const v = input.value.trim();
      const cents = v ? parseAmount(v) : 0;
      if (cents === null) {
        new Notice("Not a valid amount.");
        return;
      }
      void this.plugin.mutate((l) => {
        l.budgets = l.budgets.filter((b) => b.categoryId !== categoryId);
        if (cents > 0) l.budgets.push({ categoryId, limit: cents });
      });
    });
  }

  // ---- recurring ----

  private renderRecurring(body: HTMLElement, ledger: Ledger) {
    let monthlyOut = 0;
    let monthlyIn = 0;
    for (const r of ledger.recurring) {
      if (r.endDate && r.nextDate > r.endDate) continue;
      const factor = r.frequency === "weekly" ? 52 / 12 : r.frequency === "yearly" ? 1 / 12 : 1;
      if (r.type === "expense") monthlyOut += r.amount * factor;
      if (r.type === "income") monthlyIn += r.amount * factor;
    }
    const summary = body.createDiv("trimly-summary-chips");
    const chip = (label: string, value: string, cls: string) => {
      const c = summary.createDiv(`trimly-summary-chip ${cls}`);
      c.createDiv({ cls: "trimly-eyebrow", text: label });
      c.createDiv({ cls: "trimly-summary-value", text: value });
    };
    chip("Fixed income / month", `+${this.money(Math.round(monthlyIn))}`, "is-income");
    chip("Fixed costs / month", `−${this.money(Math.round(monthlyOut))}`, "is-expense");
    chip("Left after fixed", this.money(Math.round(monthlyIn - monthlyOut)), monthlyIn >= monthlyOut ? "is-income" : "is-expense");

    const card = this.card(body, "Recurring transactions", { label: "Add", onClick: () => this.editRecurring(null) });
    if (ledger.recurring.length === 0) {
      this.empty(card, "repeat", "Add bills, subscriptions and salaries. They post automatically when due.", {
        label: "Add recurring",
        onClick: () => this.editRecurring(null),
      });
    }
    const sorted = [...ledger.recurring].sort((a, b) => (a.nextDate < b.nextDate ? -1 : 1));
    for (const r of sorted) this.recurringRow(card, ledger, r);
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

  // ---- investments ----

  private pct(value: number, digits = 1) {
    return `${new Intl.NumberFormat(this.plugin.locale(), { maximumFractionDigits: digits }).format(value)}%`;
  }

  /** "110% CDI", "IPCA + 5% p.a.", "12% p.a."; empty when unknown. */
  private rateLabel(a: Asset) {
    const fixed = a.fixedRate ? `${this.pct(a.fixedRate, 2)} p.a.` : "";
    if (!a.rateType) return fixed;
    if (fixed) return a.rate && a.rate !== 100 ? `${this.pct(a.rate, 2)} ${a.rateType} + ${fixed}` : `${a.rateType} + ${fixed}`;
    return a.rate ? `${this.pct(a.rate, 2)} ${a.rateType}` : a.rateType;
  }

  private longDate(iso: string) {
    return this.fmt({ day: "numeric", month: "short", year: "numeric" }, this.parseDate(iso));
  }

  private assetRow(parent: HTMLElement, a: Asset) {
    const row = parent.createDiv("trimly-row");
    if (a.closed) row.addClass("is-archived");
    this.iconTile(row, ASSET_CLASS_ICONS[a.assetClass], ASSET_CLASS_COLORS[a.assetClass]);
    const main = row.createDiv("trimly-row-main");
    main.createDiv({ cls: "trimly-row-title", text: a.code && !a.name.includes(a.code) ? `${a.code} · ${a.name}` : a.name });
    const sub = [a.institution, this.rateLabel(a), a.dueDate && `due ${this.longDate(a.dueDate)}`].filter(Boolean);
    if (a.quantity && (a.assetClass === "stock" || a.assetClass === "reit" || a.assetClass === "etf")) sub.unshift(`${a.quantity} units`);
    main.createDiv({ cls: "trimly-row-sub", text: sub.join(" · ") || ASSET_CLASS_LABELS[a.assetClass] });
    const end = row.createDiv("trimly-row-end");
    end.createDiv({ cls: "trimly-amount", text: this.money(a.value) });
    if (a.invested) {
      const p = a.value - a.invested;
      end.createDiv({
        cls: `trimly-row-sub ${p >= 0 ? "is-income" : "is-expense"}`,
        text: `${p >= 0 ? "+" : "−"}${this.money(Math.abs(p))} · ${this.pct((p / a.invested) * 100)}`,
      });
    }
  }

  private emptyInvestments(parent: HTMLElement) {
    const card = parent.createDiv("trimly-card");
    this.empty(
      card,
      "trending-up",
      this.plugin.ledger?.pluggy
        ? "No investments found. Bank sync imports them when the connected Pluggy items include the investments product."
        : "Investments are imported by bank sync. Set up Pluggy in Trimly's settings to bring them in."
    );
  }

  private renderInvestmentsOverview(body: HTMLElement, ledger: Ledger) {
    const assets = openAssets(ledger);
    if (assets.length === 0) return this.emptyInvestments(body);
    const total = portfolioValue(ledger);
    const cost = portfolioInvested(ledger);
    const updated = assets.reduce((d, a) => (a.updatedAt > d ? a.updatedAt : d), "");

    const hero = body.createDiv("trimly-hero");
    const left = hero.createDiv("trimly-hero-main");
    left.createDiv({ cls: "trimly-eyebrow", text: "Portfolio" });
    left.createDiv({ cls: "trimly-hero-value", text: this.money(total) });
    left.createDiv({
      cls: "trimly-muted",
      text: `${assets.length} position${assets.length === 1 ? "" : "s"} · updated ${this.longDate(updated)}`,
    });
    const stats = hero.createDiv("trimly-hero-stats");
    this.heroStat(stats, "Invested", cost, "piggy-bank", "is-accent");
    const gain = total - cost;
    this.heroStat(
      stats,
      cost > 0 ? `Profit · ${this.pct((gain / cost) * 100)}` : "Profit",
      gain,
      gain >= 0 ? "arrow-up-right" : "arrow-down-right",
      gain >= 0 ? "is-income" : "is-expense"
    );
    const taxes = assets.reduce((s, a) => s + (a.grossValue !== undefined ? Math.max(0, a.grossValue - a.value) : 0), 0);
    this.heroStat(stats, "Taxes and fees due", taxes, "receipt", "is-expense");

    const row1 = body.createDiv("trimly-grid");
    this.renderAllocationCard(row1, ledger, total);
    const instCard = this.card(row1, "By institution");
    const byInst = new Map<string, number>();
    for (const a of assets) {
      const name = a.institution ?? "Unknown";
      byInst.set(name, (byInst.get(name) ?? 0) + a.value);
    }
    for (const [name, value] of [...byInst.entries()].sort((a, b) => b[1] - a[1])) {
      const row = instCard.createDiv("trimly-inst-row");
      const head = row.createDiv("trimly-legend-row");
      head.createSpan({ cls: "trimly-legend-name", text: name });
      head.createSpan({ cls: "trimly-legend-pct", text: this.pct((value / total) * 100, 0) });
      head.createSpan({ cls: "trimly-amount", text: this.money(value) });
      this.progress(row, value, total, "var(--interactive-accent)");
    }

    const row2 = body.createDiv("trimly-grid");
    const topCard = this.card(row2, "Largest positions", { label: "Portfolio", onClick: () => this.goTab("portfolio") });
    for (const a of [...assets].sort((x, y) => y.value - x.value).slice(0, 6)) this.assetRow(topCard, a);

    const dueCard = this.card(row2, "Upcoming maturities");
    const today = todayISO();
    const horizon = toISODate(new Date(Date.now() + MATURITY_HORIZON_DAYS * 86400000));
    const due = assets
      .filter((a): a is Asset & { dueDate: string } => !!a.dueDate && a.dueDate >= today && a.dueDate <= horizon)
      .sort((x, y) => (x.dueDate < y.dueDate ? -1 : 1));
    if (due.length === 0) this.empty(dueCard, "calendar", "Nothing matures in the next 12 months.");
    for (const a of due.slice(0, 6)) this.assetRow(dueCard, a);
  }

  private renderAllocationCard(parent: HTMLElement, ledger: Ledger, total: number) {
    const card = this.card(parent, "Allocation");
    const wrap = card.createDiv("trimly-spending");
    const alloc = allocationByClass(ledger);
    donut(
      wrap,
      alloc.map(([c, value]) => ({ value, color: ASSET_CLASS_COLORS[c] })),
      (c) => {
        c.createDiv({ cls: "trimly-eyebrow", text: "Classes" });
        c.createDiv({ cls: "trimly-donut-value", text: String(alloc.length) });
      }
    );
    const legend = wrap.createDiv("trimly-legend");
    for (const [c, value] of alloc) {
      const row = legend.createDiv("trimly-legend-row");
      row.createSpan("trimly-dot").setCssProps({ "--trimly-color": ASSET_CLASS_COLORS[c] });
      row.createSpan({ cls: "trimly-legend-name", text: ASSET_CLASS_LABELS[c] });
      row.createSpan({ cls: "trimly-legend-pct", text: this.pct((value / total) * 100, 0) });
      row.createSpan({ cls: "trimly-amount", text: this.money(value) });
    }
  }

  private renderPortfolio(body: HTMLElement, ledger: Ledger) {
    const assets = openAssets(ledger);
    const closed = ledger.investments.assets.filter((a) => a.closed);
    if (assets.length === 0 && closed.length === 0) return this.emptyInvestments(body);
    const total = portfolioValue(ledger);

    const head = body.createDiv("trimly-page-head");
    const t = head.createDiv();
    t.createDiv({ cls: "trimly-eyebrow", text: "Portfolio" });
    t.createDiv({ cls: "trimly-page-value", text: this.money(total) });

    const byClass = new Map<AssetClass, Asset[]>();
    for (const a of assets) byClass.set(a.assetClass, [...(byClass.get(a.assetClass) ?? []), a]);
    for (const [c, value] of allocationByClass(ledger)) {
      const list = (byClass.get(c) ?? []).sort((x, y) => y.value - x.value);
      body.createDiv({ cls: "trimly-section-title", text: `${ASSET_CLASS_LABELS[c]} · ${this.money(value)} · ${this.pct((value / total) * 100, 0)}` });
      const card = body.createDiv("trimly-card");
      for (const a of list) this.assetRow(card, a);
    }
    // the allocation leaves out positions worth nothing, but they are still held
    const zero = assets.filter((a) => a.value <= 0);
    if (zero.length) {
      body.createDiv({ cls: "trimly-section-title", text: "No value reported" });
      const card = body.createDiv("trimly-card");
      for (const a of zero) this.assetRow(card, a);
    }
    if (closed.length) {
      body.createDiv({ cls: "trimly-section-title", text: `Closed · ${closed.length}` });
      const card = body.createDiv("trimly-card");
      for (const a of closed) this.assetRow(card, a);
    }
  }

  // ---- categories ----

  private renderCategories(body: HTMLElement, ledger: Ledger) {
    const kinds: { kind: CategoryKind; title: string }[] = [
      { kind: "expense", title: "Expenses" },
      { kind: "income", title: "Income" },
    ];
    for (const { kind, title } of kinds) {
      body.createDiv({ cls: "trimly-section-title", text: title });
      const grid = body.createDiv("trimly-tiles trimly-tiles-compact");
      for (const c of ledger.categories.filter((x) => x.kind === kind)) {
        const tile = grid.createDiv("trimly-tile trimly-tile-row is-clickable");
        this.iconTile(tile, c.icon ?? "tag", c.color);
        const main = tile.createDiv("trimly-row-main");
        main.createDiv({ cls: "trimly-row-title", text: c.name });
        const used = ledger.transactions.filter((tx) => tx.categoryId === c.id).length;
        main.createDiv({ cls: "trimly-row-sub", text: `${used} transaction${used === 1 ? "" : "s"}` });
        tile.addEventListener("click", () => this.editCategory(c.id, kind));
      }
      this.addTile(grid, "Add category", () => this.editCategory(null, kind));
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
