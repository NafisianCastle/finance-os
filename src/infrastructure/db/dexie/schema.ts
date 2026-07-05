export interface BaseRecord {
  id: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
  syncStatus?: "pending" | "synced" | "error";
}

export interface UserProfile extends BaseRecord {
  monthlyIncomePoisha: number;
  currencyCode: string;
  locale: string;
  emergencyMonths: number;
  onboardingComplete: boolean;
}

export interface Account extends BaseRecord {
  type: number;
  name: string;
  balancePoisha: number;
}

export interface Category extends BaseRecord {
  name: string;
  parentId?: string | null;
  iconKey: string;
  isSystem: boolean;
}

export interface Transaction extends BaseRecord {
  type: number;
  amountPoisha: number;
  accountId: string;
  toAccountId?: string | null;
  categoryId: string;
  date: string;
  note?: string;
  tags?: string[];
  merchant?: string;
  recurringId?: string | null;
}

export interface Budget extends BaseRecord {
  ym: string;
  categoryId: string;
  allocatedPoisha: number;
  carryPoisha: number;
}

export interface Debt extends BaseRecord {
  lender: string;
  principalPoisha: number;
  interestRate?: number;
  remainingPoisha: number;
  borrowDate: string;
  dueDate?: string;
  status: number;
  note?: string;
}

export interface LoanGiven extends BaseRecord {
  borrower: string;
  amountPoisha: number;
  remainingPoisha: number;
  borrowDate: string;
  dueDate?: string;
  status: number;
  note?: string;
}

export interface HeldLiability extends BaseRecord {
  owner: string;
  amountPoisha: number;
  holdDate: string;
  returnDate?: string;
  purpose?: string;
  status: number;
}

export interface Goal extends BaseRecord {
  name: string;
  targetPoisha: number;
  savedPoisha: number;
  deadline?: string;
}

export interface Investment extends BaseRecord {
  type: number;
  name: string;
  /** Investor or project label */
  investorName?: string;
  investedPoisha: number;
  /** @deprecated Use effectiveValue from metrics; kept for migration */
  currentValuePoisha?: number;
  projectStartDate: string;
  projectEndDate?: string;
  /** Profit declared upfront by investor (BDT poisha) */
  declaredProfitPoisha?: number;
  /** Shares/units/grams — Stocks, Mutual Fund, Gold */
  quantity?: number;
  /** Price per share/unit at purchase (poisha) — Stocks, Mutual Fund */
  pricePerUnitPoisha?: number;
  /** Annual interest/profit rate — DPS, FDR */
  interestRatePct?: number;
  /** Gold purity, e.g. "22k" */
  purity?: string;
  status: number;
  note?: string;
}

export interface InvestmentEvent extends BaseRecord {
  investmentId: string;
  type: number;
  amountPoisha: number;
  eventDate: string;
  note?: string;
}

export interface BuyEvaluation extends BaseRecord {
  productName: string;
  categoryId: string;
  pricePoisha: number;
  priority: number;
  score: number;
  tier: number;
  recommendation: number;
  reasonCodes: number[];
  saveMonths?: number;
}

export interface SyncQueueItem {
  id?: string;
  table: string;
  recordId: string;
  operation: "upsert" | "delete";
  payload: Record<string, unknown>;
  createdAt: string;
}
