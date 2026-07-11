import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const tableData: Record<string, Record<string, unknown>[]> = {};

vi.mock("@/infrastructure/supabase/client", () => ({
  createClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          gt: () => ({
            limit: async () => ({ data: tableData[table] ?? [], error: null }),
          }),
        }),
      }),
    }),
  }),
}));

import { getDb, resetLocalDatabase } from "@/infrastructure/db/dexie/database";
import { enqueueSync, pullRemoteChanges } from "@/infrastructure/sync/sync-queue";

const USER_ID = "user-1";

function remoteAccount(overrides: Record<string, unknown> = {}) {
  return {
    id: "acc-1",
    user_id: USER_ID,
    type_smallint: 1,
    name: "Cash",
    balance_poisha: 10000,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-02T00:00:00Z",
    deleted_at: null,
    ...overrides,
  };
}

describe("pullRemoteChanges merge", () => {
  beforeEach(async () => {
    await resetLocalDatabase();
    for (const key of Object.keys(tableData)) delete tableData[key];
  });

  it("inserts a remote row with no local counterpart", async () => {
    tableData.accounts = [remoteAccount()];

    const count = await pullRemoteChanges(USER_ID, null);

    expect(count).toBe(1);
    const local = await getDb().accounts.get("acc-1");
    expect(local?.name).toBe("Cash");
    expect(local?.balancePoisha).toBe(10000);
  });

  it("overwrites local row when remote is newer, and drops the stale queued push", async () => {
    const db = getDb();
    await db.accounts.put({
      id: "acc-1",
      userId: USER_ID,
      type: 1,
      name: "Stale Cash",
      balancePoisha: 500,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    });
    await enqueueSync("accounts", "acc-1", "upsert", { name: "Stale Cash" });
    tableData.accounts = [remoteAccount({ name: "Synced Cash", balance_poisha: 20000 })];

    const count = await pullRemoteChanges(USER_ID, null);

    expect(count).toBe(1);
    const local = await db.accounts.get("acc-1");
    expect(local?.name).toBe("Synced Cash");
    expect(local?.balancePoisha).toBe(20000);
    const queued = await db.syncQueue.filter((i) => i.recordId === "acc-1").toArray();
    expect(queued).toHaveLength(0);
  });

  it("keeps local row when it is newer than remote", async () => {
    const db = getDb();
    await db.accounts.put({
      id: "acc-1",
      userId: USER_ID,
      type: 1,
      name: "Fresh Local Edit",
      balancePoisha: 999,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-02-01T00:00:00Z",
    });
    tableData.accounts = [remoteAccount({ name: "Older Remote", updated_at: "2026-01-15T00:00:00Z" })];

    const count = await pullRemoteChanges(USER_ID, null);

    expect(count).toBe(0);
    const local = await db.accounts.get("acc-1");
    expect(local?.name).toBe("Fresh Local Edit");
  });
});
