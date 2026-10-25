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

export interface LineSeries {
  values: number[];
  /** CSS class giving the color, e.g. "is-accent" */
  cls: string;
  /** fill the area under the line */
  area?: boolean;
  /** dashed line */
  dashed?: boolean;
}

/** Lines over time; `xs` holds one timestamp per value, so gaps between points keep their width. */
export function lineChart(parent: HTMLElement, xs: number[], series: LineSeries[], labels: { start: string; end: string }) {
  const wrap = parent.createDiv("trimly-line");
  const W = 300;
  const H = 100;
  const svg = wrap.createSvg("svg", { attr: { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "none" } });
  const all = series.flatMap((s) => s.values);
  let min = Math.min(...all);
  let max = Math.max(...all);
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const pad = (max - min) * 0.08;
  min -= pad;
  max += pad;
  const x0 = xs[0];
  const span = Math.max(1, xs[xs.length - 1] - x0);
  const x = (i: number) => ((xs[i] - x0) / span) * W;
  const y = (v: number) => H - ((v - min) / (max - min)) * H;
  // zero line, when the range crosses it (returns going negative)
  if (min < 0 && max > 0) svg.createSvg("line", { cls: "trimly-line-zero", attr: { x1: 0, x2: W, y1: y(0), y2: y(0) } });
  for (const s of series) {
    const pts = s.values.map((v, i) => `${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(" ");
    if (s.area) svg.createSvg("polygon", { cls: `trimly-line-area ${s.cls}`, attr: { points: `0,${H} ${pts} ${x(s.values.length - 1).toFixed(2)},${H}` } });
    svg.createSvg("polyline", { cls: `trimly-line-stroke ${s.cls}${s.dashed ? " is-dashed" : ""}`, attr: { points: pts } });
  }
  const foot = wrap.createDiv("trimly-line-labels");
  foot.createSpan({ text: labels.start });
  foot.createSpan({ text: labels.end });
}
