import { describe, it, expect } from "vitest";
import en from "../../messages/en.json";
import bn from "../../messages/bn.json";
import { SYSTEM_CATEGORIES } from "@/lib/constants";
import { REASON_MESSAGE } from "@/domain/rules-engine/reason-templates";

type Messages = { [key: string]: string | Messages };

function flatten(obj: Messages, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") out[path] = value;
    else Object.assign(out, flatten(value, path));
  }
  return out;
}

/** ICU argument names, e.g. "{count}" and "{count, plural, ...}" -> count. */
function placeholders(message: string): string[] {
  const names = new Set<string>();
  for (const m of message.matchAll(/\{\s*([A-Za-z_][\w]*)\s*[,}]/g)) names.add(m[1]);
  return [...names].sort();
}

const flatEn = flatten(en as Messages);
const flatBn = flatten(bn as Messages);

describe("i18n parity (en <-> bn)", () => {
  it("has identical key sets", () => {
    const enKeys = Object.keys(flatEn).sort();
    const bnKeys = Object.keys(flatBn).sort();
    expect(enKeys.filter((k) => !(k in flatBn))).toEqual([]);
    expect(bnKeys.filter((k) => !(k in flatEn))).toEqual([]);
  });

  it("has identical placeholders per key", () => {
    const mismatches = Object.keys(flatEn)
      .filter((k) => k in flatBn)
      .filter((k) => placeholders(flatEn[k]).join() !== placeholders(flatBn[k]).join())
      .map((k) => `${k}: en{${placeholders(flatEn[k])}} bn{${placeholders(flatBn[k])}}`);
    expect(mismatches).toEqual([]);
  });

  it("has no empty messages", () => {
    const empty = [...Object.entries(flatEn), ...Object.entries(flatBn)]
      .filter(([, v]) => v.trim() === "")
      .map(([k]) => k);
    expect(empty).toEqual([]);
  });

  it("names every system category", () => {
    const missing = SYSTEM_CATEGORIES.map((c) => `Categories.${c.id}`).filter((k) => !(k in flatEn));
    expect(missing).toEqual([]);
  });

  it("has a SmartBuyReasons message for every reason code, using its params", () => {
    for (const { key, params } of Object.values(REASON_MESSAGE)) {
      const msg = flatEn[`SmartBuyReasons.${key}`];
      expect(msg, key).toBeDefined();
      expect(placeholders(msg)).toEqual([...params].sort());
    }
    expect(flatEn["SmartBuyReasons.fallback"]).toBeDefined();
  });
});
