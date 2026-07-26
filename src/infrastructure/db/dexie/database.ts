import Dexie, { type EntityTable, type Table } from "dexie";
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
  PlannedPayment,
  ShoppingList,
  ShoppingListItem,
  SyncQueueItem,
  Group,
  GroupMember,
} from "./schema";
import { INVESTMENT_STATUS } from "@/lib/investment-constants";

export class FinanceDatabase extends Dexie {
  userProfiles!: EntityTable<UserProfile, "id">;
  accounts!: EntityTable<Account, "id">;
  categories!: EntityTable<Category, "id">;
  transactions!: EntityTable<Transaction, "id">;
  budgets!: EntityTable<Budget, "id">;
  debts!: EntityTable<Debt, "id">;
  loansGiven!: EntityTable<LoanGiven, "id">;
  heldLiabilities!: EntityTable<HeldLiability, "id">;
  goals!: EntityTable<Goal, "id">;
  investments!: EntityTable<Investment, "id">;
  investmentEvents!: EntityTable<InvestmentEvent, "id">;
  buyEvaluations!: EntityTable<BuyEvaluation, "id">;
  plannedPayments!: EntityTable<PlannedPayment, "id">;
  shoppingLists!: EntityTable<ShoppingList, "id">;
  shoppingListItems!: EntityTable<ShoppingListItem, "id">;
  syncQueue!: EntityTable<SyncQueueItem, "id">;
  groups!: EntityTable<Group, "id">;
  groupMembers!: Table<GroupMember, [string, string]>;

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

    this.version(3).stores({
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
      plannedPayments: "id, userId, nextDueDate, status, updatedAt",
      syncQueue: "++id, createdAt",
    });

    this.version(4).stores({
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
      plannedPayments: "id, userId, nextDueDate, status, updatedAt",
      shoppingLists: "id, userId, status, updatedAt",
      shoppingListItems: "id, userId, listId, checked, updatedAt",
      syncQueue: "++id, createdAt",
    });

    this.version(5).stores({
      userProfiles: "id, userId",
      accounts: "id, userId, groupId, updatedAt",
      categories: "id, userId",
      transactions: "id, userId, groupId, date, categoryId, updatedAt",
      budgets: "id, userId, groupId, ym, categoryId",
      debts: "id, userId, groupId, updatedAt",
      loansGiven: "id, userId, groupId, updatedAt",
      heldLiabilities: "id, userId, groupId, status, updatedAt",
      goals: "id, userId, groupId",
      investments: "id, userId, groupId, status, updatedAt",
      investmentEvents: "id, userId, groupId, investmentId, eventDate, updatedAt",
      buyEvaluations: "id, userId, groupId, updatedAt",
      plannedPayments: "id, userId, groupId, nextDueDate, status, updatedAt",
      shoppingLists: "id, userId, groupId, status, updatedAt",
      shoppingListItems: "id, userId, groupId, listId, checked, updatedAt",
      groups: "id",
      groupMembers: "[groupId+userId], groupId, userId",
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

/** Call after schema upgrade failures — clears local DB */
export async function resetLocalDatabase(): Promise<void> {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
  await Dexie.delete("FinanceOS");
}
