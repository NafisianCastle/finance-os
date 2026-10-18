import { v4 as uuid } from "uuid";
import { getDb } from "@/infrastructure/db/dexie/database";
import { isVisible, scoped } from "@/infrastructure/db/dexie/helpers";
import { enqueueSync } from "@/infrastructure/sync/sync-queue";
import { addTransaction } from "@/application/transactions";
import {
  PLANNED_PAYMENT_DIRECTION,
  PLANNED_PAYMENT_STATUS,
  RECURRENCE_INTERVAL,
  TX_TYPES,
} from "@/lib/constants";
import type { PlannedPayment } from "@/infrastructure/db/dexie/schema";

export type PlannedPaymentInput = Omit<
  PlannedPayment,
  "id" | "userId" | "createdAt" | "updatedAt" | "deletedAt" | "syncStatus" | "status"
>;

/** Full remote `planned_payments` row (snake_case) for an upsert. */
export function toPlannedPaymentPayload(p: PlannedPayment): Record<string, unknown> {
  return {
    id: p.id,
    user_id: p.userId,
    group_id: p.groupId ?? null,
    direction_smallint: p.direction,
    amount_poisha: p.amountPoisha,
    account_id: p.accountId,
    category_id: p.categoryId,
    counterparty: p.counterparty ?? null,
    next_due_date: p.nextDueDate,
    is_recurring: p.isRecurring,
    recurrence_interval_smallint: p.recurrenceInterval ?? null,
    status_smallint: p.status,
    note: p.note ?? null,
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

/** Planned payments visible to the user: own personal + shared with `groupId`. */
export async function listPlannedPayments(userId: string, groupId: string | null = null) {
  return scoped(getDb().plannedPayments, userId, groupId).toArray();
}

/**
 * Creates a planned payment. `groupId` is the group to share it with
 * (null = personal); defaults to `data.groupId ?? null`.
 */
export async function addPlannedPayment(
  userId: string,
  data: PlannedPaymentInput,
  groupId: string | null = data.groupId ?? null
) {
  const db = getDb();
  const now = new Date().toISOString();
  const plan: PlannedPayment = {
    ...data,
    id: uuid(),
    userId,
    groupId,
    status: PLANNED_PAYMENT_STATUS.ACTIVE,
    createdAt: now,
    updatedAt: now,
    syncStatus: "pending",
  };
  await db.plannedPayments.put(plan as never);
  await enqueueSync("planned_payments", plan.id, "upsert", toPlannedPaymentPayload(plan));
  return plan;
}

/** Edits a visible planned payment (`groupId` = viewer's current group); author and groupId are kept. */
export async function updatePlannedPayment(
  userId: string,
  planId: string,
  data: PlannedPaymentInput,
  groupId: string | null = null
) {
  const db = getDb();
  const existing = await db.plannedPayments.get(planId);
  if (!existing || !isVisible(existing, userId, groupId)) return;
  const now = new Date().toISOString();
  const plan: PlannedPayment = {
    ...existing,
    ...data,
    id: planId,
    userId: existing.userId,
    groupId: existing.groupId ?? null,
    updatedAt: now,
    syncStatus: "pending",
  };
  await db.plannedPayments.put(plan as never);
  await enqueueSync("planned_payments", plan.id, "upsert", toPlannedPaymentPayload(plan));
  return plan;
}

/** Soft-deletes a visible planned payment (`groupId` = viewer's current group). */
export async function deletePlannedPayment(userId: string, planId: string, groupId: string | null = null) {
  const db = getDb();
  const plan = await db.plannedPayments.get(planId);
  if (!plan || !isVisible(plan, userId, groupId)) return;
  const now = new Date().toISOString();
  await db.plannedPayments.update(planId, { deletedAt: now, updatedAt: now });
  await enqueueSync("planned_payments", planId, "delete", { id: planId });
}

/**
 * Records the due occurrence as an actual transaction. One-off plans are
 * consumed (soft-deleted); recurring plans stay active with nextDueDate
 * rolled forward by their interval. The transaction inherits the plan's
 * groupId; `groupId` is the viewer's current group (visibility check).
 */
export async function markPlannedPaymentPaid(
  userId: string,
  plan: PlannedPayment,
  groupId: string | null = null
) {
  const db = getDb();
  if (!isVisible(plan, userId, groupId)) return plan;

  await addTransaction(
    userId,
    {
      type: plan.direction === PLANNED_PAYMENT_DIRECTION.RECEIVE ? TX_TYPES.INCOME : TX_TYPES.EXPENSE,
      amountPoisha: plan.amountPoisha,
      accountId: plan.accountId,
      categoryId: plan.categoryId,
      date: new Date().toISOString().slice(0, 10),
      note: plan.counterparty ? `${plan.note ? `${plan.note} — ` : ""}${plan.counterparty}` : plan.note,
    },
    plan.groupId ?? null
  );

  const now = new Date().toISOString();

  if (plan.isRecurring && plan.recurrenceInterval) {
    const nextDueDate = advanceDate(plan.nextDueDate, plan.recurrenceInterval);
    const updated: PlannedPayment = { ...plan, nextDueDate, updatedAt: now };
    await db.plannedPayments.update(plan.id, { nextDueDate, updatedAt: now });
    await enqueueSync("planned_payments", plan.id, "upsert", toPlannedPaymentPayload(updated));
    return updated;
  }

  await db.plannedPayments.update(plan.id, {
    status: PLANNED_PAYMENT_STATUS.CANCELLED,
    deletedAt: now,
    updatedAt: now,
  });
  await enqueueSync("planned_payments", plan.id, "delete", { id: plan.id });
  return { ...plan, status: PLANNED_PAYMENT_STATUS.CANCELLED, deletedAt: now, updatedAt: now };
}
