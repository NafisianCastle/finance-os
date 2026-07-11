import { getDb } from "@/infrastructure/db/dexie/database";
import { LOAN_STATUS, TX_TYPES } from "@/lib/constants";
import { enqueueSync } from "@/infrastructure/sync/sync-queue";
import { addTransaction } from "@/application/transactions";
import type { LoanGiven } from "@/infrastructure/db/dexie/schema";

export async function recoverLoanGiven(
  userId: string,
  loan: LoanGiven,
  amountPoisha: number,
  accountId: string
) {
  const applied = Math.min(amountPoisha, loan.remainingPoisha);
  if (applied <= 0) return loan;

  await addTransaction(userId, {
    type: TX_TYPES.INCOME,
    amountPoisha: applied,
    accountId,
    categoryId: "income",
    date: new Date().toISOString().slice(0, 10),
    note: `Loan recovery — ${loan.borrower}`,
  });

  const now = new Date().toISOString();
  const remainingPoisha = loan.remainingPoisha - applied;
  const status = remainingPoisha <= 0 ? LOAN_STATUS.RECOVERED : loan.status;

  await getDb().loansGiven.update(loan.id, { remainingPoisha, status, updatedAt: now });
  await enqueueSync("loans_given", loan.id, "upsert", {
    id: loan.id,
    remaining_poisha: remainingPoisha,
    status_smallint: status,
  });

  return { ...loan, remainingPoisha, status, updatedAt: now };
}
