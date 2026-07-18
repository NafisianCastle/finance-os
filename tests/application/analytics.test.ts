import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb, resetLocalDatabase } from "@/infrastructure/db/dexie/database";
import { getDashboardMetrics } from "@/application/analytics";
import { TX_TYPES } from "@/lib/constants";
import type { Account, Transaction, Debt } from "@/infrastructure/db/dexie/schema";

const USER_ID = "user-1";
const now = new Date().toISOString();

function account(overrides: Partial<Account> = {}): Account {
  return {
    id: "acc-1",
    userId: USER_ID,
    type: 1,
    name: "Cash",
    balancePoisha: 100_000,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("getDashboardMetrics", () => {
  beforeEach(async () => {
    await resetLocalDatabase();
  });

  it("computes net worth from accounts, debts, and loans", async () => {
    await getDb().accounts.put(account());
    const debt: Debt = {
      id: "d1",
      userId: USER_ID,
      lender: "Bank",
      principalPoisha: 30_000,
      remainingPoisha: 30_000,
      borrowDate: "2025-01-01",
      status: 1,
      createdAt: now,
      updatedAt: now,
    };
    await getDb().debts.put(debt);

    const metrics = await getDashboardMetrics(USER_ID);
    expect(metrics.netWorth.totalAssetsPoisha).toBe(100_000);
    expect(metrics.netWorth.totalLiabilitiesPoisha).toBe(30_000);
    expect(metrics.netWorth.netWorthPoisha).toBe(70_000);
  });

  it("sums this month's income and expense transactions, grouped by category", async () => {
    await getDb().accounts.put(account());
    const today = new Date().toISOString().slice(0, 10);
    const txs: Transaction[] = [
      { id: "t1", userId: USER_ID, type: TX_TYPES.INCOME, amountPoisha: 20_000, accountId: "acc-1", categoryId: "income", date: today, createdAt: now, updatedAt: now },
      { id: "t2", userId: USER_ID, type: TX_TYPES.EXPENSE, amountPoisha: 5_000, accountId: "acc-1", categoryId: "food", date: today, createdAt: now, updatedAt: now },
      { id: "t3", userId: USER_ID, type: TX_TYPES.EXPENSE, amountPoisha: 2_000, accountId: "acc-1", categoryId: "food", date: today, createdAt: now, updatedAt: now },
    ];
    for (const tx of txs) await getDb().transactions.put(tx);

    const metrics = await getDashboardMetrics(USER_ID);
    expect(metrics.income).toBe(20_000);
    expect(metrics.expense).toBe(7_000);
    expect(metrics.byCategory.food).toBe(7_000);
  });

  it("excludes transactions outside the current month from income/expense totals", async () => {
    await getDb().accounts.put(account());
    const tx: Transaction = {
      id: "t1",
      userId: USER_ID,
      type: TX_TYPES.EXPENSE,
      amountPoisha: 9_999,
      accountId: "acc-1",
      categoryId: "food",
      date: "2000-01-01",
      createdAt: now,
      updatedAt: now,
    };
    await getDb().transactions.put(tx);

    const metrics = await getDashboardMetrics(USER_ID);
    expect(metrics.expense).toBe(0);
  });

  it("returns a 3-month trend series", async () => {
    await getDb().accounts.put(account());
    const metrics = await getDashboardMetrics(USER_ID);
    expect(metrics.trend).toHaveLength(3);
  });

  it("produces sane defaults with no data at all", async () => {
    const metrics = await getDashboardMetrics(USER_ID);
    expect(metrics.netWorth.totalAssetsPoisha).toBe(0);
    expect(metrics.income).toBe(0);
    expect(metrics.expense).toBe(0);
    expect(metrics.maturity.score).toBeGreaterThanOrEqual(0);
  });
});
