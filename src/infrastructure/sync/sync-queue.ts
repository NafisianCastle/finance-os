import { getDb } from "@/infrastructure/db/dexie/database";
import { MAX_SYNC_BUY_EVALS, SYNC_BATCH_SIZE } from "@/lib/constants";
import { createClient } from "@/infrastructure/supabase/client";
import type { BuyEvaluation } from "@/infrastructure/db/dexie/schema";

// Tables with a unique constraint other than the primary key — Supabase's
// upsert() defaults to conflict-resolving on the primary key only, so any
// other unique constraint must be named explicitly or upserts 23505 instead
// of updating the existing row.
const UNIQUE_CONFLICT_TARGETS: Record<string, string> = {
  budgets: "user_id,ym_char6,category_id",
  user_profiles: "user_id",
};

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
 * Re-enqueues full account/profile rows and drops any stale queued entries for
 * those tables. Needed for users seeded before seed.ts started pushing full
 * rows (previously only partial account balance diffs were queued, which fail
 * NOT NULL constraints on first remote insert). Categories are intentionally
 * excluded: system category ids are slugs ("food", "transport", ...) but the
 * remote categories table's id column is uuid, so they aren't syncable, and
 * transactions/budgets reference the category by slug string, not FK.
 */
export async function repairAccountSync(userId: string) {
  const db = getDb();
  // "categories" is included here purely to purge already-queued entries from
  // a previous buggy repair run; it's never re-enqueued below.
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

    // System categories use slug ids ("food", "transport", ...) which can
    // never satisfy the remote categories table's uuid id column. Drop any
    // queued entries instead of retrying forever.
    if (table === "categories") {
      if (item.id) await db.syncQueue.delete(item.id);
      continue;
    }

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
      const onConflict = UNIQUE_CONFLICT_TARGETS[table];
      const { error } = onConflict
        ? await supabase.from(table).upsert(row, { onConflict })
        : await supabase.from(table).upsert(row);
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

// Remote (snake_case Supabase row) → local (camelCase Dexie row) mappers.
// Categories are excluded: system category ids are slugs, not syncable (see
// repairAccountSync comment above).
const REMOTE_MAPPERS: Record<
  string,
  (row: Record<string, unknown>) => Record<string, unknown>
> = {
  user_profiles: (r) => ({
    id: r.id,
    userId: r.user_id,
    monthlyIncomePoisha: r.monthly_income_poisha,
    currencyCode: r.currency_code,
    locale: r.locale,
    emergencyMonths: r.emergency_months,
    onboardingComplete: r.onboarding_complete,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at,
  }),
  accounts: (r) => ({
    id: r.id,
    userId: r.user_id,
    type: r.type_smallint,
    name: r.name,
    balancePoisha: r.balance_poisha,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at,
  }),
  transactions: (r) => ({
    id: r.id,
    userId: r.user_id,
    type: r.type_smallint,
    amountPoisha: r.amount_poisha,
    accountId: r.account_id,
    toAccountId: r.to_account_id,
    categoryId: r.category_id,
    date: r.tx_date,
    note: r.note,
    tags: r.tags,
    merchant: r.merchant,
    recurringId: r.recurring_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at,
  }),
  budgets: (r) => ({
    id: r.id,
    userId: r.user_id,
    ym: r.ym_char6,
    categoryId: r.category_id,
    allocatedPoisha: r.allocated_poisha,
    carryPoisha: r.carry_poisha,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at,
  }),
  debts: (r) => ({
    id: r.id,
    userId: r.user_id,
    lender: r.lender,
    principalPoisha: r.principal_poisha,
    interestRate: r.interest_rate,
    remainingPoisha: r.remaining_poisha,
    borrowDate: r.borrow_date,
    dueDate: r.due_date,
    status: r.status_smallint,
    note: r.note,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at,
  }),
  loans_given: (r) => ({
    id: r.id,
    userId: r.user_id,
    borrower: r.borrower,
    amountPoisha: r.amount_poisha,
    remainingPoisha: r.remaining_poisha,
    borrowDate: r.borrow_date,
    dueDate: r.due_date,
    status: r.status_smallint,
    note: r.note,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at,
  }),
  held_liabilities: (r) => ({
    id: r.id,
    userId: r.user_id,
    owner: r.owner,
    amountPoisha: r.amount_poisha,
    holdDate: r.hold_date,
    returnDate: r.return_date,
    purpose: r.purpose,
    status: r.status_smallint,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at,
  }),
  goals: (r) => ({
    id: r.id,
    userId: r.user_id,
    name: r.name,
    targetPoisha: r.target_poisha,
    savedPoisha: r.saved_poisha,
    deadline: r.deadline,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at,
  }),
  investments: (r) => ({
    id: r.id,
    userId: r.user_id,
    type: r.type_smallint,
    name: r.name,
    investorName: r.investor_name,
    investedPoisha: r.invested_poisha,
    currentValuePoisha: r.current_value_poisha,
    projectStartDate: r.project_start_date,
    projectEndDate: r.project_end_date,
    declaredProfitPoisha: r.declared_profit_poisha,
    quantity: r.quantity,
    pricePerUnitPoisha: r.price_per_unit_poisha,
    interestRatePct: r.interest_rate_pct,
    purity: r.purity,
    status: r.status_smallint,
    note: r.note,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at,
  }),
  investment_events: (r) => ({
    id: r.id,
    userId: r.user_id,
    investmentId: r.investment_id,
    type: r.type_smallint,
    amountPoisha: r.amount_poisha,
    eventDate: r.event_date,
    note: r.note,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at,
  }),
  buy_evaluations: (r) => ({
    id: r.id,
    userId: r.user_id,
    productName: r.product_name,
    categoryId: r.category_id,
    pricePoisha: r.price_poisha,
    priority: r.priority,
    score: r.score,
    tier: r.tier,
    recommendation: r.recommendation,
    reasonCodes: r.reason_codes,
    saveMonths: r.save_months,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at,
  }),
};

// Dexie table name for each remote table.
const LOCAL_TABLES: Record<string, keyof ReturnType<typeof getDb>> = {
  user_profiles: "userProfiles",
  accounts: "accounts",
  transactions: "transactions",
  budgets: "budgets",
  debts: "debts",
  loans_given: "loansGiven",
  held_liabilities: "heldLiabilities",
  goals: "goals",
  investments: "investments",
  investment_events: "investmentEvents",
  buy_evaluations: "buyEvaluations",
};

/**
 * Pulls remote rows changed since lastSyncedAt and merges them into Dexie,
 * last-write-wins by updated_at. A remote row only overwrites a local row
 * when it's strictly newer; otherwise the local (possibly still-queued)
 * edit is left alone so it can be pushed later. Categories aren't synced
 * (see repairAccountSync comment).
 */
export async function pullRemoteChanges(
  userId: string,
  lastSyncedAt: string | null
): Promise<number> {
  const supabase = createClient();
  if (!supabase) return 0;

  const db = getDb();
  let count = 0;
  const since = lastSyncedAt ?? "1970-01-01T00:00:00Z";

  for (const [table, mapper] of Object.entries(REMOTE_MAPPERS)) {
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .eq("user_id", userId)
      .gt("updated_at", since)
      .limit(SYNC_BATCH_SIZE);

    if (error || !data) continue;

    const localTableName = LOCAL_TABLES[table];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const localTable = (db as any)[localTableName];

    for (const remoteRow of data) {
      const mapped = mapper(remoteRow) as { id: string; updatedAt: string };
      const existing = await localTable.get(mapped.id);
      if (existing && existing.updatedAt >= mapped.updatedAt) continue;

      await localTable.put(mapped);
      // A newer remote row supersedes any stale queued local edit for it.
      await db.syncQueue
        .filter((item) => item.table === table && item.recordId === mapped.id)
        .delete();
      count++;
    }
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
