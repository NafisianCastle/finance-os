import { getDb } from "@/infrastructure/db/dexie/database";
import { HELD_STATUS, TX_TYPES } from "@/lib/constants";
import { ymKey } from "@/lib/utils";
import type { RuleContext } from "@/domain/rules-engine/types";
import { subMonths, startOfMonth, endOfMonth, isWithinInterval, parseISO } from "date-fns";
import { computePortfolioValue } from "@/domain/investments/calculate";
import type { InvestmentEvent } from "@/infrastructure/db/dexie/schema";

export async function buildRuleContext(
  userId: string,
  categoryId: string
): Promise<RuleContext> {
  const db = getDb();
  const profile = await db.userProfiles.where("userId").equals(userId).first();
  const accounts = await db.accounts.where("userId").equals(userId).filter((a) => !a.deletedAt).toArray();
  const transactions = await db.transactions.where("userId").equals(userId).filter((t) => !t.deletedAt).toArray();
  const debts = await db.debts.where("userId").equals(userId).filter((d) => !d.deletedAt && d.status === 1).toArray();
  const held = await db.heldLiabilities.where("userId").equals(userId).filter((h) => !h.deletedAt && h.status === HELD_STATUS.ACTIVE).toArray();
  const goals = await db.goals.where("userId").equals(userId).filter((g) => !g.deletedAt).toArray();
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
  const ym = ymKey();
  const budgets = await getDb()
    .budgets.filter((b) => b.userId === userId && b.ym === ym && !b.deletedAt)
    .toArray();

  const monthlyIncome = profile?.monthlyIncomePoisha ?? 0;
  const threeMonthsAgo = subMonths(new Date(), 3);

  let incomeSum = 0;
  let expenseSum = 0;
  let categorySpend = 0;
  let categorySpendPrev = 0;
  let impulseExpenses = 0;
  let totalExpenses = 0;

  for (const tx of transactions) {
    const d = parseISO(tx.date);
    if (d < threeMonthsAgo) continue;
    if (tx.type === TX_TYPES.INCOME) incomeSum += tx.amountPoisha;
    if (tx.type === TX_TYPES.EXPENSE) {
      expenseSum += tx.amountPoisha;
      totalExpenses += tx.amountPoisha;
      if (tx.categoryId === categoryId) categorySpend += tx.amountPoisha;
      if (tx.tags?.includes("impulse")) impulseExpenses += tx.amountPoisha;
    }
  }

  const monthStart = startOfMonth(new Date());
  const monthEnd = endOfMonth(new Date());
  let prevCategorySpend = 0;
  for (const tx of transactions) {
    if (tx.type !== TX_TYPES.EXPENSE || tx.categoryId !== categoryId) continue;
    const d = parseISO(tx.date);
    if (isWithinInterval(d, { start: monthStart, end: monthEnd })) categorySpendPrev += tx.amountPoisha;
    const prevStart = startOfMonth(subMonths(new Date(), 1));
    const prevEnd = endOfMonth(subMonths(new Date(), 1));
    if (isWithinInterval(d, { start: prevStart, end: prevEnd })) prevCategorySpend += tx.amountPoisha;
  }

  const trendPct =
    prevCategorySpend > 0
      ? Math.round(((categorySpendPrev - prevCategorySpend) / prevCategorySpend) * 100)
      : 0;

  const liquid = accounts
    .filter((a) => a.type !== 4)
    .reduce((s, a) => s + a.balancePoisha, 0);
  const heldTotal = held.reduce((s, h) => s + h.amountPoisha, 0);
  const totalDebt = debts.reduce((s, d) => s + d.remainingPoisha, 0);
  const debtService = Math.round(totalDebt * 0.05);

  const catBudget = budgets.find((b) => b.categoryId === categoryId);
  const spentOnCat = transactions
    .filter(
      (t) =>
        t.type === TX_TYPES.EXPENSE &&
        t.categoryId === categoryId &&
        isWithinInterval(parseISO(t.date), { start: monthStart, end: monthEnd })
    )
    .reduce((s, t) => s + t.amountPoisha, 0);
  const budgetRemaining = (catBudget?.allocatedPoisha ?? 0) + (catBudget?.carryPoisha ?? 0) - spentOnCat;

  const emergencyMonths = profile?.emergencyMonths ?? 3;
  const monthlyExpenses = expenseSum > 0 ? Math.round(expenseSum / 3) : Math.round(monthlyIncome * 0.7);
  const emergencyTarget = monthlyExpenses * emergencyMonths;
  const emergencyGoal = goals.find((g) => g.name.toLowerCase().includes("emergency"));
  const emergencyCurrent = emergencyGoal?.savedPoisha ?? 0;

  const primaryGoal = goals.find((g) => g.savedPoisha < g.targetPoisha);
  const surplus = Math.max(monthlyIncome - monthlyExpenses - debtService, 1);

  return {
    monthlyIncomePoisha: monthlyIncome || Math.round(incomeSum / 3) || 1,
    liquidSavingsPoisha: liquid - heldTotal,
    monthlyExpensesPoisha: monthlyExpenses,
    totalDebtPoisha: totalDebt,
    monthlyDebtServicePoisha: debtService,
    categoryBudgetRemainingPoisha: budgetRemaining,
    emergencyFundTargetPoisha: emergencyTarget,
    emergencyFundCurrentPoisha: emergencyCurrent,
    primaryGoalMonthlySurplusPoisha: surplus,
    investmentValuePoisha: portfolioValue,
    impulseExpenseShare: totalExpenses > 0 ? impulseExpenses / totalExpenses : 0,
    categorySpendTrendPct: trendPct,
  };
}
