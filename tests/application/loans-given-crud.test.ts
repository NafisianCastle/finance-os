import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb, resetLocalDatabase } from "@/infrastructure/db/dexie/database";
import {
  addLoanGiven,
  deleteLoanGiven,
  isLoanOverdue,
  listLoansGiven,
  recoverLoanGiven,
  updateLoanGiven,
} from "@/application/loans-given";
import { LOAN_STATUS } from "@/lib/constants";
import { GROUP, ME, OTHER_GROUP, TEAMMATE, lastUpsert, makeAccount, queued } from "./helpers";

const LOAN_NOT_NULL = ["id", "user_id", "borrower", "amount_poisha", "remaining_poisha", "borrow_date", "status_smallint"];

describe("isLoanOverdue", () => {
  const loan = { dueDate: "2026-10-01", status: LOAN_STATUS.ACTIVE as number, remainingPoisha: 100 };
  it("is overdue after the due date while unrecovered", () => {
    expect(isLoanOverdue(loan, "2026-10-02")).toBe(true);
  });
  it("is not overdue on the due date itself", () => {
    expect(isLoanOverdue(loan, "2026-10-01")).toBe(false);
  });
  it("is never overdue without a due date, or once recovered", () => {
    expect(isLoanOverdue({ ...loan, dueDate: undefined }, "2027-01-01")).toBe(false);
    expect(isLoanOverdue({ ...loan, status: LOAN_STATUS.RECOVERED }, "2027-01-01")).toBe(false);
    expect(isLoanOverdue({ ...loan, remainingPoisha: 0 }, "2027-01-01")).toBe(false);
  });
});

describe("loans given CRUD", () => {
  beforeEach(async () => {
    await resetLocalDatabase();
    await getDb().accounts.put(makeAccount({ id: "acc-1" }));
  });

  it("addLoanGiven stores a due date and queues a full row", async () => {
    const l = await addLoanGiven(ME, { borrower: "Rahim", amountPoisha: 20_000, dueDate: "2026-11-01" });
    expect(l).toMatchObject({ dueDate: "2026-11-01", remainingPoisha: 20_000, groupId: null });
    const payload = await lastUpsert("loans_given", l.id);
    for (const col of LOAN_NOT_NULL) expect(payload?.[col]).toBeDefined();
    expect(payload).toMatchObject({ due_date: "2026-11-01", group_id: null, user_id: ME });
  });

  it("updateLoanGiven keeps recoveries when the amount changes", async () => {
    const l = await addLoanGiven(ME, { borrower: "Rahim", amountPoisha: 20_000 });
    await recoverLoanGiven(ME, l, 5_000, "acc-1");
    const updated = await updateLoanGiven(ME, l.id, { amountPoisha: 25_000, dueDate: "2026-12-31" });
    expect(updated).toMatchObject({ remainingPoisha: 20_000, dueDate: "2026-12-31", status: LOAN_STATUS.ACTIVE });
  });

  it("deleteLoanGiven soft-deletes and queues a delete", async () => {
    const l = await addLoanGiven(ME, { borrower: "Rahim", amountPoisha: 20_000 });
    expect(await deleteLoanGiven(ME, l.id)).toBe(true);
    expect(await listLoansGiven(ME)).toHaveLength(0);
    expect((await queued("loans_given", l.id)).some((q) => q.operation === "delete")).toBe(true);
  });

  it("recoverLoanGiven sends the full remote row", async () => {
    const l = await addLoanGiven(ME, { borrower: "Rahim", amountPoisha: 20_000 }, GROUP);
    await recoverLoanGiven(ME, l, 20_000, "acc-1", GROUP);
    const payload = await lastUpsert("loans_given", l.id);
    for (const col of LOAN_NOT_NULL) expect(payload?.[col]).toBeDefined();
    expect(payload).toMatchObject({
      borrower: "Rahim",
      amount_poisha: 20_000,
      remaining_poisha: 0,
      status_smallint: LOAN_STATUS.RECOVERED,
      group_id: GROUP,
    });
  });

  it("shares visibility and edit rights within the group only", async () => {
    const shared = await addLoanGiven(TEAMMATE, { borrower: "A", amountPoisha: 1_000 }, GROUP);
    const foreign = await addLoanGiven(TEAMMATE, { borrower: "B", amountPoisha: 1_000 }, OTHER_GROUP);
    expect((await listLoansGiven(ME, GROUP)).map((l) => l.id)).toEqual([shared.id]);
    expect((await updateLoanGiven(ME, shared.id, { borrower: "A2" }, GROUP))?.borrower).toBe("A2");
    expect(await updateLoanGiven(ME, foreign.id, { borrower: "x" }, GROUP)).toBeUndefined();
    const result = await recoverLoanGiven(ME, foreign, 500, "acc-1", GROUP);
    expect(result).toBe(foreign);
  });
});
