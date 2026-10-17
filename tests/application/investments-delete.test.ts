import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb, resetLocalDatabase } from "@/infrastructure/db/dexie/database";
import {
  addInvestmentEvent,
  createInvestment,
  deleteInvestment,
  deleteInvestmentEvent,
  loadInvestmentsWithEvents,
} from "@/application/investments";
import { INVESTMENT_EVENT_TYPE, INVESTMENT_STATUS } from "@/lib/investment-constants";
import { GROUP, ME, OTHER_GROUP, TEAMMATE, lastUpsert, queued } from "./helpers";

const project = { type: 6, name: "Project", investedPoisha: 100_000, projectStartDate: "2026-01-01" };

describe("investment deletes", () => {
  beforeEach(async () => {
    await resetLocalDatabase();
  });

  it("deleteInvestment soft-deletes the investment and its events", async () => {
    const inv = await createInvestment(ME, project);
    const ev = await addInvestmentEvent(ME, inv.id, {
      type: INVESTMENT_EVENT_TYPE.PROFIT_RECEIVED,
      amountPoisha: 1_000,
      eventDate: "2026-02-01",
    });
    expect(await deleteInvestment(ME, inv.id)).toBe(true);
    expect((await getDb().investments.get(inv.id))?.deletedAt).toBeTruthy();
    expect((await getDb().investmentEvents.get(ev!.id))?.deletedAt).toBeTruthy();
    expect((await queued("investment_events", ev!.id)).some((q) => q.operation === "delete")).toBe(true);
    expect((await queued("investments", inv.id)).some((q) => q.operation === "delete")).toBe(true);
    expect(await loadInvestmentsWithEvents(ME)).toHaveLength(0);
  });

  it("deleteInvestmentEvent re-derives status (undoing a completion)", async () => {
    const inv = await createInvestment(ME, project);
    const ev = await addInvestmentEvent(ME, inv.id, {
      type: INVESTMENT_EVENT_TYPE.CAPITAL_RETURN,
      amountPoisha: 100_000,
      eventDate: "2026-02-01",
    });
    expect((await getDb().investments.get(inv.id))?.status).toBe(INVESTMENT_STATUS.COMPLETED);

    expect(await deleteInvestmentEvent(ME, ev!.id)).toBe(true);
    expect((await getDb().investments.get(inv.id))?.status).toBe(INVESTMENT_STATUS.ACTIVE);
    expect((await lastUpsert("investments", inv.id))?.status_smallint).toBe(INVESTMENT_STATUS.ACTIVE);
    const [row] = await loadInvestmentsWithEvents(ME);
    expect(row.events).toHaveLength(0);
  });

  it("events inherit the investment's group and payloads carry user_id/group_id", async () => {
    const inv = await createInvestment(TEAMMATE, project, GROUP);
    const ev = await addInvestmentEvent(ME, inv.id, {
      type: INVESTMENT_EVENT_TYPE.PROFIT_RECEIVED,
      amountPoisha: 1_000,
      eventDate: "2026-02-01",
    }, GROUP);
    expect(ev?.groupId).toBe(GROUP);
    expect(await lastUpsert("investment_events", ev!.id)).toMatchObject({ user_id: ME, group_id: GROUP });
    expect(await lastUpsert("investments", inv.id)).toMatchObject({ user_id: TEAMMATE, group_id: GROUP });
    expect((await loadInvestmentsWithEvents(ME, GROUP))[0].events).toHaveLength(1);
  });

  it("refuses events and deletes on another group's investment", async () => {
    const inv = await createInvestment(TEAMMATE, project, OTHER_GROUP);
    expect(
      await addInvestmentEvent(ME, inv.id, { type: INVESTMENT_EVENT_TYPE.LOSS, amountPoisha: 1, eventDate: "2026-02-01" }, GROUP)
    ).toBeUndefined();
    expect(await deleteInvestment(ME, inv.id, GROUP)).toBe(false);
    expect(await loadInvestmentsWithEvents(ME, GROUP)).toHaveLength(0);
  });
});
