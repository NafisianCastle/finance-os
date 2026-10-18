import { getDb } from "@/infrastructure/db/dexie/database";
import { createClient, isSupabaseConfigured } from "@/infrastructure/supabase/client";
import { processSyncQueue, pullRemoteChanges } from "@/infrastructure/sync/sync-queue";
import { useAppStore } from "@/store/app-store";
import type { Group, GroupMember } from "@/infrastructure/db/dexie/schema";

const INVITE_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
const INVITE_CODE_LENGTH = 8;
const MAX_INVITE_CODE_ATTEMPTS = 5;

export type GroupErrorCode =
  | "already_in_group"
  | "invalid_invite_code"
  | "invalid_group_name"
  | "not_owner"
  | "not_a_member"
  | "not_configured"
  | "unknown";

const GROUP_ERROR_MESSAGES: Record<GroupErrorCode, string> = {
  already_in_group: "You're already in a group. Leave it before joining another.",
  invalid_invite_code: "Invalid invite code.",
  invalid_group_name: "Group name must be 1–80 characters.",
  not_owner: "Only the group owner can do that.",
  not_a_member: "You're not a member of this group.",
  not_configured: "Groups require Supabase to be configured.",
  unknown: "Something went wrong. Please try again.",
};

/**
 * Error thrown by group actions. `code` is stable (the RPCs in migration 012
 * raise these as their message) so UI can show a translated message;
 * `message` is a readable English fallback.
 */
export class GroupError extends Error {
  constructor(public readonly code: GroupErrorCode, detail?: string) {
    super(code === "unknown" && detail ? detail : GROUP_ERROR_MESSAGES[code]);
    this.name = "GroupError";
  }
}

function toGroupError(error: { message?: string; code?: string } | null): GroupError {
  const msg = error?.message ?? "";
  const known = (Object.keys(GROUP_ERROR_MESSAGES) as GroupErrorCode[]).find(
    (c) => c !== "unknown" && msg.includes(c)
  );
  if (known) return new GroupError(known);
  // One-group-per-user unique index (010) tripped by a concurrent join.
  if (error?.code === "23505") return new GroupError("already_in_group");
  return new GroupError("unknown", msg || undefined);
}

function generateInviteCode(): string {
  // Cryptographic randomness: the code is the only secret gating membership.
  const bytes = crypto.getRandomValues(new Uint8Array(INVITE_CODE_LENGTH));
  let code = "";
  // The alphabet has exactly 32 chars, so the low 5 bits index it uniformly.
  for (const b of bytes) code += INVITE_CODE_CHARS[b & 0x1f];
  return code;
}

function isUniqueViolation(error: { code?: string } | null): boolean {
  return error?.code === "23505";
}

