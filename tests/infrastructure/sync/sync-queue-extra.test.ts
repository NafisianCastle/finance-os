import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Call = { method: string; table: string; args: unknown[] };

function createSupabaseMock(config: {
  data?: Record<string, unknown[]>;
  errorFor?: Set<string>;
}) {
  const calls: Call[] = [];
  function makeChain(table: string) {
    const record = (method: string, args: unknown[]) => calls.push({ method, table, args });
    const chain = {
      select: (...a: unknown[]) => { record("select", a); return chain; },
      eq: (...a: unknown[]) => { record("eq", a); return chain; },
      gt: (...a: unknown[]) => { record("gt", a); return chain; },
      gte: (...a: unknown[]) => { record("gte", a); return chain; },
      lt: (...a: unknown[]) => { record("lt", a); return chain; },
      is: (...a: unknown[]) => { record("is", a); return chain; },
      order: (...a: unknown[]) => { record("order", a); return chain; },
      in: (...a: unknown[]) => { record("in", a); return chain; },
      limit: (...a: unknown[]) => { record("limit", a); return chain; },
      update: (payload: unknown) => {
        record("update", [payload]);
        return chain;
      },
      upsert: (rows: unknown, opts?: unknown) => {
        record("upsert", [rows, opts]);
        const error = config.errorFor?.has(table) ? { message: "boom", code: "500" } : null;
        return Promise.resolve({ data: null, error });
      },
      then: (resolve: (v: { data: unknown; error: unknown }) => void) => {
        const error = config.errorFor?.has(table) ? { message: "boom", code: "500" } : null;
        resolve({ data: error ? null : config.data?.[table] ?? [], error });
      },
    };
    return chain;
  }
  return { calls, client: { from: (table: string) => makeChain(table) } };
}

const mockState: { client: ReturnType<typeof createSupabaseMock>["client"] | null } = { client: null };

vi.mock("@/infrastructure/supabase/client", () => ({
  createClient: () => mockState.client,
}));

import { getDb, resetLocalDatabase } from "@/infrastructure/db/dexie/database";
import {
  enqueueSync,
  processSyncQueue,
  repairAccountSync,
  mergeDuplicateAccounts,
  mergeDuplicateGoals,
  repairLocalBudgets,
  forceFullResync,
  exportUserDataAsJson,
  pruneBuyEvaluations,
  toLeanBuyEval,
  pullHistoricalTransactions,
} from "@/infrastructure/sync/sync-queue";
import type { Account, UserProfile, BuyEvaluation } from "@/infrastructure/db/dexie/schema";

const USER_ID = "user-1";
const now = new Date().toISOString();

beforeEach(async () => {
  await resetLocalDatabase();
  mockState.client = null;
});

describe("enqueueSync / leanPayload", () => {
  it("truncates an overlong note to 200 chars", async () => {
    const longNote = "x".repeat(300);
    await enqueueSync("transactions", "tx-1", "upsert", { note: longNote });
    const [item] = await getDb().syncQueue.toArray();
    expect((item.payload.note as string).length).toBe(200);
  });

  it("renames reasonCodes to reason_codes for buy_evaluations", async () => {
    await enqueueSync("buy_evaluations", "b-1", "upsert", { reasonCodes: [1, 2] });
    const [item] = await getDb().syncQueue.toArray();
    expect(item.payload.reason_codes).toEqual([1, 2]);
    expect(item.payload.reasonCodes).toBeUndefined();
  });

  it("strips syncStatus from the payload", async () => {
    await enqueueSync("accounts", "a-1", "upsert", { syncStatus: "pending", name: "Cash" });
    const [item] = await getDb().syncQueue.toArray();
    expect(item.payload.syncStatus).toBeUndefined();
    expect(item.payload.name).toBe("Cash");
  });
});

