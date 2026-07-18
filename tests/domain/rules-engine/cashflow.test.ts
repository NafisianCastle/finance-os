import { describe, it, expect } from "vitest";
import { forecastCashflow } from "@/domain/rules-engine/cashflow.rules";

describe("forecastCashflow", () => {
  it("projects month-end balance from income minus recurring/debt/discretionary spend", () => {
    const result = forecastCashflow({
      currentLiquidPoisha: 10_000,
      expectedIncomePoisha: 5_000,
      recurringExpensePoisha: 3_000,
      debtInstallmentsPoisha: 1_000,
      avgDailyDiscretionaryPoisha: 100,
      daysRemaining: 10,
    });

    // 10000 + 5000 - (3000 + 1000 + 100*10) = 10000
    expect(result.projectedMonthEndPoisha).toBe(10_000);
    expect(result.dailyBurnPoisha).toBe(100);
  });

  it("defaults daysRemaining to 30", () => {
    const result = forecastCashflow({
      currentLiquidPoisha: 0,
      expectedIncomePoisha: 0,
      recurringExpensePoisha: 0,
      debtInstallmentsPoisha: 0,
      avgDailyDiscretionaryPoisha: 100,
    });
    expect(result.projectedMonthEndPoisha).toBe(-3_000);
  });

  it("flags low cash warning when projected balance drops below half of recurring expenses", () => {
    const result = forecastCashflow({
      currentLiquidPoisha: 1_000,
      expectedIncomePoisha: 0,
      recurringExpensePoisha: 5_000,
      debtInstallmentsPoisha: 0,
      avgDailyDiscretionaryPoisha: 0,
      daysRemaining: 0,
    });
    // projected = 1000 - 5000 = -4000 < 5000*0.5 = 2500
    expect(result.lowCashWarning).toBe(true);
  });

  it("does not flag low cash warning when comfortably above the threshold", () => {
    const result = forecastCashflow({
      currentLiquidPoisha: 50_000,
      expectedIncomePoisha: 10_000,
      recurringExpensePoisha: 5_000,
      debtInstallmentsPoisha: 0,
      avgDailyDiscretionaryPoisha: 0,
      daysRemaining: 0,
    });
    expect(result.lowCashWarning).toBe(false);
  });

  it("passes through overspent categories, defaulting to empty array", () => {
    const withCats = forecastCashflow({
      currentLiquidPoisha: 0,
      expectedIncomePoisha: 0,
      recurringExpensePoisha: 0,
      debtInstallmentsPoisha: 0,
      avgDailyDiscretionaryPoisha: 0,
      overspentCategories: ["food", "shopping"],
    });
    expect(withCats.budgetPressureCategories).toEqual(["food", "shopping"]);

    const withoutCats = forecastCashflow({
      currentLiquidPoisha: 0,
      expectedIncomePoisha: 0,
      recurringExpensePoisha: 0,
      debtInstallmentsPoisha: 0,
      avgDailyDiscretionaryPoisha: 0,
    });
    expect(withoutCats.budgetPressureCategories).toEqual([]);
  });
});
