import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";

type RpcResult = { data: unknown; error: { message: string; code?: string } | null };

const rpcCalls: Array<{ fn: string; args: unknown }> = [];
const rpcResults: Record<string, RpcResult> = {};
const fromCalls: Array<{ table: string; method: string; args: unknown[] }> = [];
const tableResults: Record<string, { data: unknown; error: unknown }> = {};

function makeChain(table: string) {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "gt", "gte", "lt", "is", "or", "order", "in", "limit", "update", "delete", "insert"]) {
    chain[m] = (...a: unknown[]) => {
      fromCalls.push({ table, method: m, args: a });
      return chain;
    };
  }
  const result = () => tableResults[table] ?? { data: [], error: null };
  chain.maybeSingle = () => Promise.resolve(result());
  chain.single = () => Promise.resolve(result());
  chain.upsert = () => Promise.resolve({ data: null, error: null });
  chain.then = (resolve: (v: unknown) => void) => resolve(result());
  return chain;
}

vi.mock("@/infrastructure/supabase/client", () => ({
  isSupabaseConfigured: () => true,
  createClient: () => ({
    from: (table: string) => makeChain(table),
    rpc: (fn: string, args: unknown) => {
      rpcCalls.push({ fn, args });
      return Promise.resolve(rpcResults[fn] ?? { data: null, error: null });
    },
  }),
}));

import { getDb, resetLocalDatabase } from "@/infrastructure/db/dexie/database";
import {
  createGroup,
  deleteGroup,
  getMyGroup,
  GroupError,
  joinGroupByCode,
  leaveGroup,
} from "@/application/groups";
import { enqueueSync } from "@/infrastructure/sync/sync-queue";
import { useAppStore } from "@/store/app-store";

const USER_ID = "user-1";
const GROUP_ID = "group-1";
const now = new Date().toISOString();
const groupRow = {
  id: GROUP_ID, name: "Home", invite_code: "ABCD2345", created_by: USER_ID,
  created_at: now, updated_at: now,
};

async function seedSharedData() {
  const db = getDb();
  await db.groups.put({ id: GROUP_ID, name: "Home", inviteCode: "ABCD2345", createdBy: USER_ID, createdAt: now, updatedAt: now });
  await db.groupMembers.put({ groupId: GROUP_ID, userId: USER_ID, role: "member", joinedAt: now });
  await db.goals.put({ id: "shared-goal", userId: "teammate", groupId: GROUP_ID, name: "Trip", targetPoisha: 1, savedPoisha: 0, createdAt: now, updatedAt: now } as never);
  await db.goals.put({ id: "my-goal", userId: USER_ID, groupId: null, name: "Mine", targetPoisha: 1, savedPoisha: 0, createdAt: now, updatedAt: now } as never);
  useAppStore.getState().setGroupId(GROUP_ID);
}

beforeEach(async () => {
  await resetLocalDatabase();
  rpcCalls.length = 0;
  fromCalls.length = 0;
  for (const k of Object.keys(rpcResults)) delete rpcResults[k];
  for (const k of Object.keys(tableResults)) delete tableResults[k];
  useAppStore.getState().clearSyncState();
});

