import { v4 as uuid } from "uuid";
import { getDb } from "@/infrastructure/db/dexie/database";
import { enqueueSync } from "@/infrastructure/sync/sync-queue";
import { addTransaction } from "@/application/transactions";
import {
  PLANNED_PAYMENT_DIRECTION,
  PLANNED_PAYMENT_STATUS,
  RECURRENCE_INTERVAL,
  TX_TYPES,
} from "@/lib/constants";
import type { PlannedPayment } from "@/infrastructure/db/dexie/schema";

function toSyncPayload(p: PlannedPayment): Record<string, unknown> {
  return {
    id: p.id,
    direction_smallint: p.direction,
    amount_poisha: p.amountPoisha,
    account_id: p.accountId,
    category_id: p.categoryId,
    counterparty: p.counterparty,
    next_due_date: p.nextDueDate,
    is_recurring: p.isRecurring,
    recurrence_interval_smallint: p.recurrenceInterval ?? null,
    status_smallint: p.status,
    note: p.note,
  };
}

function advanceDate(dateStr: string, interval: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  if (interval === RECURRENCE_INTERVAL.WEEKLY) {
    d.setUTCDate(d.getUTCDate() + 7);
  } else if (interval === RECURRENCE_INTERVAL.YEARLY) {
    d.setUTCFullYear(d.getUTCFullYear() + 1);
  } else {
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return d.toISOString().slice(0, 10);
}

export async function addPlannedPayment(
  userId: string,
  data: Omit<PlannedPayment, "id" | "userId" | "createdAt" | "updatedAt" | "deletedAt" | "syncStatus" | "status">
) {
  const db = getDb();
  const now = new Date().toISOString();
  const plan: PlannedPayment = {
    ...data,
    id: uuid(),
    userId,
    status: PLANNED_PAYMENT_STATUS.ACTIVE,
    createdAt: now,
    updatedAt: now,
    syncStatus: "pending",
  };
  await db.plannedPayments.put(plan as never);
  await enqueueSync("planned_payments", plan.id, "upsert", toSyncPayload(plan));
  return plan;
}

export async function updatePlannedPayment(
  userId: string,
  planId: string,
  data: Omit<PlannedPayment, "id" | "userId" | "createdAt" | "updatedAt" | "deletedAt" | "syncStatus" | "status">
) {
  const db = getDb();
  const existing = await db.plannedPayments.get(planId);
  if (!existing || existing.userId !== userId || existing.deletedAt) return;
  const now = new Date().toISOString();
  const plan: PlannedPayment = { ...existing, ...data, id: planId, userId, updatedAt: now, syncStatus: "pending" };
  await db.plannedPayments.put(plan as never);
  await enqueueSync("planned_payments", plan.id, "upsert", toSyncPayload(plan));
  return plan;
}

export async function deletePlannedPayment(userId: string, planId: string) {
  const db = getDb();
  const plan = await db.plannedPayments.get(planId);
  if (!plan || plan.userId !== userId || plan.deletedAt) return;
  const now = new Date().toISOString();
  await db.plannedPayments.update(planId, { deletedAt: now, updatedAt: now });
  await enqueueSync("planned_payments", planId, "delete", { id: planId });
}

/**
 * Records the due occurrence as an actual transaction. One-off plans are
 * consumed (soft-deleted); recurring plans stay active with nextDueDate
 * rolled forward by their interval.
 */
export async function markPlannedPaymentPaid(userId: string, plan: PlannedPayment) {
  const db = getDb();

  await addTransaction(userId, {
    type: plan.direction === PLANNED_PAYMENT_DIRECTION.RECEIVE ? TX_TYPES.INCOME : TX_TYPES.EXPENSE,
    amountPoisha: plan.amountPoisha,
    accountId: plan.accountId,
    categoryId: plan.categoryId,
    date: new Date().toISOString().slice(0, 10),
    note: plan.counterparty ? `${plan.note ? `${plan.note} — ` : ""}${plan.counterparty}` : plan.note,
  });

  const now = new Date().toISOString();

  if (plan.isRecurring && plan.recurrenceInterval) {
    const nextDueDate = advanceDate(plan.nextDueDate, plan.recurrenceInterval);
    await db.plannedPayments.update(plan.id, { nextDueDate, updatedAt: now });
    await enqueueSync("planned_payments", plan.id, "upsert", {
      ...toSyncPayload(plan),
      next_due_date: nextDueDate,
    });
    return { ...plan, nextDueDate, updatedAt: now };
  }

  await db.plannedPayments.update(plan.id, {
    status: PLANNED_PAYMENT_STATUS.CANCELLED,
    deletedAt: now,
    updatedAt: now,
  });
  await enqueueSync("planned_payments", plan.id, "delete", { id: plan.id });
  return { ...plan, status: PLANNED_PAYMENT_STATUS.CANCELLED, deletedAt: now, updatedAt: now };
}
