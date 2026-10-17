import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Call = { method: string; table: string; args: unknown[] };
type Response = { data: unknown; error: { message: string; code?: string } | null };

const calls: Call[] = [];
// Per-table queue of responses for awaited queries (select/update); falls
// back to an empty success when exhausted.
const responses: Record<string, Response[]> = {};
const upsertErrorFor = new Set<string>();

function makeChain(table: string) {
  const record = (method: string, args: unknown[]) => calls.push({ method, table, args });
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "gt", "gte", "lt", "is", "or", "order", "in", "limit", "update"]) {
    chain[m] = (...a: unknown[]) => {
      record(m, a);
      return chain;
    };
  }
  chain.upsert = (rows: unknown, opts?: unknown) => {
    record("upsert", [rows, opts]);
    return Promise.resolve({
      data: null,
      error: upsertErrorFor.has(table) ? { message: "boom", code: "500" } : null,
    });
  };
  chain.then = (resolve: (v: Response) => void) => {
    const next = responses[table]?.shift() ?? { data: [], error: null };
    resolve(next);
  };
  return chain;
}

vi.mock("@/infrastructure/supabase/client", () => ({
  createClient: () => ({ from: (table: string) => makeChain(table) }),
  isSupabaseConfigured: () => true,
}));

import { getDb, resetLocalDatabase } from "@/infrastructure/db/dexie/database";
import {
  collapseQueue,
  enqueueSync,
  forceFullResync,
  processSyncQueue,
  pruneBuyEvaluations,
  pullHistoricalTransactions,
  pullRemoteChangesWithStatus,
} from "@/infrastructure/sync/sync-queue";
import { SYNC_BATCH_SIZE, HISTORICAL_PULL_BATCH_SIZE } from "@/lib/constants";

const USER_ID = "user-1";
const GROUP_ID = "group-1";
const now = new Date().toISOString();

function upsertRows(table: string): Record<string, unknown>[] {
  return calls
    .filter((c) => c.method === "upsert" && c.table === table)
    .flatMap((c) => c.args[0] as Record<string, unknown>[]);
}

beforeEach(async () => {
  await resetLocalDatabase();
  calls.length = 0;
  for (const k of Object.keys(responses)) delete responses[k];
  upsertErrorFor.clear();
});

describe("push dedupe", () => {
  it("collapses duplicate upserts for one record into a single merged row and clears every entry", async () => {
    await enqueueSync("accounts", "a-1", "upsert", { name: "Cash", balance_poisha: 100 });
    await enqueueSync("accounts", "a-1", "upsert", { balance_poisha: 200 });
    await enqueueSync("accounts", "a-1", "upsert", { balance_poisha: 300 });
    await enqueueSync("accounts", "a-2", "upsert", { name: "Bank" });

    const result = await processSyncQueue(USER_ID);

    const rows = upsertRows("accounts");
    expect(rows).toHaveLength(2);
    const a1 = rows.find((r) => r.id === "a-1")!;
    expect(a1.name).toBe("Cash");
    expect(a1.balance_poisha).toBe(300);
    expect(result).toMatchObject({ pushed: 2, errors: 0 });
    expect(await getDb().syncQueue.count()).toBe(0);
  });

  it("keeps every collapsed entry queued when the push fails", async () => {
    upsertErrorFor.add("accounts");
    await enqueueSync("accounts", "a-1", "upsert", { name: "Cash" });
    await enqueueSync("accounts", "a-1", "upsert", { name: "Cash 2" });

    const result = await processSyncQueue(USER_ID);
    expect(result.errors).toBe(1);
    expect(await getDb().syncQueue.count()).toBe(2);
  });

  it("a later delete supersedes earlier upserts for the same record", async () => {
    await enqueueSync("goals", "g-1", "upsert", { name: "Trip" });
    await enqueueSync("goals", "g-1", "delete", { id: "g-1" });

    await processSyncQueue(USER_ID);

    expect(upsertRows("goals")).toHaveLength(0);
    const update = calls.find((c) => c.method === "update" && c.table === "goals");
    expect(update).toBeDefined();
    expect(calls.find((c) => c.method === "in" && c.table === "goals")?.args).toEqual(["id", ["g-1"]]);
    expect(await getDb().syncQueue.count()).toBe(0);
  });

  it("an upsert after a delete starts a fresh row (record recreated)", () => {
    const out = collapseQueue([
      { id: "1", table: "goals", recordId: "g-1", operation: "upsert", payload: { name: "Old", note: "x" }, createdAt: now },
      { id: "2", table: "goals", recordId: "g-1", operation: "delete", payload: {}, createdAt: now },
      { id: "3", table: "goals", recordId: "g-1", operation: "upsert", payload: { name: "New" }, createdAt: now },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].operation).toBe("upsert");
    expect(out[0].payload).toEqual({ name: "New" });
    expect(out[0].queueIds).toEqual(["1", "2", "3"]);
  });
});

