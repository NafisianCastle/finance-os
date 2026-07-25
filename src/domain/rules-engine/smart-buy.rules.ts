import { PRIORITY } from "@/lib/constants";
import { majorToMinorUnits } from "@/lib/money";

function bdtToPoisha(amount: number): number {
  return majorToMinorUnits(amount, "BDT");
}
import {
  CATEGORY_CAPS,
  GADGET_SAFE_RANGE,
  INCOME_BANDS,
  PRIORITY_PENALTY_MULTIPLIER,
  scoreToTier,
  tierToRecommendation,
} from "./rules.config";
import { ReasonCode, type RuleContext, type RuleOutcome, type SmartBuyInput } from "./types";

function incomeBand(incomePoisha: number): "low" | "mid" | "high" {
  if (incomePoisha < INCOME_BANDS.LOW) return "low";
  if (incomePoisha < INCOME_BANDS.MID) return "mid";
  return "high";
}

export function getGadgetSafeRange(incomePoisha: number): { min: number; max: number } {
  const band = incomeBand(incomePoisha);
  const range = GADGET_SAFE_RANGE[band];
  return { min: bdtToPoisha(range.min), max: bdtToPoisha(range.max) };
}

export function runSmartBuyRules(ctx: RuleContext, input: SmartBuyInput): RuleOutcome[] {
  const outcomes: RuleOutcome[] = [];
  const income = Math.max(ctx.monthlyIncomePoisha, 1);
  const ratio = input.pricePoisha / income;
  const caps = CATEGORY_CAPS[input.categoryId] ?? CATEGORY_CAPS.default;
  const isLuxury = input.priority >= PRIORITY.LUXURY;
  const cap = isLuxury ? caps.luxury : caps.need;
  // Rules below don't otherwise account for priority (unlike GADGET_CAP/
  // CATEGORY_CAP, which already pick a stricter cap for luxury, and IMPULSE,
  // which is priority-specific by definition). A NEED is discounted; an
  // IMPULSE is scrutinized harder. HARD_UNSAFE is exempt — 3x income is
  // unsafe regardless of how necessary it feels.
  const priorityMultiplier = PRIORITY_PENALTY_MULTIPLIER[input.priority] ?? 1;

  if (ratio > 3) {
    outcomes.push({
      ruleId: "HARD_UNSAFE",
      penalty: 100,
      hardUnsafe: true,
      reasonCodes: [ReasonCode.INCOME_RATIO_HIGH],
      metadata: { ratioPct: Math.round(ratio * 100) },
    });
  } else if (ratio > 1) {
    outcomes.push({
      ruleId: "INCOME_RATIO",
      penalty: Math.round(Math.min(80, ratio * 25) * priorityMultiplier),
      reasonCodes: [ReasonCode.INCOME_RATIO_HIGH],
      metadata: { ratioPct: Math.round(ratio * 100) },
    });
  }

  if (input.categoryId === "gadgets" && ratio > cap) {
    outcomes.push({
      ruleId: "GADGET_CAP",
      penalty: ratio > 1 ? 90 : 50,
      hardUnsafe: ratio > 2,
      reasonCodes: [ReasonCode.GADGET_CAP_EXCEEDED],
      metadata: { capPct: Math.round(cap * 100) },
    });
  } else if (ratio > cap) {
    outcomes.push({
      ruleId: "CATEGORY_CAP",
      penalty: ratio > cap * 2 ? 70 : 40,
      hardUnsafe: ratio > cap * 3,
      reasonCodes: [ReasonCode.CATEGORY_CAP_EXCEEDED],
      metadata: { capPct: Math.round(cap * 100) },
    });
  }

  if (input.pricePoisha > ctx.categoryBudgetRemainingPoisha && ctx.categoryBudgetRemainingPoisha >= 0) {
    outcomes.push({
      ruleId: "BUDGET_OVERFLOW",
      penalty: Math.round(45 * priorityMultiplier),
      reasonCodes: [ReasonCode.BUDGET_OVERFLOW],
    });
  }

  const preLiquid = ctx.liquidSavingsPoisha;
  const postLiquid = preLiquid - input.pricePoisha;
  const oneMonthExpenses = Math.max(ctx.monthlyExpensesPoisha, income * 0.5);
  const priceRatio = input.pricePoisha / income;
  // Only blame this purchase for the floor breach if it's the one causing it
  // (was above the floor before) or it's a substantial purchase on its own.
  if (postLiquid < oneMonthExpenses && (preLiquid >= oneMonthExpenses || priceRatio > 0.2)) {
    outcomes.push({
      ruleId: "LIQUID_FLOOR",
      penalty: Math.round(85 * priorityMultiplier),
      hardUnsafe: postLiquid < oneMonthExpenses * 0.5,
      reasonCodes: [ReasonCode.LIQUID_FLOOR_BREACH],
    });
  }

  const dti = ctx.monthlyDebtServicePoisha / income;
  if (dti > 0.4 && input.pricePoisha > income * 0.15) {
    outcomes.push({
      ruleId: "DTI_STRESS",
      penalty: Math.round(35 * priorityMultiplier),
      reasonCodes: [ReasonCode.DTI_STRESS],
      metadata: { dtiPct: Math.round(dti * 100) },
    });
  }

  if (ctx.primaryGoalMonthlySurplusPoisha > 0) {
    const monthsDelayed = input.pricePoisha / ctx.primaryGoalMonthlySurplusPoisha;
    if (monthsDelayed > 2) {
      outcomes.push({
        ruleId: "GOAL_DELAY",
        penalty: Math.round(Math.min(50, monthsDelayed * 8) * priorityMultiplier),
        reasonCodes: [ReasonCode.GOAL_DELAY],
        metadata: { monthsDelayed: Math.round(monthsDelayed) },
      });
    }
  }

  if (ctx.emergencyFundTargetPoisha > ctx.emergencyFundCurrentPoisha) {
    const impact =
      (input.pricePoisha / (ctx.emergencyFundTargetPoisha - ctx.emergencyFundCurrentPoisha)) * 100;
    if (impact > 25) {
      outcomes.push({
        ruleId: "EMERGENCY",
        penalty: Math.round(30 * priorityMultiplier),
        reasonCodes: [ReasonCode.EMERGENCY_IMPACT],
      });
    }
  }

  if (input.priority === PRIORITY.IMPULSE && isLuxury) {
    outcomes.push({
      ruleId: "IMPULSE",
      penalty: 25,
      reasonCodes: [ReasonCode.IMPULSE_LUXURY],
    });
  }

  if (ctx.categorySpendTrendPct > 20) {
    outcomes.push({
      ruleId: "SPEND_TREND",
      penalty: Math.round(15 * priorityMultiplier),
      reasonCodes: [ReasonCode.CATEGORY_SPEND_UP],
      metadata: { trendPct: ctx.categorySpendTrendPct },
    });
  }

  if (outcomes.length === 0) {
    outcomes.push({
      ruleId: "SAFE",
      penalty: 0,
      reasonCodes: [ReasonCode.SAFE_WITHIN_BAND],
    });
  }

  return outcomes;
}

