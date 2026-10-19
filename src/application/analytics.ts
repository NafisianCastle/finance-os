import { getDb } from "@/infrastructure/db/dexie/database";
import { getBudgetsForMonth, scoped } from "@/infrastructure/db/dexie/helpers";
import { TX_TYPES, HELD_STATUS, LOAN_STATUS, PRIORITY } from "@/lib/constants";
import { calculateNetWorth } from "@/domain/rules-engine/net-worth.rules";
import { forecastCashflow } from "@/domain/rules-engine/cashflow.rules";
import { computeMaturityScore } from "@/domain/rules-engine/maturity.rules";
import { budgetHealthScore } from "@/domain/rules-engine/budget-suggest.rules";
import { startOfMonth, endOfMonth, subMonths, parseISO } from "date-fns";
import { ymKey } from "@/lib/utils";
import { computePortfolioValue } from "@/domain/investments/calculate";
import type { InvestmentEvent, Transaction } from "@/infrastructure/db/dexie/schema";

/** Metrics over everything visible to the user: own personal rows + rows shared with `groupId`. */
export async function getDashboardMetrics(
  userId: string,
  preloadedTransactions?: Transaction[],
  groupId: string | null = null
) {
  const db = getDb();
  const ym = ymKey();
  // Start independent reads together instead of waiting for each IndexedDB
  // round trip before issuing the next one.
  const [
    accounts, transactions, debts, held, loans, investments, invEvents,
    profile, budgets, buyEvals, goals,
  ] = await Promise.all([
    scoped(db.accounts, userId, groupId).toArray(),
    preloadedTransactions ?? scoped(db.transactions, userId, groupId).toArray(),
    scoped(db.debts, userId, groupId).and((d) => d.status === 1).toArray(),
    scoped(db.heldLiabilities, userId, groupId).and((h) => h.status === HELD_STATUS.ACTIVE).toArray(),
    scoped(db.loansGiven, userId, groupId).and((l) => l.status !== LOAN_STATUS.RECOVERED).toArray(),
    scoped(db.investments, userId, groupId).toArray(),
    scoped(db.investmentEvents, userId, groupId).toArray(),
    db.userProfiles.where("userId").equals(userId).first(),
    getBudgetsForMonth(userId, ym, groupId),
    scoped(db.buyEvaluations, userId, groupId).toArray(),
    scoped(db.goals, userId, groupId).toArray(),
  ]);
  const eventsByInv = new Map<string, InvestmentEvent[]>();
  for (const e of invEvents) {
    const list = eventsByInv.get(e.investmentId) ?? [];
    list.push(e);
    eventsByInv.set(e.investmentId, list);
  }
  const portfolioValue = computePortfolioValue(investments, eventsByInv);

  const cashBankWallet = accounts.filter((a) => a.type !== 4).reduce((s, a) => s + a.balancePoisha, 0);
  const creditUsed = accounts.filter((a) => a.type === 4).reduce((s, a) => s + Math.abs(a.balancePoisha), 0);

  const netWorth = calculateNetWorth({
    cashBankWalletPoisha: cashBankWallet,
    investmentValuePoisha: portfolioValue,
    loansReceivablePoisha: loans.reduce((s, l) => s + l.remainingPoisha, 0),
    totalDebtPoisha: debts.reduce((s, d) => s + d.remainingPoisha, 0),
    creditUsedPoisha: creditUsed,
    activeHeldLiabilitiesPoisha: held.reduce((s, h) => s + h.amountPoisha, 0),
  });

  const now = new Date();
  const monthStart = startOfMonth(now).getTime();
  const monthEnd = endOfMonth(now).getTime();
  const trendMonths = [2, 1, 0].map((offset) => {
    const start = startOfMonth(subMonths(now, offset));
    return {
      start: start.getTime(),
      end: endOfMonth(start).getTime(),
      month: start.toLocaleString("en", { month: "short" }),
      income: 0,
      expense: 0,
    };
  });
  let income = 0;
  let expense = 0;
  let impulseExpensePoisha = 0;
  const byCategory: Record<string, number> = {};

  for (const tx of transactions) {
    const timestamp = parseISO(tx.date).getTime();
    // Parse each date once for both the trend and current-month metrics.
    for (const month of trendMonths) {
      if (!(timestamp >= month.start && timestamp <= month.end)) continue;
      if (tx.type === TX_TYPES.INCOME) month.income += tx.amountPoisha;
      if (tx.type === TX_TYPES.EXPENSE) month.expense += tx.amountPoisha;
      break;
    }
    if (!(timestamp >= monthStart && timestamp <= monthEnd)) continue;
    if (tx.type === TX_TYPES.INCOME) income += tx.amountPoisha;
    if (tx.type === TX_TYPES.EXPENSE) {
      expense += tx.amountPoisha;
      byCategory[tx.categoryId] = (byCategory[tx.categoryId] ?? 0) + tx.amountPoisha;
      if (tx.tags?.includes("impulse")) {
        impulseExpensePoisha += tx.amountPoisha;
      }
    }
  }

  const budgetAllocations = budgets.map((b) => {
    const spent = byCategory[b.categoryId] ?? 0;
    return { allocated: b.allocatedPoisha + b.carryPoisha, spent };
  });
  const hasBudgetActivity = budgetAllocations.some((b) => b.spent > 0);

  const unsafeBuys = buyEvals.filter((e) => e.tier >= 5).length;
  const smartBuyDiscipline =
    buyEvals.length > 0 ? Math.round((1 - unsafeBuys / buyEvals.length) * 100) : null;

  const impulseBuys = buyEvals.filter((e) => e.priority === PRIORITY.IMPULSE).length;
  const impulseControlFromEvals =
    buyEvals.length > 0 ? Math.round((1 - impulseBuys / buyEvals.length) * 100) : null;
  const impulseControlFromTx =
    expense > 0 ? Math.round((1 - impulseExpensePoisha / expense) * 100) : null;
  const impulseControl = impulseControlFromEvals ?? impulseControlFromTx;

  const maturity = computeMaturityScore({
    budgetAdherencePct: budgets.length > 0 && hasBudgetActivity ? budgetHealthScore(budgetAllocations) : null,
    savingsConsistencyPct:
      income > 0 ? Math.round(Math.max(0, (income - expense) / income) * 100) : null,
    debtScorePct:
      debts.length > 0 || creditUsed > 0
        ? netWorth.totalLiabilitiesPoisha < (profile?.monthlyIncomePoisha ?? 1)
          ? 70
          : 45
        : null,
    smartBuyDisciplinePct: smartBuyDiscipline,
    goalProgressPct:
      goals.length > 0
        ? Math.round(
            goals.reduce((s, g) => s + Math.min(100, (g.savedPoisha / g.targetPoisha) * 100), 0) /
              goals.length
          )
        : null,
    impulseControlPct: impulseControl,
  });

  const threeDayBurn = expense > 0 ? Math.round(expense / 30) : 0;
  const cashflow = forecastCashflow({
    currentLiquidPoisha: netWorth.spendablePoisha,
    expectedIncomePoisha: profile?.monthlyIncomePoisha ?? income,
    recurringExpensePoisha: expense,
    debtInstallmentsPoisha: Math.round(debts.reduce((s, d) => s + d.remainingPoisha, 0) * 0.05),
    avgDailyDiscretionaryPoisha: threeDayBurn,
    overspentCategories: budgetAllocations
      .filter((b) => b.spent > b.allocated && b.allocated > 0)
      .map((_, i) => budgets[i]?.categoryId ?? "")
      .filter(Boolean),
  });

  const trend = trendMonths.map(({ month, income, expense }) => ({ month, income, expense }));

  return { netWorth, maturity, cashflow, income, expense, byCategory, trend };
}
