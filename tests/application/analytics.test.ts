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
    expect(metrics.maturity.score).toBe(0);
    expect(metrics.maturity.measuredCount).toBe(0);
    expect(metrics.maturity.totalCount).toBe(6);
    expect(metrics.maturity.components.budget).toBeNull();
    expect(metrics.maturity.components.savings).toBeNull();
    expect(metrics.maturity.components.debt).toBeNull();
    expect(metrics.maturity.components.smartBuy).toBeNull();
    expect(metrics.maturity.components.goals).toBeNull();
    expect(metrics.maturity.components.impulse).toBeNull();
  });

  it("returns 100 budget score but only 1 measured component after applying suggested budgets with no other activity", async () => {
    await getDb().accounts.put(account());
    const profile = {
      id: "p1",
      userId: USER_ID,
      monthlyIncomePoisha: 50_000,
      currencyCode: "BDT",
      locale: "en",
      emergencyMonths: 3,
      onboardingComplete: true,
      createdAt: now,
      updatedAt: now,
    };
    await getDb().userProfiles.put(profile as never);
    const ym = new Date().toISOString().slice(0, 7);
    const budget = {
      id: "b1",
      userId: USER_ID,
      ym,
      categoryId: "food",
      allocatedPoisha: 10_000,
      carryPoisha: 0,
      createdAt: now,
      updatedAt: now,
    };
    await getDb().budgets.put(budget as never);

    const metrics = await getDashboardMetrics(USER_ID);
    expect(metrics.maturity.components.budget).toBe(100);
    expect(metrics.maturity.measuredCount).toBe(1);
    expect(metrics.maturity.totalCount).toBe(6);
  });

  it("computes impulse control from impulse-tagged transactions when no buy evaluations exist", async () => {
    await getDb().accounts.put(account());
    const today = new Date().toISOString().slice(0, 10);
    const txs: Transaction[] = [
      { id: "t1", userId: USER_ID, type: TX_TYPES.EXPENSE, amountPoisha: 5_000, accountId: "acc-1", categoryId: "food", date: today, tags: ["impulse"], createdAt: now, updatedAt: now },
      { id: "t2", userId: USER_ID, type: TX_TYPES.EXPENSE, amountPoisha: 15_000, accountId: "acc-1", categoryId: "food", date: today, createdAt: now, updatedAt: now },
    ];
    for (const tx of txs) await getDb().transactions.put(tx);

    const metrics = await getDashboardMetrics(USER_ID);
    expect(metrics.maturity.components.impulse).toBe(Math.round((1 - 5_000 / 20_000) * 100));
  });

  it("returns null debt score when no debt or credit data exists", async () => {
    await getDb().accounts.put(account({ type: 1, balancePoisha: 0 }));
    const profile = {
      id: "p1",
      userId: USER_ID,
      monthlyIncomePoisha: 50_000,
      currencyCode: "BDT",
      locale: "en",
      emergencyMonths: 3,
      onboardingComplete: true,
      createdAt: now,
      updatedAt: now,
    };
    await getDb().userProfiles.put(profile as never);

    const metrics = await getDashboardMetrics(USER_ID);
    expect(metrics.maturity.components.debt).toBeNull();
  });

  it("computes savings consistency from actual savings rate when income and expense exist", async () => {
    await getDb().accounts.put(account());
    const today = new Date().toISOString().slice(0, 10);
    const txs: Transaction[] = [
      { id: "t1", userId: USER_ID, type: TX_TYPES.INCOME, amountPoisha: 20_000, accountId: "acc-1", categoryId: "income", date: today, createdAt: now, updatedAt: now },
      { id: "t2", userId: USER_ID, type: TX_TYPES.EXPENSE, amountPoisha: 8_000, accountId: "acc-1", categoryId: "food", date: today, createdAt: now, updatedAt: now },
    ];
    for (const tx of txs) await getDb().transactions.put(tx);

    const metrics = await getDashboardMetrics(USER_ID);
    expect(metrics.maturity.components.savings).toBe(Math.round((20_000 - 8_000) / 20_000 * 100));
  });

  it("returns null savings score when there are no transactions", async () => {
    await getDb().accounts.put(account());
    const metrics = await getDashboardMetrics(USER_ID);
    expect(metrics.maturity.components.savings).toBeNull();
  });

  it("computes debt score when active debt exists", async () => {
    await getDb().accounts.put(account());
    const profile = {
      id: "p1",
      userId: USER_ID,
      monthlyIncomePoisha: 50_000,
      currencyCode: "BDT",
      locale: "en",
      emergencyMonths: 3,
      onboardingComplete: true,
      createdAt: now,
      updatedAt: now,
    };
    await getDb().userProfiles.put(profile as never);
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
    expect(metrics.maturity.components.debt).toBe(70);
  });
});
