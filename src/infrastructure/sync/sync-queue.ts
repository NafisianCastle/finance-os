import { getDb } from "@/infrastructure/db/dexie/database";
import {
  HISTORICAL_PULL_BATCH_SIZE,
  MAX_SYNC_BUY_EVALS,
  SYNC_BATCH_SIZE,
  SYNC_WINDOW_DAYS,
} from "@/lib/constants";
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

// Cap per-request batch size — condenses dozens of queued mutations (e.g.
// after a day offline) into a handful of HTTP round-trips instead of one
// request per item, cutting network overhead and battery drain on reconnect.
const SYNC_CHUNK_SIZE = 50;

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

  const syncable: typeof items = [];
  for (const item of items) {
    // System categories use slug ids ("food", "transport", ...) which can
    // never satisfy the remote categories table's uuid id column. Drop any
    // queued entries instead of retrying forever.
    if (item.table === "categories") {
      if (item.id) await db.syncQueue.delete(item.id);
      continue;
    }
    syncable.push(item);
  }

  // Group by table+operation — each group can be sent as one batched request.
  const groups = new Map<string, typeof items>();
  for (const item of syncable) {
    const key = `${item.table}|${item.operation}`;
    const list = groups.get(key) ?? [];
    list.push(item);
    groups.set(key, list);
  }

  for (const [key, groupItems] of groups) {
    const [table, operation] = key.split("|") as [string, "upsert" | "delete"];

    for (let i = 0; i < groupItems.length; i += SYNC_CHUNK_SIZE) {
      const chunk = groupItems.slice(i, i + SYNC_CHUNK_SIZE);
      const now = new Date().toISOString();

      const { error } =
        operation === "delete"
          ? await supabase
              .from(table)
              .update({ deleted_at: now })
              .in("id", chunk.map((c) => c.recordId))
              .eq("user_id", userId)
          : await (() => {
              const rows = chunk.map((c) => ({ ...c.payload, id: c.recordId, user_id: userId, updated_at: now }));
              const onConflict = UNIQUE_CONFLICT_TARGETS[table];
              return onConflict
                ? supabase.from(table).upsert(rows, { onConflict })
                : supabase.from(table).upsert(rows);
            })();

      if (error) {
        errors += chunk.length;
        lastError = error.message || error.code || error.details || "unknown error";
        console.error(
          `Batch sync ${operation} failed for ${table} (${chunk.length} items): code=${error.code} message=${error.message} details=${error.details} hint=${error.hint}`,
        );
      } else {
        pushed += chunk.length;
        const localIds = chunk.map((c) => c.id).filter((id): id is string => !!id);
        await db.syncQueue.bulkDelete(localIds);
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
  const isInitialHydration = lastSyncedAt === null;
  const since = lastSyncedAt ?? "1970-01-01T00:00:00Z";
  const windowCutoff = new Date(
    Date.now() - SYNC_WINDOW_DAYS * 24 * 60 * 60 * 1000
  )
    .toISOString()
    .slice(0, 10);

  for (const [table, mapper] of Object.entries(REMOTE_MAPPERS)) {
    const localTableName = LOCAL_TABLES[table];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const localTable = (db as any)[localTableName];

    // Page through in updated_at order until a page comes back under the
    // batch size — a plain .limit() with no pagination silently drops any
    // rows past the cap and this loop's caller advances lastSyncedAt
    // regardless, so under-paging here means permanent data loss for users
    // with >SYNC_BATCH_SIZE changes since their last sync.
    let cursor = since;
    for (;;) {
      let query = supabase
        .from(table)
        .select("*")
        .eq("user_id", userId)
        .gt("updated_at", cursor)
        .order("updated_at", { ascending: true })
        .limit(SYNC_BATCH_SIZE);

      // New-device hydration: keep transactions to a recent rolling window so
      // the first sync stays fast; older months load lazily on demand (see
      // pullHistoricalTransactions).
      if (isInitialHydration && table === "transactions") {
        query = query.gte("tx_date", windowCutoff);
      }

      const { data, error } = await query;
      if (error || !data) break;

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

      if (data.length < SYNC_BATCH_SIZE) break;
      cursor = (mapper(data[data.length - 1]) as { updatedAt: string }).updatedAt;
    }
  }

  return count;
}

/**
 * Lazily pulls transactions older than `beforeDate` (default: the sync
 * window cutoff used by pullRemoteChanges), one page at a time. Call when
 * the user browses further back than the initial hydration window covers
 * (e.g. paging into older reports). Returns the count pulled and the oldest
 * tx_date seen, so the caller can request the next older page.
 */
export async function pullHistoricalTransactions(
  userId: string,
  beforeDate?: string
): Promise<{ count: number; oldestDate: string | null }> {
  const supabase = createClient();
  if (!supabase) return { count: 0, oldestDate: null };

  const db = getDb();
  const cutoff =
    beforeDate ??
    new Date(Date.now() - SYNC_WINDOW_DAYS * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

  const { data, error } = await supabase
    .from("transactions")
    .select("*")
    .eq("user_id", userId)
    .lt("tx_date", cutoff)
    .order("tx_date", { ascending: false })
    .limit(HISTORICAL_PULL_BATCH_SIZE);

  if (error || !data || data.length === 0) return { count: 0, oldestDate: null };

  const mapper = REMOTE_MAPPERS.transactions;
  const localTable = db.transactions;
  let count = 0;
  let oldestDate: string | null = null;

  for (const remoteRow of data) {
    const mapped = mapper(remoteRow) as {
      id: string;
      updatedAt: string;
      date: string;
    };
    const existing = await localTable.get(mapped.id);
    if (!existing || existing.updatedAt < mapped.updatedAt) {
      await localTable.put(mapped as never);
      count++;
    }
    if (!oldestDate || mapped.date < oldestDate) oldestDate = mapped.date;
  }

  return { count, oldestDate };
}

/**
 * Merges accounts that were duplicated by the pre-fix onboarding bug (each
 * new browser re-seeded its own "Cash"/"Bank" with fresh uuids instead of
 * pulling the existing ones). Groups remote accounts by name+type, keeps the
 * oldest per group, sums balances into it, re-points transactions, and soft
 * deletes the rest. Runs directly against Supabase since it needs a full
 * cross-device view; local Dexie is refreshed via pullRemoteChanges after.
 */
export async function mergeDuplicateAccounts(
  userId: string
): Promise<{ merged: number; groups: number }> {
  const supabase = createClient();
  if (!supabase) return { merged: 0, groups: 0 };

  const { data: accounts, error } = await supabase
    .from("accounts")
    .select("*")
    .eq("user_id", userId)
    .is("deleted_at", null);
  if (error || !accounts) return { merged: 0, groups: 0 };

  const groups = new Map<string, typeof accounts>();
  for (const acc of accounts) {
    const key = `${(acc.name as string).trim().toLowerCase()}|${acc.type_smallint}`;
    const list = groups.get(key) ?? [];
    list.push(acc);
    groups.set(key, list);
  }

  let merged = 0;
  let groupsAffected = 0;
  const now = new Date().toISOString();

  for (const group of groups.values()) {
    if (group.length < 2) continue;
    groupsAffected++;

    const sorted = [...group].sort(
      (a, b) => new Date(a.created_at as string).getTime() - new Date(b.created_at as string).getTime()
    );
    const canonical = sorted[0];
    const dupes = sorted.slice(1);
    const totalBalance = group.reduce((sum, a) => sum + Number(a.balance_poisha), 0);

    for (const dupe of dupes) {
      await supabase
        .from("transactions")
        .update({ account_id: canonical.id, updated_at: now })
        .eq("user_id", userId)
        .eq("account_id", dupe.id);
      await supabase
        .from("transactions")
        .update({ to_account_id: canonical.id, updated_at: now })
        .eq("user_id", userId)
        .eq("to_account_id", dupe.id);
      await supabase
        .from("accounts")
        .update({ deleted_at: now, updated_at: now })
        .eq("user_id", userId)
        .eq("id", dupe.id);
      merged++;
    }

    await supabase
      .from("accounts")
      .update({ balance_poisha: totalBalance, updated_at: now })
      .eq("user_id", userId)
      .eq("id", canonical.id);
  }

  if (groupsAffected > 0) {
    // Remote is now the source of truth for accounts/transactions — drop any
    // queued local edits referencing merged accounts so they don't get
    // re-pushed over the merge, then refresh Dexie from the merged state.
    const db = getDb();
    await db.syncQueue.filter((i) => i.table === "accounts" || i.table === "transactions").delete();
    await pullRemoteChanges(userId, null);
  }

  return { merged, groups: groupsAffected };
}

/**
 * Merges goals duplicated by the same onboarding-style race as
 * mergeDuplicateAccounts: goals have no unique constraint on the server, so
 * a fresh browser re-creating a goal with a new uuid produced real duplicate
 * rows remotely. Groups by name, keeps the oldest per group, sums saved
 * amounts into it, and soft deletes the rest. No other table references
 * goals by id, so there's nothing to re-point.
 */
export async function mergeDuplicateGoals(
  userId: string
): Promise<{ merged: number; groups: number }> {
  const supabase = createClient();
  if (!supabase) return { merged: 0, groups: 0 };

  const { data: goals, error } = await supabase
    .from("goals")
    .select("*")
    .eq("user_id", userId)
    .is("deleted_at", null);
  if (error || !goals) return { merged: 0, groups: 0 };

  const groups = new Map<string, typeof goals>();
  for (const goal of goals) {
    const key = (goal.name as string).trim().toLowerCase();
    const list = groups.get(key) ?? [];
    list.push(goal);
    groups.set(key, list);
  }

  let merged = 0;
  let groupsAffected = 0;
  const now = new Date().toISOString();

  for (const group of groups.values()) {
    if (group.length < 2) continue;
    groupsAffected++;

    const sorted = [...group].sort(
      (a, b) => new Date(a.created_at as string).getTime() - new Date(b.created_at as string).getTime()
    );
    const canonical = sorted[0];
    const dupes = sorted.slice(1);
    const totalSaved = group.reduce((sum, g) => sum + Number(g.saved_poisha), 0);

    for (const dupe of dupes) {
      await supabase
        .from("goals")
        .update({ deleted_at: now, updated_at: now })
        .eq("user_id", userId)
        .eq("id", dupe.id);
      merged++;
    }

    await supabase
      .from("goals")
      .update({ saved_poisha: totalSaved, updated_at: now })
      .eq("user_id", userId)
      .eq("id", canonical.id);
  }

  if (groupsAffected > 0) {
    const db = getDb();
    await db.syncQueue.filter((i) => i.table === "goals").delete();
    await pullRemoteChanges(userId, null);
  }

  return { merged, groups: groupsAffected };
}

/**
 * Fixes local budget duplicates caused by the same onboarding-style race as
 * mergeDuplicateAccounts: a fresh browser's empty local Dexie made
 * applySuggestions/addBudget think no budget existed for a category yet, so
 * it created one with a new uuid. The remote `budgets` table has a
 * unique(user_id, ym_char6, category_id) constraint and the push path
 * upserts on that key, so the server was never actually duplicated — only
 * the local cache holds two id'd rows for the same category+month. Fix is
 * just: drop the local cache and re-pull the already-correct server state.
 */
export async function repairLocalBudgets(userId: string): Promise<void> {
  const db = getDb();
  const local = await db.budgets.where("userId").equals(userId).toArray();
  await db.budgets.bulkDelete(local.map((b) => b.id));
  await db.syncQueue.filter((i) => i.table === "budgets").delete();
  await pullRemoteChanges(userId, null);
}

/**
 * Escape hatch for a broken sync loop: forces a full push of anything
 * queued, then a full pull ignoring the lastSyncedAt checkpoint, so the
 * device fully reconciles against Supabase instead of trusting whatever
 * partial state it's stuck in.
 */
export async function forceFullResync(
  userId: string
): Promise<{ pushed: number; errors: number; pulled: number }> {
  const { pushed, errors } = await processSyncQueue(userId);
  const pulled = await pullRemoteChanges(userId, null);
  return { pushed, errors, pulled };
}

const EXPORTABLE_TABLES = [
  "userProfiles",
  "accounts",
  "categories",
  "transactions",
  "budgets",
  "debts",
  "loansGiven",
  "heldLiabilities",
  "goals",
  "investments",
  "investmentEvents",
  "buyEvaluations",
] as const;

/**
 * Dumps every local table's rows for this user into a plain JSON object —
 * the escape hatch if sync is broken: the user's full ledger is never
 * trapped behind a working sync pipeline, they can always get it out.
 */
export async function exportUserDataAsJson(userId: string): Promise<Record<string, unknown[]>> {
  const db = getDb();
  const out: Record<string, unknown[]> = {};
  for (const table of EXPORTABLE_TABLES) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = await (db as any)[table].where("userId").equals(userId).toArray();
    out[table] = rows;
  }
  return out;
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
