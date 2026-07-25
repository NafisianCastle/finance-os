import type { CashflowForecast } from "./types";

export interface CashflowInput {
  currentLiquidPoisha: number;
  expectedIncomePoisha: number;
  recurringExpensePoisha: number;
  debtInstallmentsPoisha: number;
  avgDailyDiscretionaryPoisha: number;
  daysRemaining?: number;
  overspentCategories?: string[];
}

export function forecastCashflow(input: CashflowInput): CashflowForecast {
  const days = input.daysRemaining ?? 30;
  const projectedOut =
    input.recurringExpensePoisha +
    input.debtInstallmentsPoisha +
    input.avgDailyDiscretionaryPoisha * days;
  const projectedMonthEndPoisha =
    input.currentLiquidPoisha + input.expectedIncomePoisha - projectedOut;
  const lowCashWarning = projectedMonthEndPoisha < input.recurringExpensePoisha * 0.5;

  return {
    projectedMonthEndPoisha,
    lowCashWarning,
    dailyBurnPoisha: input.avgDailyDiscretionaryPoisha,
    budgetPressureCategories: input.overspentCategories ?? [],
  };
}