describe("processSyncQueue", () => {
  it("returns zero counts when Supabase isn't configured", async () => {
    await enqueueSync("accounts", "a-1", "upsert", { name: "Cash" });
    const result = await processSyncQueue(USER_ID);
    expect(result).toEqual({ pushed: 0, errors: 0 });
  });

  it("pushes queued upserts and clears them from the queue on success", async () => {
    const mock = createSupabaseMock({});
    mockState.client = mock.client;
    await enqueueSync("accounts", "a-1", "upsert", { name: "Cash" });

    const result = await processSyncQueue(USER_ID);
    expect(result.pushed).toBe(1);
    expect(result.errors).toBe(0);
    expect(await getDb().syncQueue.count()).toBe(0);
  });

  it("keeps queued items and reports an error when the push fails", async () => {
    const mock = createSupabaseMock({ errorFor: new Set(["accounts"]) });
    mockState.client = mock.client;
    await enqueueSync("accounts", "a-1", "upsert", { name: "Cash" });

    const result = await processSyncQueue(USER_ID);
    expect(result.errors).toBe(1);
    expect(result.pushed).toBe(0);
    expect(await getDb().syncQueue.count()).toBe(1);
  });

  it("drops queued category entries without attempting to push them", async () => {
    const mock = createSupabaseMock({});
    mockState.client = mock.client;
    await enqueueSync("categories", "c-1", "upsert", { name: "Food" });

    const result = await processSyncQueue(USER_ID);
    expect(result.pushed).toBe(0);
    expect(await getDb().syncQueue.count()).toBe(0);
    expect(mock.calls.some((c) => c.table === "categories")).toBe(false);
  });

  it("uses the named onConflict target for tables with a unique constraint", async () => {
    const mock = createSupabaseMock({});
    mockState.client = mock.client;
    await enqueueSync("budgets", "bud-1", "upsert", { category_id: "food" });

    await processSyncQueue(USER_ID);
    const upsertCall = mock.calls.find((c) => c.method === "upsert" && c.table === "budgets");
    expect(upsertCall?.args[1]).toEqual({ onConflict: "user_id,ym_char6,category_id" });
  });

  it("sends a delete as a soft-delete update filtered by id and user_id", async () => {
    const mock = createSupabaseMock({});
    mockState.client = mock.client;
    await enqueueSync("transactions", "tx-1", "delete", { id: "tx-1" });

    await processSyncQueue(USER_ID);
    const updateCall = mock.calls.find((c) => c.method === "update" && c.table === "transactions");
    expect(updateCall).toBeDefined();
    expect((updateCall!.args[0] as Record<string, unknown>).deleted_at).toBeDefined();
  });
});

describe("pullHistoricalTransactions", () => {
  it("returns zero when Supabase isn't configured", async () => {
    const result = await pullHistoricalTransactions(USER_ID);
    expect(result).toEqual({ count: 0, oldestDate: null });
  });

  it("pulls older transactions and reports the oldest date seen", async () => {
    const mock = createSupabaseMock({
      data: {
        transactions: [
          { id: "t1", user_id: USER_ID, type_smallint: 2, amount_poisha: 1000, account_id: "acc-1", category_id: "food", tx_date: "2025-01-10", created_at: now, updated_at: now, deleted_at: null },
          { id: "t2", user_id: USER_ID, type_smallint: 2, amount_poisha: 2000, account_id: "acc-1", category_id: "food", tx_date: "2025-01-05", created_at: now, updated_at: now, deleted_at: null },
        ],
      },
    });
    mockState.client = mock.client;

    const result = await pullHistoricalTransactions(USER_ID, "2025-02-01");
    expect(result.count).toBe(2);
    expect(result.oldestDate).toBe("2025-01-05");
    expect((await getDb().transactions.get("t1"))?.amountPoisha).toBe(1000);
  });
});