export function aggregateSmartBuy(
  ctx: RuleContext,
  input: SmartBuyInput,
  outcomes: RuleOutcome[]
): import("./types").SmartBuyResult {
  const hardUnsafe = outcomes.some((o) => o.hardUnsafe);
  const maxPenalty = Math.max(...outcomes.map((o) => o.penalty), 0);
  const restPenalty = outcomes
    .map((o) => o.penalty)
    .sort((a, b) => b - a)
    .slice(1)
    .reduce((sum, p) => sum + p * 0.3, 0);
  const totalPenalty = Math.min(100, maxPenalty + restPenalty);
  const impulseBoost = input.priority === PRIORITY.IMPULSE ? 10 : 0;
  const score = Math.round(Math.max(0, Math.min(100, 100 - totalPenalty - impulseBoost)));
  const income = Math.max(ctx.monthlyIncomePoisha, 1);
  const surplus = Math.max(income - ctx.monthlyExpensesPoisha - ctx.monthlyDebtServicePoisha, 1);
  const saveMonths = Math.ceil(input.pricePoisha / surplus);

  const tier = hardUnsafe ? 5 : scoreToTier(score);
  const safeRange =
    input.categoryId === "gadgets"
      ? getGadgetSafeRange(ctx.monthlyIncomePoisha)
      : {
          min: Math.round(income * 0.05),
          max: Math.round(income * 0.15),
        };

  const reasonCodes = [...new Set(outcomes.flatMap((o) => o.reasonCodes))];
  const reasonMetadata = outcomes.reduce<Record<string, number | string>>(
    (acc, o) => ({ ...acc, ...o.metadata }),
    {}
  );

  return {
    affordabilityScore: score,
    tier,
    recommendation: tierToRecommendation(tier, hardUnsafe, saveMonths),
    saveMonths: saveMonths > 0 ? saveMonths : undefined,
    safePriceMinPoisha: safeRange.min,
    safePriceMaxPoisha: safeRange.max,
    reasonCodes,
    reasonMetadata,
    hardUnsafe,
  };
}
