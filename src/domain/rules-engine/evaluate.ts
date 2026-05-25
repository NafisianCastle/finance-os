import { aggregateSmartBuy, runSmartBuyRules } from "./smart-buy.rules";
import { suggestBudgets } from "./budget-suggest.rules";
import { calculateNetWorth } from "./net-worth.rules";
import { forecastCashflow } from "./cashflow.rules";
import { computeMaturityScore } from "./maturity.rules";
import type {
  RuleContext,
  SmartBuyInput,
  SmartBuyResult,
  BudgetSuggestion,
  NetWorthResult,
  CashflowForecast,
  MaturityResult,
} from "./types";

export function evaluateSmartBuy(ctx: RuleContext, input: SmartBuyInput): SmartBuyResult {
  const outcomes = runSmartBuyRules(ctx, input);
  return aggregateSmartBuy(ctx, input, outcomes);
}

export { suggestBudgets, calculateNetWorth, forecastCashflow, computeMaturityScore };
export type {
  RuleContext,
  SmartBuyInput,
  SmartBuyResult,
  BudgetSuggestion,
  NetWorthResult,
  CashflowForecast,
  MaturityResult,
};
