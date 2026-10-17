import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb, resetLocalDatabase } from "@/infrastructure/db/dexie/database";
import { isVisible, scoped } from "@/infrastructure/db/dexie/helpers";

const base = { createdAt: "", updatedAt: "", name: "x", balancePoisha: 0, type: "cash" };

describe("isVisible", () => {
  it("covers the mixed personal + group visibility matrix", () => {
    expect(isVisible({ userId: "me" }, "me", null)).toBe(true);
    expect(isVisible({ userId: "me" }, "me", "g1")).toBe(true);
    expect(isVisible({ userId: "other" }, "me", "g1")).toBe(false);
    expect(isVisible({ userId: "other", groupId: "g1" }, "me", "g1")).toBe(true);
    expect(isVisible({ userId: "me", groupId: "g1" }, "me", null)).toBe(false);
    expect(isVisible({ userId: "me", groupId: "g2" }, "me", "g1")).toBe(false);
    expect(isVisible({ userId: "me", deletedAt: "2026-01-01" }, "me", null)).toBe(false);
  });
});

describe("scoped", () => {
  beforeEach(async () => {
    await resetLocalDatabase();
    await getDb().accounts.bulkPut([
      { ...base, id: "a1", userId: "me" },
      { ...base, id: "a2", userId: "me", groupId: "g1" },
      { ...base, id: "a3", userId: "other", groupId: "g1" },
      { ...base, id: "a4", userId: "other" },
      { ...base, id: "a5", userId: "me", deletedAt: "2026-01-01" },
    ] as any);
  });
  afterEach(async () => {
    await resetLocalDatabase();
  });

  it("returns personal rows plus current group rows without duplicates", async () => {
    const ids = (await scoped(getDb().accounts, "me", "g1").toArray()).map((a) => a.id).sort();
    expect(ids).toEqual(["a1", "a2", "a3"]);
  });

  it("returns only personal rows outside a group", async () => {
    const ids = (await scoped(getDb().accounts, "me", null).toArray()).map((a) => a.id);
    expect(ids).toEqual(["a1"]);
  });
});
