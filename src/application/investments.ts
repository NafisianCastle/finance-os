import { v4 as uuid } from "uuid";
import { getDb } from "@/infrastructure/db/dexie/database";
import type { Investment, InvestmentEvent } from "@/infrastructure/db/dexie/schema";
import { INVESTMENT_STATUS } from "@/lib/investment-constants";
import { computeInvestmentMetrics } from "@/domain/investments/calculate";
import { enqueueSync } from "@/infrastructure/sync/sync-queue";

export async function loadInvestmentsWithEvents(userId: string) {
  const db = getDb();
  const investments = await db.investments
    .where("userId")
    .equals(userId)
    .filter((i) => !i.deletedAt)
    .toArray();
  const events = await db.investmentEvents
    .where("userId")
    .equals(userId)
    .filter((e) => !e.deletedAt)
    .toArray();
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
  }
) {
  const db = getDb();
  const now = new Date().toISOString();
  const rec: Investment = {
    id: uuid(),
    userId,
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
  await enqueueSync("investments", rec.id, "upsert", leanInvestment(rec));
  return rec;
}

export async function addInvestmentEvent(
  userId: string,
  investmentId: string,
  data: { type: number; amountPoisha: number; eventDate: string; note?: string }
) {
  const db = getDb();
  const now = new Date().toISOString();
  const ev: InvestmentEvent = {
    id: uuid(),
    userId,
    investmentId,
    type: data.type,
    amountPoisha: data.amountPoisha,
    eventDate: data.eventDate,
    note: data.note,
    createdAt: now,
    updatedAt: now,
  };
  await db.investmentEvents.put(ev as never);

  const inv = await db.investments.get(investmentId);
  if (inv) {
    const events = await db.investmentEvents
      .where("investmentId")
      .equals(investmentId)
      .filter((e) => !e.deletedAt)
      .toArray();
    const metrics = computeInvestmentMetrics(inv, [...events, ev]);
    let status = inv.status;
    if (metrics.lossPoisha > 0 && metrics.remainingCapitalPoisha === 0) {
      status = INVESTMENT_STATUS.LOSS;
    } else if (
      metrics.remainingCapitalPoisha === 0 &&
      metrics.capitalReturnedPoisha >= inv.investedPoisha
    ) {
      status = INVESTMENT_STATUS.COMPLETED;
    }
    await db.investments.update(investmentId, { status, updatedAt: now });
    await enqueueSync("investments", investmentId, "upsert", {
      ...leanInvestment({ ...inv, status }),
      status_smallint: status,
    });
  }

  await enqueueSync("investment_events", ev.id, "upsert", {
    id: ev.id,
    investment_id: investmentId,
    type_smallint: data.type,
    amount_poisha: data.amountPoisha,
    event_date: data.eventDate,
    note: data.note?.slice(0, 200),
  });

  return ev;
}

function leanInvestment(inv: Investment) {
  return {
    id: inv.id,
    type_smallint: inv.type,
    name: inv.name.slice(0, 80),
    investor_name: inv.investorName?.slice(0, 80),
    invested_poisha: inv.investedPoisha,
    declared_profit_poisha: inv.declaredProfitPoisha ?? 0,
    project_start_date: inv.projectStartDate,
    project_end_date: inv.projectEndDate ?? null,
    quantity: inv.quantity ?? null,
    price_per_unit_poisha: inv.pricePerUnitPoisha ?? null,
    interest_rate_pct: inv.interestRatePct ?? null,
    purity: inv.purity?.slice(0, 10) ?? null,
    status_smallint: inv.status,
    note: inv.note?.slice(0, 200),
  };
}
