import { describe, it, expect } from "vitest";
import {
  reasonsToText,
  tierLabel,
  recoLabel,
  formatSafeRange,
} from "@/domain/rules-engine/reason-templates";
import { ReasonCode } from "@/domain/rules-engine/types";

describe("reasonsToText", () => {
  it("renders known reason codes with metadata substitution", () => {
    const out = reasonsToText([ReasonCode.INCOME_RATIO_HIGH], { ratioPct: 150 });
    expect(out[0]).toBe("Costs 150% of monthly income");
  });

  it("falls back to a placeholder when metadata is missing", () => {
    const out = reasonsToText([ReasonCode.DTI_STRESS]);
    expect(out[0]).toContain("?");
  });

  it("renders every reason code without throwing", () => {
    const allCodes = Object.values(ReasonCode).filter(
      (v): v is ReasonCode => typeof v === "number"
    );
    const out = reasonsToText(allCodes, { ratioPct: 1, capPct: 1, dtiPct: 1, monthsDelayed: 1, trendPct: 1 });
    expect(out).toHaveLength(allCodes.length);
    expect(out.every((s) => typeof s === "string" && s.length > 0)).toBe(true);
  });
});

describe("tierLabel", () => {
  it("labels known tiers", () => {
    expect(tierLabel(1)).toBe("Cheap");
    expect(tierLabel(5)).toBe("Financially Unsafe");
  });

  it("labels unknown tier as Unknown", () => {
    expect(tierLabel(99)).toBe("Unknown");
  });
});

describe("recoLabel", () => {
  it("labels save-months recommendation with the count", () => {
    expect(recoLabel(3, 4)).toBe("Save for 4 months");
  });

  it("falls back for save-months recommendation without a count", () => {
    expect(recoLabel(3)).toBe("Save before buying");
  });

  it("labels known non-save recommendations", () => {
    expect(recoLabel(1)).toBe("Buy now");
    expect(recoLabel(2)).toBe("Wait until next salary");
    expect(recoLabel(4)).toBe("Avoid this purchase");
  });

  it("labels unknown recommendation as Review decision", () => {
    expect(recoLabel(99)).toBe("Review decision");
  });
});

describe("formatSafeRange", () => {
  it("formats a min-max money range", () => {
    const out = formatSafeRange(100000, 200000, "BDT", "en-US");
    expect(out).toContain("–");
    expect(out).toContain("1,000");
    expect(out).toContain("2,000");
  });
});
