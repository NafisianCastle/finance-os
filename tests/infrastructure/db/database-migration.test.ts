import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb, resetLocalDatabase } from "@/infrastructure/db/dexie/database";
import { INVESTMENT_STATUS } from "@/lib/investment-constants";

describe("FinanceDatabase v1 -> v2 upgrade", () => {
  beforeEach(async () => {
    await resetLocalDatabase();
  });

  afterEach(async () => {
    await resetLocalDatabase();
  });

  it("backfills projectStartDate/status/declaredProfitPoisha from legacy investment fields", async () => {
    // Seed a v1-shaped database directly, bypassing FinanceDatabase's v2 schema,
    // to simulate an existing user's browser before the migration ships.
    const legacyDb = new Dexie("FinanceOS");
    legacyDb.version(1).stores({
      userProfiles: "id, userId",
      accounts: "id, userId, updatedAt",
      categories: "id, userId",
      transactions: "id, userId, date, categoryId, updatedAt",
      budgets: "id, userId, ym, categoryId",
      debts: "id, userId, updatedAt",
      loansGiven: "id, userId, updatedAt",
      heldLiabilities: "id, userId, status, updatedAt",
      goals: "id, userId",
      investments: "id, userId",
      buyEvaluations: "id, userId, updatedAt",
      syncQueue: "++id, createdAt",
    });
    await legacyDb.open();
    await legacyDb.table("investments").put({
      id: "inv-1",
      userId: "user-1",
      type: 6,
      name: "Old Project",
      investedPoisha: 100_000,
      startDate: "2024-01-01",
      maturityDate: "2025-01-01",
      currentValuePoisha: 120_000,
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    });
    legacyDb.close();

    // Now open through FinanceDatabase (v2) — Dexie runs the .upgrade() callback.
    const db = getDb();
    await db.open();

    const migrated = await db.investments.get("inv-1");
    expect(migrated?.projectStartDate).toBe("2024-01-01");
    expect(migrated?.projectEndDate).toBe("2025-01-01");
    expect(migrated?.status).toBe(INVESTMENT_STATUS.ACTIVE);
    expect(migrated?.declaredProfitPoisha).toBe(0);
    expect(migrated?.investorName).toBe("");
  });

  it("preserves an existing projectStartDate instead of overwriting it with the legacy startDate", async () => {
    const legacyDb = new Dexie("FinanceOS");
    legacyDb.version(1).stores({
      userProfiles: "id, userId",
      accounts: "id, userId, updatedAt",
      categories: "id, userId",
      transactions: "id, userId, date, categoryId, updatedAt",
      budgets: "id, userId, ym, categoryId",
      debts: "id, userId, updatedAt",
      loansGiven: "id, userId, updatedAt",
      heldLiabilities: "id, userId, status, updatedAt",
      goals: "id, userId",
      investments: "id, userId",
      buyEvaluations: "id, userId, updatedAt",
      syncQueue: "++id, createdAt",
    });
    await legacyDb.open();
    await legacyDb.table("investments").put({
      id: "inv-2",
      userId: "user-1",
      type: 6,
      name: "Already Migrated Shape",
      investedPoisha: 50_000,
      projectStartDate: "2025-06-01",
      status: INVESTMENT_STATUS.COMPLETED,
      declaredProfitPoisha: 5_000,
      createdAt: "2025-06-01T00:00:00Z",
      updatedAt: "2025-06-01T00:00:00Z",
    });
    legacyDb.close();

    const db = getDb();
    await db.open();

    const migrated = await db.investments.get("inv-2");
    expect(migrated?.projectStartDate).toBe("2025-06-01");
    expect(migrated?.status).toBe(INVESTMENT_STATUS.COMPLETED);
    expect(migrated?.declaredProfitPoisha).toBe(5_000);
  });
});
