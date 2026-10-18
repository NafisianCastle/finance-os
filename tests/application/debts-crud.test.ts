import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb, resetLocalDatabase } from "@/infrastructure/db/dexie/database";
import { addDebt, deleteDebt, listDebts, repayDebt, updateDebt } from "@/application/debts";
import { DEBT_STATUS } from "@/lib/constants";
import { GROUP, ME, OTHER_GROUP, TEAMMATE, lastUpsert, makeAccount, queued } from "./helpers";

const DEBT_NOT_NULL = ["id", "user_id", "lender", "principal_poisha", "remaining_poisha", "borrow_date", "status_smallint"];

describe("debt CRUD", () => {
  beforeEach(async () => {
    await resetLocalDatabase();
    await getDb().accounts.put(makeAccount({ id: "acc-1" }));
  });

  it("addDebt stores the record and queues a full row", async () => {
    const d = await addDebt(ME, { lender: " Bank ", principalPoisha: 50_000, dueDate: "2026-12-01", interestRate: 9 }, GROUP);
    expect(d).toMatchObject({ lender: "Bank", remainingPoisha: 50_000, status: DEBT_STATUS.ACTIVE, groupId: GROUP });
    const payload = await lastUpsert("debts", d.id);
    for (const col of DEBT_NOT_NULL) expect(payload?.[col]).toBeDefined();
    expect(payload).toMatchObject({ group_id: GROUP, user_id: ME, due_date: "2026-12-01", interest_rate: 9 });
  });

  it("updateDebt shifts remaining by the principal delta and keeps prior repayments", async () => {
    const d = await addDebt(ME, { lender: "Bank", principalPoisha: 50_000 });
    await repayDebt(ME, d, 10_000, "acc-1");
    const updated = await updateDebt(ME, d.id, { principalPoisha: 60_000, dueDate: "" });
    expect(updated?.remainingPoisha).toBe(50_000);
    expect(updated?.dueDate).toBeUndefined();
    expect((await lastUpsert("debts", d.id))?.remaining_poisha).toBe(50_000);
  });

  it("updateDebt marks the debt PAID when the principal drops below what was repaid", async () => {
    const d = await addDebt(ME, { lender: "Bank", principalPoisha: 50_000 });
    await repayDebt(ME, d, 30_000, "acc-1");
    const updated = await updateDebt(ME, d.id, { principalPoisha: 20_000 });
    expect(updated?.remainingPoisha).toBe(0);
    expect(updated?.status).toBe(DEBT_STATUS.PAID);
  });

  it("deleteDebt soft-deletes and queues a delete", async () => {
    const d = await addDebt(ME, { lender: "Bank", principalPoisha: 50_000 });
    expect(await deleteDebt(ME, d.id)).toBe(true);
    expect((await getDb().debts.get(d.id))?.deletedAt).toBeTruthy();
    expect((await queued("debts", d.id)).some((q) => q.operation === "delete")).toBe(true);
    expect(await listDebts(ME)).toHaveLength(0);
  });

  it("repayDebt sends the full remote row, not a partial", async () => {
    const d = await addDebt(ME, { lender: "Bank", principalPoisha: 50_000 }, GROUP);
    await repayDebt(ME, d, 5_000, "acc-1", GROUP);
    const payload = await lastUpsert("debts", d.id);
    for (const col of DEBT_NOT_NULL) expect(payload?.[col]).toBeDefined();
    expect(payload).toMatchObject({ remaining_poisha: 45_000, lender: "Bank", principal_poisha: 50_000, group_id: GROUP });
  });

  it("the repayment transaction inherits the debt's group", async () => {
    const d = await addDebt(ME, { lender: "Bank", principalPoisha: 50_000 }, GROUP);
    await repayDebt(ME, d, 5_000, "acc-1", GROUP);
    const txs = await getDb().transactions.toArray();
    expect(txs[0].groupId).toBe(GROUP);
  });

  it("group members can edit and delete a teammate's shared debt; other groups can't", async () => {
    const shared = await addDebt(TEAMMATE, { lender: "Bank", principalPoisha: 10_000 }, GROUP);
    const foreign = await addDebt(TEAMMATE, { lender: "Other", principalPoisha: 10_000 }, OTHER_GROUP);

    expect((await listDebts(ME, GROUP)).map((d) => d.id)).toEqual([shared.id]);
    expect((await updateDebt(ME, shared.id, { lender: "Bank 2" }, GROUP))?.userId).toBe(TEAMMATE);
    expect(await updateDebt(ME, foreign.id, { lender: "x" }, GROUP)).toBeUndefined();
    expect(await deleteDebt(ME, foreign.id, GROUP)).toBe(false);
    expect(await deleteDebt(ME, shared.id, GROUP)).toBe(true);
  });
});
