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
  BuyEvaluation,
  SyncQueueItem,
} from "./schema";

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
  }
}

let dbInstance: FinanceDatabase | null = null;

export function getDb(): FinanceDatabase {
  if (!dbInstance) {
    dbInstance = new FinanceDatabase();
  }
  return dbInstance;
}
