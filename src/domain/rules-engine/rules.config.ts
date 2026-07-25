import { BUY_RECO, BUY_TIER, PRIORITY } from "@/lib/constants";

export const INCOME_BANDS = {
  LOW: 25_000 * 100,
  MID: 60_000 * 100,
} as const;

export const CATEGORY_CAPS: Record<string, { need: number; luxury: number }> = {
  gadgets: { need: 0.25, luxury: 0.15 },
  shopping: { need: 0.2, luxury: 0.1 },
  entertainment: { need: 0.1, luxury: 0.05 },
  default: { need: 0.3, luxury: 0.15 },
};

// Scales penalties from rules that don't otherwise account for purchase
// priority (income-ratio, budget overflow, liquid floor, DTI, goal delay,
// emergency impact, spend trend). A NEED purchase is discounted since it's
// often unavoidable; an IMPULSE purchase is scrutinized harder. HARD_UNSAFE,
// GADGET_CAP/CATEGORY_CAP, and IMPULSE itself are exempt — they already
// factor priority directly (via the need/luxury cap split, or by definition).
export const PRIORITY_PENALTY_MULTIPLIER: Record<number, number> = {
  [PRIORITY.NEED]: 0.5,
  [PRIORITY.USEFUL]: 0.85,
  [PRIORITY.LUXURY]: 1,
  [PRIORITY.IMPULSE]: 1.15,
};

export const GADGET_SAFE_RANGE = {
  low: { min: 8_000, max: 15_000 },
  mid: { min: 15_000, max: 35_000 },
  high: { min: 25_000, max: 80_000 },
};

export const BUDGET_RATIOS_BY_BAND = {
  low: {
    food: 0.18,
    transport: 0.08,
    shopping: 0.05,
    gadgets: 0.03,
    entertainment: 0.04,
    bills: 0.12,
    family: 0.08,
    education: 0.05,
    health: 0.05,
    savings: 0.15,
    investment: 0.05,
    other: 0.12,
  },
  mid: {
    food: 0.15,
    transport: 0.1,
    shopping: 0.08,
    gadgets: 0.05,
    entertainment: 0.05,
    bills: 0.1,
    family: 0.08,
    education: 0.06,
    health: 0.05,
    savings: 0.2,
    investment: 0.08,
    other: 0.1,
  },
  high: {
    food: 0.12,
    transport: 0.1,
    shopping: 0.1,
    gadgets: 0.08,
    entertainment: 0.08,
    bills: 0.08,
    family: 0.08,
    education: 0.06,
    health: 0.05,
    savings: 0.25,
    investment: 0.1,
    other: 0.1,
  },
} as const;

export function scoreToTier(score: number): number {
  if (score >= 80) return BUY_TIER.CHEAP;
  if (score >= 65) return BUY_TIER.REASONABLE;
  if (score >= 50) return BUY_TIER.STRETCH;
  if (score >= 30) return BUY_TIER.EXPENSIVE;
  return BUY_TIER.FINANCIALLY_UNSAFE;
}

export function tierToRecommendation(
  tier: number,
  hardUnsafe: boolean,
  saveMonths: number
): number {
  if (hardUnsafe || tier === BUY_TIER.FINANCIALLY_UNSAFE) return BUY_RECO.AVOID;
  if (tier === BUY_TIER.EXPENSIVE) return saveMonths > 2 ? BUY_RECO.SAVE_MONTHS : BUY_RECO.WAIT_SALARY;
  if (tier === BUY_TIER.STRETCH) return BUY_RECO.WAIT_SALARY;
  if (tier === BUY_TIER.REASONABLE) return BUY_RECO.BUY_NOW;
  return BUY_RECO.BUY_NOW;
}

export const MATURITY_LEVELS = [
  { max: 30, label: "Poor" },
  { max: 50, label: "Improving" },
  { max: 65, label: "Stable" },
  { max: 80, label: "Disciplined" },
  { max: 100, label: "Wealth Builder" },
];
