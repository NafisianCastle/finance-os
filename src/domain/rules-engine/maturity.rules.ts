import { MATURITY_LEVELS } from "./rules.config";
import type { MaturityResult } from "./types";

export interface MaturityInput {
  budgetAdherencePct: number | null;
  savingsConsistencyPct: number | null;
  debtScorePct: number;
  smartBuyDisciplinePct: number | null;
  goalProgressPct: number | null;
  impulseControlPct: number | null;
}

const WEIGHTS = {
  budget: 0.25,
  savings: 0.2,
  debt: 0.2,
  smartBuy: 0.15,
  goals: 0.1,
  impulse: 0.1,
};

export function computeMaturityScore(input: MaturityInput): MaturityResult {
  const components = {
    budget: input.budgetAdherencePct,
    savings: input.savingsConsistencyPct,
    debt: input.debtScorePct,
    smartBuy: input.smartBuyDisciplinePct,
    goals: input.goalProgressPct,
    impulse: input.impulseControlPct,
  };

  // Components with no underlying data (e.g. no budgets set yet) are excluded
  // rather than filled with a guessed neutral value — a brand-new account
  // should read as "not enough data" instead of a fake mid-range score.
  let weightedSum = 0;
  let weightTotal = 0;
  let measuredCount = 0;
  for (const key of Object.keys(components) as (keyof typeof components)[]) {
    const value = components[key];
    if (value === null) continue;
    weightedSum += value * WEIGHTS[key];
    weightTotal += WEIGHTS[key];
    measuredCount += 1;
  }

  const score = weightTotal > 0 ? Math.round(weightedSum / weightTotal) : 0;

  const level =
    MATURITY_LEVELS.find((l) => score <= l.max)?.label ?? "Wealth Builder";

  return {
    score,
    level,
    components,
    measuredCount,
    totalCount: Object.keys(components).length,
  };
}
