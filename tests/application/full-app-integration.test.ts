import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb, resetLocalDatabase } from "@/infrastructure/db/dexie/database";
import { getDashboardMetrics } from "@/application/analytics";
import { buildRuleContext } from "@/application/context-builder";
import { loadNotifications } from "@/application/notifications";
import { repayDebt } from "@/application/debts";
import { recoverLoanGiven } from "@/application/loans-given";
import { createInvestment, addInvestmentEvent, loadInvestmentsWithEvents } from "@/application/investments";
import { addTransaction } from "@/application/transactions";
import { evaluateSmartBuy, suggestBudgets } from "@/domain/rules-engine/evaluate";
import { computePortfolioValue } from "@/domain/investments/calculate";
import { INVESTMENT_TYPE, INVESTMENT_EVENT_TYPE, INVESTMENT_STATUS } from "@/lib/investment-constants";
import { TX_TYPES, DEBT_STATUS, LOAN_STATUS, HELD_STATUS, PRIORITY, BUY_TIER, BUY_RECO } from "@/lib/constants";
import { ymKey } from "@/lib/utils";
import type {
  Account,
  Debt,
  LoanGiven,
  HeldLiability,
  Goal,
  BuyEvaluation,
  UserProfile,
  Budget,
  InvestmentEvent,
} from "@/infrastructure/db/dexie/schema";

const USER_ID = "user-full";
const now = new Date().toISOString();
const today = now.slice(0, 10);
const ym = ymKey();

function iso(monthsAgo: number, day = 10) {
  const d = new Date();
  d.setMonth(d.getMonth() - monthsAgo);
  d.setDate(day);
  return d.toISOString().slice(0, 10);
}

/**
 * Populates one user with every entity type the app supports — accounts of
 * every kind, all three transaction types across three months, active +
 * settled debts/loans, a held liability, goals, every investment type with
 * every event type, and buy evaluations across the tier/priority spectrum.
 * Mirrors a real long-lived account so cross-feature aggregation (net worth,
 * maturity, notifications) can be checked for conflicts in one pass.
 */
