"use client";

import { useTranslations } from "next-intl";
import { useAppStore } from "@/store/app-store";

/** "Share with group" checkbox for create forms. Renders nothing outside a group. */
export function SharedToggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const t = useTranslations("Groups");
  const groupId = useAppStore((s) => s.groupId);
  if (!groupId) return null;
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {t("shareWithGroup")}
    </label>
  );
}

/** Small chip marking a row as shared with the household group. */
export function SharedChip({ groupId }: { groupId?: string | null }) {
  const t = useTranslations("Groups");
  if (!groupId) return null;
  return (
    <span className="rounded-full bg-accent px-1.5 py-0.5 text-[10px] text-muted-foreground">
      {t("shared")}
    </span>
  );
}