describe("push scope", () => {
  it("keeps the record's own user_id and group_id from the payload", async () => {
    await enqueueSync("transactions", "t-1", "upsert", { user_id: "teammate", group_id: GROUP_ID, amount_poisha: 5 });
    await enqueueSync("transactions", "t-2", "upsert", { group_id: null, amount_poisha: 6 });

    // Pushing while in the group must not re-scope either row.
    await processSyncQueue(USER_ID, GROUP_ID);

    const rows = upsertRows("transactions");
    const t1 = rows.find((r) => r.id === "t-1")!;
    const t2 = rows.find((r) => r.id === "t-2")!;
    expect(t1.user_id).toBe("teammate");
    expect(t1.group_id).toBe(GROUP_ID);
    expect(t2.user_id).toBe(USER_ID);
    expect(t2.group_id).toBeNull();
  });

  it("falls back to the local row's scope when the payload omits it", async () => {
    await getDb().goals.put({
      id: "g-1", userId: "teammate", groupId: GROUP_ID, name: "Trip", targetPoisha: 1, savedPoisha: 0,
      createdAt: now, updatedAt: now,
    } as never);
    await enqueueSync("goals", "g-1", "upsert", { saved_poisha: 10 });

    await processSyncQueue(USER_ID, null);

    const [row] = upsertRows("goals");
    expect(row.user_id).toBe("teammate");
    expect(row.group_id).toBe(GROUP_ID);
  });

  it("never sends group_id for non-group-scoped tables", async () => {
    await enqueueSync("user_profiles", "p-1", "upsert", { locale: "bn", group_id: GROUP_ID });
    await processSyncQueue(USER_ID, GROUP_ID);
    const [row] = upsertRows("user_profiles");
    expect("group_id" in row).toBe(false);
  });

  it("filters deletes by id only, not by group_id or user_id", async () => {
    await enqueueSync("transactions", "t-1", "delete", { id: "t-1" });
    await processSyncQueue(USER_ID, GROUP_ID);

    const eqs = calls.filter((c) => c.method === "eq" && c.table === "transactions");
    expect(eqs).toHaveLength(0);
    expect(calls.find((c) => c.method === "in" && c.table === "transactions")?.args).toEqual(["id", ["t-1"]]);
  });

  it("budgets always upsert on the budget_scope conflict target, personal or shared", async () => {
    await enqueueSync("budgets", "b-1", "upsert", { category_id: "food", ym_char6: "202610", group_id: null });
    await enqueueSync("budgets", "b-2", "upsert", { category_id: "rent", ym_char6: "202610", group_id: GROUP_ID });
    await processSyncQueue(USER_ID, GROUP_ID);

    const upserts = calls.filter((c) => c.method === "upsert" && c.table === "budgets");
    expect(upserts.length).toBeGreaterThan(0);
    for (const u of upserts) {
      expect(u.args[1]).toEqual({ onConflict: "budget_scope,ym_char6,category_id" });
    }
    for (const row of upsertRows("budgets")) expect("budget_scope" in row).toBe(false);
  });
});

