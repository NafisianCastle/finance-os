import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb, resetLocalDatabase } from "@/infrastructure/db/dexie/database";
import { addGoal, contributeToGoal, deleteGoal, listGoals, toGoalPayload, updateGoal } from "@/application/goals";
import { TX_TYPES } from "@/lib/constants";
import { GROUP, ME, OTHER_GROUP, TEAMMATE, balance, lastUpsert, makeAccount, queued } from "./helpers";

describe("goals service", () => {
  beforeEach(async () => {
    await resetLocalDatabase();
    await getDb().accounts.put(makeAccount({ id: "acc-1", balancePoisha: 100_000 }));
  });

  it("addGoal stores the goal and queues a full row", async () => {
    const g = await addGoal(ME, { name: " Trip ", targetPoisha: 50_000, deadline: "2027-01-01" }, GROUP);
    expect(g).toMatchObject({ name: "Trip", savedPoisha: 0, groupId: GROUP });
    expect(await lastUpsert("goals", g.id)).toEqual(toGoalPayload(g));
    expect(toGoalPayload(g)).toMatchObject({ user_id: ME, group_id: GROUP, deadline: "2027-01-01", saved_poisha: 0 });
  });

  it("updateGoal edits name/target/deadline and keeps savings", async () => {
    const g = await addGoal(ME, { name: "Trip", targetPoisha: 50_000 });
    await contributeToGoal(ME, g.id, 10_000, "acc-1", "note");
    const updated = await updateGoal(ME, g.id, { name: "Bigger trip", targetPoisha: 80_000, deadline: "2027-06-01" });
    expect(updated).toMatchObject({ name: "Bigger trip", targetPoisha: 80_000, savedPoisha: 10_000, deadline: "2027-06-01" });
  });

  it("deleteGoal soft-deletes and queues a delete", async () => {
    const g = await addGoal(ME, { name: "Trip", targetPoisha: 50_000 });
    expect(await deleteGoal(ME, g.id)).toBe(true);
    expect(await listGoals(ME)).toHaveLength(0);
    expect((await queued("goals", g.id)).some((q) => q.operation === "delete")).toBe(true);
  });

  it("contributeToGoal logs a dated savings expense and bumps savedPoisha", async () => {
    const g = await addGoal(ME, { name: "Trip", targetPoisha: 50_000 }, GROUP);
    const updated = await contributeToGoal(ME, g.id, 10_000, "acc-1", "Saved for Trip", GROUP);
    expect(updated?.savedPoisha).toBe(10_000);
    expect(await balance("acc-1")).toBe(90_000);
    const [tx] = await getDb().transactions.toArray();
    expect(tx).toMatchObject({ type: TX_TYPES.EXPENSE, categoryId: "savings", note: "Saved for Trip", groupId: GROUP });
    expect(tx.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect((await lastUpsert("goals", g.id))?.saved_poisha).toBe(10_000);
  });

  it("contributeToGoal ignores non-positive amounts", async () => {
    const g = await addGoal(ME, { name: "Trip", targetPoisha: 50_000 });
    expect(await contributeToGoal(ME, g.id, 0, "acc-1")).toBeUndefined();
    expect(await getDb().transactions.count()).toBe(0);
  });

  it("members can edit a teammate's shared goal, not another group's", async () => {
    const shared = await addGoal(TEAMMATE, { name: "Shared", targetPoisha: 1_000 }, GROUP);
    const foreign = await addGoal(TEAMMATE, { name: "Foreign", targetPoisha: 1_000 }, OTHER_GROUP);
    expect((await listGoals(ME, GROUP)).map((g) => g.id)).toEqual([shared.id]);
    expect(await updateGoal(ME, shared.id, { targetPoisha: 2_000 }, GROUP)).toBeDefined();
    expect(await updateGoal(ME, foreign.id, { targetPoisha: 2_000 }, GROUP)).toBeUndefined();
    expect(await contributeToGoal(ME, foreign.id, 100, "acc-1", undefined, GROUP)).toBeUndefined();
  });
});
