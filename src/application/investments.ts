import { v4 as uuid } from "uuid";
import { getDb } from "@/infrastructure/db/dexie/database";
import { isVisible, scoped } from "@/infrastructure/db/dexie/helpers";
import type { Investment, InvestmentEvent } from "@/infrastructure/db/dexie/schema";
import { INVESTMENT_STATUS } from "@/lib/investment-constants";
import { computeInvestmentMetrics } from "@/domain/investments/calculate";
import { enqueueSync } from "@/infrastructure/sync/sync-queue";

export async function loadInvestmentsWithEvents(userId: string, groupId: string | null = null) {
  const db = getDb();
  const investments = await scoped(db.investments, userId, groupId).toArray();
  const events = await scoped(db.investmentEvents, userId, groupId).toArray();
  const byInv = new Map<string, InvestmentEvent[]>();
  for (const e of events) {
    const list = byInv.get(e.investmentId) ?? [];
    list.push(e);
    byInv.set(e.investmentId, list);
  }
  return investments.map((inv) => ({
    investment: inv,
    events: byInv.get(inv.id) ?? [],
    metrics: computeInvestmentMetrics(inv, byInv.get(inv.id) ?? []),
  }));
}

/** Creates an investment; `groupId` is the group to share it with (null = personal). */
export async function createInvestment(
  userId: string,
  data: {
    type: number;
    name: string;
    investorName?: string;
    investedPoisha: number;
    declaredProfitPoisha?: number;
    projectStartDate: string;
    projectEndDate?: string;
    quantity?: number;
    pricePerUnitPoisha?: number;
    interestRatePct?: number;
    purity?: string;
    note?: string;
  },
  groupId: string | null = null
) {
  const db = getDb();
  const now = new Date().toISOString();
  const rec: Investment = {
    id: uuid(),
    userId,
    groupId,
    type: data.type,
    name: data.name,
    investorName: data.investorName,
    investedPoisha: data.investedPoisha,
    declaredProfitPoisha: data.declaredProfitPoisha ?? 0,
    projectStartDate: data.projectStartDate,
    projectEndDate: data.projectEndDate,
    quantity: data.quantity,
    pricePerUnitPoisha: data.pricePerUnitPoisha,
    interestRatePct: data.interestRatePct,
    purity: data.purity,
    status: INVESTMENT_STATUS.ACTIVE,
    note: data.note,
    createdAt: now,
    updatedAt: now,
  };
  await db.investments.put(rec as never);
  await enqueueSync("investments", rec.id, "upsert", toInvestmentPayload(rec));
  return rec;
}

/**
 * Re-derives an investment's status from its non-deleted events: LOSS when
 * capital is gone and a loss was recorded, COMPLETED when all capital came
 * back, otherwise ACTIVE (so deleting an event can undo a completion).
 */
async function recomputeInvestmentStatus(investmentId: string, now: string) {
  const db = getDb();
  const inv = await db.investments.get(investmentId);
  if (!inv || inv.deletedAt) return;
  const events = await db.investmentEvents
    .where("investmentId")
    .equals(investmentId)
    .filter((e) => !e.deletedAt)
    .toArray();
  const metrics = computeInvestmentMetrics(inv, events);
  let status: number = INVESTMENT_STATUS.ACTIVE;
  if (metrics.lossPoisha > 0 && metrics.remainingCapitalPoisha === 0) {
    status = INVESTMENT_STATUS.LOSS;
  } else if (metrics.remainingCapitalPoisha === 0 && metrics.capitalReturnedPoisha >= inv.investedPoisha) {
    status = INVESTMENT_STATUS.COMPLETED;
  }
  const updated: Investment = { ...inv, status, updatedAt: now };
  await db.investments.update(investmentId, { status, updatedAt: now });
  await enqueueSync("investments", investmentId, "upsert", toInvestmentPayload(updated));
}

/**
 * Records a cashflow event. The event inherits the investment's author-group
 * scope (its groupId). `groupId` is the viewer's current group; returns
 * undefined when the investment exists but isn't visible to the user.
 */
