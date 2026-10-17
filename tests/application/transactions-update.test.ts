import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb, resetLocalDatabase } from "@/infrastructure/db/dexie/database";
import {
  addTransaction,
  deleteTransaction,
  toTransactionPayload,
  updateTransaction,
  type TransactionInput,
} from "@/application/transactions";
import { TX_TYPES } from "@/lib/constants";
import { GROUP, ME, OTHER_GROUP, TEAMMATE, balance, lastUpsert, makeAccount } from "./helpers";

const base: TransactionInput = {
  type: TX_TYPES.EXPENSE,
  amountPoisha: 1_000,
  accountId: "a",
  categoryId: "food",
  date: "2026-10-01",
};

describe("updateTransaction balance deltas", () => {
  beforeEach(async () => {
    await resetLocalDatabase();
    await getDb().accounts.bulkPut([
      makeAccount({ id: "a", balancePoisha: 10_000 }),
      makeAccount({ id: "b", balancePoisha: 10_000 }),
      makeAccount({ id: "c", balancePoisha: 10_000 }),
    ]);
  });

  it("changes a transfer amount on both accounts", async () => {
    const tx = await addTransaction(ME, { ...base, type: TX_TYPES.TRANSFER, toAccountId: "b", amountPoisha: 2_000 });
    expect([await balance("a"), await balance("b")]).toEqual([8_000, 12_000]);

    await updateTransaction(ME, tx.id, { ...base, type: TX_TYPES.TRANSFER, toAccountId: "b", amountPoisha: 3_000 });
    expect([await balance("a"), await balance("b")]).toEqual([7_000, 13_000]);
  });

  it("moves the destination of a transfer to another account", async () => {
    const tx = await addTransaction(ME, { ...base, type: TX_TYPES.TRANSFER, toAccountId: "b", amountPoisha: 2_000 });
    await updateTransaction(ME, tx.id, { ...base, type: TX_TYPES.TRANSFER, toAccountId: "c", amountPoisha: 2_000 });
    expect([await balance("a"), await balance("b"), await balance("c")]).toEqual([8_000, 10_000, 12_000]);
  });

  it("moves the source of a transfer to another account", async () => {
    const tx = await addTransaction(ME, { ...base, type: TX_TYPES.TRANSFER, toAccountId: "b", amountPoisha: 2_000 });
    await updateTransaction(ME, tx.id, { ...base, accountId: "c", type: TX_TYPES.TRANSFER, toAccountId: "b", amountPoisha: 2_000 });
    expect([await balance("a"), await balance("b"), await balance("c")]).toEqual([10_000, 12_000, 8_000]);
  });

  it("converts an expense into a transfer", async () => {
    const tx = await addTransaction(ME, { ...base, amountPoisha: 2_000 });
    expect(await balance("a")).toBe(8_000);
    await updateTransaction(ME, tx.id, { ...base, type: TX_TYPES.TRANSFER, toAccountId: "b", amountPoisha: 2_000 });
    expect([await balance("a"), await balance("b")]).toEqual([8_000, 12_000]);
    const payload = await lastUpsert("transactions", tx.id);
    expect(payload?.to_account_id).toBe("b");
    expect(payload?.type_smallint).toBe(TX_TYPES.TRANSFER);
  });

  it("converts a transfer into an expense and clears the destination", async () => {
    const tx = await addTransaction(ME, { ...base, type: TX_TYPES.TRANSFER, toAccountId: "b", amountPoisha: 2_000 });
    // Form may still carry the stale toAccountId; it must be dropped.
    const updated = await updateTransaction(ME, tx.id, { ...base, toAccountId: "b", amountPoisha: 2_000 });
    expect([await balance("a"), await balance("b")]).toEqual([8_000, 10_000]);
    expect(updated?.toAccountId).toBeNull();
    expect((await lastUpsert("transactions", tx.id))?.to_account_id).toBeNull();
  });

  it("converts income into a transfer on a different account", async () => {
    const tx = await addTransaction(ME, { ...base, type: TX_TYPES.INCOME, amountPoisha: 2_000 });
    expect(await balance("a")).toBe(12_000);
    await updateTransaction(ME, tx.id, { ...base, accountId: "b", type: TX_TYPES.TRANSFER, toAccountId: "c", amountPoisha: 500 });
    expect([await balance("a"), await balance("b"), await balance("c")]).toEqual([10_000, 9_500, 10_500]);
  });

  it("deleting a transfer reverses both sides", async () => {
    const tx = await addTransaction(ME, { ...base, type: TX_TYPES.TRANSFER, toAccountId: "b", amountPoisha: 2_000 });
    await deleteTransaction(ME, tx.id);
    expect([await balance("a"), await balance("b")]).toEqual([10_000, 10_000]);
  });

  it("a transfer with no destination still debits its source (matches the remote trigger)", async () => {
    await addTransaction(ME, { ...base, type: TX_TYPES.TRANSFER, amountPoisha: 2_000 });
    expect(await balance("a")).toBe(8_000);
  });
});

