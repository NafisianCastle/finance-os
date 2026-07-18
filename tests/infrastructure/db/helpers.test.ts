import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb, resetLocalDatabase } from "@/infrastructure/db/dexie/database";
import { getBudgetsForMonth } from "@/infrastructure/db/dexie/helpers";

const USER_ID = "user-1";
const now = new Date().toISOString();

describe("getBudgetsForMonth", () => {
  beforeEach(async () => {
    await resetLocalDatabase();
  });

  it("returns only non-deleted budgets for the given user and month", async () => {
    const db = getDb();
    await db.budgets.put({ id: "b1", userId: USER_ID, ym: "202601", categoryId: "food", allocatedPoisha: 1000, carryPoisha: 0, createdAt: now, updatedAt: now });
    await db.budgets.put({ id: "b2", userId: USER_ID, ym: "202602", categoryId: "food", allocatedPoisha: 1000, carryPoisha: 0, createdAt: now, updatedAt: now });
    await db.budgets.put({ id: "b3", userId: "other-user", ym: "202601", categoryId: "food", allocatedPoisha: 1000, carryPoisha: 0, createdAt: now, updatedAt: now });
    await db.budgets.put({ id: "b4", userId: USER_ID, ym: "202601", categoryId: "shopping", allocatedPoisha: 1000, carryPoisha: 0, createdAt: now, updatedAt: now, deletedAt: now });

    const results = await getBudgetsForMonth(USER_ID, "202601");
    expect(results.map((b) => b.id)).toEqual(["b1"]);
  });

  it("returns an empty array when there are no matching budgets", async () => {
    const results = await getBudgetsForMonth(USER_ID, "202601");
    expect(results).toEqual([]);
  });
});