async function seedFullDataset() {
  const db = getDb();

  const profile: UserProfile = {
    id: "profile-1",
    userId: USER_ID,
    monthlyIncomePoisha: 5_000_000,
    currencyCode: "BDT",
    locale: "en",
    emergencyMonths: 3,
    onboardingComplete: true,
    createdAt: now,
    updatedAt: now,
  };
  await db.userProfiles.put(profile as never);

  const accounts: Account[] = [
    { id: "acc-cash", userId: USER_ID, type: 1, name: "Cash", balancePoisha: 200_000, createdAt: now, updatedAt: now },
    { id: "acc-bank", userId: USER_ID, type: 2, name: "Bank", balancePoisha: 3_000_000, createdAt: now, updatedAt: now },
    { id: "acc-wallet", userId: USER_ID, type: 3, name: "Wallet", balancePoisha: 50_000, createdAt: now, updatedAt: now },
    { id: "acc-credit", userId: USER_ID, type: 4, name: "Credit Card", balancePoisha: -150_000, createdAt: now, updatedAt: now },
  ];
  await db.accounts.bulkPut(accounts as never);

  // Income + expenses (incl. impulse) + a transfer, spread across 3 months.
  for (let m = 0; m < 3; m++) {
    await addTransaction(USER_ID, {
      type: TX_TYPES.INCOME,
      amountPoisha: 5_000_000,
      accountId: "acc-bank",
      categoryId: "income",
      date: iso(m, 1),
    });
    await addTransaction(USER_ID, {
      type: TX_TYPES.EXPENSE,
      amountPoisha: 600_000,
      accountId: "acc-bank",
      categoryId: "food",
      date: iso(m, 5),
    });
    await addTransaction(USER_ID, {
      type: TX_TYPES.EXPENSE,
      amountPoisha: 200_000,
      accountId: "acc-cash",
      categoryId: "transport",
      date: iso(m, 6),
    });
  }
  await addTransaction(USER_ID, {
    type: TX_TYPES.EXPENSE,
    amountPoisha: 80_000,
    accountId: "acc-wallet",
    categoryId: "shopping",
    date: today,
    tags: ["impulse"],
  });
  await addTransaction(USER_ID, {
    type: TX_TYPES.TRANSFER,
    amountPoisha: 100_000,
    accountId: "acc-cash",
    toAccountId: "acc-bank",
    categoryId: "other",
    date: today,
  });

  // Budgets for the current month — food overspent (triggers notification),
  // transport within range.
  const budgets: Budget[] = [
    { id: "budget-food", userId: USER_ID, ym, categoryId: "food", allocatedPoisha: 500_000, carryPoisha: 0, createdAt: now, updatedAt: now },
    { id: "budget-transport", userId: USER_ID, ym, categoryId: "transport", allocatedPoisha: 300_000, carryPoisha: 0, createdAt: now, updatedAt: now },
  ];
  await db.budgets.bulkPut(budgets as never);

  // Debts: one overdue+active, one paid off via repayDebt (exercises the
  // transaction+account+debt integration path together).
  const overdueDebt: Debt = {
    id: "debt-overdue",
    userId: USER_ID,
    lender: "Friend",
    principalPoisha: 1_000_000,
    remainingPoisha: 1_000_000,
    borrowDate: iso(2),
    dueDate: iso(1),
    status: DEBT_STATUS.ACTIVE,
    createdAt: now,
    updatedAt: now,
  };
  const payableDebt: Debt = {
    id: "debt-payable",
    userId: USER_ID,
    lender: "Bank",
    principalPoisha: 200_000,
    remainingPoisha: 200_000,
    borrowDate: iso(1),
    status: DEBT_STATUS.ACTIVE,
    createdAt: now,
    updatedAt: now,
  };
  await db.debts.bulkPut([overdueDebt, payableDebt] as never);
  await repayDebt(USER_ID, payableDebt, 200_000, "acc-bank");

  // Loans given: one overdue+active, one fully recovered.
  const overdueLoan: LoanGiven = {
    id: "loan-overdue",
    userId: USER_ID,
    borrower: "Cousin",
    amountPoisha: 400_000,
    remainingPoisha: 400_000,
    borrowDate: iso(2),
    dueDate: iso(1),
    status: LOAN_STATUS.OVERDUE,
    createdAt: now,
    updatedAt: now,
  };
  const recoverableLoan: LoanGiven = {
    id: "loan-recoverable",
    userId: USER_ID,
    borrower: "Sister",
    amountPoisha: 150_000,
    remainingPoisha: 150_000,
    borrowDate: iso(1),
    status: LOAN_STATUS.ACTIVE,
    createdAt: now,
    updatedAt: now,
  };
  await db.loansGiven.bulkPut([overdueLoan, recoverableLoan] as never);
  await recoverLoanGiven(USER_ID, recoverableLoan, 150_000, "acc-bank");

  const held: HeldLiability = {
    id: "held-1",
    userId: USER_ID,
    owner: "Uncle",
    amountPoisha: 300_000,
    holdDate: iso(1),
    purpose: "Holding for a purchase",
    status: HELD_STATUS.ACTIVE,
    createdAt: now,
    updatedAt: now,
  };
  await db.heldLiabilities.put(held as never);

  const goals: Goal[] = [
    { id: "goal-emergency", userId: USER_ID, name: "Emergency Fund", targetPoisha: 15_000_000, savedPoisha: 3_000_000, createdAt: now, updatedAt: now },
    { id: "goal-vacation", userId: USER_ID, name: "Vacation", targetPoisha: 2_000_000, savedPoisha: 500_000, createdAt: now, updatedAt: now },
  ];
  await db.goals.bulkPut(goals as never);

  // Investments across every type, with every event type represented.
  const dps = await createInvestment(USER_ID, {
    type: INVESTMENT_TYPE.DPS,
    name: "5yr DPS",
    investedPoisha: 1_000_000,
    interestRatePct: 8,
    projectStartDate: iso(6),
  });
  await addInvestmentEvent(USER_ID, dps.id, {
    type: INVESTMENT_EVENT_TYPE.PROFIT_DECLARED,
    amountPoisha: 80_000,
    eventDate: iso(1),
  });
  await addInvestmentEvent(USER_ID, dps.id, {
    type: INVESTMENT_EVENT_TYPE.PROFIT_RECEIVED,
    amountPoisha: 40_000,
    eventDate: today,
  });

  const stocks = await createInvestment(USER_ID, {
    type: INVESTMENT_TYPE.STOCKS,
    name: "DSE Shares",
    investedPoisha: 2_000_000,
    quantity: 100,
    pricePerUnitPoisha: 20_000,
    projectStartDate: iso(3),
  });
  await addInvestmentEvent(USER_ID, stocks.id, {
    type: INVESTMENT_EVENT_TYPE.CAPITAL_RETURN,
    amountPoisha: 2_000_000,
    eventDate: today,
  });
  await addInvestmentEvent(USER_ID, stocks.id, {
    type: INVESTMENT_EVENT_TYPE.PROFIT_RECEIVED,
    amountPoisha: 300_000,
    eventDate: today,
  });

  const gold = await createInvestment(USER_ID, {
    type: INVESTMENT_TYPE.GOLD,
    name: "22k Gold",
    investedPoisha: 500_000,
    quantity: 10,
    purity: "22k",
    projectStartDate: iso(4),
  });

  const crypto = await createInvestment(USER_ID, {
    type: INVESTMENT_TYPE.CRYPTO,
    name: "Speculative Coin",
    investedPoisha: 300_000,
    projectStartDate: iso(2),
  });
  await addInvestmentEvent(USER_ID, crypto.id, {
    type: INVESTMENT_EVENT_TYPE.LOSS,
    amountPoisha: 300_000,
    eventDate: today,
  });

  // Buy evaluations spanning tiers/priorities/recommendations.
  const buyEvals: BuyEvaluation[] = [
    { id: "buy-1", userId: USER_ID, productName: "Phone", categoryId: "gadgets", pricePoisha: 400_000, priority: PRIORITY.NEED, score: 80, tier: BUY_TIER.REASONABLE, recommendation: BUY_RECO.BUY_NOW, reasonCodes: [], createdAt: now, updatedAt: now },
    { id: "buy-2", userId: USER_ID, productName: "Impulse Gadget", categoryId: "gadgets", pricePoisha: 1_500_000, priority: PRIORITY.IMPULSE, score: 20, tier: BUY_TIER.FINANCIALLY_UNSAFE, recommendation: BUY_RECO.AVOID, reasonCodes: [], createdAt: now, updatedAt: now },
    { id: "buy-3", userId: USER_ID, productName: "Laptop", categoryId: "gadgets", pricePoisha: 800_000, priority: PRIORITY.USEFUL, score: 60, tier: BUY_TIER.STRETCH, recommendation: BUY_RECO.SAVE_MONTHS, saveMonths: 2, reasonCodes: [], createdAt: now, updatedAt: now },
  ];
  await db.buyEvaluations.bulkPut(buyEvals as never);

  return { dps, stocks, gold, crypto };
}

