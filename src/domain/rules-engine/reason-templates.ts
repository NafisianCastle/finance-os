import { ReasonCode } from "./types";
import { formatMoney } from "@/lib/money";

type TemplateVars = Record<string, number | string>;

const TEMPLATES: Record<ReasonCode, (v: TemplateVars) => string> = {
  [ReasonCode.INCOME_RATIO_HIGH]: (v) =>
    `Costs ${v.ratioPct ?? "?"}% of monthly income`,
  [ReasonCode.GADGET_CAP_EXCEEDED]: (v) =>
    `Exceeds gadget affordability threshold (max ${v.capPct ?? "?"}% of income)`,
  [ReasonCode.CATEGORY_CAP_EXCEEDED]: (v) =>
    `Exceeds category affordability threshold (max ${v.capPct ?? "?"}% of income)`,
  [ReasonCode.BUDGET_OVERFLOW]: () =>
    `Exceeds remaining category budget for this month`,
  [ReasonCode.LIQUID_FLOOR_BREACH]: () =>
    `Would drop liquid savings below one month of expenses`,
  [ReasonCode.DTI_STRESS]: (v) =>
    `Debt-to-income is ${v.dtiPct ?? "?"}% — large purchase adds pressure`,
  [ReasonCode.GOAL_DELAY]: (v) =>
    `Delays primary savings goal by ~${v.monthsDelayed ?? "?"} months`,
  [ReasonCode.IMPULSE_LUXURY]: () =>
    `Impulse luxury purchase — high discipline risk`,
  [ReasonCode.CATEGORY_SPEND_UP]: (v) =>
    `Category spending up ${v.trendPct ?? "?"}% vs recent average`,
  [ReasonCode.EMERGENCY_IMPACT]: () =>
    `Significantly impacts emergency fund progress`,
  [ReasonCode.SAFE_WITHIN_BAND]: () =>
    `Within healthy affordability band for your income`,
};

export function reasonsToText(
  codes: ReasonCode[],
  metadata: TemplateVars = {}
): string[] {
  return codes.map((code) => {
    const fn = TEMPLATES[code];
    return fn ? fn(metadata) : "Financial factor considered";
  });
}

export function tierLabel(tier: number): string {
  const labels: Record<number, string> = {
    1: "Cheap",
    2: "Reasonable",
    3: "Stretch",
    4: "Expensive",
    5: "Financially Unsafe",
  };
  return labels[tier] ?? "Unknown";
}

export function recoLabel(reco: number, saveMonths?: number): string {
  const labels: Record<number, string> = {
    1: "Buy now",
    2: "Wait until next salary",
    3: saveMonths ? `Save for ${saveMonths} months` : "Save before buying",
    4: "Avoid this purchase",
  };
  return labels[reco] ?? "Review decision";
}

export function formatSafeRange(minPoisha: number, maxPoisha: number): string {
  return `${formatMoney(minPoisha)} – ${formatMoney(maxPoisha)}`;
}
