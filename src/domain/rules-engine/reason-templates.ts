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

/**
 * Message key (in the `SmartBuyReasons` namespace) for each reason code, plus
 * the metadata params its message interpolates.
 */
export const REASON_MESSAGE: Record<ReasonCode, { key: string; params: string[] }> = {
  [ReasonCode.INCOME_RATIO_HIGH]: { key: "incomeRatioHigh", params: ["ratioPct"] },
  [ReasonCode.GADGET_CAP_EXCEEDED]: { key: "gadgetCapExceeded", params: ["capPct"] },
  [ReasonCode.CATEGORY_CAP_EXCEEDED]: { key: "categoryCapExceeded", params: ["capPct"] },
  [ReasonCode.BUDGET_OVERFLOW]: { key: "budgetOverflow", params: [] },
  [ReasonCode.LIQUID_FLOOR_BREACH]: { key: "liquidFloorBreach", params: [] },
  [ReasonCode.DTI_STRESS]: { key: "dtiStress", params: ["dtiPct"] },
  [ReasonCode.GOAL_DELAY]: { key: "goalDelay", params: ["monthsDelayed"] },
  [ReasonCode.IMPULSE_LUXURY]: { key: "impulseLuxury", params: [] },
  [ReasonCode.CATEGORY_SPEND_UP]: { key: "categorySpendUp", params: ["trendPct"] },
  [ReasonCode.EMERGENCY_IMPACT]: { key: "emergencyImpact", params: [] },
  [ReasonCode.SAFE_WITHIN_BAND]: { key: "safeWithinBand", params: [] },
};

/** Minimal translator shape — pass `useTranslations("SmartBuyReasons")`. */
export type ReasonTranslator = (key: string, values?: Record<string, string | number>) => string;

/**
 * Localized counterpart of reasonsToText: renders each code through the
 * `SmartBuyReasons` namespace. Missing metadata renders as "?".
 *
 *   const tReasons = useTranslations("SmartBuyReasons");
 *   reasonsToLocalizedText(result.reasonCodes, result.reasonMetadata, tReasons)
 */
export function reasonsToLocalizedText(
  codes: ReasonCode[],
  metadata: TemplateVars = {},
  t: ReasonTranslator,
): string[] {
  return codes.map((code) => {
    const msg = REASON_MESSAGE[code];
    if (!msg) return t("fallback");
    const values: Record<string, string | number> = {};
    for (const p of msg.params) values[p] = metadata[p] ?? "?";
    return t(msg.key, values);
  });
}

/** English-only rendering; prefer reasonsToLocalizedText in UI code. */
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

export function formatSafeRange(
  minPoisha: number,
  maxPoisha: number,
  currencyCode: string,
  locale: string,
): string {
  return `${formatMoney(minPoisha, currencyCode, locale)} – ${formatMoney(maxPoisha, currencyCode, locale)}`;
}
