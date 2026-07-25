import { INVESTMENT_EVENT_TYPE } from "@/lib/investment-constants";
import type { Investment, InvestmentEvent } from "@/infrastructure/db/dexie/schema";

export interface InvestmentMetrics {
  investedPoisha: number;
  declaredProfitPoisha: number;
  capitalReturnedPoisha: number;
  profitReceivedPoisha: number;
  lossPoisha: number;
  remainingCapitalPoisha: number;
  /** Net cash back vs what you put in */
  totalReturnPoisha: number;
  roiPct: number;
  /** vs declared profit (if set) */
  declaredVsActualPoisha: number | null;
  /** Book value for net worth: remaining capital + received profit - recognized losses */
  effectiveValuePoisha: number;
  isLoss: boolean;
}

export function sumEventsByType(events: InvestmentEvent[], type: number): number {
  return events
    .filter((e) => !e.deletedAt && e.type === type)
    .reduce((s, e) => s + e.amountPoisha, 0);
}

export function computeInvestmentMetrics(
  investment: Investment,
  events: InvestmentEvent[]
): InvestmentMetrics {
  const activeEvents = events.filter((e) => !e.deletedAt);
  const investedPoisha = investment.investedPoisha;
  const declaredFromField = investment.declaredProfitPoisha ?? 0;
  const declaredFromEvents = sumEventsByType(activeEvents, INVESTMENT_EVENT_TYPE.PROFIT_DECLARED);
  const declaredProfitPoisha = declaredFromField > 0 ? declaredFromField : declaredFromEvents;
  const capitalReturnedPoisha = sumEventsByType(activeEvents, INVESTMENT_EVENT_TYPE.CAPITAL_RETURN);
  const profitReceivedPoisha = sumEventsByType(activeEvents, INVESTMENT_EVENT_TYPE.PROFIT_RECEIVED);
  const lossPoisha = sumEventsByType(activeEvents, INVESTMENT_EVENT_TYPE.LOSS);

  const remainingCapitalPoisha = Math.max(0, investedPoisha - capitalReturnedPoisha);
  const totalReturnPoisha =
    capitalReturnedPoisha + profitReceivedPoisha - investedPoisha - lossPoisha;

  const roiPct =
    investedPoisha > 0 ? (totalReturnPoisha / investedPoisha) * 100 : 0;

  const declaredVsActualPoisha =
    declaredProfitPoisha > 0 ? profitReceivedPoisha - declaredProfitPoisha : null;

  const effectiveValuePoisha = Math.max(
    0,
    remainingCapitalPoisha + profitReceivedPoisha - lossPoisha
  );

  const isLoss = lossPoisha > 0 || totalReturnPoisha < 0 || investment.status === 3;

  return {
    investedPoisha,
    declaredProfitPoisha,
    capitalReturnedPoisha,
    profitReceivedPoisha,
    lossPoisha,
    remainingCapitalPoisha,
    totalReturnPoisha,
    roiPct,
    declaredVsActualPoisha,
    effectiveValuePoisha,
    isLoss,
  };
}

export function computePortfolioValue(
  investments: Investment[],
  eventsByInvestment: Map<string, InvestmentEvent[]>
): number {
  return investments
    .filter((i) => !i.deletedAt)
    .reduce((sum, inv) => {
      const events = eventsByInvestment.get(inv.id) ?? [];
      return sum + computeInvestmentMetrics(inv, events).effectiveValuePoisha;
    }, 0);
}
