"use client";

import { Eye, EyeOff } from "lucide-react";
import { useTranslations } from "next-intl";
import { useAppStore } from "@/store/app-store";

export function HideAmountsToggle() {
  const hideAmounts = useAppStore((s) => s.hideAmounts);
  const toggleHideAmounts = useAppStore((s) => s.toggleHideAmounts);
  const t = useTranslations("Common");

  return (
    <button
      type="button"
      onClick={toggleHideAmounts}
      aria-label={hideAmounts ? t("showAmounts") : t("hideAmounts")}
      className="rounded-full p-1 text-muted-foreground hover:text-foreground"
    >
      {hideAmounts ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
    </button>
  );
}
