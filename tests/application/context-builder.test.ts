import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb, resetLocalDatabase } from "@/infrastructure/db/dexie/database";
import { buildRuleContext } from "@/application/context-builder";
import { TX_TYPES, HELD_STATUS } from "@/lib/constants";
import type { Account, Transaction, UserProfile, HeldLiability } from "@/infrastructure/db/dexie/schema";

const USER_ID = "user-1";
const now = new Date().toISOString();

function account(overrides: Partial<Account> = {}): Account {
  return {
    id: "acc-1",
    userId: USER_ID,
    type: 1,
    name: "Cash",
    balancePoisha: 50_000,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function profile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    id: "p1",
    userId: USER_ID,
    monthlyIncomePoisha: 20_000,
    currencyCode: "BDT",
    locale: "en",
    emergencyMonths: 3,
    onboardingComplete: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("buildRuleContext", () => {
  beforeEach(async () => {
    await resetLocalDatabase();
    await getDb().accounts.put(account());
  });

  it("uses the profile's monthly income when set", async () => {
    await getDb().userProfiles.put(profile());
    const ctx = await buildRuleContext(USER_ID, "food");
    expect(ctx.monthlyIncomePoisha).toBe(20_000);
  });

  it("excludes held liabilities from liquid savings", async () => {
    await getDb().userProfiles.put(profile());
    const held: HeldLiability = {
      id: "h1",
      userId: USER_ID,
      owner: "Friend",
      amountPoisha: 15_000,
      holdDate: "2026-01-01",
      status: HELD_STATUS.ACTIVE,
      createdAt: now,
      updatedAt: now,
    };
    await getDb().heldLiabilities.put(held);

    const ctx = await buildRuleContext(USER_ID, "food");
    expect(ctx.liquidSavingsPoisha).toBe(50_000 - 15_000);
  });

  it("excludes credit card accounts from liquid savings", async () => {
    await getDb().userProfiles.put(profile());
    await getDb().accounts.put(account({ id: "acc-2", type: 4, balancePoisha: -5_000 }));

    const ctx = await buildRuleContext(USER_ID, "food");
    expect(ctx.liquidSavingsPoisha).toBe(50_000);
  });

  it("computes categoryBudgetRemainingPoisha from the current month's budget minus spend", async () => {
    await getDb().userProfiles.put(profile());
    const ym = new Date().toISOString().slice(0, 7).replace("-", "");
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
    const tx: Transaction = {
      id: "tx1",
      userId: USER_ID,
      type: TX_TYPES.EXPENSE,
      amountPoisha: 4_000,
      accountId: "acc-1",
      categoryId: "food",
      date: today,
      createdAt: now,
      updatedAt: now,
    };
    await getDb().transactions.put(tx);

    const ctx = await buildRuleContext(USER_ID, "food");
    expect(ctx.categoryBudgetRemainingPoisha).toBe(6_000);
  });

  it("falls back to a default income estimate when no profile exists", async () => {
    const ctx = await buildRuleContext(USER_ID, "food");
    expect(ctx.monthlyIncomePoisha).toBeGreaterThan(0);
  });
});
