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

/**
 * Lines over time; `xs` holds one timestamp per value, so gaps between points
 * keep their width. Hovering (or touching) shows the nearest point: a guide
 * line, a dot per series and `tooltip(i)`'s lines (first one as the heading).
 * With `range`, dragging across the chart marks a stretch and shows
 * `range(from, to)`'s lines for it until the next click.
 */
export function lineChart(
  parent: HTMLElement,
  xs: number[],
  series: LineSeries[],
  labels: { start: string; end: string },
  tooltip?: (i: number) => string[],
  range?: (from: number, to: number) => string[]
) {
  const wrap = parent.createDiv("trimly-line");
  const plot = wrap.createDiv("trimly-line-plot");
  const W = 300;
  const H = 100;
  const svg = plot.createSvg("svg", { attr: { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "none" } });
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
    // SVG elements take classes one token each: a space-separated string throws
    if (s.area) svg.createSvg("polygon", { cls: ["trimly-line-area", s.cls], attr: { points: `0,${H} ${pts} ${x(s.values.length - 1).toFixed(2)},${H}` } });
    svg.createSvg("polyline", { cls: ["trimly-line-stroke", s.cls, ...(s.dashed ? ["is-dashed"] : [])], attr: { points: pts } });
  }

  if (tooltip) {
    // HTML overlay: dots drawn inside the stretched SVG would turn into ellipses
    const guide = plot.createDiv("trimly-line-guide");
    const dots = series.map((s) => plot.createDiv(`trimly-line-dot ${s.cls}`));
    if (range) plot.addClass("is-range");
    const band = range ? plot.createDiv("trimly-line-band") : null;
    const tip = plot.createDiv("trimly-line-tip");
    const nearest = (e: PointerEvent) => {
      const rect = plot.getBoundingClientRect();
      if (rect.width <= 0) return null;
      const at = x0 + ((e.clientX - rect.left) / rect.width) * span;
      let i = 0;
      for (let k = 1; k < xs.length; k++) if (Math.abs(xs[k] - at) < Math.abs(xs[i] - at)) i = k;
      return i;
    };
    const fillTip = (lines: string[], left: number) => {
      tip.empty();
      lines.forEach((line, k) => tip.createDiv({ cls: k === 0 ? "trimly-line-tip-head" : "", text: line }));
      tip.setCssProps({ "--trimly-x": `${left}%` });
      // keep the box inside the chart: flip it to the left of the guide on the right half
      tip.toggleClass("is-left", left > 50);
    };
    // drag start while the button is down, and the stretch marked by the last drag
    let dragFrom: number | null = null;
    let selected = false;
    const select = (a: number, b: number) => {
      if (!band || !range) return;
      const [from, to] = a < b ? [a, b] : [b, a];
      const l = (x(from) / W) * 100;
      const r = (x(to) / W) * 100;
      band.setCssProps({ "--trimly-x": `${l}%`, "--trimly-w": `${r - l}%` });
      fillTip(range(from, to), r);
      selected = true;
      plot.removeClass("is-hover");
      plot.addClass("is-selected");
    };
    const show = (e: PointerEvent) => {
      const i = nearest(e);
      if (i === null) return;
      if (dragFrom !== null && i !== dragFrom) return select(dragFrom, i);
      if (selected) return;
      const left = (x(i) / W) * 100;
      guide.setCssProps({ "--trimly-x": `${left}%` });
      series.forEach((s, k) => dots[k].setCssProps({ "--trimly-x": `${left}%`, "--trimly-y": `${(y(s.values[i]) / H) * 100}%` }));
      fillTip(tooltip(i), left);
      plot.addClass("is-hover");
    };
    plot.addEventListener("pointermove", show);
    plot.addEventListener("pointerdown", (e) => {
      // a new click clears the last stretch
      selected = false;
      plot.removeClass("is-selected");
      if (range && e.button === 0) {
        dragFrom = nearest(e);
        plot.setPointerCapture(e.pointerId);
      }
      show(e);
    });
    plot.addEventListener("pointerup", () => (dragFrom = null));
    plot.addEventListener("pointercancel", () => (dragFrom = null));
    plot.addEventListener("pointerleave", () => plot.removeClass("is-hover"));
  }

  const foot = wrap.createDiv("trimly-line-labels");
  foot.createSpan({ text: labels.start });
  foot.createSpan({ text: labels.end });
}

export interface Bar {
  label: string;
  value: number;
  current?: boolean;
}

/** One bar per group, e.g. income per month. */
export function bars(parent: HTMLElement, groups: Bar[], tooltip: (g: Bar) => string) {
  const wrap = parent.createDiv("trimly-bars");
  const max = Math.max(1, ...groups.map((g) => g.value));
  for (const g of groups) {
    const col = wrap.createDiv("trimly-bars-col");
    if (g.current) col.addClass("is-current");
    col.setAttr("aria-label", tooltip(g));
    const pair = col.createDiv("trimly-bars-pair");
    pair.createDiv("trimly-bars-bar is-income").setCssProps({ "--trimly-h": `${(g.value / max) * 100}%` });
    col.createDiv({ cls: "trimly-bars-label", text: g.label });
  }
}
