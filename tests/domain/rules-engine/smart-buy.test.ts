import { describe, it, expect } from "vitest";
import { evaluateSmartBuy } from "@/domain/rules-engine/evaluate";
import { bdtToPoisha } from "@/lib/money";
import { PRIORITY } from "@/lib/constants";
import type { RuleContext } from "@/domain/rules-engine/types";

const baseCtx: RuleContext = {
  monthlyIncomePoisha: bdtToPoisha(20_000),
  liquidSavingsPoisha: bdtToPoisha(10_000),
  monthlyExpensesPoisha: bdtToPoisha(15_000),
  totalDebtPoisha: 0,
  monthlyDebtServicePoisha: 0,
  categoryBudgetRemainingPoisha: bdtToPoisha(2_000),
  emergencyFundTargetPoisha: bdtToPoisha(45_000),
  emergencyFundCurrentPoisha: bdtToPoisha(5_000),
  primaryGoalMonthlySurplusPoisha: bdtToPoisha(3_000),
  investmentValuePoisha: 0,
  impulseExpenseShare: 0.1,
  categorySpendTrendPct: 0,
};

describe("Smart Buy — iPhone on 20k income", () => {
  it("flags 120k gadget as financially unsafe", () => {
    const result = evaluateSmartBuy(baseCtx, {
      productName: "iPhone",
      categoryId: "gadgets",
      pricePoisha: bdtToPoisha(120_000),
      priority: PRIORITY.LUXURY,
    });

    expect(result.hardUnsafe).toBe(true);
    expect(result.tier).toBe(5);
    expect(result.affordabilityScore).toBeLessThan(30);
    expect(result.recommendation).toBe(4);
    expect(result.safePriceMaxPoisha).toBeLessThanOrEqual(bdtToPoisha(25_000));
  });
});

describe("Smart Buy — small need purchase", () => {
  it("scores reasonably for affordable item", () => {
    const result = evaluateSmartBuy(baseCtx, {
      productName: "Rice cooker",
      categoryId: "gadgets",
      pricePoisha: bdtToPoisha(3_000),
      priority: PRIORITY.NEED,
    });

    expect(result.affordabilityScore).toBeGreaterThan(50);
    expect(result.hardUnsafe).toBe(false);
  });
});
