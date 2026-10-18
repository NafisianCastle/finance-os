import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb, resetLocalDatabase } from "@/infrastructure/db/dexie/database";
import { getBudgetsForMonth } from "@/infrastructure/db/dexie/helpers";
import { loadNotifications } from "@/application/notifications";
import { getDashboardMetrics } from "@/application/analytics";
import { buildRuleContext } from "@/application/context-builder";
import { DEBT_STATUS, LOAN_STATUS, PLANNED_PAYMENT_DIRECTION, PLANNED_PAYMENT_STATUS } from "@/lib/constants";
import { ymKey } from "@/lib/utils";
import { GROUP, ME, OTHER_GROUP, TEAMMATE, makeAccount } from "./helpers";

const now = new Date().toISOString();

describe("group-scoped reads", () => {
  beforeEach(async () => {
    await resetLocalDatabase();
    const db = getDb();
    await db.accounts.bulkPut([
      makeAccount({ id: "mine", balancePoisha: 1_000 }),
      makeAccount({ id: "shared", userId: TEAMMATE, groupId: GROUP, balancePoisha: 2_000 }),
      makeAccount({ id: "foreign", userId: TEAMMATE, groupId: OTHER_GROUP, balancePoisha: 4_000 }),
      makeAccount({ id: "teammate-personal", userId: TEAMMATE, balancePoisha: 8_000 }),
    ]);
  });

  it("dashboard net worth counts personal + current-group accounts only", async () => {
    const solo = await getDashboardMetrics(ME);
    const grouped = await getDashboardMetrics(ME, undefined, GROUP);
    expect(solo.netWorth.spendablePoisha).toBe(1_000);
    expect(grouped.netWorth.spendablePoisha).toBe(3_000);
  });

  it("rule context sees the group's accounts", async () => {
    const ctx = await buildRuleContext(ME, "food", GROUP);
    expect(ctx.liquidSavingsPoisha).toBe(3_000);
  });

  it("getBudgetsForMonth returns personal + current-group budgets", async () => {
    const ym = ymKey();
    const budget = { ym, allocatedPoisha: 1, carryPoisha: 0, createdAt: now, updatedAt: now };
    await getDb().budgets.bulkPut([
      { ...budget, id: "b1", userId: ME, categoryId: "food" },
      { ...budget, id: "b2", userId: TEAMMATE, groupId: GROUP, categoryId: "bills" },
      { ...budget, id: "b3", userId: TEAMMATE, groupId: OTHER_GROUP, categoryId: "bills" },
      { ...budget, id: "b4", userId: ME, categoryId: "food", ym: "200001" },
    ]);
    expect((await getBudgetsForMonth(ME, ym)).map((b) => b.id)).toEqual(["b1"]);
    expect((await getBudgetsForMonth(ME, ym, GROUP)).map((b) => b.id).sort()).toEqual(["b1", "b2"]);
  });
});

describe("notifications as i18n keys", () => {
  beforeEach(async () => {
    await resetLocalDatabase();
  });

  it("emits keys + params and includes a teammate's shared overdue loan", async () => {
    await getDb().loansGiven.put({
      id: "l1",
      userId: TEAMMATE,
      groupId: GROUP,
      borrower: "Karim",
      amountPoisha: 1_000,
      remainingPoisha: 1_000,
      borrowDate: "2025-01-01",
      dueDate: "2000-01-01",
      status: LOAN_STATUS.ACTIVE,
      createdAt: now,
      updatedAt: now,
    });
    expect(await loadNotifications(ME)).toEqual([]);
    const [n] = await loadNotifications(ME, undefined, GROUP);
    expect(n).toMatchObject({
      type: "overdue_loan",
      titleKey: "overdueLoanTitle",
      bodyKey: "overdueLoanBody",
      params: { borrower: "Karim", dueDate: "2000-01-01" },
    });
    expect(n.title).toBeUndefined();
  });

  it("overdue debt uses lender + dueDate params", async () => {
    await getDb().debts.put({
      id: "d1",
      userId: ME,
      lender: "Bank",
      principalPoisha: 1,
      remainingPoisha: 1,
      borrowDate: "2025-01-01",
      dueDate: "2000-01-01",
      status: DEBT_STATUS.ACTIVE,
      createdAt: now,
      updatedAt: now,
    });
    const [n] = await loadNotifications(ME);
    expect(n).toMatchObject({ titleKey: "overdueDebtTitle", bodyKey: "overdueDebtBody", params: { lender: "Bank", dueDate: "2000-01-01" } });
  });

  it("planned payments pick a direction/overdue-specific body key", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const base = {
      amountPoisha: 1,
      accountId: "a",
      categoryId: "bills",
      isRecurring: false,
      status: PLANNED_PAYMENT_STATUS.ACTIVE,
      createdAt: now,
      updatedAt: now,
      userId: ME,
    };
    await getDb().plannedPayments.bulkPut([
      { ...base, id: "p1", direction: PLANNED_PAYMENT_DIRECTION.PAY, nextDueDate: "2000-01-01", counterparty: "DESCO" },
      { ...base, id: "p2", direction: PLANNED_PAYMENT_DIRECTION.RECEIVE, nextDueDate: today },
    ]);
    const ns = await loadNotifications(ME);
    const p1 = ns.find((n) => n.id.startsWith("planned_payment_due_p1"))!;
    const p2 = ns.find((n) => n.id.startsWith("planned_payment_due_p2"))!;
    expect(p1).toMatchObject({ titleKey: "plannedPaymentDueTitleWithParty", bodyKey: "plannedPaymentOverduePayBody", params: { counterparty: "DESCO" } });
    expect(p2).toMatchObject({ titleKey: "plannedPaymentDueTitle", bodyKey: "plannedPaymentDueTodayReceiveBody" });
  });
});