describe("repairAccountSync", () => {
  it("purges stale queued entries and re-enqueues the current profile and accounts", async () => {
    await getDb().syncQueue.add({ table: "categories", recordId: "c1", operation: "upsert", payload: {}, createdAt: now });
    const profile: UserProfile = {
      id: "p1", userId: USER_ID, monthlyIncomePoisha: 10_000, currencyCode: "BDT", locale: "en",
      emergencyMonths: 3, onboardingComplete: true, createdAt: now, updatedAt: now,
    };
    await getDb().userProfiles.put(profile);
    const acc: Account = { id: "a1", userId: USER_ID, type: 1, name: "Cash", balancePoisha: 5000, createdAt: now, updatedAt: now };
    await getDb().accounts.put(acc);

    await repairAccountSync(USER_ID);

    const queue = await getDb().syncQueue.toArray();
    expect(queue.some((q) => q.table === "categories")).toBe(false);
    expect(queue.some((q) => q.table === "user_profiles" && q.recordId === "p1")).toBe(true);
    expect(queue.some((q) => q.table === "accounts" && q.recordId === "a1")).toBe(true);
  });
});

describe("mergeDuplicateAccounts", () => {
  it("returns zero when Supabase isn't configured", async () => {
    const result = await mergeDuplicateAccounts(USER_ID);
    expect(result).toEqual({ merged: 0, groups: 0 });
  });

  it("merges same name+type duplicates, keeping the oldest and summing balances", async () => {
    const mock = createSupabaseMock({
      data: {
        accounts: [
          { id: "old", user_id: USER_ID, name: "Cash", type_smallint: 1, balance_poisha: 1000, created_at: "2025-01-01T00:00:00Z" },
          { id: "new", user_id: USER_ID, name: "Cash", type_smallint: 1, balance_poisha: 2000, created_at: "2025-02-01T00:00:00Z" },
        ],
      },
    });
    mockState.client = mock.client;

    const result = await mergeDuplicateAccounts(USER_ID);
    expect(result).toEqual({ merged: 1, groups: 1 });
    const balanceUpdate = mock.calls.find(
      (c) => c.method === "update" && c.table === "accounts" && (c.args[0] as Record<string, unknown>).balance_poisha !== undefined
    );
    expect((balanceUpdate!.args[0] as Record<string, unknown>).balance_poisha).toBe(3000);
  });

  it("does nothing when there are no duplicate groups", async () => {
    const mock = createSupabaseMock({
      data: { accounts: [{ id: "a1", user_id: USER_ID, name: "Cash", type_smallint: 1, balance_poisha: 1000, created_at: now }] },
    });
    mockState.client = mock.client;

    const result = await mergeDuplicateAccounts(USER_ID);
    expect(result).toEqual({ merged: 0, groups: 0 });
  });
});

describe("mergeDuplicateGoals", () => {
  it("merges same-name duplicate goals, keeping the oldest and summing saved amounts", async () => {
    const mock = createSupabaseMock({
      data: {
        goals: [
          { id: "old", user_id: USER_ID, name: "Emergency Fund", saved_poisha: 1000, created_at: "2025-01-01T00:00:00Z" },
          { id: "new", user_id: USER_ID, name: "emergency fund", saved_poisha: 500, created_at: "2025-02-01T00:00:00Z" },
        ],
      },
    });
    mockState.client = mock.client;

    const result = await mergeDuplicateGoals(USER_ID);
    expect(result).toEqual({ merged: 1, groups: 1 });
    const savedUpdate = mock.calls.find(
      (c) => c.method === "update" && c.table === "goals" && (c.args[0] as Record<string, unknown>).saved_poisha !== undefined
    );
    expect((savedUpdate!.args[0] as Record<string, unknown>).saved_poisha).toBe(1500);
  });
});

describe("repairLocalBudgets", () => {
  it("clears local budgets and their queued entries", async () => {
    await getDb().budgets.put({ id: "b1", userId: USER_ID, ym: "202601", categoryId: "food", allocatedPoisha: 1000, carryPoisha: 0, createdAt: now, updatedAt: now });
    await getDb().syncQueue.add({ table: "budgets", recordId: "b1", operation: "upsert", payload: {}, createdAt: now });

    await repairLocalBudgets(USER_ID);

    expect(await getDb().budgets.count()).toBe(0);
    const queue = await getDb().syncQueue.toArray();
    expect(queue.some((q) => q.table === "budgets")).toBe(false);
  });
});

