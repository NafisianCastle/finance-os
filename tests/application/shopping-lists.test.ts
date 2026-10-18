import "fake-indexeddb/auto";
import { readFileSync } from "fs";
import path from "path";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb, resetLocalDatabase } from "@/infrastructure/db/dexie/database";
import {
  addShoppingListItem,
  checkoutGroupKey,
  createShoppingList,
  deleteShoppingList,
  deleteShoppingListItem,
  finishShoppingList,
  listShoppingListItems,
  priceItemAfterCheckout,
  renameShoppingList,
  updateShoppingListItem,
} from "@/application/shopping-lists";
import { GROUP, ME, OTHER_GROUP, TEAMMATE, balance, lastUpsert, makeAccount } from "./helpers";

describe("shopping lists", () => {
  beforeEach(async () => {
    await resetLocalDatabase();
    await getDb().accounts.bulkPut([
      makeAccount({ id: "cash", balancePoisha: 100_000 }),
      makeAccount({ id: "card", balancePoisha: 100_000 }),
    ]);
  });

  it("source file contains no NUL bytes and uses a printable checkout key", () => {
    const src = readFileSync(path.resolve(__dirname, "../../src/application/shopping-lists.ts"), "utf8");
    expect(src.includes("\u0000")).toBe(false);
    expect(checkoutGroupKey("a", "b")).toBe("a|b");
  });

  it("items inherit the list's group; payloads carry user_id/group_id", async () => {
    const list = await createShoppingList(TEAMMATE, "Bazaar", GROUP);
    const item = await addShoppingListItem(ME, list.id, { name: "Rice" }, GROUP);
    expect(item?.groupId).toBe(GROUP);
    expect(await lastUpsert("shopping_lists", list.id)).toMatchObject({ user_id: TEAMMATE, group_id: GROUP });
    expect(await lastUpsert("shopping_list_items", item!.id)).toMatchObject({ user_id: ME, group_id: GROUP, list_id: list.id });
  });

  it("refuses to add to, rename or delete another group's list", async () => {
    const list = await createShoppingList(TEAMMATE, "Bazaar", OTHER_GROUP);
    expect(await addShoppingListItem(ME, list.id, { name: "Rice" }, GROUP)).toBeUndefined();
    expect(await renameShoppingList(ME, list.id, "x", GROUP)).toBeUndefined();
    expect(await deleteShoppingList(list.id, ME, GROUP)).toBe(false);
  });

  it("item sortOrder is computed from non-deleted items without collisions", async () => {
    const list = await createShoppingList(ME, "Bazaar");
    const a = await addShoppingListItem(ME, list.id, { name: "A" });
    const b = await addShoppingListItem(ME, list.id, { name: "B" });
    await deleteShoppingListItem(a!.id, ME);
    const c = await addShoppingListItem(ME, list.id, { name: "C" });
    expect(c!.sortOrder).toBe(b!.sortOrder + 1);
    expect((await listShoppingListItems(list.id)).map((i) => i.name)).toEqual(["B", "C"]);
  });

  it("renames a list and edits an item's name", async () => {
    const list = await createShoppingList(ME, "Bazaar");
    const item = await addShoppingListItem(ME, list.id, { name: "Rice" });
    expect((await renameShoppingList(ME, list.id, "  Weekly  "))?.name).toBe("Weekly");
    expect(await renameShoppingList(ME, list.id, "   ")).toBeUndefined();
    expect((await updateShoppingListItem(item!.id, { name: " Basmati " }, ME))?.name).toBe("Basmati");
    expect((await lastUpsert("shopping_lists", list.id))?.name).toBe("Weekly");
  });

  it("group members can edit a teammate's shared item", async () => {
    const list = await createShoppingList(TEAMMATE, "Bazaar", GROUP);
    const item = await addShoppingListItem(TEAMMATE, list.id, { name: "Rice" }, GROUP);
    const updated = await updateShoppingListItem(item!.id, { checked: true }, ME, GROUP);
    expect(updated).toMatchObject({ checked: true, userId: TEAMMATE, groupId: GROUP });
    expect(await updateShoppingListItem(item!.id, { checked: false }, ME, OTHER_GROUP)).toBeUndefined();
  });

  it("finish writes resolved account/category back onto items so post-checkout pricing hits the right tx", async () => {
    const list = await createShoppingList(ME, "Bazaar");
    const rice = await addShoppingListItem(ME, list.id, { name: "Rice" });
    const phone = await addShoppingListItem(ME, list.id, { name: "Cable", accountId: "card", categoryId: "gadgets" });
    await updateShoppingListItem(rice!.id, { checked: true, actualPricePoisha: 1_000 });
    await updateShoppingListItem(phone!.id, { checked: true });

    const txIds = (await finishShoppingList(ME, list.id, "cash"))!;
    expect(txIds).toHaveLength(2);
    expect((await getDb().shoppingListItems.get(rice!.id))).toMatchObject({ accountId: "cash", categoryId: "food" });

    await priceItemAfterCheckout(ME, phone!.id, 2_500);
    const txs = await Promise.all(txIds.map((id) => getDb().transactions.get(id)));
    const cardTx = txs.find((t) => t?.accountId === "card")!;
    const cashTx = txs.find((t) => t?.accountId === "cash")!;
    expect(cardTx.amountPoisha).toBe(2_500);
    expect(cashTx.amountPoisha).toBe(1_000);
    expect(await balance("card")).toBe(97_500);
  });

  it("legacy items without an account match their tx by category, never by a transaction id", async () => {
    const list = await createShoppingList(ME, "Bazaar");
    const item = await addShoppingListItem(ME, list.id, { name: "Rice" });
    await updateShoppingListItem(item!.id, { checked: true });
    const [txId] = (await finishShoppingList(ME, list.id, "cash"))!;
    // Simulate an item checked out by an old client (no account written back).
    await getDb().shoppingListItems.update(item!.id, { accountId: undefined });

    await priceItemAfterCheckout(ME, item!.id, 4_000);
    expect((await getDb().transactions.get(txId))?.amountPoisha).toBe(4_000);
  });

  it("checkout transactions inherit the list's group", async () => {
    const list = await createShoppingList(TEAMMATE, "Bazaar", GROUP);
    const item = await addShoppingListItem(ME, list.id, { name: "Rice" }, GROUP);
    await updateShoppingListItem(item!.id, { checked: true, actualPricePoisha: 500 }, ME, GROUP);
    const [txId] = (await finishShoppingList(ME, list.id, "cash", GROUP))!;
    expect((await getDb().transactions.get(txId))?.groupId).toBe(GROUP);
    expect(await lastUpsert("shopping_lists", list.id)).toMatchObject({ status: "completed", group_id: GROUP, user_id: TEAMMATE });
  });

  it("deleting a checked item on a completed list recomputes its transaction", async () => {
    const list = await createShoppingList(ME, "Bazaar");
    const a = await addShoppingListItem(ME, list.id, { name: "A" });
    const b = await addShoppingListItem(ME, list.id, { name: "B" });
    await updateShoppingListItem(a!.id, { checked: true, actualPricePoisha: 1_000 });
    await updateShoppingListItem(b!.id, { checked: true, actualPricePoisha: 2_000 });
    const [txId] = (await finishShoppingList(ME, list.id, "cash"))!;
    expect(await balance("cash")).toBe(97_000);

    expect(await deleteShoppingListItem(b!.id, ME)).toBe(true);
    const tx = await getDb().transactions.get(txId);
    expect(tx?.amountPoisha).toBe(1_000);
    expect(tx?.lineItems?.map((l) => l.name)).toEqual(["A"]);
    expect(await balance("cash")).toBe(99_000);
  });

  it("a completed list can be deleted; its spending transactions are kept", async () => {
    const list = await createShoppingList(ME, "Bazaar");
    const a = await addShoppingListItem(ME, list.id, { name: "A" });
    await updateShoppingListItem(a!.id, { checked: true, actualPricePoisha: 1_000 });
    const [txId] = (await finishShoppingList(ME, list.id, "cash"))!;
    expect(await deleteShoppingList(list.id, ME)).toBe(true);
    expect((await getDb().shoppingLists.get(list.id))?.deletedAt).toBeTruthy();
    expect((await getDb().shoppingListItems.get(a!.id))?.deletedAt).toBeTruthy();
    expect((await getDb().transactions.get(txId))?.deletedAt).toBeFalsy();
  });
});
