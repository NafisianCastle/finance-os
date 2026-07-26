import { getDb } from "@/infrastructure/db/dexie/database";
import { createClient, isSupabaseConfigured } from "@/infrastructure/supabase/client";
import { pullRemoteChanges } from "@/infrastructure/sync/sync-queue";
import { useAppStore } from "@/store/app-store";
import type { Group, GroupMember } from "@/infrastructure/db/dexie/schema";

const INVITE_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
const INVITE_CODE_LENGTH = 8;
const MAX_INVITE_CODE_ATTEMPTS = 5;

function generateInviteCode(): string {
  let code = "";
  for (let i = 0; i < INVITE_CODE_LENGTH; i++) {
    code += INVITE_CODE_CHARS[Math.floor(Math.random() * INVITE_CODE_CHARS.length)];
  }
  return code;
}

function isUniqueViolation(error: { code?: string } | null): boolean {
  return error?.code === "23505";
}

async function cacheGroupLocally(group: Group, members: GroupMember[]) {
  const db = getDb();
  await db.groups.put(group);
  await db.groupMembers.where("groupId").equals(group.id).delete();
  await db.groupMembers.bulkPut(members);
}

async function purgeGroupLocally(groupId: string) {
  const db = getDb();
  await db.groupMembers.where("groupId").equals(groupId).delete();
  await db.groups.delete(groupId);
  // Drop cached rows that were only visible via this group membership — a
  // removed member shouldn't retain an offline snapshot of shared finances.
  const tables = [
    "accounts", "transactions", "budgets", "debts", "loansGiven",
    "heldLiabilities", "goals", "investments", "investmentEvents",
    "buyEvaluations", "plannedPayments", "shoppingLists", "shoppingListItems",
  ] as const;
  for (const table of tables) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db as any)[table].where("groupId").equals(groupId).delete();
  }
}

export async function createGroup(userId: string, name: string): Promise<Group> {
  const supabase = createClient();
  if (!supabase) throw new Error("Groups require Supabase to be configured.");

  let lastError: { code?: string; message?: string } | null = null;
  for (let attempt = 0; attempt < MAX_INVITE_CODE_ATTEMPTS; attempt++) {
    const inviteCode = generateInviteCode();
    const { data, error } = await supabase
      .from("groups")
      .insert({ name, invite_code: inviteCode, created_by: userId })
      .select()
      .single();

    if (!error && data) {
      const { error: memberError } = await supabase
        .from("group_members")
        .insert({ group_id: data.id, user_id: userId, role: "owner" });
      if (memberError) throw new Error(memberError.message);

      const group: Group = {
        id: data.id,
        name: data.name,
        inviteCode: data.invite_code,
        createdBy: data.created_by,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
      };
      const member: GroupMember = {
        groupId: group.id,
        userId,
        role: "owner",
        joinedAt: new Date().toISOString(),
      };
      await cacheGroupLocally(group, [member]);
      useAppStore.getState().setGroupId(group.id);
      return group;
    }

    lastError = error;
    if (!isUniqueViolation(error)) break;
  }
  throw new Error(lastError?.message ?? "Failed to create group.");
}

export async function joinGroupByCode(userId: string, code: string): Promise<Group> {
  const supabase = createClient();
  if (!supabase) throw new Error("Groups require Supabase to be configured.");

  const { data: resolved, error: resolveError } = await supabase.rpc("resolve_invite_code", {
    code: code.trim().toUpperCase(),
  });
  if (resolveError) throw new Error(resolveError.message);
  const match = Array.isArray(resolved) ? resolved[0] : resolved;
  if (!match) throw new Error("Invalid invite code.");

  const { error: memberError } = await supabase
    .from("group_members")
    .insert({ group_id: match.id, user_id: userId, role: "member" });
  if (memberError) {
    throw new Error(
      isUniqueViolation(memberError)
        ? "You're already in a group. Leave it before joining another."
        : memberError.message
    );
  }

  const group = await getMyGroup(userId);
  if (!group) throw new Error("Joined group but failed to load it.");

  // Hydrate the device with the group's shared data right away.
  await pullRemoteChanges(userId, group.group.id, useAppStore.getState().lastSyncedAt);

  return group.group;
}

export async function leaveGroup(userId: string, groupId: string): Promise<void> {
  const supabase = createClient();
  if (!supabase) return;

  const { data: members } = await supabase
    .from("group_members")
    .select("user_id, role, joined_at")
    .eq("group_id", groupId)
    .order("joined_at", { ascending: true });

  const me = members?.find((m) => m.user_id === userId);
  const others = (members ?? []).filter((m) => m.user_id !== userId);
  if (me?.role === "owner" && others.length > 0) {
    const next = others[0];
    await supabase
      .from("group_members")
      .update({ role: "owner" })
      .eq("group_id", groupId)
      .eq("user_id", next.user_id);
  }

  await supabase.from("group_members").delete().eq("group_id", groupId).eq("user_id", userId);

  const db = getDb();
  await db.groupMembers.where("groupId").equals(groupId).and((m) => m.userId === userId).delete();
  useAppStore.getState().setGroupId(null);
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
  if (!supabase) throw new Error("Groups require Supabase to be configured.");

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

  const db = getDb();
  const cachedGroupId = useAppStore.getState().groupId;

  const { data: membership } = await supabase
    .from("group_members")
    .select("group_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (!membership) {
    if (cachedGroupId) await purgeGroupLocally(cachedGroupId);
    useAppStore.getState().setGroupId(null);
    return null;
  }

  const [{ data: groupRow }, { data: memberRows }] = await Promise.all([
    supabase.from("groups").select("*").eq("id", membership.group_id).single(),
    supabase.from("group_members").select("*").eq("group_id", membership.group_id),
  ]);
  if (!groupRow) return null;

  const group: Group = {
    id: groupRow.id,
    name: groupRow.name,
    inviteCode: groupRow.invite_code,
    createdBy: groupRow.created_by,
    createdAt: groupRow.created_at,
    updatedAt: groupRow.updated_at,
  };
  const members: GroupMember[] = (memberRows ?? []).map((m) => ({
    groupId: m.group_id,
    userId: m.user_id,
    role: m.role,
    joinedAt: m.joined_at,
  }));

  await cacheGroupLocally(group, members);
  useAppStore.getState().setGroupId(group.id);

  await db.groups.put(group);
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
