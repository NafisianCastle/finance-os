import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb, resetLocalDatabase } from "@/infrastructure/db/dexie/database";
import { addTransaction, deleteTransaction } from "@/application/transactions";
import { TX_TYPES } from "@/lib/constants";
import type { Account } from "@/infrastructure/db/dexie/schema";

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

describe("addTransaction", () => {
  beforeEach(async () => {
    await resetLocalDatabase();
  });

  it("increases account balance for an income transaction", async () => {
    const db = getDb();
    await db.accounts.put(account());

    await addTransaction(USER_ID, {
      type: TX_TYPES.INCOME,
      amountPoisha: 5_000,
      accountId: "acc-1",
      categoryId: "income",
      date: "2026-01-01",
    });

    const acc = await db.accounts.get("acc-1");
    expect(acc?.balancePoisha).toBe(15_000);
  });

  it("decreases account balance for an expense transaction", async () => {
    const db = getDb();
    await db.accounts.put(account());

    await addTransaction(USER_ID, {
      type: TX_TYPES.EXPENSE,
      amountPoisha: 3_000,
      accountId: "acc-1",
      categoryId: "food",
      date: "2026-01-01",
    });

    const acc = await db.accounts.get("acc-1");
    expect(acc?.balancePoisha).toBe(7_000);
  });

  it("moves balance between accounts for a transfer transaction", async () => {
    const db = getDb();
    await db.accounts.put(account({ id: "acc-1", balancePoisha: 10_000 }));
    await db.accounts.put(account({ id: "acc-2", name: "Bank", balancePoisha: 2_000 }));

    await addTransaction(USER_ID, {
      type: TX_TYPES.TRANSFER,
      amountPoisha: 4_000,
      accountId: "acc-1",
      toAccountId: "acc-2",
      categoryId: "other",
      date: "2026-01-01",
    });

    expect((await db.accounts.get("acc-1"))?.balancePoisha).toBe(6_000);
    expect((await db.accounts.get("acc-2"))?.balancePoisha).toBe(6_000);
  });

  it("queues a sync entry for the new transaction", async () => {
    const db = getDb();
    await db.accounts.put(account());

    const tx = await addTransaction(USER_ID, {
      type: TX_TYPES.EXPENSE,
      amountPoisha: 1_000,
      accountId: "acc-1",
      categoryId: "food",
      date: "2026-01-01",
    });

    const queued = await db.syncQueue.filter((i) => i.table === "transactions" && i.recordId === tx.id).toArray();
    expect(queued).toHaveLength(1);
    expect(queued[0].operation).toBe("upsert");
  });

  it("does not throw when the account no longer exists", async () => {
    await expect(
      addTransaction(USER_ID, {
        type: TX_TYPES.EXPENSE,
        amountPoisha: 1_000,
        accountId: "missing-acc",
        categoryId: "food",
        date: "2026-01-01",
      })
    ).resolves.toBeDefined();
  });
});

describe("deleteTransaction", () => {
  beforeEach(async () => {
    await resetLocalDatabase();
  });

  it("reverses the balance effect of an expense and soft-deletes the row", async () => {
    const db = getDb();
    await db.accounts.put(account());
    const tx = await addTransaction(USER_ID, {
      type: TX_TYPES.EXPENSE,
      amountPoisha: 3_000,
      accountId: "acc-1",
      categoryId: "food",
      date: "2026-01-01",
    });
    expect((await db.accounts.get("acc-1"))?.balancePoisha).toBe(7_000);

    await deleteTransaction(USER_ID, tx.id);

    expect((await db.accounts.get("acc-1"))?.balancePoisha).toBe(10_000);
    const deleted = await db.transactions.get(tx.id);
    expect(deleted?.deletedAt).toBeTruthy();
  });

  it("reverses a transfer between both accounts", async () => {
    const db = getDb();
    await db.accounts.put(account({ id: "acc-1", balancePoisha: 10_000 }));
    await db.accounts.put(account({ id: "acc-2", name: "Bank", balancePoisha: 2_000 }));
    const tx = await addTransaction(USER_ID, {
      type: TX_TYPES.TRANSFER,
      amountPoisha: 4_000,
      accountId: "acc-1",
      toAccountId: "acc-2",
      categoryId: "other",
      date: "2026-01-01",
    });

    await deleteTransaction(USER_ID, tx.id);

    expect((await db.accounts.get("acc-1"))?.balancePoisha).toBe(10_000);
    expect((await db.accounts.get("acc-2"))?.balancePoisha).toBe(2_000);
  });

  it("is a no-op for a transaction belonging to another user", async () => {
    const db = getDb();
    await db.accounts.put(account());
    const tx = await addTransaction(USER_ID, {
      type: TX_TYPES.EXPENSE,
      amountPoisha: 3_000,
      accountId: "acc-1",
      categoryId: "food",
      date: "2026-01-01",
    });

    await deleteTransaction("someone-else", tx.id);

    const untouched = await db.transactions.get(tx.id);
    expect(untouched?.deletedAt).toBeFalsy();
  });

  it("is a no-op for an already-deleted transaction", async () => {
    const db = getDb();
    await db.accounts.put(account());
    const tx = await addTransaction(USER_ID, {
      type: TX_TYPES.EXPENSE,
      amountPoisha: 3_000,
      accountId: "acc-1",
      categoryId: "food",
      date: "2026-01-01",
    });
    await deleteTransaction(USER_ID, tx.id);
    const balanceAfterFirstDelete = (await db.accounts.get("acc-1"))?.balancePoisha;

    await deleteTransaction(USER_ID, tx.id);

    expect((await db.accounts.get("acc-1"))?.balancePoisha).toBe(balanceAfterFirstDelete);
  });
});
