"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";
import { SYSTEM_CATEGORIES } from "@/lib/constants";

const SYSTEM_CATEGORY_IDS = new Set<string>(SYSTEM_CATEGORIES.map((c) => c.id));

export type CategoryRef = string | { id: string; name?: string | null } | null | undefined;

/**
 * Returns a function resolving a category id (or `{ id, name }` record) to its
 * display name. System categories are translated via the `Categories`
 * namespace; custom categories fall back to their stored name, then the raw id.
 */
export function useCategoryName() {
  const t = useTranslations("Categories");
  return useCallback(
    (ref: CategoryRef): string => {
      if (!ref) return "";
      const id = typeof ref === "string" ? ref : ref.id;
      if (SYSTEM_CATEGORY_IDS.has(id)) return t(id);
      if (typeof ref !== "string" && ref.name) return ref.name;
      return id;
    },
    [t],
  );
}
