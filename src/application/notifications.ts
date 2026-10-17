import { getDb } from "@/infrastructure/db/dexie/database";
import { getBudgetsForMonth, scoped } from "@/infrastructure/db/dexie/helpers";
import { DEBT_STATUS, TX_TYPES, PLANNED_PAYMENT_STATUS, PLANNED_PAYMENT_DIRECTION } from "@/lib/constants";
import { budgetHealthScore } from "@/domain/rules-engine/budget-suggest.rules";
import { startOfMonth, endOfMonth, parseISO, isWithinInterval } from "date-fns";
import { ymKey } from "@/lib/utils";
import { isLoanOverdue } from "@/application/loans-given";
import type { AppNotification } from "@/store/notification-store";
import type { Transaction } from "@/infrastructure/db/dexie/schema";

/**
 * Builds the notification list over own personal rows + rows shared with
 * `groupId`. Text is returned as i18n keys in the "Notifications" namespace
 * (`titleKey`/`bodyKey` + `params`); the UI translates them. Budget
 * notifications carry the raw category id in `params.category` — the UI
 * should swap in the localised category name before formatting.
 */
export async function loadNotifications(
  userId: string,
  preloadedTransactions?: Transaction[],
  groupId: string | null = null
): Promise<AppNotification[]> {
  const db = getDb();
  const today = new Date().toISOString().slice(0, 10);
  const notifications: AppNotification[] = [];

  const debts = await scoped(db.debts, userId, groupId)
    .and((d) => d.status === DEBT_STATUS.ACTIVE)
    .toArray();

  for (const d of debts) {
    if (d.dueDate && d.dueDate < today) {
      notifications.push({
        id: `overdue_debt_${d.id}`,
        type: "overdue_debt",
        titleKey: "overdueDebtTitle",
        bodyKey: "overdueDebtBody",
        params: { lender: d.lender, dueDate: d.dueDate },
        priority: "high",
        href: "/debt",
      });
    }
  }

  const loans = await scoped(db.loansGiven, userId, groupId)
    .and((l) => isLoanOverdue(l, today))
    .toArray();

  for (const l of loans) {
    notifications.push({
      id: `overdue_loan_${l.id}`,
      type: "overdue_loan",
      titleKey: "overdueLoanTitle",
      bodyKey: "overdueLoanBody",
      params: { borrower: l.borrower, dueDate: l.dueDate ?? "" },
      priority: "high",
      href: "/loans-given",
    });
  }

  const plannedPayments = await scoped(db.plannedPayments, userId, groupId)
    .and((p) => p.status === PLANNED_PAYMENT_STATUS.ACTIVE && p.nextDueDate <= today)
    .toArray();

  for (const p of plannedPayments) {
    const receive = p.direction === PLANNED_PAYMENT_DIRECTION.RECEIVE;
    const overdue = p.nextDueDate < today;
    const bodyKey = overdue
      ? receive
        ? "plannedOverdueReceiveBody"
        : "plannedOverduePayBody"
      : receive
        ? "plannedDueTodayReceiveBody"
        : "plannedDueTodayPayBody";
    notifications.push({
      id: `planned_payment_due_${p.id}_${p.nextDueDate}`,
      type: "planned_payment_due",
      titleKey: p.counterparty ? "plannedDueTitleWithCounterparty" : "plannedDueTitle",
      bodyKey,
      params: { counterparty: p.counterparty ?? "", dueDate: p.nextDueDate },
      priority: "high",
      href: "/planned-payments",
    });
  }

  const ym = ymKey();
  const budgets = await getBudgetsForMonth(userId, ym, groupId);

  const txs = (preloadedTransactions ?? (await scoped(db.transactions, userId, groupId).toArray())).filter(
    (t) => t.type === TX_TYPES.EXPENSE && !t.deletedAt
  );

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
        id: `budget_overspend_${b.categoryId}_${ym}${b.groupId ? `_${b.groupId}` : ""}`,
        type: "budget_overspend",
        titleKey: "budgetOverspendTitle",
        bodyKey: "budgetOverspendBody",
        params: { category: b.categoryId },
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
      titleKey: "lowBudgetHealthTitle",
      bodyKey: "lowBudgetHealthBody",
      params: { health },
      priority: "medium",
      href: "/budgets",
    });
  }

  return notifications.sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2 };
    return order[a.priority] - order[b.priority];
  });
}
