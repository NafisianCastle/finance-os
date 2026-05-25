"use client";

import { useEffect } from "react";
import { useAppStore } from "@/store/app-store";
import { processSyncQueue } from "@/infrastructure/sync/sync-queue";
import { isSupabaseConfigured } from "@/infrastructure/supabase/client";
import { getDb } from "@/infrastructure/db/dexie/database";

export function SyncOnFocus() {
  const setPending = useAppStore((s) => s.setPendingSyncCount);

  useEffect(() => {
    if (!isSupabaseConfigured()) return;

    const sync = async () => {
      const uid = useAppStore.getState().userId;
      if (!uid) return;
      await processSyncQueue(uid);
      const count = await getDb().syncQueue.count();
      setPending(count);
    };

    const onFocus = () => sync();
    window.addEventListener("focus", onFocus);
    sync();
    return () => window.removeEventListener("focus", onFocus);
  }, [setPending]);

  return null;
}
