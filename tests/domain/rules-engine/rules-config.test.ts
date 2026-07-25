import { describe, it, expect } from "vitest";
import { scoreToTier, tierToRecommendation } from "@/domain/rules-engine/rules.config";
import { BUY_RECO, BUY_TIER } from "@/lib/constants";

describe("scoreToTier", () => {
  it("maps score bands to tiers", () => {
    expect(scoreToTier(90)).toBe(BUY_TIER.CHEAP);
    expect(scoreToTier(80)).toBe(BUY_TIER.CHEAP);
    expect(scoreToTier(70)).toBe(BUY_TIER.REASONABLE);
    expect(scoreToTier(65)).toBe(BUY_TIER.REASONABLE);
    expect(scoreToTier(55)).toBe(BUY_TIER.STRETCH);
    expect(scoreToTier(50)).toBe(BUY_TIER.STRETCH);
    expect(scoreToTier(35)).toBe(BUY_TIER.EXPENSIVE);
    expect(scoreToTier(30)).toBe(BUY_TIER.EXPENSIVE);
    expect(scoreToTier(10)).toBe(BUY_TIER.FINANCIALLY_UNSAFE);
    expect(scoreToTier(0)).toBe(BUY_TIER.FINANCIALLY_UNSAFE);
  });
});

describe("tierToRecommendation", () => {
  it("forces AVOID when hardUnsafe regardless of tier", () => {
    expect(tierToRecommendation(BUY_TIER.REASONABLE, true, 0)).toBe(BUY_RECO.AVOID);
  });

  it("forces AVOID for FINANCIALLY_UNSAFE tier", () => {
    expect(tierToRecommendation(BUY_TIER.FINANCIALLY_UNSAFE, false, 0)).toBe(BUY_RECO.AVOID);
  });

  it("recommends SAVE_MONTHS for EXPENSIVE tier when saveMonths > 2", () => {
    expect(tierToRecommendation(BUY_TIER.EXPENSIVE, false, 3)).toBe(BUY_RECO.SAVE_MONTHS);
  });

  it("recommends WAIT_SALARY for EXPENSIVE tier when saveMonths <= 2", () => {
    expect(tierToRecommendation(BUY_TIER.EXPENSIVE, false, 2)).toBe(BUY_RECO.WAIT_SALARY);
  });

  it("recommends WAIT_SALARY for STRETCH tier", () => {
    expect(tierToRecommendation(BUY_TIER.STRETCH, false, 0)).toBe(BUY_RECO.WAIT_SALARY);
  });

  it("recommends BUY_NOW for REASONABLE tier", () => {
    expect(tierToRecommendation(BUY_TIER.REASONABLE, false, 0)).toBe(BUY_RECO.BUY_NOW);
  });

  it("recommends BUY_NOW for CHEAP tier", () => {
    expect(tierToRecommendation(BUY_TIER.CHEAP, false, 0)).toBe(BUY_RECO.BUY_NOW);
  });
});
