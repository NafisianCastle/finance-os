import { v4 as uuid } from "uuid";
import { getDb } from "@/infrastructure/db/dexie/database";
import { isVisible, scoped } from "@/infrastructure/db/dexie/helpers";
import { LOAN_STATUS, TX_TYPES } from "@/lib/constants";
import { enqueueSync } from "@/infrastructure/sync/sync-queue";
import { addTransaction } from "@/application/transactions";
import type { LoanGiven } from "@/infrastructure/db/dexie/schema";

export interface LoanGivenInput {
  borrower: string;
  amountPoisha: number;
  /** Defaults to today (YYYY-MM-DD). */
  borrowDate?: string;
  /** YYYY-MM-DD; empty/undefined = no due date. */
  dueDate?: string;
  note?: string;
}

/** Full remote `loans_given` row (snake_case) for an upsert — every NOT NULL column included. */
export function toLoanGivenPayload(l: LoanGiven): Record<string, unknown> {
  return {
    id: l.id,
    user_id: l.userId,
    group_id: l.groupId ?? null,
    borrower: l.borrower,
    amount_poisha: l.amountPoisha,
    remaining_poisha: l.remainingPoisha,
    borrow_date: l.borrowDate,
    due_date: l.dueDate ?? null,
    status_smallint: l.status,
    note: l.note ?? null,
  };
}

/**
 * Derived overdue flag: has a due date before `today` (YYYY-MM-DD) and is not
 * recovered. OVERDUE is never stored — it's computed, so it flips on its own
 * as days pass and works for rows written by old clients.
 */
export function isLoanOverdue(loan: Pick<LoanGiven, "dueDate" | "status" | "remainingPoisha">, today: string) {
  if (loan.status === LOAN_STATUS.RECOVERED || loan.remainingPoisha <= 0) return false;
  return !!loan.dueDate && loan.dueDate < today;
}

/** Loans visible to the user: own personal + shared with `groupId`. */
export async function listLoansGiven(userId: string, groupId: string | null = null) {
  return scoped(getDb().loansGiven, userId, groupId).toArray();
}

/** Creates a loan given; `groupId` is the group to share it with (null = personal). */
export async function addLoanGiven(userId: string, data: LoanGivenInput, groupId: string | null = null) {
  const now = new Date().toISOString();
  const l: LoanGiven = {
    id: uuid(),
    userId,
    groupId,
    borrower: data.borrower.trim(),
    amountPoisha: data.amountPoisha,
    remainingPoisha: data.amountPoisha,
    borrowDate: data.borrowDate || now.slice(0, 10),
    dueDate: data.dueDate || undefined,
    status: LOAN_STATUS.ACTIVE,
    note: data.note,
    createdAt: now,
    updatedAt: now,
  };
  await getDb().loansGiven.put(l as never);
  await enqueueSync("loans_given", l.id, "upsert", toLoanGivenPayload(l));
  return l;
}

/**
 * Edits a visible loan (`groupId` = viewer's current group). Changing the
 * amount shifts the remaining balance by the same delta (never below 0), so
 * recoveries already made are preserved.
 */
export async function updateLoanGiven(
  userId: string,
  loanId: string,
  data: Partial<LoanGivenInput>,
  groupId: string | null = null
) {
  const db = getDb();
  const existing = await db.loansGiven.get(loanId);
  if (!existing || !isVisible(existing, userId, groupId)) return;
  const now = new Date().toISOString();

  const amountPoisha = data.amountPoisha ?? existing.amountPoisha;
  const remainingPoisha = Math.max(0, existing.remainingPoisha + (amountPoisha - existing.amountPoisha));
  const l: LoanGiven = {
    ...existing,
    borrower: data.borrower !== undefined ? data.borrower.trim() : existing.borrower,
    amountPoisha,
    remainingPoisha,
    borrowDate: data.borrowDate || existing.borrowDate,
    dueDate: "dueDate" in data ? data.dueDate || undefined : existing.dueDate,
    note: "note" in data ? data.note : existing.note,
    status: remainingPoisha <= 0 ? LOAN_STATUS.RECOVERED : LOAN_STATUS.ACTIVE,
    updatedAt: now,
  };
  await db.loansGiven.put(l as never);
  await enqueueSync("loans_given", l.id, "upsert", toLoanGivenPayload(l));
  return l;
}

/** Soft-deletes a visible loan. Recovery transactions already logged are kept. */
export async function deleteLoanGiven(userId: string, loanId: string, groupId: string | null = null) {
  const db = getDb();
  const existing = await db.loansGiven.get(loanId);
  if (!existing || !isVisible(existing, userId, groupId)) return false;
  const now = new Date().toISOString();
  await db.loansGiven.update(loanId, { deletedAt: now, updatedAt: now });
  await enqueueSync("loans_given", loanId, "delete", {});
  return true;
}

/**
 * Logs a recovery income into `accountId` and reduces the loan. The income
 * transaction inherits the loan's groupId. `groupId` is the viewer's current
 * group (visibility check).
 */
export async function recoverLoanGiven(
  userId: string,
  loan: LoanGiven,
  amountPoisha: number,
  accountId: string,
  groupId: string | null = null
) {
  if (!isVisible(loan, userId, groupId)) return loan;
  const applied = Math.min(amountPoisha, loan.remainingPoisha);
  if (applied <= 0) return loan;

  await addTransaction(
    userId,
    {
      type: TX_TYPES.INCOME,
      amountPoisha: applied,
      accountId,
      categoryId: "income",
      date: new Date().toISOString().slice(0, 10),
      note: `Loan recovery — ${loan.borrower}`,
    },
    loan.groupId ?? null
  );

  const now = new Date().toISOString();
  const remainingPoisha = loan.remainingPoisha - applied;
  const status = remainingPoisha <= 0 ? LOAN_STATUS.RECOVERED : loan.status;
  const updated: LoanGiven = { ...loan, remainingPoisha, status, updatedAt: now };

  await getDb().loansGiven.update(loan.id, { remainingPoisha, status, updatedAt: now });
  await enqueueSync("loans_given", loan.id, "upsert", toLoanGivenPayload(updated));

  return updated;
}
