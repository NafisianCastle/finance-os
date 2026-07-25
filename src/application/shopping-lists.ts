import { v4 as uuid } from "uuid";
import { getDb } from "@/infrastructure/db/dexie/database";
import { enqueueSync } from "@/infrastructure/sync/sync-queue";
import { addTransaction, updateTransaction } from "@/application/transactions";
import { TX_TYPES } from "@/lib/constants";
import type { ShoppingList, ShoppingListItem } from "@/infrastructure/db/dexie/schema";

export async function createShoppingList(userId: string, name: string) {
  const db = getDb();
  const now = new Date().toISOString();
  const list: ShoppingList = {
    id: uuid(),
    userId,
    name,
    status: "active",
    createdAt: now,
    updatedAt: now,
    syncStatus: "pending",
  };
  await db.shoppingLists.put(list);
  await enqueueSync("shopping_lists", list.id, "upsert", {
    id: list.id,
    name: list.name,
    status: list.status,
  });
  return list;
}

export async function addShoppingListItem(
  userId: string,
  listId: string,
  data: { name: string; categoryId?: string; quantity?: number; unit?: string; estimatedPricePoisha?: number }
) {
  const db = getDb();
  const now = new Date().toISOString();
  const count = await db.shoppingListItems.where("listId").equals(listId).count();
  const item: ShoppingListItem = {
    id: uuid(),
    userId,
    listId,
    name: data.name,
    categoryId: data.categoryId,
    quantity: data.quantity,
    unit: data.unit,
    estimatedPricePoisha: data.estimatedPricePoisha,
    actualPricePoisha: null,
    checked: false,
    sortOrder: count,
    createdAt: now,
    updatedAt: now,
    syncStatus: "pending",
  };
  await db.shoppingListItems.put(item);
  await syncItem(item);
  return item;
}

export async function updateShoppingListItem(
  itemId: string,
  data: Partial<Pick<ShoppingListItem, "checked" | "actualPricePoisha" | "name" | "estimatedPricePoisha">>
) {
  const db = getDb();
  const existing = await db.shoppingListItems.get(itemId);
  if (!existing || existing.deletedAt) return;
  const now = new Date().toISOString();
  const item: ShoppingListItem = { ...existing, ...data, updatedAt: now, syncStatus: "pending" };
  await db.shoppingListItems.put(item);
  await syncItem(item);
  return item;
}

export async function deleteShoppingListItem(itemId: string) {
  const db = getDb();
  const now = new Date().toISOString();
  await db.shoppingListItems.update(itemId, { deletedAt: now, updatedAt: now });
  await enqueueSync("shopping_list_items", itemId, "delete", { id: itemId });
}

async function syncItem(item: ShoppingListItem) {
  await enqueueSync("shopping_list_items", item.id, "upsert", {
    id: item.id,
    list_id: item.listId,
    name: item.name,
    category_id: item.categoryId,
    quantity: item.quantity,
    unit: item.unit,
    estimated_price_poisha: item.estimatedPricePoisha,
    actual_price_poisha: item.actualPricePoisha,
    checked: item.checked,
    sort_order: item.sortOrder,
  });
}

/**
 * Collapses the checked items of a shopping list into a single expense
 * transaction. Items missing a price are skipped from the total (and from
 * the transaction's line items) so the trip can still be closed out at the
 * market; their price can be filled in later via updateShoppingListPrices,
 * which recomputes the linked transaction's amount.
 */
export async function finishShoppingList(
  userId: string,
  listId: string,
  accountId: string,
  categoryId: string
) {
  const db = getDb();
  const list = await db.shoppingLists.get(listId);
  if (!list || list.deletedAt) return;

  const items = await db.shoppingListItems
    .where("listId")
    .equals(listId)
    .filter((i) => !i.deletedAt && i.checked)
    .toArray();

  const priced = items.filter((i) => typeof i.actualPricePoisha === "number" && i.actualPricePoisha! > 0);
  const amountPoisha = priced.reduce((sum, i) => sum + (i.actualPricePoisha ?? 0), 0);

  const tx = await addTransaction(userId, {
    type: TX_TYPES.EXPENSE,
    amountPoisha,
    accountId,
    categoryId,
    date: new Date().toISOString().slice(0, 10),
    merchant: list.name,
    lineItems: priced.map((i) => ({ name: i.name, amountPoisha: i.actualPricePoisha!, categoryId: i.categoryId })),
  });

  const now = new Date().toISOString();
  await db.shoppingLists.update(listId, {
    status: "completed",
    linkedTransactionId: tx.id,
    updatedAt: now,
    syncStatus: "pending",
  });
  await enqueueSync("shopping_lists", listId, "upsert", {
    id: listId,
    name: list.name,
    status: "completed",
    linked_transaction_id: tx.id,
  });

  return tx;
}

/** Re-syncs a checked item's price after the trip was already finished, and keeps the linked transaction's amount + line items in step. */
export async function priceItemAfterCheckout(userId: string, itemId: string, actualPricePoisha: number) {
  const item = await updateShoppingListItem(itemId, { actualPricePoisha });
  if (!item) return;

  const db = getDb();
  const list = await db.shoppingLists.get(item.listId);
  if (!list?.linkedTransactionId) return;

  const tx = await db.transactions.get(list.linkedTransactionId);
  if (!tx || tx.deletedAt) return;

  const items = await db.shoppingListItems
    .where("listId")
    .equals(item.listId)
    .filter((i) => !i.deletedAt && i.checked)
    .toArray();
  const priced = items.filter((i) => typeof i.actualPricePoisha === "number" && i.actualPricePoisha! > 0);
  const amountPoisha = priced.reduce((sum, i) => sum + (i.actualPricePoisha ?? 0), 0);

  await updateTransaction(userId, tx.id, {
    type: tx.type,
    amountPoisha,
    accountId: tx.accountId,
    toAccountId: tx.toAccountId,
    categoryId: tx.categoryId,
    date: tx.date,
    note: tx.note,
    tags: tx.tags,
    merchant: tx.merchant,
    recurringId: tx.recurringId,
    lineItems: priced.map((i) => ({ name: i.name, amountPoisha: i.actualPricePoisha!, categoryId: i.categoryId })),
  });
}

export async function deleteShoppingList(listId: string) {
  const db = getDb();
  const now = new Date().toISOString();
  await db.shoppingLists.update(listId, { deletedAt: now, updatedAt: now });
  await enqueueSync("shopping_lists", listId, "delete", { id: listId });
  const items = await db.shoppingListItems.where("listId").equals(listId).toArray();
  for (const item of items) {
    await db.shoppingListItems.update(item.id, { deletedAt: now, updatedAt: now });
    await enqueueSync("shopping_list_items", item.id, "delete", { id: item.id });
  }
}