export async function addInvestmentEvent(
  userId: string,
  investmentId: string,
  data: { type: number; amountPoisha: number; eventDate: string; note?: string },
  groupId: string | null = null
) {
  const db = getDb();
  const inv = await db.investments.get(investmentId);
  if (inv && !isVisible(inv, userId, groupId)) return undefined;
  const now = new Date().toISOString();
  const ev: InvestmentEvent = {
    id: uuid(),
    userId,
    groupId: inv?.groupId ?? null,
    investmentId,
    type: data.type,
    amountPoisha: data.amountPoisha,
    eventDate: data.eventDate,
    note: data.note,
    createdAt: now,
    updatedAt: now,
  };
  await db.investmentEvents.put(ev as never);
  // Event first, then the parent's status — the remote event row must exist
  // before anything depends on it.
  await enqueueSync("investment_events", ev.id, "upsert", toInvestmentEventPayload(ev));
  if (inv) await recomputeInvestmentStatus(investmentId, now);

  return ev;
}

/** Soft-deletes a visible investment and all of its events. */
export async function deleteInvestment(userId: string, investmentId: string, groupId: string | null = null) {
  const db = getDb();
  const inv = await db.investments.get(investmentId);
  if (!inv || !isVisible(inv, userId, groupId)) return false;
  const now = new Date().toISOString();
  const events = await db.investmentEvents
    .where("investmentId")
    .equals(investmentId)
    .filter((e) => !e.deletedAt)
    .toArray();
  for (const e of events) {
    await db.investmentEvents.update(e.id, { deletedAt: now, updatedAt: now });
    await enqueueSync("investment_events", e.id, "delete", {});
  }
  await db.investments.update(investmentId, { deletedAt: now, updatedAt: now });
  await enqueueSync("investments", investmentId, "delete", {});
  return true;
}

/** Soft-deletes a visible event and re-derives the parent investment's status. */
export async function deleteInvestmentEvent(userId: string, eventId: string, groupId: string | null = null) {
  const db = getDb();
  const ev = await db.investmentEvents.get(eventId);
  if (!ev || !isVisible(ev, userId, groupId)) return false;
  const now = new Date().toISOString();
  await db.investmentEvents.update(eventId, { deletedAt: now, updatedAt: now });
  await enqueueSync("investment_events", eventId, "delete", {});
  await recomputeInvestmentStatus(ev.investmentId, now);
  return true;
}

/** Full remote `investments` row (snake_case) for an upsert. */
export function toInvestmentPayload(inv: Investment): Record<string, unknown> {
  return {
    id: inv.id,
    user_id: inv.userId,
    group_id: inv.groupId ?? null,
    type_smallint: inv.type,
    name: inv.name.slice(0, 80),
    investor_name: inv.investorName?.slice(0, 80) ?? null,
    invested_poisha: inv.investedPoisha,
    declared_profit_poisha: inv.declaredProfitPoisha ?? 0,
    project_start_date: inv.projectStartDate,
    project_end_date: inv.projectEndDate ?? null,
    quantity: inv.quantity ?? null,
    price_per_unit_poisha: inv.pricePerUnitPoisha ?? null,
    interest_rate_pct: inv.interestRatePct ?? null,
    purity: inv.purity?.slice(0, 10) ?? null,
    status_smallint: inv.status,
    note: inv.note?.slice(0, 200) ?? null,
  };
}

/** Full remote `investment_events` row (snake_case) for an upsert. */
export function toInvestmentEventPayload(ev: InvestmentEvent): Record<string, unknown> {
  return {
    id: ev.id,
    user_id: ev.userId,
    group_id: ev.groupId ?? null,
    investment_id: ev.investmentId,
    type_smallint: ev.type,
    amount_poisha: ev.amountPoisha,
    event_date: ev.eventDate,
    note: ev.note?.slice(0, 200) ?? null,
  };
}
