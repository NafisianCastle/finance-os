import { v4 as uuid } from "uuid";
import { getDb } from "@/infrastructure/db/dexie/database";
import { isVisible } from "@/infrastructure/db/dexie/helpers";
import { TX_TYPES } from "@/lib/constants";
import { enqueueSync } from "@/infrastructure/sync/sync-queue";
import type { Transaction } from "@/infrastructure/db/dexie/schema";

export type TransactionInput = Omit<
  Transaction,
  "id" | "userId" | "createdAt" | "updatedAt" | "deletedAt" | "syncStatus"
>;

/** Category slug stored for transfers when the caller leaves it empty (remote category_id is NOT NULL). */
export const TRANSFER_CATEGORY_ID = "other";

/** Full remote `transactions` row (snake_case) for an upsert. */
export function toTransactionPayload(tx: Transaction): Record<string, unknown> {
  return {
    id: tx.id,
    user_id: tx.userId,
    group_id: tx.groupId ?? null,
    type_smallint: tx.type,
    amount_poisha: tx.amountPoisha,
    account_id: tx.accountId,
    to_account_id: tx.type === TX_TYPES.TRANSFER ? tx.toAccountId ?? null : null,
    category_id: tx.categoryId,
    tx_date: tx.date,
    note: tx.note ?? null,
    tags: tx.tags ?? null,
    merchant: tx.merchant ?? null,
    recurring_id: tx.recurringId ?? null,
    line_items: tx.lineItems ?? null,
  };
}

/** Normalises type-dependent fields: only transfers carry a destination account. */
function normalise(tx: Transaction): Transaction {
  if (tx.type === TX_TYPES.TRANSFER) {
    return { ...tx, toAccountId: tx.toAccountId ?? null, categoryId: tx.categoryId || TRANSFER_CATEGORY_ID };
  }
  return { ...tx, toAccountId: null };
}

/**
 * Applies (sign = 1) or reverses (sign = -1) a transaction's effect on local
 * account balances. Mirrors the remote apply_transaction_balance_delta
 * trigger: a transfer always debits its source account and credits the
 * destination when one is set. Each account is re-read so that edits moving
 * a transaction between accounts compose correctly.
 */
async function applyBalanceEffect(t: Transaction, sign: 1 | -1, now: string) {
  const db = getDb();
  const adjust = async (accountId: string | null | undefined, delta: number) => {
    if (!accountId || delta === 0) return;
    const account = await db.accounts.get(accountId);
    if (!account) return;
    await db.accounts.update(account.id, { balancePoisha: account.balancePoisha + delta, updatedAt: now });
  };

  if (t.type === TX_TYPES.INCOME) {
    await adjust(t.accountId, sign * t.amountPoisha);
  } else if (t.type === TX_TYPES.EXPENSE) {
    await adjust(t.accountId, -sign * t.amountPoisha);
  } else if (t.type === TX_TYPES.TRANSFER) {
    await adjust(t.accountId, -sign * t.amountPoisha);
    await adjust(t.toAccountId, sign * t.amountPoisha);
  }
}

/**
 * Creates a transaction. `groupId` is the group the new row is shared with
 * (caller passes `shared ? currentGroupId : null`); defaults to
 * `data.groupId ?? null`.
 */
export async function addTransaction(
  userId: string,
  data: TransactionInput,
  groupId: string | null = data.groupId ?? null
) {
  const db = getDb();
  const now = new Date().toISOString();
  const tx = normalise({
    ...data,
    id: uuid(),
    userId,
    groupId,
    createdAt: now,
    updatedAt: now,
    syncStatus: "pending",
  });

  // Local balance is updated immediately for instant UI feedback. The pushed
  // transaction row (below) is the source of truth remotely — a Postgres
  // trigger derives the account balance delta from it atomically, so two
  // devices adding transactions to the same account offline can't clobber
  // each other's balance change the way an absolute balance upsert would.
  await db.transaction("rw", db.transactions, db.accounts, async () => {
    await db.transactions.put(tx as never);
    await applyBalanceEffect(tx, 1, now);
  });

  await enqueueSync("transactions", tx.id, "upsert", toTransactionPayload(tx));
  return tx;
}

/**
 * Edits a transaction visible to the user (own personal row or any row shared
 * with `groupId`, the viewer's current group). The record keeps its author
 * (`userId`) and `groupId`. Balance effects are reversed and re-applied, so
 * amount/type/account/destination changes — including switching to or from a
 * transfer — are all handled.
 */
export async function updateTransaction(
  userId: string,
  txId: string,
  data: TransactionInput,
  groupId: string | null = null
) {
  const db = getDb();
  const existing = await db.transactions.get(txId);
  if (!existing || !isVisible(existing, userId, groupId)) return;
  const now = new Date().toISOString();

  const tx = normalise({
    ...existing,
    ...data,
    id: txId,
    userId: existing.userId,
    groupId: existing.groupId ?? null,
    createdAt: existing.createdAt,
    deletedAt: existing.deletedAt,
    updatedAt: now,
    syncStatus: "pending",
  });

  await db.transaction("rw", db.transactions, db.accounts, async () => {
    await applyBalanceEffect(existing, -1, now);
    await db.transactions.put(tx as never);
    await applyBalanceEffect(tx, 1, now);
  });

  await enqueueSync("transactions", tx.id, "upsert", toTransactionPayload(tx));
  return tx;
}

/** Soft-deletes a visible transaction and reverses its balance effect. */
export async function deleteTransaction(userId: string, txId: string, groupId: string | null = null) {
  const db = getDb();
  const tx = await db.transactions.get(txId);
  if (!tx || !isVisible(tx, userId, groupId)) return;
  const now = new Date().toISOString();

  await db.transaction("rw", db.transactions, db.accounts, async () => {
    await db.transactions.update(txId, { deletedAt: now, updatedAt: now });
    await applyBalanceEffect(tx, -1, now);
  });

  await enqueueSync("transactions", txId, "delete", { id: txId });
}
