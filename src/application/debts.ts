import { v4 as uuid } from "uuid";
import { getDb } from "@/infrastructure/db/dexie/database";
import { isVisible, scoped } from "@/infrastructure/db/dexie/helpers";
import { DEBT_STATUS, TX_TYPES } from "@/lib/constants";
import { enqueueSync } from "@/infrastructure/sync/sync-queue";
import { addTransaction } from "@/application/transactions";
import type { Debt } from "@/infrastructure/db/dexie/schema";

export interface DebtInput {
  lender: string;
  principalPoisha: number;
  interestRate?: number;
  /** Defaults to today (YYYY-MM-DD). */
  borrowDate?: string;
  dueDate?: string;
  note?: string;
}

/** Full remote `debts` row (snake_case) for an upsert — every NOT NULL column included. */
export function toDebtPayload(d: Debt): Record<string, unknown> {
  return {
    id: d.id,
    user_id: d.userId,
    group_id: d.groupId ?? null,
    lender: d.lender,
    principal_poisha: d.principalPoisha,
    interest_rate: d.interestRate ?? null,
    remaining_poisha: d.remainingPoisha,
    borrow_date: d.borrowDate,
    due_date: d.dueDate ?? null,
    status_smallint: d.status,
    note: d.note ?? null,
  };
}

/** Debts visible to the user: own personal + shared with `groupId`. */
export async function listDebts(userId: string, groupId: string | null = null) {
  return scoped(getDb().debts, userId, groupId).toArray();
}

/** Creates a debt; `groupId` is the group to share it with (null = personal). */
export async function addDebt(userId: string, data: DebtInput, groupId: string | null = null) {
  const now = new Date().toISOString();
  const d: Debt = {
    id: uuid(),
    userId,
    groupId,
    lender: data.lender.trim(),
    principalPoisha: data.principalPoisha,
    remainingPoisha: data.principalPoisha,
    interestRate: data.interestRate,
    borrowDate: data.borrowDate || now.slice(0, 10),
    dueDate: data.dueDate || undefined,
    status: DEBT_STATUS.ACTIVE,
    note: data.note,
    createdAt: now,
    updatedAt: now,
  };
  await getDb().debts.put(d as never);
  await enqueueSync("debts", d.id, "upsert", toDebtPayload(d));
  return d;
}

/**
 * Edits a visible debt (`groupId` = viewer's current group). Changing the
 * principal shifts the remaining balance by the same delta (never below 0),
 * so repayments already made are preserved; status follows remaining.
 */
export async function updateDebt(
  userId: string,
  debtId: string,
  data: Partial<DebtInput>,
  groupId: string | null = null
) {
  const db = getDb();
  const existing = await db.debts.get(debtId);
  if (!existing || !isVisible(existing, userId, groupId)) return;
  const now = new Date().toISOString();

  const principalPoisha = data.principalPoisha ?? existing.principalPoisha;
  const remainingPoisha = Math.max(0, existing.remainingPoisha + (principalPoisha - existing.principalPoisha));
  const d: Debt = {
    ...existing,
    lender: data.lender !== undefined ? data.lender.trim() : existing.lender,
    principalPoisha,
    remainingPoisha,
    interestRate: "interestRate" in data ? data.interestRate : existing.interestRate,
    borrowDate: data.borrowDate || existing.borrowDate,
    dueDate: "dueDate" in data ? data.dueDate || undefined : existing.dueDate,
    note: "note" in data ? data.note : existing.note,
    status: remainingPoisha <= 0 ? DEBT_STATUS.PAID : DEBT_STATUS.ACTIVE,
    updatedAt: now,
  };
  await db.debts.put(d as never);
  await enqueueSync("debts", d.id, "upsert", toDebtPayload(d));
  return d;
}

/** Soft-deletes a visible debt. Repayment transactions already logged are kept. */
export async function deleteDebt(userId: string, debtId: string, groupId: string | null = null) {
  const db = getDb();
  const existing = await db.debts.get(debtId);
  if (!existing || !isVisible(existing, userId, groupId)) return false;
  const now = new Date().toISOString();
  await db.debts.update(debtId, { deletedAt: now, updatedAt: now });
  await enqueueSync("debts", debtId, "delete", {});
  return true;
}

/**
 * Logs a repayment expense from `accountId` and reduces the debt. The
 * repayment transaction inherits the debt's groupId. `groupId` is the
 * viewer's current group (visibility check).
 */
export async function repayDebt(
  userId: string,
  debt: Debt,
  amountPoisha: number,
  accountId: string,
  groupId: string | null = null,
  note?: string
) {
  if (!isVisible(debt, userId, groupId)) return debt;
  const applied = Math.min(amountPoisha, debt.remainingPoisha);
  if (applied <= 0) return debt;

  await addTransaction(
    userId,
    {
      type: TX_TYPES.EXPENSE,
      amountPoisha: applied,
      accountId,
      categoryId: "other",
      date: new Date().toISOString().slice(0, 10),
      note: note ?? `Debt repayment — ${debt.lender}`,
    },
    debt.groupId ?? null
  );

  const now = new Date().toISOString();
  const remainingPoisha = debt.remainingPoisha - applied;
  const status = remainingPoisha <= 0 ? DEBT_STATUS.PAID : debt.status;
  const updated: Debt = { ...debt, remainingPoisha, status, updatedAt: now };

  await getDb().debts.update(debt.id, { remainingPoisha, status, updatedAt: now });
  await enqueueSync("debts", debt.id, "upsert", toDebtPayload(updated));

  return updated;
}
