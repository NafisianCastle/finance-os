import type { NetWorthResult } from "./types";

export interface NetWorthInput {
  cashBankWalletPoisha: number;
  investmentValuePoisha: number;
  loansReceivablePoisha: number;
  totalDebtPoisha: number;
  creditUsedPoisha: number;
  activeHeldLiabilitiesPoisha: number;
}

export function calculateNetWorth(input: NetWorthInput): NetWorthResult {
  const totalAssets =
    input.cashBankWalletPoisha +
    input.investmentValuePoisha +
    input.loansReceivablePoisha;

  const totalLiabilities =
    input.totalDebtPoisha +
    input.creditUsedPoisha +
    input.activeHeldLiabilitiesPoisha;

  const spendablePoisha = totalAssets - totalLiabilities;
  const netWorthPoisha = spendablePoisha;

  return {
    netWorthPoisha,
    spendablePoisha,
    heldLiabilitiesPoisha: input.activeHeldLiabilitiesPoisha,
    totalAssetsPoisha: totalAssets,
    totalLiabilitiesPoisha: totalLiabilities,
  };
}
