import { describe, it, expect } from "vitest";
import {
  getCurrencyDigits,
  majorToMinorUnits,
  minorUnitsToMajor,
  formatMoney,
  formatCompact,
} from "@/lib/money";

describe("getCurrencyDigits", () => {
  it("returns 2 for BDT/USD", () => {
    expect(getCurrencyDigits("BDT")).toBe(2);
    expect(getCurrencyDigits("USD")).toBe(2);
  });

  it("returns 0 for JPY", () => {
    expect(getCurrencyDigits("JPY")).toBe(0);
  });

  it("falls back to 2 for an invalid currency code", () => {
    expect(getCurrencyDigits("NOT_A_CURRENCY")).toBe(2);
  });
});

describe("majorToMinorUnits / minorUnitsToMajor", () => {
  it("round-trips a 2-decimal currency", () => {
    expect(majorToMinorUnits(123.45, "BDT")).toBe(12345);
    expect(minorUnitsToMajor(12345, "BDT")).toBe(123.45);
  });

  it("round-trips a 0-decimal currency", () => {
    expect(majorToMinorUnits(500, "JPY")).toBe(500);
    expect(minorUnitsToMajor(500, "JPY")).toBe(500);
  });

  it("rounds fractional minor units instead of truncating", () => {
    // 19.999 BDT -> 1999.9 poisha, must round not floor
    expect(majorToMinorUnits(19.999, "BDT")).toBe(2000);
  });

  it("handles zero and negative amounts", () => {
    expect(majorToMinorUnits(0, "BDT")).toBe(0);
    expect(majorToMinorUnits(-50, "BDT")).toBe(-5000);
    expect(minorUnitsToMajor(-5000, "BDT")).toBe(-50);
  });
});

describe("formatMoney", () => {
  it("formats BDT minor units as a localized currency string", () => {
    const out = formatMoney(150000, "BDT", "en-US");
    expect(out).toContain("1,500");
  });

  it("formats zero", () => {
    const out = formatMoney(0, "BDT", "en-US");
    expect(out).toMatch(/0(\.00)?/);
  });
});

describe("formatCompact", () => {
  it("compacts millions with M suffix", () => {
    const out = formatCompact(majorToMinorUnits(2_500_000, "BDT"), "BDT", "en-US");
    expect(out).toMatch(/2\.5M/);
  });

  it("compacts thousands with k suffix", () => {
    const out = formatCompact(majorToMinorUnits(4_200, "BDT"), "BDT", "en-US");
    expect(out).toMatch(/4\.2k/);
  });

  it("falls back to full formatMoney below 1000", () => {
    const compact = formatCompact(majorToMinorUnits(500, "BDT"), "BDT", "en-US");
    const full = formatMoney(majorToMinorUnits(500, "BDT"), "BDT", "en-US");
    expect(compact).toBe(full);
  });

  it("compacts negative amounts by magnitude", () => {
    const out = formatCompact(majorToMinorUnits(-3_000, "BDT"), "BDT", "en-US");
    expect(out).toContain("3.0k");
    expect(out).toContain("-");
  });
});
