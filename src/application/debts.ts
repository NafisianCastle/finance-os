import { getDb } from "@/infrastructure/db/dexie/database";
import { DEBT_STATUS } from "@/lib/constants";
import { enqueueSync } from "@/infrastructure/sync/sync-queue";
import { addTransaction } from "@/application/transactions";
import { TX_TYPES } from "@/lib/constants";
import type { Debt } from "@/infrastructure/db/dexie/schema";

export async function repayDebt(
  userId: string,
  debt: Debt,
  amountPoisha: number,
  accountId: string
) {
  const applied = Math.min(amountPoisha, debt.remainingPoisha);
  if (applied <= 0) return debt;

  await addTransaction(userId, {
    type: TX_TYPES.EXPENSE,
    amountPoisha: applied,
    accountId,
    categoryId: "other",
    date: new Date().toISOString().slice(0, 10),
    note: `Debt repayment — ${debt.lender}`,
  });

  const now = new Date().toISOString();
  const remainingPoisha = debt.remainingPoisha - applied;
  const status = remainingPoisha <= 0 ? DEBT_STATUS.PAID : debt.status;

  await getDb().debts.update(debt.id, { remainingPoisha, status, updatedAt: now });
  await enqueueSync("debts", debt.id, "upsert", {
    id: debt.id,
    remaining_poisha: remainingPoisha,
    status_smallint: status,
  });

  return { ...debt, remainingPoisha, status, updatedAt: now };
}