describe("forceFullResync", () => {
  it("pushes then pulls, returning combined counts", async () => {
    const mock = createSupabaseMock({});
    mockState.client = mock.client;
    await enqueueSync("accounts", "a-1", "upsert", { name: "Cash" });

    const result = await forceFullResync(USER_ID);
    expect(result.pushed).toBe(1);
    expect(result.errors).toBe(0);
    expect(result.pulled).toBe(0);
  });
});

describe("exportUserDataAsJson", () => {
  it("dumps every exportable table's rows for the given user", async () => {
    await getDb().accounts.put({ id: "a1", userId: USER_ID, type: 1, name: "Cash", balancePoisha: 1000, createdAt: now, updatedAt: now });
    await getDb().accounts.put({ id: "a2", userId: "someone-else", type: 1, name: "Cash", balancePoisha: 1000, createdAt: now, updatedAt: now });

    const dump = await exportUserDataAsJson(USER_ID);
    expect(dump.accounts).toHaveLength(1);
    expect((dump.accounts[0] as Account).id).toBe("a1");
  });
});

describe("pruneBuyEvaluations", () => {
  it("keeps only the most recently updated MAX_SYNC_BUY_EVALS evaluations", async () => {
    for (let i = 0; i < 25; i++) {
      await getDb().buyEvaluations.put({
        id: `e${i}`,
        userId: USER_ID,
        productName: "x",
        categoryId: "gadgets",
        pricePoisha: 100,
        priority: 1,
        score: 50,
        tier: 2,
        recommendation: 1,
        reasonCodes: [],
        createdAt: now,
        updatedAt: new Date(2026, 0, i + 1).toISOString(),
      });
    }

    await pruneBuyEvaluations(USER_ID);

    const remaining = await getDb().buyEvaluations.where("userId").equals(USER_ID).toArray();
    expect(remaining).toHaveLength(20);
    expect(remaining.some((e) => e.id === "e0")).toBe(false);
    expect(remaining.some((e) => e.id === "e24")).toBe(true);
  });

  it("is a no-op when under the cap", async () => {
    await getDb().buyEvaluations.put({
      id: "e0", userId: USER_ID, productName: "x", categoryId: "gadgets", pricePoisha: 100,
      priority: 1, score: 50, tier: 2, recommendation: 1, reasonCodes: [], createdAt: now, updatedAt: now,
    });
    await pruneBuyEvaluations(USER_ID);
    expect(await getDb().buyEvaluations.count()).toBe(1);
  });
});

describe("toLeanBuyEval", () => {
  it("maps camelCase fields to the remote snake_case shape and truncates the product name", () => {
    const evalRec: BuyEvaluation = {
      id: "e1",
      userId: USER_ID,
      productName: "x".repeat(100),
      categoryId: "gadgets",
      pricePoisha: 12000,
      priority: 1,
      score: 80,
      tier: 1,
      recommendation: 1,
      reasonCodes: [10],
      saveMonths: 2,
      createdAt: now,
      updatedAt: now,
    };

    const lean = toLeanBuyEval(evalRec);
    expect((lean.product_name as string).length).toBe(80);
    expect(lean.reason_codes).toEqual([10]);
    expect(lean.save_months).toBe(2);
  });

  it("defaults save_months to null when unset", () => {
    const evalRec: BuyEvaluation = {
      id: "e1", userId: USER_ID, productName: "x", categoryId: "gadgets", pricePoisha: 100,
      priority: 1, score: 80, tier: 1, recommendation: 1, reasonCodes: [], createdAt: now, updatedAt: now,
    };
    expect(toLeanBuyEval(evalRec).save_months).toBeNull();
  });
});
