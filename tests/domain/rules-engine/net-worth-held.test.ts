import { describe, it, expect } from "vitest";
import { calculateNetWorth } from "@/domain/rules-engine/net-worth.rules";
import { bdtToPoisha } from "@/lib/money";

describe("Net worth with held liabilities", () => {
  it("excludes held money from spendable wealth", () => {
    const result = calculateNetWorth({
      cashBankWalletPoisha: bdtToPoisha(50_000),
      investmentValuePoisha: bdtToPoisha(10_000),
      loansReceivablePoisha: bdtToPoisha(5_000),
      totalDebtPoisha: bdtToPoisha(10_000),
      creditUsedPoisha: 0,
      activeHeldLiabilitiesPoisha: bdtToPoisha(20_000),
    });

    expect(result.heldLiabilitiesPoisha).toBe(bdtToPoisha(20_000));
    expect(result.spendablePoisha).toBe(bdtToPoisha(35_000));
    expect(result.netWorthPoisha).toBe(bdtToPoisha(35_000));
  });

  it("held money is liability not asset", () => {
    const withoutHeld = calculateNetWorth({
      cashBankWalletPoisha: bdtToPoisha(30_000),
      investmentValuePoisha: 0,
      loansReceivablePoisha: 0,
      totalDebtPoisha: 0,
      creditUsedPoisha: 0,
      activeHeldLiabilitiesPoisha: 0,
    });

    const withHeld = calculateNetWorth({
      cashBankWalletPoisha: bdtToPoisha(30_000),
      investmentValuePoisha: 0,
      loansReceivablePoisha: 0,
      totalDebtPoisha: 0,
      creditUsedPoisha: 0,
      activeHeldLiabilitiesPoisha: bdtToPoisha(10_000),
    });

    expect(withHeld.spendablePoisha).toBe(withoutHeld.spendablePoisha - bdtToPoisha(10_000));
  });
});
