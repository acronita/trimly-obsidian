import { ItemView, Menu, Modal, Notice, Setting, WorkspaceLeaf, setIcon } from "obsidian";
import type TrimlyPlugin from "./main";
import { LineSeries, bars, cashFlowBars, donut, lineChart } from "./charts";
import { AccountModal, AssetModal, CategoryModal, ConfirmModal, MovementModal, ObligationModal, RecurringModal, SettleModal, TransactionModal } from "./modals";
import {
  ACCOUNT_TYPE_ICONS,
  ASSET_CLASS_COLORS,
  ASSET_CLASS_ICONS,
  Account,
  Asset,
  AssetClass,
  Category,
  CategoryKind,
  Ledger,
  MOVEMENT_ICONS,
  Movement,
  MovementType,
  Obligation,
  ObligationKind,
  Recurring,
  Transaction,
  TxType,
  accountBalance,
  accountInUse,
  cardBills,
  allocationByClass,
  applyInstitutionToConnection,
  centsToInput,
  incomeByMonth,
  movementFlow,
  monthOf,
  monthSummary,
  monthlyAmount,
  monthlyHistory,
  netWorth,
  openAssets,
  parseAmount,
  portfolioInvested,
  portfolioValue,
  rebalance,
  postDueRecurring,
  ruleTransactions,
  daysUntil,
  dueObligations,
  nextDue,
  paymentCandidates,
  settleObligation,
  unsettleObligation,
  removeCategory,
  removeManualAsset,
  removeManualMovement,
  saveAsset,
  saveManualMovement,
  shiftMonth,
  sortTransactions,
  spendingByCategory,
  todayISO,
  toISODate,
  upcomingRecurring,
} from "./ledger";
import { t } from "./i18n";
import type { Strings } from "./i18n";
import { averagePrice, institutionOf, tickerOf } from "./quotes";
import { IndexPoint, cdiReturn, ipcaReturn, monthlyReturns, periodReturn, portfolioIndex } from "./returns";

export const VIEW_TYPE_TRIMLY = "trimly-dashboard";

type Mode = "accounts" | "investments";
type Tab = "overview" | "transactions" | "accounts" | "budgets" | "recurring" | "obligations" | "categories" | "inv-overview" | "portfolio" | "performance" | "movements" | "income" | "targets";

const MODES: { id: Mode; label: () => string; icon: string }[] = [
  { id: "accounts", label: () => t.header.modeAccounts, icon: "wallet" },
  { id: "investments", label: () => t.header.modeInvestments, icon: "trending-up" },
];

/** `label` names the tab's entry in the dictionary, read at render time so a language switch applies. */
const TABS: Record<Mode, { id: Tab; label: keyof Strings["tabs"]; icon: string }[]> = {
  accounts: [
    { id: "overview", label: "overview", icon: "layout-dashboard" },
    { id: "transactions", label: "transactions", icon: "arrow-left-right" },
    { id: "accounts", label: "accounts", icon: "landmark" },
    { id: "budgets", label: "budgets", icon: "target" },
    { id: "recurring", label: "recurring", icon: "repeat" },
    { id: "obligations", label: "obligations", icon: "clipboard-check" },
    { id: "categories", label: "categories", icon: "tags" },
  ],
  investments: [
    { id: "inv-overview", label: "overview", icon: "layout-dashboard" },
    { id: "portfolio", label: "portfolio", icon: "briefcase" },
    { id: "performance", label: "performance", icon: "line-chart" },
    { id: "movements", label: "movements", icon: "arrow-left-right" },
    { id: "income", label: "income", icon: "coins" },
    { id: "targets", label: "targets", icon: "target" },
  ],
};

/** Maturities shown on the investments overview. */
const MATURITY_HORIZON_DAYS = 365;

const NEUTRAL = "#8a8a8a";
const OVERDUE = "#cc4125";

const OBLIGATION_ICONS: Record<ObligationKind, string> = { payment: "receipt", document: "file-text" };

/** "vence amanhã", "atrasada há 3 dias", … */
export function dueWhen(today: string, due: string): string {
  const days = daysUntil(today, due);
  const o = t.obligations;
  if (days < 0) return o.overdueBy(-days);
  if (days === 0) return o.dueToday;
  if (days === 1) return o.dueTomorrow;
  return o.dueIn(days);
}

interface TxFilter {
  text: string;
  accountId: string;
  categoryId: string;
  type: string;
  allMonths: boolean;
}

interface MovementFilter {
  assetId: string;
  type: string;
  /** off = last 12 months */
  allTime: boolean;
}

