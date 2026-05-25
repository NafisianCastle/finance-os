import { describe, it, expect } from "vitest";
import { suggestBudgets, budgetHealthScore } from "@/domain/rules-engine/budget-suggest.rules";
import { bdtToPoisha } from "@/lib/money";

describe("Budget suggestion engine", () => {
  it("allocates savings for low income band", () => {
    const suggestions = suggestBudgets(bdtToPoisha(20_000));
    const savings = suggestions.find((s) => s.categoryId === "savings");
    expect(savings).toBeDefined();
    expect(savings!.ratioPct).toBeGreaterThanOrEqual(10);
    const total = suggestions.reduce((sum, s) => sum + s.suggestedPoisha, 0);
    expect(total).toBeGreaterThan(bdtToPoisha(15_000));
  });

  it("computes budget health score", () => {
    const score = budgetHealthScore([
      { allocated: 100, spent: 98 },
      { allocated: 200, spent: 150 },
    ]);
    expect(score).toBeGreaterThan(60);
  });
});
