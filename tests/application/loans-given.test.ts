import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb, resetLocalDatabase } from "@/infrastructure/db/dexie/database";
import { recoverLoanGiven } from "@/application/loans-given";
import { LOAN_STATUS } from "@/lib/constants";
import type { Account, LoanGiven } from "@/infrastructure/db/dexie/schema";

const USER_ID = "user-1";

function account(overrides: Partial<Account> = {}): Account {
  const now = new Date().toISOString();
  return {
    id: "acc-1",
    userId: USER_ID,
    type: 1,
    name: "Cash",
    balancePoisha: 10_000,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function loan(overrides: Partial<LoanGiven> = {}): LoanGiven {
  const now = new Date().toISOString();
  return {
    id: "loan-1",
    userId: USER_ID,
    borrower: "Friend",
    amountPoisha: 20_000,
    remainingPoisha: 20_000,
    borrowDate: "2025-01-01",
    status: LOAN_STATUS.ACTIVE,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("recoverLoanGiven", () => {
  beforeEach(async () => {
    await resetLocalDatabase();
    await getDb().accounts.put(account());
    await getDb().loansGiven.put(loan());
  });

  it("reduces remaining balance and credits the receiving account", async () => {
    const result = await recoverLoanGiven(USER_ID, loan(), 8_000, "acc-1");

    expect(result.remainingPoisha).toBe(12_000);
    expect(result.status).toBe(LOAN_STATUS.ACTIVE);
    const acc = await getDb().accounts.get("acc-1");
    expect(acc?.balancePoisha).toBe(18_000);
  });

  it("marks the loan RECOVERED once fully repaid", async () => {
    const result = await recoverLoanGiven(USER_ID, loan({ remainingPoisha: 5_000 }), 5_000, "acc-1");
    expect(result.remainingPoisha).toBe(0);
    expect(result.status).toBe(LOAN_STATUS.RECOVERED);
  });

  it("clamps an overpayment to the remaining balance", async () => {
    const result = await recoverLoanGiven(USER_ID, loan({ remainingPoisha: 3_000 }), 30_000, "acc-1");
    expect(result.remainingPoisha).toBe(0);
    const acc = await getDb().accounts.get("acc-1");
    expect(acc?.balancePoisha).toBe(13_000);
  });

  it("is a no-op when the amount is zero or negative", async () => {
    const original = loan();
    const result = await recoverLoanGiven(USER_ID, original, -100, "acc-1");
    expect(result).toEqual(original);
    const acc = await getDb().accounts.get("acc-1");
    expect(acc?.balancePoisha).toBe(10_000);
  });

  it("logs an income transaction for the recovery", async () => {
    await recoverLoanGiven(USER_ID, loan(), 6_000, "acc-1");
    const txs = await getDb().transactions.where("userId").equals(USER_ID).toArray();
    expect(txs).toHaveLength(1);
    expect(txs[0].amountPoisha).toBe(6_000);
  });
});
