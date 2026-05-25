import { describe, it, expect } from "vitest";
import { computeMaturityScore } from "@/domain/rules-engine/maturity.rules";

describe("Financial maturity score", () => {
  it("returns Wealth Builder for high components", () => {
    const result = computeMaturityScore({
      budgetAdherencePct: 90,
      savingsConsistencyPct: 85,
      debtScorePct: 80,
      smartBuyDisciplinePct: 90,
      goalProgressPct: 75,
      impulseControlPct: 85,
    });
    expect(result.score).toBeGreaterThanOrEqual(80);
    expect(result.level).toBe("Wealth Builder");
  });

  it("returns Poor for low discipline", () => {
    const result = computeMaturityScore({
      budgetAdherencePct: 20,
      savingsConsistencyPct: 15,
      debtScorePct: 25,
      smartBuyDisciplinePct: 10,
      goalProgressPct: 5,
      impulseControlPct: 20,
    });
    expect(result.score).toBeLessThan(30);
    expect(result.level).toBe("Poor");
  });
});
