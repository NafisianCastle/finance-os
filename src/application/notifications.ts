import { getDb } from "@/infrastructure/db/dexie/database";
import { DEBT_STATUS, LOAN_STATUS, TX_TYPES } from "@/lib/constants";
import { budgetHealthScore } from "@/domain/rules-engine/budget-suggest.rules";
import { startOfMonth, endOfMonth, parseISO, isWithinInterval } from "date-fns";
import { ymKey } from "@/lib/utils";
import type { AppNotification } from "@/store/notification-store";

export async function loadNotifications(userId: string): Promise<AppNotification[]> {
  const db = getDb();
  const today = new Date().toISOString().slice(0, 10);
  const notifications: AppNotification[] = [];

  const debts = await db.debts
    .where("userId")
    .equals(userId)
    .filter((d) => !d.deletedAt && d.status === DEBT_STATUS.ACTIVE)
    .toArray();

  for (const d of debts) {
    if (d.dueDate && d.dueDate < today) {
      notifications.push({
        id: `overdue_debt_${d.id}`,
        type: "overdue_debt",
        title: `Overdue debt — ${d.lender}`,
        body: `Due ${d.dueDate} · still unpaid`,
        priority: "high",
        href: "/debt",
      });
    }
  }

  const loans = await db.loansGiven
    .where("userId")
    .equals(userId)
    .filter((l) => !l.deletedAt && l.status !== LOAN_STATUS.RECOVERED)
    .toArray();

  for (const l of loans) {
    if (l.dueDate && l.dueDate < today) {
      notifications.push({
        id: `overdue_loan_${l.id}`,
        type: "overdue_loan",
        title: `Loan overdue — ${l.borrower}`,
        body: `Due ${l.dueDate} · not yet recovered`,
        priority: "high",
        href: "/loans-given",
      });
    }
  }

  const ym = ymKey();
  const budgets = await db.budgets
    .filter((b) => b.userId === userId && b.ym === ym && !b.deletedAt)
    .toArray();

  const txs = await db.transactions
    .where("userId")
    .equals(userId)
    .filter((t) => !t.deletedAt && t.type === TX_TYPES.EXPENSE)
    .toArray();

  const start = startOfMonth(new Date());
  const end = endOfMonth(new Date());
  const spent: Record<string, number> = {};
  for (const tx of txs) {
    if (!isWithinInterval(parseISO(tx.date), { start, end })) continue;
    spent[tx.categoryId] = (spent[tx.categoryId] ?? 0) + tx.amountPoisha;
  }

  for (const b of budgets) {
    const s = spent[b.categoryId] ?? 0;
    const t = b.allocatedPoisha + b.carryPoisha;
    if (t > 0 && s > t * 1.1) {
      notifications.push({
        id: `budget_overspend_${b.categoryId}_${ym}`,
        type: "budget_overspend",
        title: `Over budget — ${b.categoryId}`,
        body: `Spent more than allocated this month`,
        priority: "medium",
        href: "/budgets",
      });
    }
  }

  const allocs = budgets.map((b) => ({
    allocated: b.allocatedPoisha + b.carryPoisha,
    spent: spent[b.categoryId] ?? 0,
  }));
  const health = budgetHealthScore(allocs);
  if (health < 50 && budgets.length > 0) {
    notifications.push({
      id: `low_budget_health_${ym}`,
      type: "budget_overspend",
      title: "Budget health is low",
      body: `Overall budget adherence at ${health}% this month`,
      priority: "medium",
      href: "/budgets",
    });
  }

  return notifications.sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2 };
    return order[a.priority] - order[b.priority];
  });
}
