import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb, resetLocalDatabase } from "@/infrastructure/db/dexie/database";
import {
  addLiability,
  deleteLiability,
  listLiabilities,
  markLiabilityReturned,
  updateLiability,
} from "@/application/liabilities";
import { HELD_STATUS } from "@/lib/constants";
import { GROUP, ME, OTHER_GROUP, TEAMMATE, lastUpsert, queued } from "./helpers";

const HELD_NOT_NULL = ["id", "user_id", "owner", "amount_poisha", "hold_date", "status_smallint"];

describe("held liabilities service", () => {
  beforeEach(async () => {
    await resetLocalDatabase();
  });

  it("addLiability queues a full row", async () => {
    const h = await addLiability(ME, { owner: "Mom", amountPoisha: 5_000, purpose: "Rent" });
    expect(h).toMatchObject({ status: HELD_STATUS.ACTIVE, groupId: null });
    const payload = await lastUpsert("held_liabilities", h.id);
    for (const col of HELD_NOT_NULL) expect(payload?.[col]).toBeDefined();
    expect(payload).toMatchObject({ purpose: "Rent", group_id: null });
  });

  it("markLiabilityReturned sends the full remote row", async () => {
    const h = await addLiability(ME, { owner: "Mom", amountPoisha: 5_000 }, GROUP);
    const returned = await markLiabilityReturned(ME, h.id, GROUP);
    expect(returned?.status).toBe(HELD_STATUS.RETURNED);
    const payload = await lastUpsert("held_liabilities", h.id);
    for (const col of HELD_NOT_NULL) expect(payload?.[col]).toBeDefined();
    expect(payload).toMatchObject({ owner: "Mom", amount_poisha: 5_000, status_smallint: HELD_STATUS.RETURNED, group_id: GROUP });
    expect(payload?.return_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("updateLiability edits fields and keeps status", async () => {
    const h = await addLiability(ME, { owner: "Mom", amountPoisha: 5_000 });
    const updated = await updateLiability(ME, h.id, { owner: "Dad", amountPoisha: 7_000, purpose: "Fees" });
    expect(updated).toMatchObject({ owner: "Dad", amountPoisha: 7_000, purpose: "Fees", status: HELD_STATUS.ACTIVE });
  });

  it("deleteLiability soft-deletes and queues a delete", async () => {
    const h = await addLiability(ME, { owner: "Mom", amountPoisha: 5_000 });
    expect(await deleteLiability(ME, h.id)).toBe(true);
    expect(await listLiabilities(ME)).toHaveLength(0);
    expect((await queued("held_liabilities", h.id)).some((q) => q.operation === "delete")).toBe(true);
  });

  it("group members share edit rights; other groups are invisible", async () => {
    const shared = await addLiability(TEAMMATE, { owner: "A", amountPoisha: 1 }, GROUP);
    const foreign = await addLiability(TEAMMATE, { owner: "B", amountPoisha: 1 }, OTHER_GROUP);
    expect((await listLiabilities(ME, GROUP)).map((h) => h.id)).toEqual([shared.id]);
    expect(await markLiabilityReturned(ME, shared.id, GROUP)).toBeDefined();
    expect(await markLiabilityReturned(ME, foreign.id, GROUP)).toBeUndefined();
    expect(await deleteLiability(ME, foreign.id, GROUP)).toBe(false);
    expect((await getDb().heldLiabilities.get(foreign.id))?.deletedAt).toBeFalsy();
  });
});
