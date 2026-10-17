"use client";

import { getDb } from "@/infrastructure/db/dexie/database";
import { isSupabaseConfigured } from "@/infrastructure/supabase/client";
import { useAppStore } from "@/store/app-store";
import { AlertTriangle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

// iOS can silently evict IndexedDB/service worker storage after ~7 days of
// no interaction with the PWA — an offline trip logging expenses that never
// gets reopened risks losing unsynced data before it ever reaches Supabase.
// 24h is early enough to prompt reconnecting well before that window closes.
const WARN_AFTER_MS = 1000 * 60 * 60 * 24;

export function UnsyncedWarningBanner() {
  const t = useTranslations("Banners");
  const pendingSyncCount = useAppStore((s) => s.pendingSyncCount);
  const [oldestAgeMs, setOldestAgeMs] = useState<number | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured()) return;

    let cancelled = false;
    getDb()
      .syncQueue.orderBy("createdAt")
      .first()
      .then((oldest) => {
        if (cancelled) return;
        setOldestAgeMs(oldest ? Date.now() - new Date(oldest.createdAt).getTime() : null);
      });
    return () => {
      cancelled = true;
    };
  }, [pendingSyncCount]);

  if (!pendingSyncCount || oldestAgeMs === null || oldestAgeMs < WARN_AFTER_MS) return null;

  const days = Math.floor(oldestAgeMs / (1000 * 60 * 60 * 24));

  return (
    <div className="mx-4 mt-3 flex items-start gap-2 rounded-lg border border-warning/50 bg-warning/10 px-3 py-2 text-sm text-warning">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <p>{t("unsyncedWarning", { count: pendingSyncCount, days })}</p>
    </div>
  );
}