function toGroup(row: Record<string, unknown>): Group {
  return {
    id: row.id as string,
    name: row.name as string,
    inviteCode: row.invite_code as string,
    createdBy: row.created_by as string,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

/** RPCs returning a composite row may come back as an object or a 1-row array. */
function firstRow(data: unknown): Record<string, unknown> | null {
  const row = Array.isArray(data) ? data[0] : data;
  return row && typeof row === "object" ? (row as Record<string, unknown>) : null;
}

async function cacheGroupLocally(group: Group, members: GroupMember[]) {
  const db = getDb();
  await db.groups.put(group);
  await db.groupMembers.where("groupId").equals(group.id).delete();
  await db.groupMembers.bulkPut(members);
}

// Local Dexie table → remote table, for every group-scoped table.
const GROUP_SCOPED_LOCAL_TABLES: Array<[local: string, remote: string]> = [
  ["accounts", "accounts"],
  ["transactions", "transactions"],
  ["budgets", "budgets"],
  ["debts", "debts"],
  ["loansGiven", "loans_given"],
  ["heldLiabilities", "held_liabilities"],
  ["goals", "goals"],
  ["investments", "investments"],
  ["investmentEvents", "investment_events"],
  ["buyEvaluations", "buy_evaluations"],
  ["plannedPayments", "planned_payments"],
  ["shoppingLists", "shopping_lists"],
  ["shoppingListItems", "shopping_list_items"],
];

async function purgeGroupLocally(groupId: string) {
  const db = getDb();
  await db.groupMembers.where("groupId").equals(groupId).delete();
  await db.groups.delete(groupId);
  // Drop cached rows that were only visible via this group membership — a
  // removed member shouldn't retain an offline snapshot of shared finances.
  // Their still-queued edits go too: RLS would reject them now that we're
  // out of the group, and a permanently failing entry stalls the queue.
  for (const [local, remote] of GROUP_SCOPED_LOCAL_TABLES) {
    const table = (db as any)[local];
    const ids = new Set<string>(await table.where("groupId").equals(groupId).primaryKeys());
    if (ids.size === 0) continue;
    await table.bulkDelete([...ids]);
    await db.syncQueue.filter((q) => q.table === remote && ids.has(q.recordId)).delete();
  }
}

/** Purge every locally cached group except `keep` (stale memberships). */
async function purgeOtherGroups(keep: string | null) {
  const db = getDb();
  const cached = (await db.groups.toCollection().primaryKeys()) as string[];
  const fromStore = useAppStore.getState().groupId;
  const ids = new Set([...cached, ...(fromStore ? [fromStore] : [])]);
  for (const id of ids) {
    if (id !== keep) await purgeGroupLocally(id);
  }
}

/** Best-effort flush so shared edits made while still a member aren't lost. */
async function flushQueue(userId: string) {
  try {
    await processSyncQueue(userId, useAppStore.getState().groupId);
  } catch {
    // Offline etc. — whatever's left for the group is purged with it.
  }
}

async function fetchMembers(groupId: string): Promise<GroupMember[]> {
  const supabase = createClient();
  if (!supabase) return [];
  const { data } = await supabase.from("group_members").select("*").eq("group_id", groupId);
  return (data ?? []).map((m) => ({
    groupId: m.group_id,
    userId: m.user_id,
    role: m.role,
    joinedAt: m.joined_at,
  }));
}

export async function createGroup(userId: string, name: string): Promise<Group> {
  const supabase = createClient();
  if (!supabase) throw new GroupError("not_configured");

  // Atomic group + owner membership (migration 012).
  const { data, error } = await supabase.rpc("create_group", { p_name: name.trim() });
  const row = firstRow(data);
  if (error || !row) throw toGroupError(error);

  const group = toGroup(row);
  const member: GroupMember = {
    groupId: group.id,
    userId,
    role: "owner",
    joinedAt: new Date().toISOString(),
  };
  await purgeOtherGroups(group.id);
  await cacheGroupLocally(group, [member]);
  useAppStore.getState().setGroupId(group.id);
  return group;
}

export async function joinGroupByCode(userId: string, code: string): Promise<Group> {
  const supabase = createClient();
  if (!supabase) throw new GroupError("not_configured");

  const { data, error } = await supabase.rpc("join_group_by_code", {
    p_code: code.trim().toUpperCase(),
  });
  const row = firstRow(data);
  if (error || !row) throw toGroupError(error);

  const group = toGroup(row);
  const members = await fetchMembers(group.id);
  await purgeOtherGroups(group.id);
  await cacheGroupLocally(group, members);
  useAppStore.getState().setGroupId(group.id);

  // Full pull (null checkpoint): the group's shared rows can be older than
  // this device's lastSyncedAt, so an incremental pull would miss them.
  await pullRemoteChanges(userId, group.id, null);

  return group;
}

export async function leaveGroup(userId: string, groupId: string): Promise<void> {
  const supabase = createClient();
  if (!supabase) return;

  await flushQueue(userId);

  // Server hands ownership to the oldest remaining member, or deletes the
  // group if we were the last one.
  const { error } = await supabase.rpc("leave_group", { p_group_id: groupId });
  if (error) {
    const err = toGroupError(error);
    // Already out (e.g. removed by the owner) — still clean up locally.
    if (err.code !== "not_a_member") throw err;
  }

  // Purge BEFORE clearing groupId so nothing renders/syncs the shared rows
  // in personal mode in between.
  await purgeGroupLocally(groupId);
  useAppStore.getState().setGroupId(null);
}

/** Owner only. Shared rows revert to their authors' personal rows server-side. */
export async function deleteGroup(userId: string, groupId: string): Promise<void> {
  const supabase = createClient();
  if (!supabase) return;

  await flushQueue(userId);

  const { error } = await supabase.rpc("delete_group", { p_group_id: groupId });
  if (error) throw toGroupError(error);

  await purgeGroupLocally(groupId);
  useAppStore.getState().setGroupId(null);
  // Our own formerly-shared rows come back as personal rows (group_id was
  // set null server-side); re-pull so they reappear.
  await pullRemoteChanges(userId, null, null);
}

export async function removeMember(groupId: string, targetUserId: string): Promise<void> {
  const supabase = createClient();
  if (!supabase) return;
  const { error } = await supabase
    .from("group_members")
    .delete()
    .eq("group_id", groupId)
    .eq("user_id", targetUserId);
  if (error) throw new Error(error.message);

  const db = getDb();
  await db.groupMembers.where("groupId").equals(groupId).and((m) => m.userId === targetUserId).delete();
}

export async function regenerateInviteCode(groupId: string): Promise<string> {
  const supabase = createClient();
  if (!supabase) throw new GroupError("not_configured");

  let lastError: { code?: string; message?: string } | null = null;
  for (let attempt = 0; attempt < MAX_INVITE_CODE_ATTEMPTS; attempt++) {
    const inviteCode = generateInviteCode();
    const { data, error } = await supabase
      .from("groups")
      .update({ invite_code: inviteCode })
      .eq("id", groupId)
      .select()
      .single();

    if (!error && data) {
      await getDb().groups.update(groupId, { inviteCode: data.invite_code });
      return data.invite_code;
    }
    lastError = error;
    if (!isUniqueViolation(error)) break;
  }
  throw new Error(lastError?.message ?? "Failed to regenerate invite code.");
}

export async function getMyGroup(
  userId: string
): Promise<{ group: Group; members: GroupMember[] } | null> {
  if (!isSupabaseConfigured()) return null;
  const supabase = createClient();
  if (!supabase) return null;

  const cachedGroupId = useAppStore.getState().groupId;

  const { data: membership, error: membershipError } = await supabase
    .from("group_members")
    .select("group_id")
    .eq("user_id", userId)
    .maybeSingle();

  // A failed lookup (offline, timeout) says nothing about membership — never
  // purge shared data on it; keep whatever is cached.
  if (membershipError) return getCachedGroup(userId);

  if (!membership) {
    // Removed from (or left) the group elsewhere: purge first, then clear
    // groupId, so shared rows never show up as if they were personal.
    await purgeOtherGroups(null);
    useAppStore.getState().setGroupId(null);
    return null;
  }

  const gid = membership.group_id as string;
  const [{ data: groupRow, error: groupError }, members] = await Promise.all([
    supabase.from("groups").select("*").eq("id", gid).single(),
    fetchMembers(gid),
  ]);
  if (groupError || !groupRow) return getCachedGroup(userId);

  const group = toGroup(groupRow);
  await purgeOtherGroups(group.id);
  await cacheGroupLocally(group, members);
  useAppStore.getState().setGroupId(group.id);

  // Joined on another device (or switched groups): the shared rows predate
  // our checkpoint, so do a full pull.
  if (cachedGroupId !== group.id) await pullRemoteChanges(userId, group.id, null);

  return { group, members };
}

export async function getCachedGroup(
  userId: string
): Promise<{ group: Group; members: GroupMember[] } | null> {
  const db = getDb();
  const membership = await db.groupMembers.where("userId").equals(userId).first();
  if (!membership) return null;
  const group = await db.groups.get(membership.groupId);
  if (!group) return null;
  const members = await db.groupMembers.where("groupId").equals(group.id).toArray();
  return { group, members };
}
