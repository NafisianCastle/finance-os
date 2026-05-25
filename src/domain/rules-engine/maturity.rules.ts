import { MATURITY_LEVELS } from "./rules.config";
import type { MaturityResult } from "./types";

export interface MaturityInput {
  budgetAdherencePct: number;
  savingsConsistencyPct: number;
  debtScorePct: number;
  smartBuyDisciplinePct: number;
  goalProgressPct: number;
  impulseControlPct: number;
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

  const score = Math.round(
    components.budget * WEIGHTS.budget +
      components.savings * WEIGHTS.savings +
      components.debt * WEIGHTS.debt +
      components.smartBuy * WEIGHTS.smartBuy +
      components.goals * WEIGHTS.goals +
      components.impulse * WEIGHTS.impulse
  );

  const level =
    MATURITY_LEVELS.find((l) => score <= l.max)?.label ?? "Wealth Builder";

  return { score, level, components };
}
