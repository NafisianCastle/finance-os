export const INVESTMENT_TYPE = {
  DPS: 1,
  FDR: 2,
  STOCKS: 3,
  MUTUAL_FUND: 4,
  GOLD: 5,
  BUSINESS: 6,
  CRYPTO: 7,
  OTHER: 9,
} as const;

export const INVESTMENT_STATUS = {
  ACTIVE: 1,
  COMPLETED: 2,
  LOSS: 3,
} as const;

/** Cashflow events on an investment */
export const INVESTMENT_EVENT_TYPE = {
  /** Profit announced/committed upfront by investor (for expected return) */
  PROFIT_DECLARED: 1,
  /** Profit actually received */
  PROFIT_RECEIVED: 2,
  /** Partial or full capital returned */
  CAPITAL_RETURN: 3,
  /** Loss (partial write-off or total) */
  LOSS: 4,
} as const;

export const INVESTMENT_EVENT_LABELS: Record<number, string> = {
  1: "Declared profit",
  2: "Profit received",
  3: "Capital return",
  4: "Loss",
};
