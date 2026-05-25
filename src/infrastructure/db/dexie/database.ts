import Dexie, { type EntityTable } from "dexie";
import type {
  UserProfile,
  Account,
  Category,
  Transaction,
  Budget,
  Debt,
  LoanGiven,
  HeldLiability,
  Goal,
  Investment,
  InvestmentEvent,
  BuyEvaluation,
  SyncQueueItem,
} from "./schema";
import { INVESTMENT_STATUS } from "@/lib/investment-constants";

export class FinanceDatabase extends Dexie {
  userProfiles!: EntityTable<UserProfile, string>;
  accounts!: EntityTable<Account, string>;
  categories!: EntityTable<Category, string>;
  transactions!: EntityTable<Transaction, string>;
  budgets!: EntityTable<Budget, string>;
  debts!: EntityTable<Debt, string>;
  loansGiven!: EntityTable<LoanGiven, string>;
  heldLiabilities!: EntityTable<HeldLiability, string>;
  goals!: EntityTable<Goal, string>;
  investments!: EntityTable<Investment, string>;
  investmentEvents!: EntityTable<InvestmentEvent, string>;
  buyEvaluations!: EntityTable<BuyEvaluation, string>;
  syncQueue!: EntityTable<SyncQueueItem, number>;

  constructor() {
    super("FinanceOS");

    this.version(1).stores({
      userProfiles: "id, userId",
      accounts: "id, userId, updatedAt",
      categories: "id, userId",
      transactions: "id, userId, date, categoryId, updatedAt",
      budgets: "id, userId, ym, categoryId",
      debts: "id, userId, updatedAt",
      loansGiven: "id, userId, updatedAt",
      heldLiabilities: "id, userId, status, updatedAt",
      goals: "id, userId",
      investments: "id, userId",
      buyEvaluations: "id, userId, updatedAt",
      syncQueue: "++id, createdAt",
    });

    this.version(2)
      .stores({
        userProfiles: "id, userId",
        accounts: "id, userId, updatedAt",
        categories: "id, userId",
        transactions: "id, userId, date, categoryId, updatedAt",
        budgets: "id, userId, ym, categoryId",
        debts: "id, userId, updatedAt",
        loansGiven: "id, userId, updatedAt",
        heldLiabilities: "id, userId, status, updatedAt",
        goals: "id, userId",
        investments: "id, userId, status, updatedAt",
        investmentEvents: "id, userId, investmentId, eventDate, updatedAt",
        buyEvaluations: "id, userId, updatedAt",
        syncQueue: "++id, createdAt",
      })
      .upgrade(async (tx) => {
        const investments = await tx.table("investments").toArray();
        for (const inv of investments) {
          const legacy = inv as Investment & {
            startDate?: string;
            maturityDate?: string;
            currentValuePoisha?: number;
          };
          const start =
            legacy.projectStartDate ??
            legacy.startDate ??
            new Date().toISOString().slice(0, 10);
          await tx.table("investments").update(inv.id, {
            projectStartDate: start,
            projectEndDate: legacy.projectEndDate ?? legacy.maturityDate,
            status: legacy.status ?? INVESTMENT_STATUS.ACTIVE,
            declaredProfitPoisha: legacy.declaredProfitPoisha ?? 0,
            investorName: legacy.investorName ?? "",
          });
        }
      });
  }
}

let dbInstance: FinanceDatabase | null = null;

export function getDb(): FinanceDatabase {
  if (!dbInstance) {
    dbInstance = new FinanceDatabase();
  }
  return dbInstance;
}

/** Call after schema upgrade failures — clears local DB */
export async function resetLocalDatabase(): Promise<void> {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
  await Dexie.delete("FinanceOS");
}
