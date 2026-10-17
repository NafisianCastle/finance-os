import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb, resetLocalDatabase } from "@/infrastructure/db/dexie/database";
import {
  addPlannedPayment,
  deletePlannedPayment,
  listPlannedPayments,
  markPlannedPaymentPaid,
  updatePlannedPayment,
  type PlannedPaymentInput,
} from "@/application/planned-payments";
import { PLANNED_PAYMENT_DIRECTION, RECURRENCE_INTERVAL } from "@/lib/constants";
import { GROUP, ME, OTHER_GROUP, TEAMMATE, lastUpsert, makeAccount } from "./helpers";

const input: PlannedPaymentInput = {
  direction: PLANNED_PAYMENT_DIRECTION.PAY,
  amountPoisha: 5_000,
  accountId: "acc-1",
  categoryId: "bills",
  nextDueDate: "2026-10-01",
  isRecurring: true,
  recurrenceInterval: RECURRENCE_INTERVAL.MONTHLY,
};

describe("planned payments group behaviour", () => {
  beforeEach(async () => {
    await resetLocalDatabase();
    await getDb().accounts.put(makeAccount({ id: "acc-1" }));
  });

  it("addPlannedPayment stores groupId and sends user_id/group_id", async () => {
    const p = await addPlannedPayment(ME, input, GROUP);
    expect(p.groupId).toBe(GROUP);
    expect(await lastUpsert("planned_payments", p.id)).toMatchObject({ user_id: ME, group_id: GROUP, next_due_date: "2026-10-01" });
  });

  it("a member can update a teammate's shared plan; author and group are kept", async () => {
    const p = await addPlannedPayment(TEAMMATE, input, GROUP);
    const updated = await updatePlannedPayment(ME, p.id, { ...input, amountPoisha: 7_000 }, GROUP);
    expect(updated).toMatchObject({ userId: TEAMMATE, groupId: GROUP, amountPoisha: 7_000 });
    expect(await lastUpsert("planned_payments", p.id)).toMatchObject({ user_id: TEAMMATE, group_id: GROUP });
  });

  it("a member can delete a teammate's shared plan but not another group's", async () => {
    const shared = await addPlannedPayment(TEAMMATE, input, GROUP);
    const foreign = await addPlannedPayment(TEAMMATE, input, OTHER_GROUP);
    await deletePlannedPayment(ME, foreign.id, GROUP);
    expect((await getDb().plannedPayments.get(foreign.id))?.deletedAt).toBeFalsy();
    await deletePlannedPayment(ME, shared.id, GROUP);
    expect((await getDb().plannedPayments.get(shared.id))?.deletedAt).toBeTruthy();
  });

  it("listPlannedPayments returns personal + current group rows", async () => {
    const mine = await addPlannedPayment(ME, input);
    const shared = await addPlannedPayment(TEAMMATE, input, GROUP);
    await addPlannedPayment(TEAMMATE, input);
    const ids = (await listPlannedPayments(ME, GROUP)).map((p) => p.id).sort();
    expect(ids).toEqual([mine.id, shared.id].sort());
  });

  it("markPlannedPaymentPaid books the transaction in the plan's group and rolls the date", async () => {
    const p = await addPlannedPayment(TEAMMATE, input, GROUP);
    const next = await markPlannedPaymentPaid(ME, p, GROUP);
    expect(next.nextDueDate).toBe("2026-11-01");
    const [tx] = await getDb().transactions.toArray();
    expect(tx.groupId).toBe(GROUP);
    expect(await lastUpsert("planned_payments", p.id)).toMatchObject({ next_due_date: "2026-11-01", user_id: TEAMMATE });
  });

  it("markPlannedPaymentPaid is a no-op for an invisible plan", async () => {
    const p = await addPlannedPayment(TEAMMATE, input, OTHER_GROUP);
    await markPlannedPaymentPaid(ME, p, GROUP);
    expect(await getDb().transactions.count()).toBe(0);
  });
});
