import { describe, it, expect } from "vitest";
import { computeInvestmentMetrics } from "@/domain/investments/calculate";
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
});
