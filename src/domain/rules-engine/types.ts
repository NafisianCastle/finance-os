export enum ReasonCode {
  INCOME_RATIO_HIGH = 1,
  GADGET_CAP_EXCEEDED = 2,
  BUDGET_OVERFLOW = 3,
  LIQUID_FLOOR_BREACH = 4,
  DTI_STRESS = 5,
  GOAL_DELAY = 6,
  IMPULSE_LUXURY = 7,
  CATEGORY_SPEND_UP = 8,
  EMERGENCY_IMPACT = 9,
  SAFE_WITHIN_BAND = 10,
}

export interface RuleContext {
  monthlyIncomePoisha: number;
  liquidSavingsPoisha: number;
  monthlyExpensesPoisha: number;
  totalDebtPoisha: number;
  monthlyDebtServicePoisha: number;
  categoryBudgetRemainingPoisha: number;
  emergencyFundTargetPoisha: number;
  emergencyFundCurrentPoisha: number;
  primaryGoalMonthlySurplusPoisha: number;
  investmentValuePoisha: number;
  impulseExpenseShare: number;
  categorySpendTrendPct: number;
}

export interface SmartBuyInput {
  productName: string;
  categoryId: string;
  pricePoisha: number;
  priority: number;
}

export interface RuleOutcome {
  ruleId: string;
  penalty: number;
  hardUnsafe?: boolean;
  reasonCodes: ReasonCode[];
  metadata?: Record<string, number | string>;
}

export interface SmartBuyResult {
  affordabilityScore: number;
  tier: number;
  recommendation: number;
  saveMonths?: number;
  safePriceMinPoisha: number;
  safePriceMaxPoisha: number;
  reasonCodes: ReasonCode[];
  hardUnsafe: boolean;
}

export interface BudgetSuggestion {
  categoryId: string;
  suggestedPoisha: number;
  ratioPct: number;
}

export interface NetWorthResult {
  netWorthPoisha: number;
  spendablePoisha: number;
  heldLiabilitiesPoisha: number;
  totalAssetsPoisha: number;
  totalLiabilitiesPoisha: number;
}

export interface CashflowForecast {
  projectedMonthEndPoisha: number;
  lowCashWarning: boolean;
  dailyBurnPoisha: number;
  budgetPressureCategories: string[];
}

export interface MaturityResult {
  score: number;
  level: string;
  components: Record<string, number>;
}
