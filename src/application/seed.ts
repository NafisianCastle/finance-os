import { v4 as uuid } from "uuid";
import { getDb } from "@/infrastructure/db/dexie/database";
import { SYSTEM_CATEGORIES } from "@/lib/constants";
import { bdtToPoisha } from "@/lib/money";
import type { UserProfile, Account, Category } from "@/infrastructure/db/dexie/schema";

export async function seedUserData(userId: string, monthlyIncomeBdt: number) {
  const db = getDb();
  const now = new Date().toISOString();

  const existing = await db.userProfiles.where("userId").equals(userId).first();
  if (existing?.onboardingComplete) return existing;

  const profile: UserProfile = {
    id: uuid(),
    userId,
    monthlyIncomePoisha: bdtToPoisha(monthlyIncomeBdt),
    currencyCode: "BDT",
    locale: "bn-BD",
    emergencyMonths: 3,
    onboardingComplete: true,
    createdAt: now,
    updatedAt: now,
  };

  const accounts: Account[] = [
    {
      id: uuid(),
      userId,
      type: 1,
      name: "Cash",
      balancePoisha: bdtToPoisha(5000),
      createdAt: now,
      updatedAt: now,
    },
    {
      id: uuid(),
      userId,
      type: 2,
      name: "Bank",
      balancePoisha: bdtToPoisha(15000),
      createdAt: now,
      updatedAt: now,
    },
  ];

  const categories: Category[] = SYSTEM_CATEGORIES.map((c) => ({
    id: c.id,
    userId,
    name: c.name,
    iconKey: c.icon,
    isSystem: true,
    createdAt: now,
    updatedAt: now,
  }));

  await db.transaction("rw", [db.userProfiles, db.accounts, db.categories], async () => {
    await db.userProfiles.put(profile as never);
    await db.accounts.bulkPut(accounts as never);
    await db.categories.bulkPut(categories as never);
  });

  return profile;
}