export class TrimlyView extends ItemView {
  private mode: Mode = "accounts";
  /** active tab of each mode, so switching back returns to it */
  private tabs: Record<Mode, Tab> = { accounts: "overview", investments: "inv-overview" };
  private month = monthOf(todayISO());
  private filter: TxFilter = { text: "", accountId: "", categoryId: "", type: "", allMonths: false };
  private movementFilter: MovementFilter = { assetId: "", type: "", allTime: false };
  /** amount typed in the Targets tab to plan a contribution, in cents; not saved */
  private contribution = 0;

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
      case "obligations":
        this.renderObligations(body, ledger);
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
      case "performance":
        this.renderPerformance(body, ledger);
        break;
      case "movements":
        this.renderMovements(body, ledger);
        break;
      case "income":
        this.renderIncome(body, ledger);
        break;
      case "targets":
        this.renderTargets(body, ledger);
        break;
    }
    root.scrollTop = scroll;
  }

  // ---- shared bits ----

  private money(cents: number) {
    return this.plugin.settings.hideValues ? "••••••" : this.plugin.formatMoney(cents);
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
    if (iso === today) return t.common.today;
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    if (iso === toISODate(yesterday)) return t.common.yesterday;
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

  /** Opened from an obligation reminder. */
  showObligations() {
    this.mode = "accounts";
    this.goTab("obligations");
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
    box.createDiv({ cls: "trimly-locked-title", text: t.locked.title });
    box.createDiv({ cls: "trimly-locked-text", text: t.locked.text });
    const btn = box.createEl("button", { cls: "mod-cta", text: t.locked.unlock });
    btn.addEventListener("click", () => void this.plugin.unlock());
  }

  // ---- header ----

  private renderHeader(page: HTMLElement) {
    const top = page.createDiv("trimly-topbar");
    const left = top.createDiv("trimly-top-left");
    const modes = left.createDiv("trimly-segmented");
    for (const m of MODES) {
      const b = modes.createEl("button", { attr: { "aria-label": m.label() } });
      setIcon(b.createSpan("trimly-seg-icon"), m.icon);
      b.createSpan({ text: m.label() });
      if (m.id === this.mode) b.addClass("is-active");
      b.addEventListener("click", () => this.setMode(m.id));
    }
    if (this.mode === "accounts") this.renderMonthNav(left);

    const actions = top.createDiv("trimly-top-actions");
    const hidden = this.plugin.settings.hideValues;
    const eye = actions.createEl("button", {
      cls: "clickable-icon",
      attr: { "aria-label": hidden ? t.header.showValues : t.header.hideValues },
    });
    setIcon(eye, hidden ? "eye-off" : "eye");
    eye.addEventListener("click", () => {
      this.plugin.settings.hideValues = !hidden;
      void this.plugin.saveSettings();
      this.plugin.refreshViews();
    });
    if (this.plugin.canSync()) {
      const syncing = this.plugin.isSyncing();
      const sync = actions.createEl("button", {
        cls: "clickable-icon",
        attr: { "aria-label": syncing ? t.header.syncing : t.header.sync },
      });
      setIcon(sync, "refresh-cw");
      sync.toggleClass("trimly-spin", syncing);
      sync.disabled = syncing;
      sync.addEventListener("click", () => void this.plugin.sync());
    }
    const lock = actions.createEl("button", { cls: "clickable-icon", attr: { "aria-label": t.header.lock } });
    setIcon(lock, "lock");
    lock.addEventListener("click", () => this.plugin.lock());
    const add = actions.createEl("button", { cls: "mod-cta trimly-add" });
    setIcon(add.createSpan("trimly-add-icon"), "plus");
    if (this.mode === "accounts") {
      add.createSpan({ text: t.header.newTransaction });
      add.addEventListener("click", () => this.plugin.openTransactionModal(null));
    } else {
      add.createSpan({ text: t.header.add });
      add.addEventListener("click", (e) => {
        new Menu()
          .addItem((i) => i.setTitle(t.header.newPosition).setIcon("briefcase").onClick(() => this.editAsset(null)))
          .addItem((i) => i.setTitle(t.header.newMovement).setIcon("arrow-left-right").onClick(() => this.editMovement(null)))
          .showAtMouseEvent(e);
      });
    }

    const tabs = page.createDiv("trimly-tabs");
    for (const tab of TABS[this.mode]) {
      const el = tabs.createEl("button", { cls: "trimly-tab" });
      setIcon(el.createSpan("trimly-tab-icon"), tab.icon);
      el.createSpan({ text: t.tabs[tab.label] });
      if (tab.id === this.tabs[this.mode]) el.addClass("is-active");
      el.addEventListener("click", () => this.goTab(tab.id));
    }
  }

  private renderMonthNav(parent: HTMLElement) {
    const nav = parent.createDiv("trimly-month-nav");
    const prev = nav.createEl("button", { cls: "clickable-icon", attr: { "aria-label": t.header.previousMonth } });
    setIcon(prev, "chevron-left");
    prev.addEventListener("click", () => this.setMonth(shiftMonth(this.month, -1)));
    nav.createDiv({ cls: "trimly-month-label", text: this.monthLabel(this.month) });
    const next = nav.createEl("button", { cls: "clickable-icon", attr: { "aria-label": t.header.nextMonth } });
    setIcon(next, "chevron-right");
    next.addEventListener("click", () => this.setMonth(shiftMonth(this.month, 1)));
    const current = monthOf(todayISO());
    if (this.month !== current) {
      const today = nav.createEl("button", { cls: "trimly-pill", text: t.common.thisMonth });
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
    left.createDiv({ cls: "trimly-eyebrow", text: t.overview.netWorth });
    left.createDiv({ cls: "trimly-hero-value", text: this.money(netWorth(ledger, monthEnd)) });
    left.createDiv({
      cls: "trimly-muted",
      text: t.overview.across(activeAccounts.length, invested ? this.money(invested) : null, this.monthLabel(this.month)),
    });
    const stats = hero.createDiv("trimly-hero-stats");
    this.heroStat(stats, t.common.income, sum.income, "arrow-down-left", "is-income");
    this.heroStat(stats, t.common.expenses, sum.expense, "arrow-up-right", "is-expense");
    const rate = sum.income > 0 ? Math.round((sum.net / sum.income) * 100) : null;
    this.heroStat(stats, rate === null ? t.common.net : t.overview.saved(rate), sum.net, "piggy-bank", sum.net >= 0 ? "is-accent" : "is-expense");
    if (sum.income > 0 || sum.expense > 0) {
      const flow = hero.createDiv("trimly-flow");
      const spentPct = sum.income > 0 ? Math.min(100, (sum.expense / sum.income) * 100) : 100;
      flow.createDiv("trimly-flow-fill").setCssProps({ "--trimly-pct": `${spentPct}%` });
      if (sum.expense > sum.income) flow.addClass("is-over");
      hero.createDiv({
        cls: "trimly-flow-caption",
        text: sum.income > 0 ? t.overview.incomeSpent(Math.round((sum.expense / sum.income) * 100)) : t.overview.noIncome,
      });
    }

    const row1 = body.createDiv("trimly-grid");
    this.renderCashFlowCard(row1, ledger);
    this.renderSpendingCard(row1, ledger);

    const row2 = body.createDiv("trimly-grid trimly-grid-3");
    const accCard = this.card(row2, t.overview.accounts, { label: t.overview.manage, onClick: () => this.goTab("accounts") });
    if (activeAccounts.length === 0) this.empty(accCard, "landmark", t.overview.noAccounts);
    for (const a of activeAccounts) {
      const row = accCard.createDiv("trimly-row is-clickable");
      this.iconTile(row, ACCOUNT_TYPE_ICONS[a.type], "var(--interactive-accent)");
      const main = row.createDiv("trimly-row-main");
      main.createDiv({ cls: "trimly-row-title", text: a.name });
      if (a.type === "credit") {
        const open = cardBills(ledger, a.id, todayISO()).open;
        main.createDiv({ cls: "trimly-row-sub", text: t.accounts.openBill(this.shortDate(open.close)) });
        row.createDiv({ cls: "trimly-amount", text: this.money(open.remaining) });
      } else {
        main.createDiv({ cls: "trimly-row-sub", text: t.labels.accountType[a.type] });
        const bal = accountBalance(ledger, a.id, monthEnd);
        row.createDiv({ cls: `trimly-amount ${bal < 0 ? "is-expense" : ""}`, text: this.money(bal) });
      }
      row.addEventListener("click", () => this.editAccount(a.id));
    }
    if (positions) {
      const row = accCard.createDiv("trimly-row is-clickable");
      this.iconTile(row, "trending-up", "var(--interactive-accent)");
      const main = row.createDiv("trimly-row-main");
      main.createDiv({ cls: "trimly-row-title", text: t.overview.investments });
      main.createDiv({ cls: "trimly-row-sub", text: t.overview.positions(positions) });
      row.createDiv({ cls: "trimly-amount", text: this.money(invested) });
      row.addEventListener("click", () => this.setMode("investments"));
    }

    const recentCard = this.card(row2, t.overview.recent, { label: t.overview.seeAll, onClick: () => this.goTab("transactions") });
    const recent = sortTransactions(ledger.transactions.filter((t) => monthOf(t.date) === this.month)).slice(0, 6);
    if (recent.length === 0) {
      this.empty(recentCard, "receipt", t.overview.nothingThisMonth, {
        label: t.overview.addTransaction,
        onClick: () => this.plugin.openTransactionModal(null),
      });
    }
    for (const tx of recent) this.txRow(recentCard, ledger, tx, true);

    const upCard = this.card(row2, t.overview.upcoming, { label: t.overview.recurringLink, onClick: () => this.goTab("recurring") });
    const today = todayISO();
    const horizon = toISODate(new Date(Date.now() + 30 * 86400000));
    const upcoming = upcomingRecurring(ledger, today, horizon).slice(0, 6);
    if (upcoming.length === 0) this.empty(upCard, "calendar", t.overview.nothingUpcoming);
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
    const card = this.card(parent, t.overview.cashFlow);
    const legend = card.createDiv("trimly-legend-inline");
    legend.createSpan("trimly-key is-income").createSpan({ text: t.common.income });
    legend.createSpan("trimly-key is-expense").createSpan({ text: t.common.expenses });
    const hist = monthlyHistory(ledger, this.month, 6);
    cashFlowBars(
      card,
      hist.map((h) => ({ label: this.shortMonth(h.month), income: h.income, expense: h.expense, current: h.month === this.month })),
      (g) => `${g.label}: +${this.money(g.income)} / −${this.money(g.expense)}`
    );
    const avgExpense = hist.reduce((s, h) => s + h.expense, 0) / hist.length;
    card.createDiv({ cls: "trimly-muted trimly-card-foot", text: t.overview.avgSpending(this.money(Math.round(avgExpense))) });
  }

  private renderSpendingCard(parent: HTMLElement, ledger: Ledger) {
    const card = this.card(parent, t.overview.spendingByCategory, { label: t.overview.budgetsLink, onClick: () => this.goTab("budgets") });
    const spending = [...spendingByCategory(ledger, this.month).entries()].sort((a, b) => b[1] - a[1]);
    const total = spending.reduce((s, [, v]) => s + v, 0);
    if (total === 0) {
      this.empty(card, "pie-chart", t.overview.noExpenses);
      return;
    }
    const wrap = card.createDiv("trimly-spending");
    const top = spending.slice(0, 6);
    const rest = spending.slice(6).reduce((s, [, v]) => s + v, 0);
    const slices = top.map(([id, value]) => ({ value, color: this.category(ledger, id)?.color ?? NEUTRAL }));
    if (rest) slices.push({ value: rest, color: NEUTRAL });
    donut(wrap, slices, (c) => {
      c.createDiv({ cls: "trimly-eyebrow", text: t.overview.spent });
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
      item(cat?.name ?? t.common.uncategorized, cat?.color ?? NEUTRAL, value);
    }
    if (rest) item(t.common.other, NEUTRAL, rest);
  }

  private txRow(parent: HTMLElement, ledger: Ledger, tx: Transaction, showDate: boolean) {
    const row = parent.createDiv("trimly-row is-clickable");
    const cat = this.category(ledger, tx.categoryId);
    if (tx.type === "transfer") this.iconTile(row, "arrow-left-right", NEUTRAL);
    else this.iconTile(row, cat?.icon ?? "tag", cat?.color ?? NEUTRAL);
    const main = row.createDiv("trimly-row-main");
    const title = main.createDiv({ cls: "trimly-row-title", text: tx.description });
    if (tx.recurringId) setIcon(title.createSpan({ cls: "trimly-inline-icon", attr: { "aria-label": t.tx.recurring } }), "repeat");
    const acc = (id?: string) => ledger.accounts.find((a) => a.id === id)?.name ?? "?";
    const parts =
      tx.type === "transfer"
        ? [`${acc(tx.accountId)} → ${acc(tx.toAccountId)}`]
        : [cat?.name ?? t.common.uncategorized, acc(tx.accountId)];
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
      text: ended
        ? t.recurring.ended(t.labels.frequency[r.frequency])
        : t.recurring.next(t.labels.frequency[r.frequency], this.shortDate(r.nextDate)),
    });
    row.createDiv({ cls: `trimly-amount is-${r.type}`, text: this.signedMoney(r.amount, r.type) });
    row.addEventListener("click", () => this.editRecurring(r.id));
  }

  // ---- transactions ----

  private renderTransactions(body: HTMLElement, ledger: Ledger) {
    const bar = body.createDiv("trimly-filters");
    const searchWrap = bar.createDiv("trimly-search");
    setIcon(searchWrap.createSpan("trimly-search-icon"), "search");
    const search = searchWrap.createEl("input", { type: "search", placeholder: t.tx.search });
    search.value = this.filter.text;
    const select = (options: Record<string, string>, value: string, onChange: (v: string) => void) => {
      const s = bar.createEl("select", { cls: "dropdown" });
      for (const [k, v] of Object.entries(options)) s.createEl("option", { value: k, text: v });
      s.value = value;
      s.addEventListener("change", () => onChange(s.value));
    };
    const accounts: Record<string, string> = { "": t.tx.allAccounts };
    for (const a of ledger.accounts) accounts[a.id] = a.name;
    const categories: Record<string, string> = { "": t.tx.allCategories, none: t.common.uncategorized };
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
      { "": t.tx.allTypes, expense: t.common.expenses, income: t.common.income, transfer: t.common.transfers },
      this.filter.type,
      (v) => ((this.filter.type = v), renderList())
    );
    const allLabel = bar.createEl("label", { cls: "trimly-toggle-pill" });
    const all = allLabel.createEl("input", { type: "checkbox" });
    all.checked = this.filter.allMonths;
    allLabel.createSpan({ text: t.tx.allMonths });
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
    chip(t.tx.count, String(txs.length), "");
    chip(t.tx.in, `+${this.money(income)}`, "is-income");
    chip(t.tx.out, `−${this.money(expense)}`, "is-expense");
    chip(t.common.net, this.money(income - expense), income - expense >= 0 ? "is-income" : "is-expense");

    if (txs.length === 0) {
      const card = wrap.createDiv("trimly-card");
      this.empty(card, "search-x", t.tx.noMatch);
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
      wrap.createDiv({ cls: "trimly-muted", text: t.common.showingNewest(txs.length) });
    }
  }

  // ---- accounts ----

  private renderAccounts(body: HTMLElement, ledger: Ledger) {
    const head = body.createDiv("trimly-page-head");
    const h = head.createDiv();
    h.createDiv({ cls: "trimly-eyebrow", text: t.overview.netWorth });
    h.createDiv({ cls: "trimly-page-value", text: this.money(netWorth(ledger)) });
    const invested = portfolioValue(ledger);
    if (invested) h.createDiv({ cls: "trimly-muted", text: t.accounts.includesInvestments(this.money(invested)) });

    const grid = body.createDiv("trimly-tiles");
    const sorted = [...ledger.accounts].sort((a, b) => Number(!!a.archived) - Number(!!b.archived));
    for (const a of sorted) {
      const tile = grid.createDiv("trimly-tile is-clickable");
      if (a.archived) tile.addClass("is-archived");
      const top = tile.createDiv("trimly-tile-top");
      this.iconTile(top, ACCOUNT_TYPE_ICONS[a.type], "var(--interactive-accent)");
      top.createDiv({ cls: "trimly-tile-tag", text: a.archived ? t.accounts.archived : t.labels.accountType[a.type] });
      tile.createDiv({ cls: "trimly-tile-name", text: a.name });
      const bal = accountBalance(ledger, a.id);
      if (a.type === "credit") this.cardBillLines(tile, ledger, a, bal);
      else tile.createDiv({ cls: `trimly-tile-value ${bal < 0 ? "is-expense" : ""}`, text: this.money(bal) });
      const count = ledger.transactions.filter((tx) => tx.accountId === a.id || tx.toAccountId === a.id).length;
      tile.createDiv({ cls: "trimly-muted", text: t.accounts.txCount(count) });
      tile.addEventListener("click", () => this.editAccount(a.id));
    }
    const positions = openAssets(ledger).length;
    if (positions) {
      const tile = grid.createDiv("trimly-tile is-clickable");
      const top = tile.createDiv("trimly-tile-top");
      this.iconTile(top, "trending-up", "var(--interactive-accent)");
      top.createDiv({ cls: "trimly-tile-tag", text: t.overview.positions(positions) });
      tile.createDiv({ cls: "trimly-tile-name", text: t.overview.investments });
      tile.createDiv({ cls: "trimly-tile-value", text: this.money(invested) });
      tile.addEventListener("click", () => this.setMode("investments"));
    }
    this.addTile(grid, t.accounts.add, () => this.editAccount(null));
  }

  /** A card shows its bills instead of a balance that adds up its whole history. */
  private cardBillLines(tile: HTMLElement, ledger: Ledger, a: Account, balance: number) {
    const { closed, open } = cardBills(ledger, a.id, todayISO());
    tile.createDiv({ cls: "trimly-tile-value", text: this.money(open.remaining) });
    tile.createDiv({ cls: "trimly-muted", text: t.accounts.openBill(this.shortDate(open.close)) });
    if (closed.total > 0) {
      const v = this.money(closed.remaining);
      tile.createDiv({
        cls: `trimly-muted ${closed.remaining > 0 && closed.due && closed.due < todayISO() ? "is-expense" : ""}`,
        text: closed.remaining === 0 ? t.accounts.closedBillPaid : closed.due ? t.accounts.closedBillDue(v, this.shortDate(closed.due)) : t.accounts.closedBill(v),
      });
    }
    if (balance < 0) tile.createDiv({ cls: "trimly-muted", text: t.accounts.cardDebt(this.money(-balance)) });
    if (!a.closingDay) tile.createDiv({ cls: "trimly-muted", text: t.accounts.noClosingDay });
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
              new Notice(t.accounts.inUse);
              return;
            }
            new ConfirmModal(this.app, t.accounts.deleteConfirm(acc.name), t.common.delete, () =>
              void this.plugin.mutate((l) => {
                l.accounts = l.accounts.filter((a) => a.id !== acc.id);
              })
            ).open();
          }
        : null,
      existing ? () => this.showAccountTransactions(existing.id) : null
    ).open();
  }

  private showAccountTransactions(accountId: string) {
    this.filter = { text: "", accountId, categoryId: "", type: "", allMonths: true };
    this.mode = "accounts";
    this.goTab("transactions");
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
    const h = head.createDiv();
    h.createDiv({ cls: "trimly-eyebrow", text: t.budgets.title(this.monthLabel(this.month)) });
    if (totalLimit > 0) {
      const left = totalLimit - totalSpent;
      h.createDiv({
        cls: `trimly-page-value ${left < 0 ? "is-expense" : ""}`,
        text: left >= 0 ? t.budgets.left(this.money(left)) : t.budgets.over(this.money(-left)),
      });
      h.createDiv({ cls: "trimly-muted", text: t.budgets.spentOf(this.money(totalSpent), this.money(totalLimit)) });
      this.progress(head, totalSpent, totalLimit, "var(--interactive-accent)");
    } else {
      h.createDiv({ cls: "trimly-page-value", text: t.budgets.none });
      h.createDiv({ cls: "trimly-muted", text: t.budgets.noneHint });
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
          text: left >= 0 ? t.budgets.left(this.money(left)) : t.budgets.over(this.money(-left)),
        });
        this.progress(tile, spent, limit, c.color);
        const foot = tile.createDiv("trimly-tile-foot");
        foot.createSpan({ cls: "trimly-muted", text: t.budgets.of(this.money(spent)) });
        this.limitInput(foot, c.id, limit);
      }
    }

    if (unbudgeted.length) {
      const card = this.card(body, t.budgets.without);
      for (const c of unbudgeted) {
        const row = card.createDiv("trimly-row");
        this.iconTile(row, c.icon ?? "tag", c.color);
        const main = row.createDiv("trimly-row-main");
        main.createDiv({ cls: "trimly-row-title", text: c.name });
        main.createDiv({ cls: "trimly-row-sub", text: t.budgets.spentThisMonth(this.money(spending.get(c.id) ?? 0)) });
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
    const input = parent.createEl("input", { cls: "trimly-limit-input", type: "text", placeholder: t.budgets.setLimit });
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
        new Notice(t.common.notValidAmount);
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
      if (r.type === "expense") monthlyOut += monthlyAmount(r);
      if (r.type === "income") monthlyIn += monthlyAmount(r);
    }
    const summary = body.createDiv("trimly-summary-chips");
    const chip = (label: string, value: string, cls: string) => {
      const c = summary.createDiv(`trimly-summary-chip ${cls}`);
      c.createDiv({ cls: "trimly-eyebrow", text: label });
      c.createDiv({ cls: "trimly-summary-value", text: value });
    };
    chip(t.recurring.fixedIncome, `+${this.money(Math.round(monthlyIn))}`, "is-income");
    chip(t.recurring.fixedCosts, `−${this.money(Math.round(monthlyOut))}`, "is-expense");
    chip(t.recurring.leftAfterFixed, this.money(Math.round(monthlyIn - monthlyOut)), monthlyIn >= monthlyOut ? "is-income" : "is-expense");

    const card = this.card(body, t.recurring.title, { label: t.common.add, onClick: () => this.editRecurring(null) });
    if (ledger.recurring.length === 0) {
      this.empty(card, "repeat", t.recurring.empty, {
        label: t.recurring.add,
        onClick: () => this.editRecurring(null),
      });
    }
    const sorted = [...ledger.recurring].sort((a, b) => (a.nextDate < b.nextDate ? -1 : 1));
    for (const r of sorted) if (!r.subscription) this.recurringRow(card, ledger, r);

    this.renderSubscriptions(body, ledger, sorted.filter((r) => r.subscription));
  }

  /** What each subscription costs per year and how its price moved, to judge whether it is worth keeping. */
  private renderSubscriptions(body: HTMLElement, ledger: Ledger, subs: Recurring[]) {
    const card = this.card(body, t.recurring.subscriptions);
    if (subs.length === 0) {
      this.empty(card, "clapperboard", t.recurring.subscriptionsEmpty);
      return;
    }
    const today = todayISO();
    let monthly = 0;
    for (const r of [...subs].sort((a, b) => monthlyAmount(b) - monthlyAmount(a))) {
      const ended = !!r.endDate && r.nextDate > r.endDate;
      if (!ended) monthly += monthlyAmount(r);
      const row = card.createDiv("trimly-row is-clickable");
      const cat = this.category(ledger, r.categoryId);
      this.iconTile(row, cat?.icon ?? "tag", cat?.color ?? NEUTRAL);
      if (ended) row.addClass("is-archived");
      const main = row.createDiv("trimly-row-main");
      main.createDiv({ cls: "trimly-row-title", text: r.description });
      const charges = ruleTransactions(ledger, r.id);
      const last = charges[charges.length - 1];
      const prev = charges[charges.length - 2];
      const parts = [
        ended ? t.recurring.ended(t.labels.frequency[r.frequency]) : t.labels.frequency[r.frequency],
        t.recurring.perYear(this.money(Math.round(monthlyAmount(r) * 12))),
      ];
      if (!ended && r.nextDate < today) parts.push(t.recurring.awaitingCharge(this.shortDate(r.nextDate)));
      else if (last) parts.push(t.recurring.lastCharge(this.shortDate(last.date)));
      if (last && prev && last.amount !== prev.amount) {
        parts.push((last.amount > prev.amount ? t.recurring.priceUp : t.recurring.priceDown)(this.money(prev.amount)));
      }
      main.createDiv({ cls: "trimly-row-sub", text: parts.join(" · ") });
      row.createDiv({ cls: "trimly-amount is-expense", text: this.signedMoney(r.amount, r.type) });
      row.addEventListener("click", () => this.editRecurring(r.id));
    }
    card.createDiv({
      cls: "trimly-muted trimly-card-foot",
      text: t.recurring.subscriptionsTotal(this.money(Math.round(monthly)), this.money(Math.round(monthly * 12))),
    });
  }

  private editRecurring(id: string | null) {
    const ledger = this.plugin.ledger;
    if (!ledger) return;
    if (!ledger.accounts.some((a) => !a.archived)) {
      new Notice(t.common.addAccountFirst);
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
          if (posted) new Notice(t.recurring.posted(posted));
        }),
      existing
        ? (rec) =>
            new ConfirmModal(
              this.app,
              t.recurring.deleteConfirm(rec.description),
              t.common.delete,
              () =>
                void this.plugin.mutate((l) => {
                  l.recurring = l.recurring.filter((r) => r.id !== rec.id);
                })
            ).open()
        : null
    ).open();
  }

  // ---- obligations ----

  private renderObligations(body: HTMLElement, ledger: Ledger) {
    const today = todayISO();
    const days = (n: number) => toISODate(new Date(Date.now() + n * 86400000));
    const open = dueObligations(ledger, days(30));
    const overdue = open.filter((d) => d.due < today);
    const soon = open.filter((d) => d.due >= today && d.due <= days(7));
    const endOfMonth = `${monthOf(today)}-31`;
    const toPay = dueObligations(ledger, endOfMonth).reduce((s, d) => s + (d.obligation.amount ?? 0), 0);

    const summary = body.createDiv("trimly-summary-chips");
    const chip = (label: string, value: string, cls: string) => {
      const c = summary.createDiv(`trimly-summary-chip ${cls}`);
      c.createDiv({ cls: "trimly-eyebrow", text: label });
      c.createDiv({ cls: "trimly-summary-value", text: value });
    };
    chip(t.obligations.overdue, String(overdue.length), overdue.length ? "is-expense" : "");
    chip(t.obligations.dueSoon, String(soon.length), "");
    chip(t.obligations.toPay, this.money(toPay), "is-expense");

    const pending = this.card(body, t.obligations.pending);
    if (ledger.obligations.length === 0) {
      this.empty(pending, "clipboard-check", t.obligations.empty, { label: t.obligations.add, onClick: () => this.editObligation(null) });
    } else if (open.length === 0) {
      this.empty(pending, "check-circle", t.obligations.nothingPending);
    }
    for (const { obligation: o, due } of open) {
      const row = pending.createDiv("trimly-row is-clickable");
      this.iconTile(row, OBLIGATION_ICONS[o.kind], due < today ? OVERDUE : NEUTRAL);
      const main = row.createDiv("trimly-row-main");
      main.createDiv({ cls: "trimly-row-title", text: o.name });
      main.createDiv({ cls: "trimly-row-sub", text: `${dueWhen(today, due)} · ${this.shortDate(due)}` });
      if (o.amount) row.createDiv({ cls: "trimly-amount is-expense", text: this.money(o.amount) });
      const done = row.createEl("button", { cls: "clickable-icon", attr: { "aria-label": t.obligations.markDone } });
      setIcon(done, "check");
      done.addEventListener("click", (e) => {
        e.stopPropagation();
        void this.plugin.mutate((l) => {
          const target = l.obligations.find((x) => x.id === o.id);
          if (target) settleObligation(target, { due, status: "done", date: todayISO() });
        });
      });
      row.addEventListener("click", () => this.settle(o, due));
    }

    const all = this.card(body, t.obligations.all, { label: t.common.add, onClick: () => this.editObligation(null) });
    for (const o of [...ledger.obligations].sort((a, b) => a.name.localeCompare(b.name))) {
      const next = nextDue(o, toISODate(new Date(Date.now() - 86400000)));
      const row = all.createDiv("trimly-row is-clickable");
      this.iconTile(row, OBLIGATION_ICONS[o.kind], NEUTRAL);
      if (!next) row.addClass("is-archived");
      const main = row.createDiv("trimly-row-main");
      main.createDiv({ cls: "trimly-row-title", text: o.name });
      const freq = t.labels.frequency[o.frequency];
      main.createDiv({ cls: "trimly-row-sub", text: next ? t.obligations.next(freq, this.shortDate(next)) : t.obligations.ended(freq) });
      if (o.amount) row.createDiv({ cls: "trimly-amount", text: this.money(o.amount) });
      row.addEventListener("click", () => this.editObligation(o.id));
    }

    const history = ledger.obligations
      .flatMap((o) => o.settled.map((s) => ({ o, s })))
      .sort((a, b) => (a.s.date === b.s.date ? (a.s.due < b.s.due ? 1 : -1) : a.s.date < b.s.date ? 1 : -1))
      .slice(0, 10);
    if (history.length === 0) return;
    const hist = this.card(body, t.obligations.history);
    for (const { o, s } of history) {
      const row = hist.createDiv("trimly-row is-clickable");
      if (s.status === "skipped") row.addClass("is-archived");
      this.iconTile(row, s.status === "skipped" ? "minus" : "check", NEUTRAL);
      const main = row.createDiv("trimly-row-main");
      main.createDiv({ cls: "trimly-row-title", text: o.name });
      const tx = s.transactionId ? ledger.transactions.find((x) => x.id === s.transactionId) : undefined;
      const parts = [
        this.shortDate(s.due),
        s.status === "skipped" ? t.obligations.skipped : (o.kind === "payment" ? t.obligations.paidOn : t.obligations.doneOn)(this.shortDate(s.date)),
      ];
      if (tx) parts.push(t.obligations.linked);
      main.createDiv({ cls: "trimly-row-sub", text: parts.join(" · ") });
      if (tx) row.createDiv({ cls: `trimly-amount is-${tx.type}`, text: this.signedMoney(tx.amount, tx.type) });
      row.addEventListener("click", () => this.settle(o, s.due));
    }
  }

  private settle(o: Obligation, due: string) {
    const ledger = this.plugin.ledger;
    if (!ledger) return;
    new SettleModal(
      this.app,
      o,
      due,
      this.shortDate(due),
      paymentCandidates(ledger, o, due),
      (tx) => `${this.shortDate(tx.date)} · ${tx.description} · ${this.money(tx.amount)}`,
      (s) =>
        void this.plugin.mutate((l) => {
          const target = l.obligations.find((x) => x.id === o.id);
          if (!target) return;
          if (s) settleObligation(target, s);
          else unsettleObligation(target, due);
        })
    ).open();
  }

  private editObligation(id: string | null) {
    const existing = this.plugin.ledger?.obligations.find((o) => o.id === id) ?? null;
    new ObligationModal(
      this.app,
      existing,
      (ob) =>
        void this.plugin.mutate((l) => {
          const i = l.obligations.findIndex((o) => o.id === ob.id);
          if (i >= 0) l.obligations[i] = ob;
          else l.obligations.push(ob);
        }),
      existing
        ? (ob) =>
            new ConfirmModal(
              this.app,
              t.obligations.deleteConfirm(ob.name),
              t.common.delete,
              () =>
                void this.plugin.mutate((l) => {
                  l.obligations = l.obligations.filter((o) => o.id !== ob.id);
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
    const fixed = a.fixedRate ? `${this.pct(a.fixedRate, 2)} ${t.inv.perYear}` : "";
    if (!a.rateType) return fixed;
    if (fixed) return a.rate && a.rate !== 100 ? `${this.pct(a.rate, 2)} ${a.rateType} + ${fixed}` : `${a.rateType} + ${fixed}`;
    return a.rate ? `${this.pct(a.rate, 2)} ${a.rateType}` : a.rateType;
  }

  private longDate(iso: string) {
    return this.fmt({ day: "numeric", month: "short", year: "numeric" }, this.parseDate(iso));
  }

  private assetRow(parent: HTMLElement, a: Asset) {
    const row = parent.createDiv("trimly-row is-clickable");
    row.addEventListener("click", () => this.showAsset(a.id));
    if (a.closed) row.addClass("is-archived");
    this.iconTile(row, ASSET_CLASS_ICONS[a.assetClass], ASSET_CLASS_COLORS[a.assetClass]);
    const main = row.createDiv("trimly-row-main");
    main.createDiv({ cls: "trimly-row-title", text: a.name });
    const sub = [institutionOf(a)?.name, this.rateLabel(a), a.dueDate && t.inv.due(this.longDate(a.dueDate))].filter(Boolean);
    if (a.quantity && (a.assetClass === "stock" || a.assetClass === "reit" || a.assetClass === "etf")) sub.unshift(t.inv.units(a.quantity));
    if (a.code && !a.name.includes(a.code)) sub.unshift(a.code);
    if (a.quote?.longName && a.institution && tickerOf({ code: a.name })) sub.unshift(a.quote.longName);
    if (a.quote?.changePct !== undefined) sub.push(this.signedPct(a.quote.changePct / 100));
    main.createDiv({ cls: "trimly-row-sub", text: sub.join(" · ") || t.labels.assetClass[a.assetClass] });
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
      this.plugin.ledger?.pluggy ? t.inv.emptySynced : t.inv.empty,
      { label: t.inv.addPosition, onClick: () => this.editAsset(null) }
    );
  }

  private editAsset(id: string | null) {
    const ledger = this.plugin.ledger;
    if (!ledger) return;
    const existing = ledger.investments.assets.find((a) => a.id === id) ?? null;
    new AssetModal(
      this.app,
      existing,
      (asset, toConnection) =>
        void this.plugin.mutate((l) => {
          saveAsset(l, asset, todayISO());
          if (toConnection && asset.pluggyId) applyInstitutionToConnection(l, asset);
        }),
      existing && !existing.pluggyId
        ? (asset) =>
            new ConfirmModal(this.app, t.inv.deleteConfirm(asset.name), t.common.delete, () =>
              void this.plugin.mutate((l) => removeManualAsset(l, asset.id, todayISO()))
            ).open()
        : null
    ).open();
  }

  /** Everything known about a position, with its recent movements and the actions on it. */
  private showAsset(id: string) {
    const ledger = this.plugin.ledger;
    const a = ledger?.investments.assets.find((x) => x.id === id);
    if (!ledger || !a) return;
    try {
      this.openAssetDetails(ledger, a);
    } catch (e) {
      // unexpected data must not make a click do nothing silently
      console.error("Trimly: position details failed", e);
      new Notice(t.notices.detailsFailed((e as Error).message));
    }
  }

  private openAssetDetails(ledger: Ledger, a: Asset) {
    const modal = new Modal(this.app);
    modal.setTitle(a.name);
    const el = modal.contentEl;
    el.addClass("trimly-modal", "trimly-asset-details");

    const head = el.createDiv("trimly-detail-head");
    if (a.quote?.logo) head.createEl("img", { cls: "trimly-detail-logo", attr: { src: a.quote.logo, alt: "" } });
    else this.iconTile(head, ASSET_CLASS_ICONS[a.assetClass], ASSET_CLASS_COLORS[a.assetClass]);
    const tags = head.createDiv("trimly-detail-tags");
    tags.createSpan({ cls: "trimly-tile-tag", text: t.labels.assetClass[a.assetClass] });
    tags.createSpan({ cls: "trimly-tile-tag", text: a.pluggyId ? t.details.bankSync : t.details.manual });
    if (a.closed) tags.createSpan({ cls: "trimly-tile-tag", text: t.details.closed });

    el.createDiv({ cls: "trimly-eyebrow", text: t.details.currentValue });
    el.createDiv({ cls: "trimly-page-value", text: this.money(a.value) });
    if (a.invested) {
      const p = a.value - a.invested;
      el.createDiv({
        cls: p >= 0 ? "is-income" : "is-expense",
        text: t.details.sinceInvested(`${p >= 0 ? "+" : "−"}${this.money(Math.abs(p))}`, this.pct((p / a.invested) * 100)),
      });
    }

    const grid = el.createDiv("trimly-detail-grid");
    const item = (label: string, value: string | undefined | false) => {
      if (!value) return;
      const cell = grid.createDiv("trimly-detail-item");
      cell.createDiv({ cls: "trimly-eyebrow", text: label });
      cell.createDiv({ text: value });
    };
    const today = todayISO();
    item(t.details.invested, a.invested !== undefined && this.money(a.invested));
    item(t.details.gross, a.grossValue !== undefined && this.money(a.grossValue));
    item(t.details.taxesDue, a.grossValue !== undefined && a.grossValue > a.value && this.money(a.grossValue - a.value));
    item(t.details.quantity, a.quantity !== undefined && String(a.quantity));
    item(t.details.unitValue, !!a.quantity && this.money(Math.round(a.value / a.quantity)));
    item(t.details.rate, this.rateLabel(a));
    if (a.dueDate) {
      const days = Math.round((this.ts(a.dueDate) - this.ts(today)) / 86_400_000);
      item(t.details.maturity, `${this.longDate(a.dueDate)} · ${days >= 0 ? t.details.inDays(days) : t.details.matured}`);
    }
    const q = a.quote;
    const avg = averagePrice(a);
    item(t.details.company, q?.longName);
    if (q) {
      const change = q.changePct !== undefined ? this.signedPct(q.changePct / 100) : "—";
      const when = q.time ? this.plugin.formatDateTime(q.time) : "";
      item(t.details.quote, t.details.quoteValue(this.money(q.price), change, when));
    }
    if (avg) item(t.details.avgPrice, this.money(avg) + (q ? ` · ${t.details.quoteVsAvg(this.signedPct(q.price / avg - 1))}` : ""));
    if (q) {
      item(t.details.range52, q.low52 !== undefined && q.high52 !== undefined && `${this.money(q.low52)} – ${this.money(q.high52)}`);
      item(t.details.pe, q.pe !== undefined && new Intl.NumberFormat(this.plugin.locale(), { maximumFractionDigits: 2 }).format(q.pe));
      item(t.details.eps, q.eps !== undefined && this.money(q.eps));
      item(t.details.marketCap, q.marketCap !== undefined && this.plugin.formatCompactMoney(q.marketCap));
    }
    const inst = institutionOf(a);
    const via = inst?.via === "quote" ? ` ${t.details.viaBrapi}` : inst?.via === "issuer" ? ` ${t.details.viaIssuer}` : "";
    item(t.details.institution, inst ? `${inst.name}${via}` : undefined);
    item(t.details.issuer, a.issuer);
    item(t.details.code, a.code);
    item(t.details.product, a.subtype);
    item(t.details.nameAtBank, a.pluggyName !== a.name && a.pluggyName);
    item(t.details.valueAsOf, this.longDate(a.updatedAt));
    item(t.details.trackedSince, a.addedOn && this.longDate(a.addedOn));
    const income12 = ledger.investments.movements
      .filter((m) => m.assetId === a.id && m.type === "income" && m.date > this.yearAgo())
      .reduce((s, m) => s + m.amount, 0);
    item(t.details.income12, income12 > 0 && this.money(income12));

    if (q?.history && q.history.length >= 2) {
      const history = q.history;
      el.createDiv({ cls: "trimly-section-title", text: t.details.history });
      const chart = el.createDiv("trimly-card");
      const legend = chart.createDiv("trimly-legend-inline");
      legend.createSpan("trimly-key is-accent").createSpan({ text: t.details.price });
      const series: LineSeries[] = [{ values: history.map(([, p]) => p / 100), cls: "is-accent", area: true }];
      if (avg) {
        legend.createSpan("trimly-key is-muted").createSpan({ text: t.details.avgPrice });
        series.push({ values: history.map(() => avg / 100), cls: "is-muted", dashed: true });
      }
      lineChart(
        chart,
        history.map(([d]) => this.ts(d)),
        series,
        { start: this.longDate(history[0][0]), end: this.longDate(history[history.length - 1][0]) },
        (i) => [
          this.longDate(history[i][0]),
          `${t.details.price}: ${this.money(history[i][1])}`,
          ...(avg ? [`${t.details.avgPrice}: ${this.money(avg)}`] : []),
        ]
      );
    }

    const moves = ledger.investments.movements
      .filter((m) => m.assetId === a.id)
      .sort((x, y) => (x.date < y.date ? 1 : -1));
    el.createDiv({ cls: "trimly-section-title", text: t.details.movements(moves.length) });
    const list = el.createDiv("trimly-card");
    if (moves.length === 0) this.empty(list, "arrow-left-right", a.pluggyId ? t.details.noSyncedMovements : t.details.noMovements);
    for (const m of moves.slice(0, 6)) this.movementRow(list, ledger, m, true, false);

    const actions = new Setting(el);
    if (moves.length > 6) {
      actions.addButton((b) =>
        b.setButtonText(t.details.allMovements).onClick(() => {
          modal.close();
          this.movementFilter = { assetId: a.id, type: "", allTime: true };
          this.goTab("movements");
        })
      );
    }
    if (!a.pluggyId && !a.closed) {
      actions.addButton((b) =>
        b.setButtonText(t.details.addMovement).onClick(() => {
          modal.close();
          this.editMovement(null, a.id);
        })
      );
    }
    actions.addButton((b) =>
      b
        .setButtonText(t.common.edit)
        .setCta()
        .onClick(() => {
          modal.close();
          this.editAsset(a.id);
        })
    );
    modal.open();
  }

  private editMovement(id: string | null, presetAssetId?: string) {
    const ledger = this.plugin.ledger;
    if (!ledger) return;
    if (!id && !ledger.investments.assets.some((a) => !a.pluggyId && !a.closed)) {
      new Notice(t.inv.manualFirst);
      return;
    }
    const existing = ledger.investments.movements.find((m) => m.id === id) ?? null;
    const assetId = presetAssetId ?? (this.movementFilter.assetId || undefined);
    new MovementModal(
      this.app,
      ledger,
      existing,
      (m) => void this.plugin.mutate((l) => saveManualMovement(l, m, todayISO())),
      existing
        ? (m) =>
            new ConfirmModal(this.app, t.inv.deleteMovementConfirm, t.common.delete, () =>
              void this.plugin.mutate((l) => removeManualMovement(l, m.id, todayISO()))
            ).open()
        : null,
      ledger.investments.assets.some((a) => a.id === assetId && !a.pluggyId) ? assetId : undefined
    ).open();
  }

  private renderInvestmentsOverview(body: HTMLElement, ledger: Ledger) {
    const assets = openAssets(ledger);
    if (assets.length === 0) return this.emptyInvestments(body);
    const total = portfolioValue(ledger);
    const cost = portfolioInvested(ledger);
    const updated = assets.reduce((d, a) => (a.updatedAt > d ? a.updatedAt : d), "");

    const hero = body.createDiv("trimly-hero");
    const left = hero.createDiv("trimly-hero-main");
    left.createDiv({ cls: "trimly-eyebrow", text: t.inv.portfolio });
    left.createDiv({ cls: "trimly-hero-value", text: this.money(total) });
    left.createDiv({
      cls: "trimly-muted",
      text: t.inv.positionsUpdated(assets.length, this.longDate(updated)),
    });
    const stats = hero.createDiv("trimly-hero-stats");
    this.heroStat(stats, t.inv.invested, cost, "piggy-bank", "is-accent");
    const gain = total - cost;
    this.heroStat(
      stats,
      cost > 0 ? t.inv.profitPct(this.pct((gain / cost) * 100)) : t.inv.profit,
      gain,
      gain >= 0 ? "arrow-up-right" : "arrow-down-right",
      gain >= 0 ? "is-income" : "is-expense"
    );
    const taxes = assets.reduce((s, a) => s + (a.grossValue !== undefined ? Math.max(0, a.grossValue - a.value) : 0), 0);
    this.heroStat(stats, t.inv.taxesDue, taxes, "receipt", "is-expense");

    const row0 = body.createDiv("trimly-grid");
    this.renderEvolutionCard(row0, ledger);
    this.renderPeriodsCard(row0, ledger, { label: t.inv.details, onClick: () => this.goTab("performance") });

    const row1 = body.createDiv("trimly-grid");
    this.renderAllocationCard(row1, ledger, total);
    const instCard = this.card(row1, t.inv.byInstitution);
    const byInst = new Map<string, number>();
    for (const a of assets) {
      const name = institutionOf(a)?.name ?? t.common.unknown;
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
    const topCard = this.card(row2, t.inv.largest, { label: t.inv.portfolio, onClick: () => this.goTab("portfolio") });
    for (const a of [...assets].sort((x, y) => y.value - x.value).slice(0, 6)) this.assetRow(topCard, a);

    const dueCard = this.card(row2, t.inv.maturities);
    const today = todayISO();
    const horizon = toISODate(new Date(Date.now() + MATURITY_HORIZON_DAYS * 86400000));
    const due = assets
      .filter((a): a is Asset & { dueDate: string } => !!a.dueDate && a.dueDate >= today && a.dueDate <= horizon)
      .sort((x, y) => (x.dueDate < y.dueDate ? -1 : 1));
    if (due.length === 0) this.empty(dueCard, "calendar", t.inv.noMaturities);
    for (const a of due.slice(0, 6)) this.assetRow(dueCard, a);
  }

  /** "+1,23%" from a fraction; "—" when unknown. */
  private signedPct(fraction: number | null) {
    if (fraction === null || !Number.isFinite(fraction)) return "—";
    return `${fraction >= 0 ? "+" : "−"}${this.pct(Math.abs(fraction) * 100, 2)}`;
  }

  private ts(iso: string) {
    return this.parseDate(iso).getTime();
  }

  /** History needs two snapshots; until then explain why the card is empty. Returns false when empty. */
  private needsHistory(card: HTMLElement, points: IndexPoint[]) {
    if (points.length >= 2) return true;
    this.empty(card, "line-chart", t.perf.history);
    return false;
  }

  /** Where the CDI/IPCA columns stand, when they are not shown. */
  private benchmarkNote(parent: HTMLElement, loaded: boolean) {
    if (loaded) return;
    const text = !this.plugin.settings.benchmarks
      ? t.perf.benchOff
      : this.plugin.benchmarkError
        ? t.perf.benchError(this.plugin.benchmarkError)
        : t.perf.benchLoading;
    parent.createDiv({ cls: "trimly-muted trimly-card-foot", text });
  }

  private renderEvolutionCard(parent: HTMLElement, ledger: Ledger) {
    const card = this.card(parent, t.perf.evolution);
    const snaps = ledger.investments.snapshots;
    if (!this.needsHistory(card, portfolioIndex(snaps))) return;
    const legend = card.createDiv("trimly-legend-inline");
    legend.createSpan("trimly-key is-accent").createSpan({ text: t.perf.value });
    legend.createSpan("trimly-key is-muted").createSpan({ text: t.perf.invested });
    lineChart(
      card,
      snaps.map((s) => this.ts(s.date)),
      [
        { values: snaps.map((s) => s.value / 100), cls: "is-accent", area: true },
        { values: snaps.map((s) => s.invested / 100), cls: "is-muted", dashed: true },
      ],
      { start: this.longDate(snaps[0].date), end: this.longDate(snaps[snaps.length - 1].date) },
      (i) => [
        this.longDate(snaps[i].date),
        `${t.perf.value}: ${this.money(snaps[i].value)}`,
        `${t.perf.invested}: ${this.money(snaps[i].invested)}`,
      ]
    );
  }

  /** Portfolio vs CDI and IPCA over this month, 12 months and since the first snapshot. */
  private renderPeriodsCard(parent: HTMLElement, ledger: Ledger, link?: { label: string; onClick: () => void }) {
    const card = this.card(parent, t.perf.title, link);
    const points = portfolioIndex(ledger.investments.snapshots);
    if (!this.needsHistory(card, points)) return;
    const first = points[0].date;
    const today = todayISO();
    const bench = this.plugin.benchmarks(first);
    const now = new Date();
    const periods: [string, string][] = [[t.perf.thisMonth, toISODate(new Date(now.getFullYear(), now.getMonth(), 0))]];
    const yearAgo = toISODate(new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()));
    if (first <= yearAgo) periods.push([t.perf.months12, yearAgo]);
    periods.push([t.perf.since(this.longDate(first)), first]);

    const table = card.createDiv("trimly-perf-table");
    this.perfRow(table, ["", t.perf.portfolio, "CDI", "IPCA"], true);
    for (const [label, start] of periods) {
      const from = start < first ? first : start;
      this.perfRow(table, [
        label,
        periodReturn(points, from, today),
        bench ? cdiReturn(bench.cdi, from, today) : null,
        bench ? ipcaReturn(bench.ipca, from, today) : null,
      ]);
    }
    this.benchmarkNote(card, !!bench);
  }

  /** A row of the performance table; numbers are fractions, shown as signed percentages. */
  private perfRow(table: HTMLElement, cells: (string | number | null)[], head = false) {
    const row = table.createDiv(`trimly-perf-row${head ? " is-head" : ""}`);
    for (const [i, c] of cells.entries()) {
      if (typeof c === "string") {
        row.createDiv({ cls: i === 0 ? "trimly-perf-label" : "trimly-perf-cell", text: c });
        continue;
      }
      const cell = row.createDiv({ cls: "trimly-perf-cell trimly-amount", text: this.signedPct(c) });
      if (c !== null && i === 1) cell.addClass(c >= 0 ? "is-income" : "is-expense");
    }
  }

  private renderPerformance(body: HTMLElement, ledger: Ledger) {
    if (ledger.investments.assets.length === 0) return this.emptyInvestments(body);
    const points = portfolioIndex(ledger.investments.snapshots);

    const chartCard = this.card(body, t.perf.cumulative);
    if (this.needsHistory(chartCard, points)) {
      const first = points[0].date;
      const bench = this.plugin.benchmarks(first);
      const legend = chartCard.createDiv("trimly-legend-inline");
      legend.createSpan("trimly-key is-accent").createSpan({ text: t.perf.portfolio });
      const series = [{ values: points.map((p) => (p.index - 1) * 100), cls: "is-accent" }];
      if (bench) {
        legend.createSpan("trimly-key is-cdi").createSpan({ text: "CDI" });
        legend.createSpan("trimly-key is-ipca").createSpan({ text: "IPCA" });
        series.push({ values: points.map((p) => cdiReturn(bench.cdi, first, p.date) * 100), cls: "is-cdi" });
        series.push({ values: points.map((p) => ipcaReturn(bench.ipca, first, p.date) * 100), cls: "is-ipca" });
      }
      lineChart(
        chartCard,
        points.map((p) => this.ts(p.date)),
        series,
        { start: this.longDate(first), end: this.longDate(points[points.length - 1].date) },
        (i) => [
          this.longDate(points[i].date),
          `${t.perf.portfolio}: ${this.signedPct(points[i].index - 1)}`,
          ...(bench
            ? [
                `CDI: ${this.signedPct(cdiReturn(bench.cdi, first, points[i].date))}`,
                `IPCA: ${this.signedPct(ipcaReturn(bench.ipca, first, points[i].date))}`,
              ]
            : []),
        ]
      );
      this.benchmarkNote(chartCard, !!bench);
    }

    const row = body.createDiv("trimly-grid");
    this.renderPeriodsCard(row, ledger);
    const monthCard = this.card(row, t.perf.monthByMonth);
    if (this.needsHistory(monthCard, points)) {
      const bench = this.plugin.benchmarks(points[0].date);
      const table = monthCard.createDiv("trimly-perf-table");
      this.perfRow(table, ["", t.perf.portfolio, "CDI", "IPCA"], true);
      for (const m of monthlyReturns(points, bench, todayISO()).reverse()) {
        this.perfRow(table, [this.monthLabel(m.month), m.portfolio, m.cdi, m.ipca]);
      }
      this.benchmarkNote(monthCard, !!bench);
    }
    body.createDiv({
      cls: "trimly-muted",
      text: t.perf.note,
    });
  }

  private movementLabel(m: Movement) {
    if (m.type === "transfer") return m.direction === "out" ? t.labels.transferOut : t.labels.transferIn;
    return t.labels.movement[m.type];
  }

  /** `linkAsset`: a synced movement opens its position (off inside that position's own details). */
  private movementRow(parent: HTMLElement, ledger: Ledger, m: Movement, showDate: boolean, linkAsset = true) {
    const row = parent.createDiv("trimly-row");
    const asset = ledger.investments.assets.find((a) => a.id === m.assetId);
    // synced movements mirror Pluggy; only manual ones are edited here
    if (asset && !asset.pluggyId) {
      row.addClass("is-clickable");
      row.addEventListener("click", () => this.editMovement(m.id));
    } else if (asset && linkAsset) {
      row.addClass("is-clickable");
      row.addEventListener("click", () => this.showAsset(asset.id));
    }
    const color: Record<MovementType, string> = {
      buy: "var(--interactive-accent)",
      sell: NEUTRAL,
      amortization: NEUTRAL,
      transfer: NEUTRAL,
      income: "var(--trimly-income)",
      tax: "var(--trimly-expense)",
    };
    this.iconTile(row, MOVEMENT_ICONS[m.type], color[m.type]);
    const main = row.createDiv("trimly-row-main");
    main.createDiv({ cls: "trimly-row-title", text: asset?.name ?? "?" });
    const sub = [this.movementLabel(m)];
    if (showDate) sub.push(this.shortDate(m.date));
    if (m.quantity) sub.push(t.inv.units(m.quantity));
    if (m.description) sub.push(m.description);
    main.createDiv({ cls: "trimly-row-sub", text: sub.join(" · ") });
    // signed from the portfolio's side: money in is +, out is −; income is a gain, tax a cost
    const signed = m.type === "income" ? m.amount : m.type === "tax" ? -m.amount : movementFlow(m);
    const cls = m.type === "income" ? "is-income" : m.type === "tax" ? "is-expense" : "";
    row.createDiv({ cls: `trimly-amount ${cls}`, text: `${signed >= 0 ? "+" : "−"}${this.money(Math.abs(signed))}` });
  }

  private yearAgo() {
    const now = new Date();
    return toISODate(new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()));
  }

  private renderMovements(body: HTMLElement, ledger: Ledger) {
    if (ledger.investments.assets.length === 0) return this.emptyInvestments(body);
    const bar = body.createDiv("trimly-filters");
    const select = (options: Record<string, string>, value: string, onChange: (v: string) => void) => {
      const s = bar.createEl("select", { cls: "dropdown" });
      for (const [k, v] of Object.entries(options)) s.createEl("option", { value: k, text: v });
      s.value = value;
      s.addEventListener("change", () => onChange(s.value));
    };
    const f = this.movementFilter;
    const assets: Record<string, string> = { "": t.movements.allPositions };
    for (const a of [...ledger.investments.assets].sort((x, y) => x.name.localeCompare(y.name))) assets[a.id] = a.name;
    const types: Record<string, string> = { "": t.movements.allTypes };
    for (const [k, v] of Object.entries(t.labels.movement)) types[k] = v;
    const listWrap = body.createDiv();
    const renderList = () => this.renderMovementList(listWrap, ledger);
    select(assets, f.assetId, (v) => ((f.assetId = v), renderList()));
    select(types, f.type, (v) => ((f.type = v), renderList()));
    const allLabel = bar.createEl("label", { cls: "trimly-toggle-pill" });
    const all = allLabel.createEl("input", { type: "checkbox" });
    all.checked = f.allTime;
    allLabel.createSpan({ text: t.movements.allTime });
    all.addEventListener("change", () => ((f.allTime = all.checked), renderList()));
    renderList();
  }

  private renderMovementList(wrap: HTMLElement, ledger: Ledger) {
    wrap.empty();
    const f = this.movementFilter;
    const from = f.allTime ? "" : this.yearAgo();
    const list = ledger.investments.movements
      .filter((m) => m.date >= from && (!f.assetId || m.assetId === f.assetId) && (!f.type || m.type === f.type))
      .sort((a, b) => (a.date === b.date ? (a.id < b.id ? 1 : -1) : a.date < b.date ? 1 : -1));

    let contributed = 0;
    let withdrawn = 0;
    let income = 0;
    for (const m of list) {
      const flow = movementFlow(m);
      if (flow > 0) contributed += flow;
      else withdrawn -= flow;
      if (m.type === "income") income += m.amount;
    }
    const summary = wrap.createDiv("trimly-summary-chips");
    const chip = (label: string, value: string, cls: string) => {
      const c = summary.createDiv(`trimly-summary-chip ${cls}`);
      c.createDiv({ cls: "trimly-eyebrow", text: label });
      c.createDiv({ cls: "trimly-summary-value", text: value });
    };
    chip(t.movements.putIn, `+${this.money(contributed)}`, "");
    chip(t.movements.takenOut, `−${this.money(withdrawn)}`, "");
    chip(t.movements.net, this.money(contributed - withdrawn), "");
    chip(t.movements.income, `+${this.money(income)}`, "is-income");

    if (list.length === 0) {
      const card = wrap.createDiv("trimly-card");
      this.empty(
        card,
        "search-x",
        ledger.investments.movements.length ? t.movements.noMatch : t.movements.empty
      );
      return;
    }
    const shown = list.slice(0, 500);
    let month = "";
    let group: HTMLElement | null = null;
    for (const m of shown) {
      if (monthOf(m.date) !== month) {
        month = monthOf(m.date);
        const day = wrap.createDiv("trimly-day");
        day.createDiv("trimly-day-head").createSpan({ text: this.monthLabel(month) });
        group = day.createDiv("trimly-card trimly-day-card");
      }
      if (group) this.movementRow(group, ledger, m, true);
    }
    if (list.length > 500) {
      wrap.createDiv({ cls: "trimly-muted", text: t.common.showingNewest(list.length) });
    }
  }

  private renderIncome(body: HTMLElement, ledger: Ledger) {
    if (ledger.investments.assets.length === 0) return this.emptyInvestments(body);
    const payouts = ledger.investments.movements.filter((m) => m.type === "income");
    if (payouts.length === 0) {
      const card = body.createDiv("trimly-card");
      this.empty(card, "coins", t.income.empty);
      return;
    }
    const today = todayISO();
    const from = this.yearAgo();
    const last12 = payouts.filter((m) => m.date > from && m.date <= today);
    const total12 = last12.reduce((s, m) => s + m.amount, 0);
    const thisMonth = monthOf(today);
    const value = portfolioValue(ledger);

    const summary = body.createDiv("trimly-summary-chips");
    const chip = (label: string, text: string, cls = "") => {
      const c = summary.createDiv(`trimly-summary-chip ${cls}`);
      c.createDiv({ cls: "trimly-eyebrow", text: label });
      c.createDiv({ cls: "trimly-summary-value", text });
    };
    chip(t.income.last12, `+${this.money(total12)}`, "is-income");
    chip(t.income.monthlyAvg, this.money(Math.round(total12 / 12)));
    chip(t.income.thisMonth, this.money(payouts.filter((m) => monthOf(m.date) === thisMonth).reduce((s, m) => s + m.amount, 0)));
    chip(t.income.yield12, value > 0 ? this.pct((total12 / value) * 100, 2) : "—");

    const chartCard = this.card(body, t.income.perMonth);
    const byMonth = incomeByMonth(ledger, `${shiftMonth(thisMonth, -11)}-01`, today);
    bars(
      chartCard,
      Array.from({ length: 12 }, (_, i) => shiftMonth(thisMonth, i - 11)).map((m) => ({
        label: this.shortMonth(m),
        value: byMonth.get(m) ?? 0,
        current: m === thisMonth,
      })),
      (g) => `${g.label}: ${this.money(g.value)}`
    );

    const row = body.createDiv("trimly-grid");
    const byAsset = this.card(row, t.income.byPosition);
    const perAsset = new Map<string, number>();
    for (const m of last12) perAsset.set(m.assetId, (perAsset.get(m.assetId) ?? 0) + m.amount);
    if (perAsset.size === 0) this.empty(byAsset, "coins", t.income.nothing12);
    for (const [assetId, amount] of [...perAsset.entries()].sort((a, b) => b[1] - a[1])) {
      const a = ledger.investments.assets.find((x) => x.id === assetId);
      const r = byAsset.createDiv("trimly-row");
      if (a) {
        r.addClass("is-clickable");
        r.addEventListener("click", () => this.showAsset(a.id));
      }
      if (a) this.iconTile(r, ASSET_CLASS_ICONS[a.assetClass], ASSET_CLASS_COLORS[a.assetClass]);
      const main = r.createDiv("trimly-row-main");
      main.createDiv({ cls: "trimly-row-title", text: a?.name ?? "?" });
      main.createDiv({ cls: "trimly-row-sub", text: t.income.share(this.pct((amount / total12) * 100, 0)) });
      r.createDiv({ cls: "trimly-amount is-income", text: `+${this.money(amount)}` });
    }

    const recent = this.card(row, t.income.recent, { label: t.income.movementsLink, onClick: () => this.openMovements("income") });
    const sorted = [...payouts].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 8);
    for (const m of sorted) this.movementRow(recent, ledger, m, true);
  }

  private renderTargets(body: HTMLElement, ledger: Ledger) {
    if (ledger.investments.assets.length === 0) return this.emptyInvestments(body);
    const targets = ledger.investments.targets;
    const sum = targets.reduce((s, t) => s + t.pct, 0);
    const lines = rebalance(ledger, this.contribution);

    const head = body.createDiv("trimly-page-head");
    const h = head.createDiv();
    h.createDiv({ cls: "trimly-eyebrow", text: t.targets.title });
    h.createDiv({ cls: "trimly-page-value", text: sum ? this.pct(sum, 2) : t.targets.none });
    h.createDiv({
      cls: `trimly-muted ${sum && Math.abs(sum - 100) > 0.001 ? "is-expense" : ""}`,
      text: !sum ? t.targets.hintNone : Math.abs(sum - 100) <= 0.001 ? t.targets.hintOk : t.targets.hintScaled(this.pct(sum, 2)),
    });

    // classes held or targeted, then the rest so a target can be set before buying
    const shown = new Set<AssetClass>([...allocationByClass(ledger).map(([c]) => c), ...targets.map((x) => x.assetClass)]);
    const card = this.card(body, t.targets.byClass);
    const table = card.createDiv("trimly-perf-table trimly-target-table");
    const headRow = table.createDiv("trimly-perf-row is-head");
    for (const label of ["", t.targets.now, t.targets.target, t.targets.toTarget]) headRow.createDiv({ cls: label ? "trimly-perf-cell" : "trimly-perf-label", text: label });
    const total = portfolioValue(ledger);
    const byClass = new Map(allocationByClass(ledger));
    for (const c of shown) {
      const row = table.createDiv("trimly-perf-row");
      const label = row.createDiv("trimly-perf-label trimly-target-label");
      label.createSpan("trimly-dot").setCssProps({ "--trimly-color": ASSET_CLASS_COLORS[c] });
      label.createSpan({ text: t.labels.assetClass[c] });
      const value = byClass.get(c) ?? 0;
      row.createDiv({ cls: "trimly-perf-cell trimly-amount", text: total > 0 ? this.pct((value / total) * 100) : "—" });
      const input = row.createDiv("trimly-perf-cell").createEl("input", { cls: "trimly-limit-input trimly-target-input", type: "text", placeholder: "0" });
      input.inputMode = "decimal";
      const current = targets.find((x) => x.assetClass === c)?.pct;
      if (current) input.value = String(current);
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") input.blur();
      });
      input.addEventListener("change", () => this.setTarget(c, input.value));
      const gap = lines.find((l) => l.assetClass === c)?.gap;
      row.createDiv({
        cls: `trimly-perf-cell trimly-amount ${gap ? (gap > 0 ? "is-income" : "is-expense") : ""}`,
        text: gap === undefined ? "—" : `${gap >= 0 ? "+" : "−"}${this.money(Math.abs(gap))}`,
      });
    }
    const missing = (Object.keys(ASSET_CLASS_ICONS) as AssetClass[]).filter((c) => !shown.has(c));
    if (missing.length) {
      const add = card.createEl("select", { cls: "dropdown trimly-target-add" });
      add.createEl("option", { value: "", text: t.targets.addClass });
      for (const c of missing) add.createEl("option", { value: c, text: t.labels.assetClass[c] });
      add.addEventListener("change", () => add.value && this.setTarget(add.value as AssetClass, "10"));
    }
    card.createDiv({
      cls: "trimly-muted trimly-card-foot",
      text: t.targets.toTargetNote,
    });

    const plan = this.card(body, t.targets.plan);
    const bar = plan.createDiv("trimly-filters");
    const amount = bar.createEl("input", { cls: "trimly-limit-input", type: "text", placeholder: t.targets.amount });
    amount.inputMode = "decimal";
    if (this.contribution) amount.value = centsToInput(this.contribution);
    amount.addEventListener("keydown", (e) => {
      if (e.key === "Enter") amount.blur();
    });
    amount.addEventListener("change", () => {
      const cents = amount.value.trim() ? parseAmount(amount.value) : 0;
      if (cents === null) {
        new Notice(t.common.notValidAmount);
        return;
      }
      this.contribution = Math.abs(cents);
      this.render();
    });
    if (!lines.length) {
      plan.createDiv({ cls: "trimly-muted", text: t.targets.setOne });
      return;
    }
    if (!this.contribution) {
      plan.createDiv({ cls: "trimly-muted", text: t.targets.typeAmount });
      return;
    }
    for (const l of lines.filter((x) => x.contribute > 0)) {
      const row = plan.createDiv("trimly-row");
      this.iconTile(row, ASSET_CLASS_ICONS[l.assetClass], ASSET_CLASS_COLORS[l.assetClass]);
      const main = row.createDiv("trimly-row-main");
      main.createDiv({ cls: "trimly-row-title", text: t.labels.assetClass[l.assetClass] });
      const after = total + this.contribution;
      main.createDiv({
        cls: "trimly-row-sub",
        text: t.targets.after(this.pct(l.pct), after > 0 ? this.pct(((l.value + l.contribute) / after) * 100) : "—", this.pct(l.target)),
      });
      row.createDiv({ cls: "trimly-amount is-income", text: `+${this.money(l.contribute)}` });
    }
  }

  private setTarget(c: AssetClass, text: string) {
    const v = text.trim() ? Number(text.trim().replace(",", ".").replace("%", "")) : 0;
    if (!Number.isFinite(v) || v < 0 || v > 100) {
      new Notice(t.targets.invalidPct);
      return;
    }
    void this.plugin.mutate((l) => {
      l.investments.targets = l.investments.targets.filter((x) => x.assetClass !== c);
      if (v > 0) l.investments.targets.push({ assetClass: c, pct: v });
    });
  }

  private openMovements(type: MovementType) {
    this.movementFilter = { assetId: "", type, allTime: false };
    this.goTab("movements");
  }

  private renderAllocationCard(parent: HTMLElement, ledger: Ledger, total: number) {
    const card = this.card(parent, t.inv.allocation);
    const wrap = card.createDiv("trimly-spending");
    const alloc = allocationByClass(ledger);
    donut(
      wrap,
      alloc.map(([c, value]) => ({ value, color: ASSET_CLASS_COLORS[c] })),
      (c) => {
        c.createDiv({ cls: "trimly-eyebrow", text: t.inv.classes });
        c.createDiv({ cls: "trimly-donut-value", text: String(alloc.length) });
      }
    );
    const legend = wrap.createDiv("trimly-legend");
    for (const [c, value] of alloc) {
      const row = legend.createDiv("trimly-legend-row");
      row.createSpan("trimly-dot").setCssProps({ "--trimly-color": ASSET_CLASS_COLORS[c] });
      row.createSpan({ cls: "trimly-legend-name", text: t.labels.assetClass[c] });
      const target = ledger.investments.targets.find((x) => x.assetClass === c)?.pct;
      if (target) row.createSpan({ cls: "trimly-legend-target", text: t.inv.targetPct(this.pct(target, 0)) });
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
    const h = head.createDiv();
    h.createDiv({ cls: "trimly-eyebrow", text: t.inv.portfolio });
    h.createDiv({ cls: "trimly-page-value", text: this.money(total) });

    const byClass = new Map<AssetClass, Asset[]>();
    for (const a of assets) byClass.set(a.assetClass, [...(byClass.get(a.assetClass) ?? []), a]);
    for (const [c, value] of allocationByClass(ledger)) {
      const list = (byClass.get(c) ?? []).sort((x, y) => y.value - x.value);
      body.createDiv({ cls: "trimly-section-title", text: `${t.labels.assetClass[c]} · ${this.money(value)} · ${this.pct((value / total) * 100, 0)}` });
      const card = body.createDiv("trimly-card");
      for (const a of list) this.assetRow(card, a);
    }
    // the allocation leaves out positions worth nothing, but they are still held
    const zero = assets.filter((a) => a.value <= 0);
    if (zero.length) {
      body.createDiv({ cls: "trimly-section-title", text: t.inv.noValue });
      const card = body.createDiv("trimly-card");
      for (const a of zero) this.assetRow(card, a);
    }
    if (closed.length) {
      body.createDiv({ cls: "trimly-section-title", text: t.inv.closed(closed.length) });
      const card = body.createDiv("trimly-card");
      for (const a of closed) this.assetRow(card, a);
    }
  }

  // ---- categories ----

  private renderCategories(body: HTMLElement, ledger: Ledger) {
    const kinds: { kind: CategoryKind; title: string }[] = [
      { kind: "expense", title: t.common.expenses },
      { kind: "income", title: t.common.income },
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
        main.createDiv({ cls: "trimly-row-sub", text: t.accounts.txCount(used) });
        tile.addEventListener("click", () => this.editCategory(c.id, kind));
      }
      this.addTile(grid, t.categories.add, () => this.editCategory(null, kind));
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
              t.categories.deleteConfirm(cat.name),
              t.common.delete,
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
    new Notice(t.common.addAccountFirst);
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
          new ConfirmModal(plugin.app, t.tx.deleteConfirm(del.description), t.common.delete, () =>
            void plugin.mutate((l) => {
              l.transactions = l.transactions.filter((t) => t.id !== del.id);
            })
          ).open()
      : null
  ).open();
}
