export const DEFAULT_CURRENCY = "BDT";
export const DEFAULT_LOCALE = "bn-BD";

export const ACCOUNT_TYPES = {
  CASH: 1,
  BANK: 2,
  WALLET: 3,
  CREDIT_CARD: 4,
} as const;

export const TX_TYPES = {
  INCOME: 1,
  EXPENSE: 2,
  TRANSFER: 3,
} as const;

export const PRIORITY = {
  NEED: 1,
  USEFUL: 2,
  LUXURY: 3,
  IMPULSE: 4,
} as const;

export const BUY_TIER = {
  CHEAP: 1,
  REASONABLE: 2,
  STRETCH: 3,
  EXPENSIVE: 4,
  FINANCIALLY_UNSAFE: 5,
} as const;

export const BUY_RECO = {
  BUY_NOW: 1,
  WAIT_SALARY: 2,
  SAVE_MONTHS: 3,
  AVOID: 4,
} as const;

export const HELD_STATUS = { ACTIVE: 1, RETURNED: 2 } as const;
export const DEBT_STATUS = { ACTIVE: 1, PAID: 2 } as const;
export const LOAN_STATUS = { ACTIVE: 1, OVERDUE: 2, RECOVERED: 3 } as const;

export const SYNC_BATCH_SIZE = 100;
export const MAX_SYNC_BUY_EVALS = 20;
// Initial hydration on a new device only pulls transactions from this many
// days back, so first sync stays fast; older months are pulled on demand
// via pullHistoricalTransactions.
export const SYNC_WINDOW_DAYS = 180;
export const HISTORICAL_PULL_BATCH_SIZE = 500;

export const SYSTEM_CATEGORIES = [
  { id: "food", name: "Food", icon: "utensils" },
  { id: "transport", name: "Transport", icon: "car" },
  { id: "shopping", name: "Shopping", icon: "shopping-bag" },
  { id: "gadgets", name: "Gadgets", icon: "smartphone" },
  { id: "entertainment", name: "Entertainment", icon: "gamepad-2" },
  { id: "bills", name: "Bills", icon: "receipt" },
  { id: "family", name: "Family", icon: "users" },
  { id: "education", name: "Education", icon: "graduation-cap" },
  { id: "health", name: "Health", icon: "heart-pulse" },
  { id: "savings", name: "Savings", icon: "piggy-bank" },
  { id: "investment", name: "Investment", icon: "trending-up" },
  { id: "income", name: "Income", icon: "wallet" },
  { id: "other", name: "Other", icon: "circle" },
] as const;
