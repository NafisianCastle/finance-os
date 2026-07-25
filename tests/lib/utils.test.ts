import { describe, it, expect } from "vitest";
import { ymKey, parseYm } from "@/lib/utils";

describe("ymKey", () => {
  it("formats a date as YYYYMM", () => {
    expect(ymKey(new Date(2026, 0, 15))).toBe("202601");
  });

  it("pads single-digit months", () => {
    expect(ymKey(new Date(2026, 8, 1))).toBe("202609");
  });

  it("defaults to the current date when none given", () => {
    const now = new Date();
    const expected = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
    expect(ymKey()).toBe(expected);
  });
});

describe("parseYm", () => {
  it("parses a YYYYMM key back into year and month", () => {
    expect(parseYm("202601")).toEqual({ year: 2026, month: 1 });
  });

  it("round-trips with ymKey", () => {
    const date = new Date(2025, 11, 1);
    expect(parseYm(ymKey(date))).toEqual({ year: 2025, month: 12 });
  });
});
