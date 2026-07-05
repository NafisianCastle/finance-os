import { getDb } from "@/infrastructure/db/dexie/database";
import { MAX_SYNC_BUY_EVALS, SYNC_BATCH_SIZE } from "@/lib/constants";
import { createClient } from "@/infrastructure/supabase/client";
import type { BuyEvaluation } from "@/infrastructure/db/dexie/schema";

export async function enqueueSync(
  table: string,
  recordId: string,
  operation: "upsert" | "delete",
  payload: Record<string, unknown>
) {
  const db = getDb();
  await db.syncQueue.add({
    table,
    recordId,
    operation,
    payload: leanPayload(table, payload),
    createdAt: new Date().toISOString(),
  });
}

function leanPayload(table: string, payload: Record<string, unknown>): Record<string, unknown> {
  const p = { ...payload };
  if (typeof p.note === "string" && p.note.length > 200) {
    p.note = p.note.slice(0, 200);
  }
  if (table === "buy_evaluations" && Array.isArray(p.reasonCodes)) {
    p.reason_codes = p.reasonCodes;
    delete p.reasonCodes;
  }
  delete p.syncStatus;
  return p;
}

/**
 * Re-enqueues full account/profile/category rows and drops any stale queued
 * entries for those tables. Needed for users seeded before seed.ts started
 * pushing full rows (previously only partial account balance diffs were queued,
 * which fail NOT NULL constraints on first remote insert).
 */
export async function repairAccountSync(userId: string) {
  const db = getDb();
  const staleTables = new Set(["accounts", "user_profiles", "categories"]);
  await db.syncQueue.filter((item) => staleTables.has(item.table)).delete();

  const profile = await db.userProfiles.where("userId").equals(userId).first();
  if (profile) {
    await enqueueSync("user_profiles", profile.id, "upsert", {
      id: profile.id,
      monthly_income_poisha: profile.monthlyIncomePoisha,
      currency_code: profile.currencyCode,
      locale: profile.locale,
      emergency_months: profile.emergencyMonths,
      onboarding_complete: profile.onboardingComplete,
    });
  }

  const accounts = await db.accounts.where("userId").equals(userId).filter((a) => !a.deletedAt).toArray();
  for (const acc of accounts) {
    await enqueueSync("accounts", acc.id, "upsert", {
      id: acc.id,
      type_smallint: acc.type,
      name: acc.name,
      balance_poisha: acc.balancePoisha,
    });
  }

  const categories = await db.categories.where("userId").equals(userId).filter((c) => !c.deletedAt).toArray();
  for (const cat of categories) {
    await enqueueSync("categories", cat.id, "upsert", {
      id: cat.id,
      name: cat.name,
      icon_key: cat.iconKey,
    });
  }
}

export async function processSyncQueue(
  userId: string
): Promise<{ pushed: number; errors: number; lastError?: string }> {
  const supabase = createClient();
  if (!supabase) return { pushed: 0, errors: 0 };

  const db = getDb();
  const items = await db.syncQueue.orderBy("createdAt").limit(SYNC_BATCH_SIZE).toArray();
  let pushed = 0;
  let errors = 0;
  let lastError: string | undefined;

  for (const item of items) {
    const { table, operation, payload, recordId } = item;
    const row = { ...payload, id: recordId, user_id: userId, updated_at: new Date().toISOString() };

    if (operation === "delete") {
      const { error } = await supabase
        .from(table)
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", recordId)
        .eq("user_id", userId);
      if (error) {
        errors++;
        lastError = error.message || error.code || error.details || "unknown error";
        console.error(
          `Sync delete failed for ${table}/${recordId}: code=${error.code} message=${error.message} details=${error.details} hint=${error.hint}`,
        );
      } else {
        pushed++;
        if (item.id) await db.syncQueue.delete(item.id);
      }
    } else {
      const { error } = await supabase.from(table).upsert(row);
      if (error) {
        errors++;
        lastError = error.message || error.code || error.details || "unknown error";
        console.error(
          `Sync upsert failed for ${table}/${recordId}: code=${error.code} message=${error.message} details=${error.details} hint=${error.hint}`,
        );
      } else {
        pushed++;
        if (item.id) await db.syncQueue.delete(item.id);
      }
    }
  }

  return { pushed, errors, lastError };
}

export async function pullRemoteChanges(
  userId: string,
  lastSyncedAt: string | null
): Promise<number> {
  const supabase = createClient();
  if (!supabase) return 0;

  const tables = [
    "accounts",
    "transactions",
    "categories",
    "budgets",
    "debts",
    "loans_given",
    "held_liabilities",
    "goals",
    "investments",
    "investment_events",
    "buy_evaluations",
    "user_profiles",
  ] as const;

  const db = getDb();
  let count = 0;
  const since = lastSyncedAt ?? "1970-01-01T00:00:00Z";

  for (const table of tables) {
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .eq("user_id", userId)
      .gt("updated_at", since)
      .limit(SYNC_BATCH_SIZE);

    if (error || !data) continue;
    count += data.length;
    // Map remote → local in sync mapper (simplified: skip if no supabase configured)
  }

  return count;
}

export async function pruneBuyEvaluations(userId: string) {
  const db = getDb();
  const all = await db.buyEvaluations
    .where("userId")
    .equals(userId)
    .sortBy("updatedAt");
  if (all.length <= MAX_SYNC_BUY_EVALS) return;
  const toRemove = all.slice(0, all.length - MAX_SYNC_BUY_EVALS);
  for (const rec of toRemove) {
    await db.buyEvaluations.delete(rec.id);
  }
}

export function toLeanBuyEval(eval_: BuyEvaluation): Record<string, unknown> {
  return {
    id: eval_.id,
    product_name: eval_.productName.slice(0, 80),
    category_id: eval_.categoryId,
    price_poisha: eval_.pricePoisha,
    priority: eval_.priority,
    score: eval_.score,
    tier: eval_.tier,
    recommendation: eval_.recommendation,
    reason_codes: eval_.reasonCodes,
    save_months: eval_.saveMonths ?? null,
    updated_at: eval_.updatedAt,
  };
}
