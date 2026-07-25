import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb, resetLocalDatabase } from "@/infrastructure/db/dexie/database";
import {
  loadInvestmentsWithEvents,
  createInvestment,
  addInvestmentEvent,
} from "@/application/investments";
import { INVESTMENT_STATUS, INVESTMENT_EVENT_TYPE } from "@/lib/investment-constants";

const USER_ID = "user-1";

describe("createInvestment", () => {
  beforeEach(async () => {
    await resetLocalDatabase();
  });

  it("creates an investment with ACTIVE status and queues a sync entry", async () => {
    const inv = await createInvestment(USER_ID, {
      type: 6,
      name: "Project A",
      investedPoisha: 100_000,
      projectStartDate: "2026-01-01",
    });

    expect(inv.status).toBe(INVESTMENT_STATUS.ACTIVE);
    const stored = await getDb().investments.get(inv.id);
    expect(stored?.name).toBe("Project A");
    const queued = await getDb().syncQueue.filter((i) => i.table === "investments" && i.recordId === inv.id).toArray();
    expect(queued).toHaveLength(1);
  });

  it("defaults declaredProfitPoisha to 0 when not given", async () => {
    const inv = await createInvestment(USER_ID, {
      type: 6,
      name: "Project B",
      investedPoisha: 50_000,
      projectStartDate: "2026-01-01",
    });
    expect(inv.declaredProfitPoisha).toBe(0);
  });
});

describe("addInvestmentEvent", () => {
  beforeEach(async () => {
    await resetLocalDatabase();
  });

  it("records the event and queues its own sync entry", async () => {
    const inv = await createInvestment(USER_ID, {
      type: 6,
      name: "Project A",
      investedPoisha: 100_000,
      projectStartDate: "2026-01-01",
    });

    const ev = await addInvestmentEvent(USER_ID, inv.id, {
      type: INVESTMENT_EVENT_TYPE.PROFIT_RECEIVED,
      amountPoisha: 5_000,
      eventDate: "2026-02-01",
    });

    const stored = await getDb().investmentEvents.get(ev.id);
    expect(stored?.amountPoisha).toBe(5_000);
    const queued = await getDb().syncQueue.filter((i) => i.table === "investment_events" && i.recordId === ev.id).toArray();
    expect(queued).toHaveLength(1);
  });

  it("marks the investment COMPLETED once capital and declared profit are fully returned", async () => {
    const inv = await createInvestment(USER_ID, {
      type: 6,
      name: "Project A",
      investedPoisha: 100_000,
      declaredProfitPoisha: 10_000,
      projectStartDate: "2026-01-01",
    });

    await addInvestmentEvent(USER_ID, inv.id, {
      type: INVESTMENT_EVENT_TYPE.CAPITAL_RETURN,
      amountPoisha: 100_000,
      eventDate: "2026-02-01",
    });
    await addInvestmentEvent(USER_ID, inv.id, {
      type: INVESTMENT_EVENT_TYPE.PROFIT_RECEIVED,
      amountPoisha: 10_000,
      eventDate: "2026-02-01",
    });

    const updated = await getDb().investments.get(inv.id);
    expect(updated?.status).toBe(INVESTMENT_STATUS.COMPLETED);
  });

  it("marks the investment LOSS once capital is returned/written off and a loss is recorded", async () => {
    const inv = await createInvestment(USER_ID, {
      type: 6,
      name: "Project A",
      investedPoisha: 100_000,
      projectStartDate: "2026-01-01",
    });

    await addInvestmentEvent(USER_ID, inv.id, {
      type: INVESTMENT_EVENT_TYPE.CAPITAL_RETURN,
      amountPoisha: 100_000,
      eventDate: "2026-02-01",
    });
    await addInvestmentEvent(USER_ID, inv.id, {
      type: INVESTMENT_EVENT_TYPE.LOSS,
      amountPoisha: 30_000,
      eventDate: "2026-02-01",
    });

    const updated = await getDb().investments.get(inv.id);
    expect(updated?.status).toBe(INVESTMENT_STATUS.LOSS);
  });

  it("is a no-op update when the investment does not exist", async () => {
    await expect(
      addInvestmentEvent(USER_ID, "missing-inv", {
        type: INVESTMENT_EVENT_TYPE.PROFIT_RECEIVED,
        amountPoisha: 1_000,
        eventDate: "2026-02-01",
      })
    ).resolves.toBeDefined();
  });
});

describe("loadInvestmentsWithEvents", () => {
  beforeEach(async () => {
    await resetLocalDatabase();
  });

  it("groups events by investment and attaches computed metrics", async () => {
    const invA = await createInvestment(USER_ID, {
      type: 6,
      name: "Project A",
      investedPoisha: 100_000,
      projectStartDate: "2026-01-01",
    });
    const invB = await createInvestment(USER_ID, {
      type: 6,
      name: "Project B",
      investedPoisha: 50_000,
      projectStartDate: "2026-01-01",
    });
    await addInvestmentEvent(USER_ID, invA.id, {
      type: INVESTMENT_EVENT_TYPE.PROFIT_RECEIVED,
      amountPoisha: 5_000,
      eventDate: "2026-02-01",
    });

    const results = await loadInvestmentsWithEvents(USER_ID);

    expect(results).toHaveLength(2);
    const a = results.find((r) => r.investment.id === invA.id)!;
    const b = results.find((r) => r.investment.id === invB.id)!;
    expect(a.events).toHaveLength(1);
    expect(b.events).toHaveLength(0);
    expect(a.metrics.profitReceivedPoisha).toBe(5_000);
  });

  it("excludes soft-deleted investments", async () => {
    const inv = await createInvestment(USER_ID, {
      type: 6,
      name: "Project A",
      investedPoisha: 100_000,
      projectStartDate: "2026-01-01",
    });
    await getDb().investments.update(inv.id, { deletedAt: new Date().toISOString() });

    const results = await loadInvestmentsWithEvents(USER_ID);
    expect(results).toHaveLength(0);
  });
});