describe("full app integration — every feature, one dataset", () => {
  beforeEach(async () => {
    await resetLocalDatabase();
  });

  it("computes dashboard metrics with every maturity component measured and no NaNs", async () => {
    await seedFullDataset();
    const metrics = await getDashboardMetrics(USER_ID);

    expect(Number.isFinite(metrics.netWorth.netWorthPoisha)).toBe(true);
    expect(metrics.maturity.measuredCount).toBe(6);
    expect(metrics.maturity.totalCount).toBe(6);
    for (const value of Object.values(metrics.maturity.components)) {
      expect(value).not.toBeNull();
      expect(Number.isNaN(value as number)).toBe(false);
    }
    expect(metrics.trend).toHaveLength(3);

    // Category totals must reconcile with the overall expense total —
    // no double counting or dropped transactions across categories.
    const categorySum = Object.values(metrics.byCategory).reduce((s, v) => s + v, 0);
    expect(categorySum).toBe(metrics.expense);
  });

  it("reflects account balances, debt repayment, and loan recovery consistently in net worth", async () => {
    await seedFullDataset();
    const db = getDb();
    const metrics = await getDashboardMetrics(USER_ID);

    const accounts = await db.accounts.where("userId").equals(USER_ID).toArray();
    const cashBankWallet = accounts.filter((a) => a.type !== 4).reduce((s, a) => s + a.balancePoisha, 0);
    const creditUsed = accounts.filter((a) => a.type === 4).reduce((s, a) => s + Math.abs(a.balancePoisha), 0);

    // The paid-off debt and recovered loan should no longer count as liabilities/receivables.
    const debts = await db.debts.where("userId").equals(USER_ID).toArray();
    const activeDebt = debts.find((d) => d.id === "debt-overdue")!;
    const paidDebt = debts.find((d) => d.id === "debt-payable")!;
    expect(paidDebt.status).toBe(DEBT_STATUS.PAID);
    expect(paidDebt.remainingPoisha).toBe(0);

    const loans = await db.loansGiven.where("userId").equals(USER_ID).toArray();
    const recoveredLoan = loans.find((l) => l.id === "loan-recoverable")!;
    expect(recoveredLoan.status).toBe(LOAN_STATUS.RECOVERED);
    expect(recoveredLoan.remainingPoisha).toBe(0);

    expect(metrics.netWorth.totalLiabilitiesPoisha).toBe(
      activeDebt.remainingPoisha + creditUsed + 300_000 // held liability
    );
    expect(metrics.netWorth.totalAssetsPoisha).toBeGreaterThan(cashBankWallet);
    expect(metrics.netWorth.netWorthPoisha).toBe(
      metrics.netWorth.totalAssetsPoisha - metrics.netWorth.totalLiabilitiesPoisha
    );
  });

  it("agrees on investment portfolio value between analytics, context-builder, and the investments module", async () => {
    await seedFullDataset();
    const db = getDb();
    const [dashboard, ruleCtx, withEvents] = await Promise.all([
      getDashboardMetrics(USER_ID),
      buildRuleContext(USER_ID, "food"),
      loadInvestmentsWithEvents(USER_ID),
    ]);

    const sumFromInvestmentsModule = withEvents.reduce((s, w) => s + w.metrics.effectiveValuePoisha, 0);

    const investments = await db.investments.where("userId").equals(USER_ID).toArray();
    const events = await db.investmentEvents.where("userId").equals(USER_ID).toArray();
    const byInv = new Map<string, InvestmentEvent[]>();
    for (const e of events) byInv.set(e.investmentId, [...(byInv.get(e.investmentId) ?? []), e]);
    const expected = computePortfolioValue(investments, byInv);

    expect(dashboard.netWorth.totalAssetsPoisha).toBeGreaterThanOrEqual(expected);
    expect(ruleCtx.investmentValuePoisha).toBe(expected);
    expect(sumFromInvestmentsModule).toBe(expected);

    // The crypto investment took a full loss — should read as a loss with zero remaining capital.
    const cryptoEntry = withEvents.find((w) => w.investment.name === "Speculative Coin")!;
    expect(cryptoEntry.metrics.isLoss).toBe(true);
    expect(cryptoEntry.metrics.effectiveValuePoisha).toBe(0);

    // Stocks fully returned capital + profit — should be marked completed.
    const stockEntry = withEvents.find((w) => w.investment.name === "DSE Shares")!;
    expect(stockEntry.investment.status).toBe(INVESTMENT_STATUS.COMPLETED);
  });

  it("raises notifications for overdue debt, overdue loan, and the overspent budget without duplicates", async () => {
    await seedFullDataset();
    const notifications = await loadNotifications(USER_ID);

    const types = notifications.map((n) => n.type);
    expect(types).toContain("overdue_debt");
    expect(types).toContain("overdue_loan");
    expect(types).toContain("budget_overspend");

    const ids = notifications.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);

    // High priority items (overdue debt/loan) must sort ahead of medium ones.
    const firstMediumIdx = notifications.findIndex((n) => n.priority === "medium");
    const lastHighIdx = notifications.map((n) => n.priority).lastIndexOf("high");
    if (firstMediumIdx !== -1 && lastHighIdx !== -1) {
      expect(lastHighIdx).toBeLessThan(firstMediumIdx);
    }
  });

  it("builds a rule context whose category budget remaining matches actual spend against the food budget", async () => {
    await seedFullDataset();
    const ctx = await buildRuleContext(USER_ID, "food");

    // Allocated 500_000, and food spend this month is 600_000 (from the m=0 loop iteration) -> overspent.
    expect(ctx.categoryBudgetRemainingPoisha).toBeLessThan(0);
    expect(ctx.monthlyIncomePoisha).toBe(5_000_000);
    expect(ctx.totalDebtPoisha).toBe(1_000_000); // only the still-active overdue debt
  });

  it("runs smart-buy evaluation and budget suggestion against the full context without conflicting with dashboard state", async () => {
    await seedFullDataset();
    const ctx = await buildRuleContext(USER_ID, "gadgets");

    const result = evaluateSmartBuy(ctx, {
      productName: "New Phone",
      categoryId: "gadgets",
      pricePoisha: 300_000,
      priority: PRIORITY.NEED,
    });
    expect(result.tier).toBeGreaterThanOrEqual(1);
    expect(result.recommendation).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(result.reasonCodes)).toBe(true);

    const suggestions = suggestBudgets(ctx.monthlyIncomePoisha);
    expect(suggestions.length).toBeGreaterThan(0);
    for (const s of suggestions) {
      expect(s.suggestedPoisha).toBeGreaterThanOrEqual(0);
    }
  });

  it("keeps account balances internally consistent after transfers, repayments, and recoveries", async () => {
    await seedFullDataset();
    const db = getDb();
    const accounts = await db.accounts.where("userId").equals(USER_ID).toArray();
    const transactions = await db.transactions.where("userId").equals(USER_ID).toArray();

    // Recompute each account's balance purely from its transaction history and
    // confirm it matches the stored balance — catches any double-application
    // or missed reversal across the debt/loan/transfer code paths.
    for (const acc of accounts) {
      let expected = 0;
      if (acc.id === "acc-cash") expected = 200_000;
      if (acc.id === "acc-bank") expected = 3_000_000;
      if (acc.id === "acc-wallet") expected = 50_000;
      if (acc.id === "acc-credit") expected = -150_000;

      for (const tx of transactions) {
        if (tx.type === TX_TYPES.INCOME && tx.accountId === acc.id) expected += tx.amountPoisha;
        if (tx.type === TX_TYPES.EXPENSE && tx.accountId === acc.id) expected -= tx.amountPoisha;
        if (tx.type === TX_TYPES.TRANSFER) {
          if (tx.accountId === acc.id) expected -= tx.amountPoisha;
          if (tx.toAccountId === acc.id) expected += tx.amountPoisha;
        }
      }
      expect(acc.balancePoisha).toBe(expected);
    }
  });
});
