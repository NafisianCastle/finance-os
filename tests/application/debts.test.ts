import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb, resetLocalDatabase } from "@/infrastructure/db/dexie/database";
import { repayDebt } from "@/application/debts";
import { DEBT_STATUS } from "@/lib/constants";
import type { Account, Debt } from "@/infrastructure/db/dexie/schema";

const USER_ID = "user-1";

function account(overrides: Partial<Account> = {}): Account {
  const now = new Date().toISOString();
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

function debt(overrides: Partial<Debt> = {}): Debt {
  const now = new Date().toISOString();
  return {
    id: "debt-1",
    userId: USER_ID,
    lender: "Bank",
    principalPoisha: 50_000,
    remainingPoisha: 50_000,
    borrowDate: "2025-01-01",
    status: DEBT_STATUS.ACTIVE,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("repayDebt", () => {
  beforeEach(async () => {
    await resetLocalDatabase();
    await getDb().accounts.put(account());
    await getDb().debts.put(debt());
  });

  it("reduces remaining balance and debits the paying account", async () => {
    const result = await repayDebt(USER_ID, debt(), 20_000, "acc-1");

    expect(result.remainingPoisha).toBe(30_000);
    expect(result.status).toBe(DEBT_STATUS.ACTIVE);
    const acc = await getDb().accounts.get("acc-1");
    expect(acc?.balancePoisha).toBe(80_000);
    const updated = await getDb().debts.get("debt-1");
    expect(updated?.remainingPoisha).toBe(30_000);
  });

  it("marks the debt PAID once fully repaid", async () => {
    const result = await repayDebt(USER_ID, debt({ remainingPoisha: 10_000 }), 10_000, "acc-1");
    expect(result.remainingPoisha).toBe(0);
    expect(result.status).toBe(DEBT_STATUS.PAID);
  });

  it("clamps an overpayment to the remaining balance", async () => {
    const result = await repayDebt(USER_ID, debt({ remainingPoisha: 5_000 }), 50_000, "acc-1");
    expect(result.remainingPoisha).toBe(0);
    const acc = await getDb().accounts.get("acc-1");
    // only 5_000 should have been debited, not the full 50_000 requested
    expect(acc?.balancePoisha).toBe(95_000);
  });

  it("is a no-op when the amount is zero or negative", async () => {
    const original = debt();
    const result = await repayDebt(USER_ID, original, 0, "acc-1");
    expect(result).toEqual(original);
    const acc = await getDb().accounts.get("acc-1");
    expect(acc?.balancePoisha).toBe(100_000);
  });

  it("logs an expense transaction for the repayment", async () => {
    await repayDebt(USER_ID, debt(), 15_000, "acc-1");
    const txs = await getDb().transactions.where("userId").equals(USER_ID).toArray();
    expect(txs).toHaveLength(1);
    expect(txs[0].amountPoisha).toBe(15_000);
  });
});
