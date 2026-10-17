import { v4 as uuid } from "uuid";
import { getDb } from "@/infrastructure/db/dexie/database";
import { isVisible, scoped } from "@/infrastructure/db/dexie/helpers";
import { HELD_STATUS } from "@/lib/constants";
import { enqueueSync } from "@/infrastructure/sync/sync-queue";
import type { HeldLiability } from "@/infrastructure/db/dexie/schema";

export interface LiabilityInput {
  owner: string;
  amountPoisha: number;
  purpose?: string;
  /** Defaults to today (YYYY-MM-DD). */
  holdDate?: string;
}

/** Full remote `held_liabilities` row (snake_case) for an upsert — every NOT NULL column included. */
export function toHeldLiabilityPayload(h: HeldLiability): Record<string, unknown> {
  return {
    id: h.id,
    user_id: h.userId,
    group_id: h.groupId ?? null,
    owner: h.owner,
    amount_poisha: h.amountPoisha,
    hold_date: h.holdDate,
    return_date: h.returnDate ?? null,
    purpose: h.purpose ?? null,
    status_smallint: h.status,
  };
}

/** Held money visible to the user: own personal + shared with `groupId`. */
export async function listLiabilities(userId: string, groupId: string | null = null) {
  return scoped(getDb().heldLiabilities, userId, groupId).toArray();
}

/** Records money held for someone else; `groupId` is the group to share it with (null = personal). */
export async function addLiability(userId: string, data: LiabilityInput, groupId: string | null = null) {
  const now = new Date().toISOString();
  const h: HeldLiability = {
    id: uuid(),
    userId,
    groupId,
    owner: data.owner.trim(),
    amountPoisha: data.amountPoisha,
    holdDate: data.holdDate || now.slice(0, 10),
    purpose: data.purpose,
    status: HELD_STATUS.ACTIVE,
    createdAt: now,
    updatedAt: now,
  };
  await getDb().heldLiabilities.put(h as never);
  await enqueueSync("held_liabilities", h.id, "upsert", toHeldLiabilityPayload(h));
  return h;
}

/** Edits a visible held-money record (`groupId` = viewer's current group). */
export async function updateLiability(
  userId: string,
  id: string,
  data: Partial<LiabilityInput>,
  groupId: string | null = null
) {
  const db = getDb();
  const existing = await db.heldLiabilities.get(id);
  if (!existing || !isVisible(existing, userId, groupId)) return;
  const now = new Date().toISOString();
  const h: HeldLiability = {
    ...existing,
    owner: data.owner !== undefined ? data.owner.trim() : existing.owner,
    amountPoisha: data.amountPoisha ?? existing.amountPoisha,
    purpose: "purpose" in data ? data.purpose : existing.purpose,
    holdDate: data.holdDate || existing.holdDate,
    updatedAt: now,
  };
  await db.heldLiabilities.put(h as never);
  await enqueueSync("held_liabilities", h.id, "upsert", toHeldLiabilityPayload(h));
  return h;
}

/** Soft-deletes a visible held-money record. */
export async function deleteLiability(userId: string, id: string, groupId: string | null = null) {
  const db = getDb();
  const existing = await db.heldLiabilities.get(id);
  if (!existing || !isVisible(existing, userId, groupId)) return false;
  const now = new Date().toISOString();
  await db.heldLiabilities.update(id, { deletedAt: now, updatedAt: now });
  await enqueueSync("held_liabilities", id, "delete", {});
  return true;
}

/** Marks held money as returned today, sending the full remote row. */
export async function markLiabilityReturned(userId: string, id: string, groupId: string | null = null) {
  const db = getDb();
  const existing = await db.heldLiabilities.get(id);
  if (!existing || !isVisible(existing, userId, groupId)) return;
  const now = new Date().toISOString();
  const h: HeldLiability = {
    ...existing,
    status: HELD_STATUS.RETURNED,
    returnDate: now.slice(0, 10),
    updatedAt: now,
  };
  await db.heldLiabilities.put(h as never);
  await enqueueSync("held_liabilities", id, "upsert", toHeldLiabilityPayload(h));
  return h;
}
