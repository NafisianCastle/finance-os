import { getDb } from "@/infrastructure/db/dexie/database";
import { TX_TYPES, HELD_STATUS, LOAN_STATUS, PRIORITY } from "@/lib/constants";
import { calculateNetWorth } from "@/domain/rules-engine/net-worth.rules";
import { forecastCashflow } from "@/domain/rules-engine/cashflow.rules";
import { computeMaturityScore } from "@/domain/rules-engine/maturity.rules";
import { budgetHealthScore } from "@/domain/rules-engine/budget-suggest.rules";
import { startOfMonth, endOfMonth, subMonths, parseISO, isWithinInterval } from "date-fns";
import { ymKey } from "@/lib/utils";
import { computePortfolioValue } from "@/domain/investments/calculate";
import type { InvestmentEvent, Transaction } from "@/infrastructure/db/dexie/schema";

export async function getDashboardMetrics(userId: string, preloadedTransactions?: Transaction[]) {
  const db = getDb();
  const accounts = await db.accounts.where("userId").equals(userId).filter((a) => !a.deletedAt).toArray();
  const transactions =
    preloadedTransactions ??
    (await db.transactions.where("userId").equals(userId).filter((t) => !t.deletedAt).toArray());
  const debts = await db.debts.where("userId").equals(userId).filter((d) => !d.deletedAt && d.status === 1).toArray();
  const held = await db.heldLiabilities.where("userId").equals(userId).filter((h) => !h.deletedAt && h.status === HELD_STATUS.ACTIVE).toArray();
  const loans = await db.loansGiven.where("userId").equals(userId).filter((l) => !l.deletedAt && l.status !== LOAN_STATUS.RECOVERED).toArray();
  const investments = await db.investments.where("userId").equals(userId).filter((i) => !i.deletedAt).toArray();
  const invEvents = await db.investmentEvents
    .where("userId")
    .equals(userId)
    .filter((e) => !e.deletedAt)
    .toArray();
  const eventsByInv = new Map<string, InvestmentEvent[]>();
  for (const e of invEvents) {
    const list = eventsByInv.get(e.investmentId) ?? [];
    list.push(e);
    eventsByInv.set(e.investmentId, list);
  }
  const portfolioValue = computePortfolioValue(investments, eventsByInv);
  const profile = await db.userProfiles.where("userId").equals(userId).first();
  const ym = ymKey();
  const budgets = await db.budgets.filter((b) => b.userId === userId && b.ym === ym && !b.deletedAt).toArray();
  const buyEvals = await db.buyEvaluations.where("userId").equals(userId).toArray();
  const goals = await db.goals.where("userId").equals(userId).filter((g) => !g.deletedAt).toArray();

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

  const monthStart = startOfMonth(new Date());
  const monthEnd = endOfMonth(new Date());
  let income = 0;
  let expense = 0;
  let impulseExpensePoisha = 0;
  const byCategory: Record<string, number> = {};

  for (const tx of transactions) {
    const d = parseISO(tx.date);
    if (!isWithinInterval(d, { start: monthStart, end: monthEnd })) continue;
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
    budgetAdherencePct: budgets.length > 0 ? budgetHealthScore(budgetAllocations) : null,
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

  const last3 = subMonths(new Date(), 3);
  const trend: { month: string; income: number; expense: number }[] = [];
  for (let i = 2; i >= 0; i--) {
    const start = startOfMonth(subMonths(new Date(), i));
    const end = endOfMonth(subMonths(new Date(), i));
    let inc = 0;
    let exp = 0;
    for (const tx of transactions) {
      const d = parseISO(tx.date);
      if (!isWithinInterval(d, { start, end })) continue;
      if (tx.type === TX_TYPES.INCOME) inc += tx.amountPoisha;
      if (tx.type === TX_TYPES.EXPENSE) exp += tx.amountPoisha;
    }
    trend.push({
      month: start.toLocaleString("en", { month: "short" }),
      income: inc,
      expense: exp,
    });
  }

  return { netWorth, maturity, cashflow, income, expense, byCategory, trend };
}
