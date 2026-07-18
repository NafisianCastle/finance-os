import { describe, it, expect } from "vitest";
import { computeInvestmentMetrics, computePortfolioValue } from "@/domain/investments/calculate";
import { INVESTMENT_EVENT_TYPE, INVESTMENT_STATUS } from "@/lib/investment-constants";
import { majorToMinorUnits } from "@/lib/money";

function bdtToPoisha(amount: number): number {
  return majorToMinorUnits(amount, "BDT");
}
import type { Investment, InvestmentEvent } from "@/infrastructure/db/dexie/schema";

const baseInv: Investment = {
  id: "1",
  userId: "u",
  type: 6,
  name: "Project A",
  investedPoisha: bdtToPoisha(100_000),
  declaredProfitPoisha: bdtToPoisha(20_000),
  projectStartDate: "2025-01-01",
  projectEndDate: "2026-01-01",
  status: INVESTMENT_STATUS.ACTIVE,
  createdAt: "",
  updatedAt: "",
};

function ev(type: number, amountBdt: number): InvestmentEvent {
  return {
    id: String(type),
    userId: "u",
    investmentId: "1",
    type,
    amountPoisha: bdtToPoisha(amountBdt),
    eventDate: "2025-06-01",
    createdAt: "",
    updatedAt: "",
  };
}

describe("Investment metrics", () => {
  it("calculates total return with declared profit and partial capital return", () => {
    const metrics = computeInvestmentMetrics(baseInv, [
      ev(INVESTMENT_EVENT_TYPE.CAPITAL_RETURN, 50_000),
      ev(INVESTMENT_EVENT_TYPE.PROFIT_RECEIVED, 15_000),
    ]);

    expect(metrics.remainingCapitalPoisha).toBe(bdtToPoisha(50_000));
    expect(metrics.declaredProfitPoisha).toBe(bdtToPoisha(20_000));
    expect(metrics.totalReturnPoisha).toBe(bdtToPoisha(-35_000));
    expect(metrics.declaredVsActualPoisha).toBe(bdtToPoisha(-5_000));
  });

  it("tracks loss", () => {
    const metrics = computeInvestmentMetrics(baseInv, [
      ev(INVESTMENT_EVENT_TYPE.LOSS, 30_000),
      ev(INVESTMENT_EVENT_TYPE.CAPITAL_RETURN, 40_000),
    ]);

    expect(metrics.lossPoisha).toBe(bdtToPoisha(30_000));
    expect(metrics.isLoss).toBe(true);
    expect(metrics.totalReturnPoisha).toBeLessThan(0);
  });

  it("declaredProfitPoisha falls back to summed PROFIT_DECLARED events when the field is unset", () => {
    const noDeclaredField: Investment = { ...baseInv, declaredProfitPoisha: 0 };
    const metrics = computeInvestmentMetrics(noDeclaredField, [
      ev(INVESTMENT_EVENT_TYPE.PROFIT_DECLARED, 12_000),
    ]);
    expect(metrics.declaredProfitPoisha).toBe(bdtToPoisha(12_000));
  });

  it("ignores soft-deleted events", () => {
    const deletedEvent: InvestmentEvent = { ...ev(INVESTMENT_EVENT_TYPE.CAPITAL_RETURN, 50_000), deletedAt: "2025-07-01" };
    const metrics = computeInvestmentMetrics(baseInv, [deletedEvent]);
    expect(metrics.capitalReturnedPoisha).toBe(0);
    expect(metrics.remainingCapitalPoisha).toBe(baseInv.investedPoisha);
  });

  it("clamps remainingCapitalPoisha and effectiveValuePoisha at zero", () => {
    const metrics = computeInvestmentMetrics(baseInv, [
      ev(INVESTMENT_EVENT_TYPE.CAPITAL_RETURN, 150_000),
      ev(INVESTMENT_EVENT_TYPE.LOSS, 100_000),
    ]);
    expect(metrics.remainingCapitalPoisha).toBe(0);
    expect(metrics.effectiveValuePoisha).toBe(0);
  });
});

describe("computePortfolioValue", () => {
  it("sums effective value across investments, keyed by investment id", () => {
    const invA: Investment = { ...baseInv, id: "a" };
    const invB: Investment = { ...baseInv, id: "b", investedPoisha: bdtToPoisha(50_000), declaredProfitPoisha: 0 };
    const eventsByInv = new Map<string, InvestmentEvent[]>([
      ["a", [{ ...ev(INVESTMENT_EVENT_TYPE.PROFIT_RECEIVED, 5_000), investmentId: "a" }]],
      ["b", [{ ...ev(INVESTMENT_EVENT_TYPE.CAPITAL_RETURN, 20_000), investmentId: "b" }]],
    ]);

    const total = computePortfolioValue([invA, invB], eventsByInv);
    // a: remaining 100_000 + profit 5_000 = 105_000
    // b: remaining 30_000 + 0 = 30_000
    expect(total).toBe(bdtToPoisha(135_000));
  });

  it("excludes soft-deleted investments", () => {
    const invA: Investment = { ...baseInv, id: "a" };
    const invDeleted: Investment = { ...baseInv, id: "b", deletedAt: "2025-07-01" };
    const total = computePortfolioValue([invA, invDeleted], new Map());
    expect(total).toBe(computePortfolioValue([invA], new Map()));
  });

  it("returns 0 for an empty portfolio", () => {
    expect(computePortfolioValue([], new Map())).toBe(0);
  });
});