describe("groups service", () => {
  it("createGroup calls the create_group RPC and caches the result", async () => {
    rpcResults.create_group = { data: groupRow, error: null };

    const group = await createGroup(USER_ID, "  Home ");

    expect(rpcCalls).toEqual([{ fn: "create_group", args: { p_name: "Home" } }]);
    expect(group.inviteCode).toBe("ABCD2345");
    expect(useAppStore.getState().groupId).toBe(GROUP_ID);
    expect((await getDb().groupMembers.toArray())[0]).toMatchObject({ userId: USER_ID, role: "owner" });
    // No direct inserts into groups/group_members any more.
    expect(fromCalls.some((c) => c.method === "insert")).toBe(false);
  });

  it("maps RPC errors to a typed GroupError", async () => {
    rpcResults.create_group = { data: null, error: { message: "already_in_group", code: "P0001" } };
    await expect(createGroup(USER_ID, "Home")).rejects.toMatchObject({ code: "already_in_group" });
    await expect(createGroup(USER_ID, "Home")).rejects.toBeInstanceOf(GroupError);
  });

  it("joinGroupByCode calls the RPC with a normalized code, then does a full pull", async () => {
    rpcResults.join_group_by_code = { data: [groupRow], error: null };
    useAppStore.getState().setLastSyncedAt("2026-10-01T00:00:00Z");

    const group = await joinGroupByCode(USER_ID, " abcd2345 ");

    expect(rpcCalls[0]).toEqual({ fn: "join_group_by_code", args: { p_code: "ABCD2345" } });
    expect(group.id).toBe(GROUP_ID);
    expect(useAppStore.getState().groupId).toBe(GROUP_ID);
    // Full pull: since-1970 cursor rather than the stored checkpoint.
    const gt = fromCalls.find((c) => c.method === "gt" && c.args[0] === "updated_at");
    expect(gt?.args[1]).toBe("1970-01-01T00:00:00Z");
  });

  it("joinGroupByCode surfaces an invalid code", async () => {
    rpcResults.join_group_by_code = { data: null, error: { message: "invalid_invite_code" } };
    await expect(joinGroupByCode(USER_ID, "NOPE")).rejects.toMatchObject({ code: "invalid_invite_code" });
  });

  it("leaveGroup calls leave_group and purges shared rows (and their queued edits) before clearing groupId", async () => {
    await seedSharedData();
    await enqueueSync("goals", "shared-goal", "upsert", { saved_poisha: 5 });
    let groupIdDuringPurge: string | null | undefined;
    const db = getDb();
    const origDelete = db.groups.delete.bind(db.groups);
    db.groups.delete = ((key: string) => {
      groupIdDuringPurge = useAppStore.getState().groupId;
      return origDelete(key);
    }) as typeof db.groups.delete;

    await leaveGroup(USER_ID, GROUP_ID);

    expect(rpcCalls.some((c) => c.fn === "leave_group" && (c.args as { p_group_id: string }).p_group_id === GROUP_ID)).toBe(true);
    expect(groupIdDuringPurge).toBe(GROUP_ID);
    expect(useAppStore.getState().groupId).toBeNull();
    expect(await db.goals.get("shared-goal")).toBeUndefined();
    expect(await db.goals.get("my-goal")).toBeDefined();
    expect(await db.syncQueue.filter((q) => q.recordId === "shared-goal").count()).toBe(0);
    expect(await db.groups.count()).toBe(0);
  });

  it("deleteGroup calls delete_group and purges locally", async () => {
    await seedSharedData();
    await deleteGroup(USER_ID, GROUP_ID);
    expect(rpcCalls.some((c) => c.fn === "delete_group")).toBe(true);
    expect(useAppStore.getState().groupId).toBeNull();
    expect(await getDb().goals.get("shared-goal")).toBeUndefined();
  });

  it("deleteGroup rejects for non-owners and keeps local data", async () => {
    await seedSharedData();
    rpcResults.delete_group = { data: null, error: { message: "not_owner", code: "42501" } };
    await expect(deleteGroup(USER_ID, GROUP_ID)).rejects.toMatchObject({ code: "not_owner" });
    expect(useAppStore.getState().groupId).toBe(GROUP_ID);
    expect(await getDb().goals.get("shared-goal")).toBeDefined();
  });

  it("getMyGroup doesn't purge anything when the membership lookup fails", async () => {
    await seedSharedData();
    tableResults.group_members = { data: null, error: { message: "offline" } };

    const result = await getMyGroup(USER_ID);

    expect(result?.group.id).toBe(GROUP_ID);
    expect(useAppStore.getState().groupId).toBe(GROUP_ID);
    expect(await getDb().goals.get("shared-goal")).toBeDefined();
  });

  it("getMyGroup purges then clears groupId when no longer a member", async () => {
    await seedSharedData();
    tableResults.group_members = { data: null, error: null };

    const result = await getMyGroup(USER_ID);

    expect(result).toBeNull();
    expect(useAppStore.getState().groupId).toBeNull();
    expect(await getDb().goals.get("shared-goal")).toBeUndefined();
    expect(await getDb().goals.get("my-goal")).toBeDefined();
  });
});
