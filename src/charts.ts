/** Small dependency-free SVG charts for the dashboard. Colors come from CSS classes or the data. */

export interface DonutSlice {
  value: number;
  color: string;
}

/** Ring chart; `center` renders inside the hole. */
export function donut(parent: HTMLElement, slices: DonutSlice[], center: (el: HTMLElement) => void) {
  const wrap = parent.createDiv("trimly-donut");
  const svg = wrap.createSvg("svg", { attr: { viewBox: "0 0 100 100" } });
  const r = 40;
  const circ = 2 * Math.PI * r;
  svg.createSvg("circle", { cls: "trimly-donut-track", attr: { cx: 50, cy: 50, r, fill: "none", "stroke-width": 12 } });
  const total = slices.reduce((s, x) => s + x.value, 0);
  let offset = 0;
  // a hairline gap between slices reads better than touching arcs
  const gap = slices.length > 1 ? 0.8 : 0;
  for (const s of slices) {
    if (total <= 0 || s.value <= 0) continue;
    const len = (s.value / total) * circ;
    svg.createSvg("circle", {
      attr: {
        cx: 50,
        cy: 50,
        r,
        fill: "none",
        stroke: s.color,
        "stroke-width": 12,
        "stroke-dasharray": `${Math.max(0, len - gap)} ${circ}`,
        "stroke-dashoffset": -offset,
        transform: "rotate(-90 50 50)",
      },
    });
    offset += len;
  }
  center(wrap.createDiv("trimly-donut-center"));
}

export interface BarGroup {
  label: string;
  income: number;
  expense: number;
  current?: boolean;
}

/** Paired income/expense bars per month. */
export function cashFlowBars(parent: HTMLElement, groups: BarGroup[], tooltip: (g: BarGroup) => string) {
  const wrap = parent.createDiv("trimly-bars");
  const max = Math.max(1, ...groups.map((g) => Math.max(g.income, g.expense)));
  for (const g of groups) {
    const col = wrap.createDiv("trimly-bars-col");
    if (g.current) col.addClass("is-current");
    col.setAttr("aria-label", tooltip(g));
    const pair = col.createDiv("trimly-bars-pair");
    pair.createDiv("trimly-bars-bar is-income").setCssProps({ "--trimly-h": `${(g.income / max) * 100}%` });
    pair.createDiv("trimly-bars-bar is-expense").setCssProps({ "--trimly-h": `${(g.expense / max) * 100}%` });
    col.createDiv({ cls: "trimly-bars-label", text: g.label });
  }
}
