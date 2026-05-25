import { BUDGET_RATIOS_BY_BAND, INCOME_BANDS } from "./rules.config";
import type { BudgetSuggestion } from "./types";

function incomeBand(incomePoisha: number): keyof typeof BUDGET_RATIOS_BY_BAND {
  if (incomePoisha < INCOME_BANDS.LOW) return "low";
  if (incomePoisha < INCOME_BANDS.MID) return "mid";
  return "high";
}

export function suggestBudgets(
  monthlyIncomePoisha: number,
  actualRatios: Record<string, number> = {},
  blendActual = 0.3
): BudgetSuggestion[] {
  const band = incomeBand(monthlyIncomePoisha);
  const base = BUDGET_RATIOS_BY_BAND[band];
  return Object.entries(base).map(([categoryId, baseRatio]) => {
    const actual = actualRatios[categoryId] ?? baseRatio;
    const blended = baseRatio * (1 - blendActual) + actual * blendActual;
    const ratioPct = Math.round(blended * 1000) / 10;
    return {
      categoryId,
      ratioPct,
      suggestedPoisha: Math.round(monthlyIncomePoisha * blended),
    };
  });
}

export function budgetHealthScore(
  allocations: { allocated: number; spent: number }[]
): number {
  if (allocations.length === 0) return 50;
  let score = 0;
  for (const { allocated, spent } of allocations) {
    if (allocated <= 0) continue;
    const pct = spent / allocated;
    if (pct >= 0.95 && pct <= 1.05) score += 100;
    else if (pct < 0.95) score += 90;
    else if (pct <= 1.15) score += 60;
    else score += 20;
  }
  return Math.round(score / allocations.length);
}