describe("transaction payloads", () => {
  beforeEach(async () => {
    await resetLocalDatabase();
    await getDb().accounts.put(makeAccount({ id: "a" }));
  });

  it("sends recurring_id, user_id and group_id", async () => {
    const tx = await addTransaction(ME, { ...base, recurringId: "rec-1" }, GROUP);
    const payload = await lastUpsert("transactions", tx.id);
    expect(payload).toMatchObject({ recurring_id: "rec-1", user_id: ME, group_id: GROUP, account_id: "a" });
    expect(tx.groupId).toBe(GROUP);
  });

  it("defaults group_id to null for a personal transaction", async () => {
    const tx = await addTransaction(ME, base);
    expect((await lastUpsert("transactions", tx.id))?.group_id).toBeNull();
  });

  it("toTransactionPayload falls back to a category for transfers", async () => {
    const tx = await addTransaction(ME, { ...base, type: TX_TYPES.TRANSFER, categoryId: "", toAccountId: "a" });
    expect(toTransactionPayload(tx).category_id).toBe("other");
  });
});

describe("transaction group visibility", () => {
  beforeEach(async () => {
    await resetLocalDatabase();
    await getDb().accounts.put(makeAccount({ id: "a", balancePoisha: 10_000, groupId: GROUP, userId: TEAMMATE }));
  });

  it("lets a member edit a teammate's shared transaction, keeping author and group", async () => {
    const tx = await addTransaction(TEAMMATE, { ...base, amountPoisha: 1_000 }, GROUP);
    const updated = await updateTransaction(ME, tx.id, { ...base, amountPoisha: 4_000 }, GROUP);
    expect(updated?.userId).toBe(TEAMMATE);
    expect(updated?.groupId).toBe(GROUP);
    expect(await balance("a")).toBe(6_000);
    expect(await lastUpsert("transactions", tx.id)).toMatchObject({ user_id: TEAMMATE, group_id: GROUP, amount_poisha: 4_000 });
  });

  it("lets a member delete a teammate's shared transaction", async () => {
    const tx = await addTransaction(TEAMMATE, base, GROUP);
    await deleteTransaction(ME, tx.id, GROUP);
    expect((await getDb().transactions.get(tx.id))?.deletedAt).toBeTruthy();
  });

  it("refuses edits to another group's transaction", async () => {
    const tx = await addTransaction(TEAMMATE, base, OTHER_GROUP);
    expect(await updateTransaction(ME, tx.id, { ...base, amountPoisha: 9_000 }, GROUP)).toBeUndefined();
    await deleteTransaction(ME, tx.id, GROUP);
    expect((await getDb().transactions.get(tx.id))?.deletedAt).toBeFalsy();
  });

  it("refuses edits to a teammate's personal transaction", async () => {
    const tx = await addTransaction(TEAMMATE, base, null);
    expect(await updateTransaction(ME, tx.id, base, GROUP)).toBeUndefined();
  });

  it("hides shared rows when the caller is not passing the group", async () => {
    const tx = await addTransaction(ME, base, GROUP);
    expect(await updateTransaction(ME, tx.id, base)).toBeUndefined();
  });
});
