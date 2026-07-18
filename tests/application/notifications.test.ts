import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb, resetLocalDatabase } from "@/infrastructure/db/dexie/database";
import { loadNotifications } from "@/application/notifications";
import { DEBT_STATUS, LOAN_STATUS, TX_TYPES } from "@/lib/constants";
import { ymKey } from "@/lib/utils";
import type { Debt, LoanGiven, Budget, Transaction } from "@/infrastructure/db/dexie/schema";

const USER_ID = "user-1";
const now = new Date().toISOString();

function debt(overrides: Partial<Debt> = {}): Debt {
  return {
    id: "debt-1",
    userId: USER_ID,
    lender: "Bank",
    principalPoisha: 10_000,
    remainingPoisha: 10_000,
    borrowDate: "2025-01-01",
    status: DEBT_STATUS.ACTIVE,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function loan(overrides: Partial<LoanGiven> = {}): LoanGiven {
  return {
    id: "loan-1",
    userId: USER_ID,
    borrower: "Friend",
    amountPoisha: 10_000,
    remainingPoisha: 10_000,
    borrowDate: "2025-01-01",
    status: LOAN_STATUS.ACTIVE,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("loadNotifications", () => {
  beforeEach(async () => {
    await resetLocalDatabase();
  });

  it("flags an overdue active debt", async () => {
    await getDb().debts.put(debt({ dueDate: "2000-01-01" }));
    const notifications = await loadNotifications(USER_ID);
    expect(notifications.some((n) => n.type === "overdue_debt")).toBe(true);
  });

  it("does not flag a debt that isn't overdue yet", async () => {
    await getDb().debts.put(debt({ dueDate: "2999-01-01" }));
    const notifications = await loadNotifications(USER_ID);
    expect(notifications.some((n) => n.type === "overdue_debt")).toBe(false);
  });

  it("does not flag a paid-off debt even if its due date has passed", async () => {
    await getDb().debts.put(debt({ dueDate: "2000-01-01", status: DEBT_STATUS.PAID }));
    const notifications = await loadNotifications(USER_ID);
    expect(notifications.some((n) => n.type === "overdue_debt")).toBe(false);
  });

  it("flags an overdue loan given that hasn't been recovered", async () => {
    await getDb().loansGiven.put(loan({ dueDate: "2000-01-01" }));
    const notifications = await loadNotifications(USER_ID);
    expect(notifications.some((n) => n.type === "overdue_loan")).toBe(true);
  });

  it("does not flag a recovered loan", async () => {
    await getDb().loansGiven.put(loan({ dueDate: "2000-01-01", status: LOAN_STATUS.RECOVERED }));
    const notifications = await loadNotifications(USER_ID);
    expect(notifications.some((n) => n.type === "overdue_loan")).toBe(false);
  });

  it("flags budget overspend when spend exceeds allocation by more than 10%", async () => {
    const ym = ymKey();
    const budget: Budget = {
      id: "b1",
      userId: USER_ID,
      ym,
      categoryId: "food",
      allocatedPoisha: 10_000,
      carryPoisha: 0,
      createdAt: now,
      updatedAt: now,
    };
    await getDb().budgets.put(budget);

    const today = new Date().toISOString().slice(0, 10);
    const tx: Transaction = {
      id: "tx1",
      userId: USER_ID,
      type: TX_TYPES.EXPENSE,
      amountPoisha: 12_000,
      accountId: "acc-1",
      categoryId: "food",
      date: today,
      createdAt: now,
      updatedAt: now,
    };
    await getDb().transactions.put(tx);

    const notifications = await loadNotifications(USER_ID);
    expect(notifications.some((n) => n.type === "budget_overspend" && n.title.includes("food"))).toBe(true);
  });

  it("sorts notifications high priority first", async () => {
    await getDb().debts.put(debt({ dueDate: "2000-01-01" }));
    const ym = ymKey();
    await getDb().budgets.put({
      id: "b1",
      userId: USER_ID,
      ym,
      categoryId: "food",
      allocatedPoisha: 10_000,
      carryPoisha: 0,
      createdAt: now,
      updatedAt: now,
    });
    const today = new Date().toISOString().slice(0, 10);
    await getDb().transactions.put({
      id: "tx1",
      userId: USER_ID,
      type: TX_TYPES.EXPENSE,
      amountPoisha: 12_000,
      accountId: "acc-1",
      categoryId: "food",
      date: today,
      createdAt: now,
      updatedAt: now,
    });

    const notifications = await loadNotifications(USER_ID);
    expect(notifications[0].priority).toBe("high");
  });

  it("returns an empty list when there is nothing to notify about", async () => {
    const notifications = await loadNotifications(USER_ID);
    expect(notifications).toEqual([]);
  });
});
