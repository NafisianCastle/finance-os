import { v4 as uuid } from "uuid";
import { getDb } from "@/infrastructure/db/dexie/database";
import { DEFAULT_CURRENCY, DEFAULT_LOCALE, SYSTEM_CATEGORIES } from "@/lib/constants";
import { majorToMinorUnits } from "@/lib/money";
import type { UserProfile, Account, Category } from "@/infrastructure/db/dexie/schema";
import { enqueueSync, pullRemoteChanges } from "@/infrastructure/sync/sync-queue";
import { isSupabaseConfigured } from "@/infrastructure/supabase/client";

export async function seedUserData(
  userId: string,
  monthlyIncome: number,
  currencyCode: string = DEFAULT_CURRENCY,
  locale: string = DEFAULT_LOCALE
) {
  const db = getDb();
  const now = new Date().toISOString();

  let existing = await db.userProfiles.where("userId").equals(userId).first();

  // Local Dexie is empty on a fresh browser/device — pull from Supabase before
  // seeding fresh default accounts, otherwise a user who already onboarded on
  // another browser gets duplicate "Cash"/"Bank" accounts created here.
  if (!existing?.onboardingComplete && isSupabaseConfigured()) {
    await pullRemoteChanges(userId, null);
    existing = await db.userProfiles.where("userId").equals(userId).first();
  }

  if (existing?.onboardingComplete) return existing;

  const profile: UserProfile = {
    id: uuid(),
    userId,
    monthlyIncomePoisha: majorToMinorUnits(monthlyIncome, currencyCode),
    currencyCode,
    locale,
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
      balancePoisha: 0,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: uuid(),
      userId,
      type: 2,
      name: "Bank",
      balancePoisha: 0,
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

  await enqueueSync("user_profiles", profile.id, "upsert", {
    id: profile.id,
    monthly_income_poisha: profile.monthlyIncomePoisha,
    currency_code: profile.currencyCode,
    locale: profile.locale,
    emergency_months: profile.emergencyMonths,
    onboarding_complete: profile.onboardingComplete,
  });

  for (const acc of accounts) {
    await enqueueSync("accounts", acc.id, "upsert", {
      id: acc.id,
      type_smallint: acc.type,
      name: acc.name,
      balance_poisha: acc.balancePoisha,
    });
  }

  // System categories use slug ids ("food", "transport", ...) but the remote
  // categories table's id column is uuid — not syncable, and unnecessary since
  // transactions/budgets reference the category by slug string, not FK.

  return profile;
}
