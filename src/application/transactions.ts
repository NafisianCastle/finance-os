import { v4 as uuid } from "uuid";
import { getDb } from "@/infrastructure/db/dexie/database";
import { TX_TYPES } from "@/lib/constants";
import { enqueueSync } from "@/infrastructure/sync/sync-queue";
import type { Transaction } from "@/infrastructure/db/dexie/schema";

export async function addTransaction(
  userId: string,
  data: Omit<Transaction, "id" | "userId" | "createdAt" | "updatedAt" | "deletedAt" | "syncStatus">
) {
  const db = getDb();
  const now = new Date().toISOString();
  const tx: Transaction = {
    ...data,
    id: uuid(),
    userId,
    createdAt: now,
    updatedAt: now,
    syncStatus: "pending",
  };

  await db.transaction("rw", [db.transactions, db.accounts], async () => {
    await db.transactions.add(tx);
    const account = await db.accounts.get(data.accountId);
    if (account) {
      if (data.type === TX_TYPES.INCOME) {
        const bal = account.balancePoisha + data.amountPoisha;
        await db.accounts.update(account.id, { balancePoisha: bal, updatedAt: now });
        await enqueueSync("accounts", account.id, "upsert", { id: account.id, balance_poisha: bal });
      } else if (data.type === TX_TYPES.EXPENSE) {
        const bal = account.balancePoisha - data.amountPoisha;
        await db.accounts.update(account.id, { balancePoisha: bal, updatedAt: now });
        await enqueueSync("accounts", account.id, "upsert", { id: account.id, balance_poisha: bal });
      } else if (data.type === TX_TYPES.TRANSFER && data.toAccountId) {
        const fromBal = account.balancePoisha - data.amountPoisha;
        await db.accounts.update(account.id, { balancePoisha: fromBal, updatedAt: now });
        await enqueueSync("accounts", account.id, "upsert", { id: account.id, balance_poisha: fromBal });
        const to = await db.accounts.get(data.toAccountId);
        if (to) {
          const toBal = to.balancePoisha + data.amountPoisha;
          await db.accounts.update(to.id, { balancePoisha: toBal, updatedAt: now });
          await enqueueSync("accounts", to.id, "upsert", { id: to.id, balance_poisha: toBal });
        }
      }
    }
  });

  await enqueueSync("transactions", tx.id, "upsert", {
    id: tx.id,
    type_smallint: tx.type,
    amount_poisha: tx.amountPoisha,
    account_id: tx.accountId,
    to_account_id: tx.toAccountId,
    category_id: tx.categoryId,
    tx_date: tx.date,
    note: tx.note,
    tags: tx.tags,
    merchant: tx.merchant,
  });

  return tx;
}

export async function deleteTransaction(userId: string, txId: string) {
  const db = getDb();
  const tx = await db.transactions.get(txId);
  if (!tx || tx.userId !== userId) return;
  const now = new Date().toISOString();
  await db.transactions.update(txId, { deletedAt: now, updatedAt: now });
  await enqueueSync("transactions", txId, "delete", { id: txId });
}
