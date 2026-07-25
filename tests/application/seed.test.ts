import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/infrastructure/supabase/client", () => ({
  isSupabaseConfigured: () => false,
}));

import { getDb, resetLocalDatabase } from "@/infrastructure/db/dexie/database";
import { seedUserData } from "@/application/seed";
import { SYSTEM_CATEGORIES } from "@/lib/constants";

const USER_ID = "user-1";

describe("seedUserData", () => {
  beforeEach(async () => {
    await resetLocalDatabase();
  });

  it("creates a profile, two default accounts, and system categories", async () => {
    const profile = await seedUserData(USER_ID, 20_000, "BDT", "en");

    expect(profile.onboardingComplete).toBe(true);
    expect(profile.monthlyIncomePoisha).toBe(2_000_000);

    const accounts = await getDb().accounts.where("userId").equals(USER_ID).toArray();
    expect(accounts.map((a) => a.name).sort()).toEqual(["Bank", "Cash"]);

    const categories = await getDb().categories.where("userId").equals(USER_ID).toArray();
    expect(categories).toHaveLength(SYSTEM_CATEGORIES.length);
  });

  it("queues sync entries for the profile and each account", async () => {
    await seedUserData(USER_ID, 20_000, "BDT", "en");
    const queued = await getDb().syncQueue.toArray();
    const tables = queued.map((q) => q.table);
    expect(tables).toContain("user_profiles");
    expect(tables.filter((t) => t === "accounts")).toHaveLength(2);
  });

  it("is idempotent — does not reseed if onboarding is already complete", async () => {
    const first = await seedUserData(USER_ID, 20_000, "BDT", "en");
    const second = await seedUserData(USER_ID, 99_999, "BDT", "en");

    expect(second.id).toBe(first.id);
    expect(second.monthlyIncomePoisha).toBe(first.monthlyIncomePoisha);
    const accounts = await getDb().accounts.where("userId").equals(USER_ID).toArray();
    expect(accounts).toHaveLength(2);
  });

  it("converts monthly income using the given currency's minor-unit precision", async () => {
    const profile = await seedUserData(USER_ID, 500, "JPY", "en");
    expect(profile.monthlyIncomePoisha).toBe(500);
  });
});
