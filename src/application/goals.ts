import { v4 as uuid } from "uuid";
import { getDb } from "@/infrastructure/db/dexie/database";
import { isVisible, scoped } from "@/infrastructure/db/dexie/helpers";
import { TX_TYPES } from "@/lib/constants";
import { enqueueSync } from "@/infrastructure/sync/sync-queue";
import { addTransaction } from "@/application/transactions";
import type { Goal } from "@/infrastructure/db/dexie/schema";

/** Category slug used for goal contribution expenses. */
export const GOAL_CATEGORY_ID = "savings";

export interface GoalInput {
  name: string;
  targetPoisha: number;
  /** YYYY-MM-DD; empty/undefined = no deadline. */
  deadline?: string;
}

/** Full remote `goals` row (snake_case) for an upsert — every NOT NULL column included. */
export function toGoalPayload(g: Goal): Record<string, unknown> {
  return {
    id: g.id,
    user_id: g.userId,
    group_id: g.groupId ?? null,
    name: g.name,
    target_poisha: g.targetPoisha,
    saved_poisha: g.savedPoisha,
    deadline: g.deadline ?? null,
  };
}

/** Goals visible to the user: own personal + shared with `groupId`. */
export async function listGoals(userId: string, groupId: string | null = null) {
  return scoped(getDb().goals, userId, groupId).toArray();
}

/** Creates a goal; `groupId` is the group to share it with (null = personal). */
export async function addGoal(userId: string, data: GoalInput, groupId: string | null = null) {
  const now = new Date().toISOString();
  const g: Goal = {
    id: uuid(),
    userId,
    groupId,
    name: data.name.trim(),
    targetPoisha: data.targetPoisha,
    savedPoisha: 0,
    deadline: data.deadline || undefined,
    createdAt: now,
    updatedAt: now,
  };
  await getDb().goals.put(g as never);
  await enqueueSync("goals", g.id, "upsert", toGoalPayload(g));
  return g;
}

/** Edits a visible goal's name/target/deadline (`groupId` = viewer's current group). */
export async function updateGoal(
  userId: string,
  goalId: string,
  data: Partial<GoalInput>,
  groupId: string | null = null
) {
  const db = getDb();
  const existing = await db.goals.get(goalId);
  if (!existing || !isVisible(existing, userId, groupId)) return;
  const now = new Date().toISOString();
  const g: Goal = {
    ...existing,
    name: data.name !== undefined ? data.name.trim() : existing.name,
    targetPoisha: data.targetPoisha ?? existing.targetPoisha,
    deadline: "deadline" in data ? data.deadline || undefined : existing.deadline,
    updatedAt: now,
  };
  await db.goals.put(g as never);
  await enqueueSync("goals", g.id, "upsert", toGoalPayload(g));
  return g;
}

/** Soft-deletes a visible goal. Contribution transactions already logged are kept. */
export async function deleteGoal(userId: string, goalId: string, groupId: string | null = null) {
  const db = getDb();
  const existing = await db.goals.get(goalId);
  if (!existing || !isVisible(existing, userId, groupId)) return false;
  const now = new Date().toISOString();
  await db.goals.update(goalId, { deletedAt: now, updatedAt: now });
  await enqueueSync("goals", goalId, "delete", {});
  return true;
}

/**
 * Moves real money out of `accountId` into the goal as a "savings" expense
 * (keeps account balances and Activity truthful), then bumps savedPoisha.
 * The transaction inherits the goal's groupId. `note` is the (translated)
 * transaction note, e.g. t("contributionNote", { name }).
 */
export async function contributeToGoal(
  userId: string,
  goalId: string,
  amountPoisha: number,
  accountId: string,
  note?: string,
  groupId: string | null = null
) {
  const db = getDb();
  const g = await db.goals.get(goalId);
  if (!g || !isVisible(g, userId, groupId) || amountPoisha <= 0) return;
  const now = new Date().toISOString();

  await addTransaction(
    userId,
    {
      type: TX_TYPES.EXPENSE,
      amountPoisha,
      accountId,
      categoryId: GOAL_CATEGORY_ID,
      date: now.slice(0, 10),
      note,
    },
    g.groupId ?? null
  );

  const updated: Goal = { ...g, savedPoisha: g.savedPoisha + amountPoisha, updatedAt: now };
  await db.goals.update(goalId, { savedPoisha: updated.savedPoisha, updatedAt: now });
  await enqueueSync("goals", goalId, "upsert", toGoalPayload(updated));
  return updated;
}
