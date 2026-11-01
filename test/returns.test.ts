import { test } from "node:test";
import assert from "node:assert/strict";
import { cdiReturn, closeReturn, monthlyRateReturn, monthlyReturns, periodReturn, portfolioIndex } from "../src/returns.ts";
import type { PortfolioSnapshot } from "../src/ledger.ts";

const close = (actual: number | null, expected: number) => {
  assert.ok(actual !== null, "expected a number");
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≈ ${expected}`);
};

const snap = (date: string, value: number, invested: number): PortfolioSnapshot => ({ date, value, invested });

test("growth with no money moving in or out is the plain change in value", () => {
  const idx = portfolioIndex([snap("2026-10-01", 1000_00, 1000_00), snap("2026-10-31", 1010_00, 1000_00)]);
  close(periodReturn(idx, "2026-10-01", "2026-10-31"), 0.01);
});

test("a contribution is not counted as gain", () => {
  // +R$ 500 deposited, value grew only by that: 0% return, not 50%
  const idx = portfolioIndex([snap("2026-10-01", 1000_00, 1000_00), snap("2026-10-02", 1500_00, 1500_00)]);
  close(periodReturn(idx, "2026-10-01", "2026-10-02"), 0);
});

test("a withdrawal from a profitable portfolio is not counted as loss", () => {
  // half withdrawn: value 1000 -> 500, but cost only 800 -> 400
  const idx = portfolioIndex([snap("2026-10-01", 1000_00, 800_00), snap("2026-10-02", 500_00, 400_00)]);
  close(periodReturn(idx, "2026-10-01", "2026-10-02"), 0);
});

test("returns chain across periods regardless of portfolio size", () => {
  const idx = portfolioIndex([
    snap("2026-09-30", 1000_00, 1000_00),
    snap("2026-10-15", 1100_00, 1000_00), // +10%
    snap("2026-10-16", 3100_00, 3000_00), // +2000 deposited, flat
    snap("2026-10-31", 2790_00, 3000_00), // -10%
  ]);
  close(periodReturn(idx, "2026-09-30", "2026-10-31"), 1.1 * 0.9 - 1);
});

test("starting from an empty portfolio does not invent a return", () => {
  const idx = portfolioIndex([snap("2026-10-01", 0, 0), snap("2026-10-02", 1000_00, 1000_00), snap("2026-10-03", 1020_00, 1000_00)]);
  close(periodReturn(idx, "2026-10-01", "2026-10-03"), 0.02);
});

test("a period starting before the history counts from the first snapshot", () => {
  const idx = portfolioIndex([snap("2026-10-10", 1000_00, 1000_00), snap("2026-10-20", 1050_00, 1000_00)]);
  close(periodReturn(idx, "2025-10-20", "2026-10-20"), 0.05);
});

test("CDI compounds the business days strictly after the start date", () => {
  const cdi = [
    { date: "2026-10-01", rate: 0.05 },
    { date: "2026-10-02", rate: 0.05 },
    { date: "2026-10-05", rate: 0.05 },
  ];
  close(cdiReturn(cdi, "2026-10-01", "2026-10-05"), 1.0005 ** 2 - 1);
});

test("IPCA only counts months fully inside the period", () => {
  const ipca = [
    { date: "2026-08-01", rate: -0.32 },
    { date: "2026-09-01", rate: 0.82 },
  ];
  // August ends after the period; September is entirely inside
  close(monthlyRateReturn(ipca, "2026-08-15", "2026-09-30"), 0.0082);
  close(monthlyRateReturn(ipca, "2026-07-31", "2026-09-30"), 0.9968 * 1.0082 - 1);
  // no month over yet: unknown, not 0%, so a two-week-old portfolio doesn't look like it beat inflation
  assert.equal(monthlyRateReturn(ipca, "2026-09-10", "2026-09-25"), null);
});

test("monthly returns line up with the benchmarks of each month", () => {
  const idx = portfolioIndex([
    snap("2026-09-10", 1000_00, 1000_00),
    snap("2026-09-30", 1010_00, 1000_00),
    snap("2026-10-25", 1030_20, 1000_00),
  ]);
  const months = monthlyReturns(
    idx,
    {
      cdi: [{ date: "2026-10-01", rate: 0.05 }],
      ipca: [{ date: "2026-09-01", rate: 0.82 }],
      poupanca: [
        { date: "2026-09-01", rate: 0.67 },
        { date: "2026-10-01", rate: 0.68 },
      ],
      ibov: [
        { date: "2026-09-30", close: 100 },
        { date: "2026-10-24", close: 95 },
      ],
      ifix: null,
    },
    "2026-10-25"
  );
  assert.deepEqual(
    months.map((m) => m.month),
    ["2026-09", "2026-10"]
  );
  close(months[0].portfolio, 0.01);
  close(months[1].portfolio, 0.02);
  close(months[1].cdi, 0.0005);
  close(months[0].ipca, 0.0082);
  // October's IPCA is not out yet
  assert.equal(months[1].ipca, null);
  // poupança pays on the anniversary: October's yield only counts once the month is over
  close(months[0].poupanca, 0.0067);
  assert.equal(months[1].poupanca, null);
  // B3 down: the IFIX column stays empty instead of showing a 0% month
  assert.equal(months[1].ifix, null);
  close(months[1].ibov, -0.05);
});

test("an index return runs from the last close on or before each date", () => {
  const ibov = [
    { date: "2026-10-02", close: 100 },
    { date: "2026-10-05", close: 110 },
    { date: "2026-10-09", close: 121 },
  ];
  // the 3rd and 4th are a weekend: the 2nd's close stands for them
  close(closeReturn(ibov, "2026-10-04", "2026-10-08"), 0.1);
  // a portfolio older than the data counts from the first close
  close(closeReturn(ibov, "2026-09-01", "2026-10-09"), 0.21);
  assert.equal(closeReturn([], "2026-10-01", "2026-10-09"), null);
  assert.equal(closeReturn(null, "2026-10-01", "2026-10-09"), null);
});
