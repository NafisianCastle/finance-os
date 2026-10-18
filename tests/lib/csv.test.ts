import { describe, expect, it } from "vitest";
import { escapeCsvField, toCsv, toCsvRow } from "@/lib/csv";

describe("escapeCsvField", () => {
  it("leaves plain fields untouched", () => {
    expect(escapeCsvField("Food")).toBe("Food");
    expect(escapeCsvField(12.5)).toBe("12.5");
  });

  it("renders null/undefined as empty", () => {
    expect(escapeCsvField(null)).toBe("");
    expect(escapeCsvField(undefined)).toBe("");
  });

  it("quotes fields with commas, quotes and newlines", () => {
    expect(escapeCsvField("a,b")).toBe('"a,b"');
    expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvField("line1\nline2")).toBe('"line1\nline2"');
    expect(escapeCsvField("cr\rhere")).toBe('"cr\rhere"');
  });

  it("keeps non-ASCII text as-is", () => {
    expect(escapeCsvField("খাবার")).toBe("খাবার");
  });
});

describe("toCsv", () => {
  it("joins fields with commas and records with CRLF", () => {
    expect(toCsvRow(["a", "b,c", 1])).toBe('a,"b,c",1');
    expect(toCsv([["h1", "h2"], ["x", 'y"z']])).toBe('h1,h2\r\nx,"y""z"');
  });
});