describe("pull", () => {
  it("reports failure instead of swallowing it", async () => {
    responses.accounts = [{ data: null, error: { message: "network down" } }];

    const result = await pullRemoteChangesWithStatus(USER_ID, null, "2026-01-01T00:00:00Z");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("network down");
  });

  it("forceFullResync surfaces the pull error", async () => {
    responses.goals = [{ data: null, error: { message: "timeout" } }];
    const result = await forceFullResync(USER_ID);
    expect(result.pullError).toBe("timeout");
  });

  it("is ok when every table pulls cleanly", async () => {
    const result = await pullRemoteChangesWithStatus(USER_ID, null, null);
    expect(result).toEqual({ pulled: 0, ok: true });
  });

  it("does not filter by group_id in group mode (RLS scopes personal + group rows)", async () => {
    await pullRemoteChangesWithStatus(USER_ID, GROUP_ID, null);
    const txFilters = calls.filter(
      (c) => c.table === "transactions" && (c.method === "eq" || c.method === "is")
    );
    expect(txFilters).toHaveLength(0);
  });

  it("pages with a compound (updated_at, id) cursor so equal timestamps aren't skipped", async () => {
    const ts = "2026-03-01T00:00:00.123456+00:00";
    const page = Array.from({ length: SYNC_BATCH_SIZE }, (_, i) => ({
      id: `g-${String(i).padStart(5, "0")}`, user_id: USER_ID, name: "x", target_poisha: 1, saved_poisha: 0,
      created_at: ts, updated_at: ts, deleted_at: null, group_id: null,
    }));
    responses.goals = [{ data: page, error: null }, { data: [], error: null }];

    const result = await pullRemoteChangesWithStatus(USER_ID, null, null);
    expect(result.ok).toBe(true);
    const orCall = calls.find((c) => c.method === "or" && c.table === "goals");
    const lastId = page[page.length - 1].id;
    expect(orCall?.args[0]).toBe(
      `updated_at.gt."${ts}",and(updated_at.eq."${ts}",id.gt."${lastId}")`
    );
  });

  it("historical pull reports an error status on failure", async () => {
    responses.transactions = [{ data: null, error: { message: "boom" } }];
    const result = await pullHistoricalTransactions(USER_ID, null, "2025-01-01");
    expect(result.error).toBe("boom");
    expect(result.count).toBe(0);
  });

  it("historical pull completes the oldest day of a full page", async () => {
    const page = Array.from({ length: HISTORICAL_PULL_BATCH_SIZE }, (_, i) => ({
      id: `t-${i}`, user_id: USER_ID, type_smallint: 2, amount_poisha: 1, account_id: "a", category_id: "food",
      tx_date: i === HISTORICAL_PULL_BATCH_SIZE - 1 ? "2024-12-01" : "2024-12-15",
      created_at: now, updated_at: now, deleted_at: null, group_id: null,
    }));
    const rest = [
      page[page.length - 1],
      { ...page[0], id: "t-extra", tx_date: "2024-12-01" },
    ];
    responses.transactions = [{ data: page, error: null }, { data: rest, error: null }];

    const result = await pullHistoricalTransactions(USER_ID, null, "2025-01-01");
    expect(result.oldestDate).toBe("2024-12-01");
    expect(result.count).toBe(HISTORICAL_PULL_BATCH_SIZE + 1);
    expect(await getDb().transactions.get("t-extra")).toBeDefined();
  });
});

describe("pruneBuyEvaluations", () => {
  it("enqueues a remote delete for every pruned evaluation", async () => {
    for (let i = 0; i < 22; i++) {
      await getDb().buyEvaluations.put({
        id: `e${i}`, userId: USER_ID, productName: "x", categoryId: "gadgets", pricePoisha: 100,
        priority: 1, score: 50, tier: 2, recommendation: 1, reasonCodes: [], createdAt: now,
        updatedAt: new Date(2026, 0, i + 1).toISOString(),
      });
    }

    await pruneBuyEvaluations(USER_ID);

    const queue = await getDb().syncQueue.toArray();
    const deletes = queue.filter((q) => q.table === "buy_evaluations" && q.operation === "delete");
    expect(deletes.map((d) => d.recordId).sort()).toEqual(["e0", "e1"]);
  });
});
