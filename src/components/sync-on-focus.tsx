"use client";

import { getDb } from "@/infrastructure/db/dexie/database";
import { isSupabaseConfigured } from "@/infrastructure/supabase/client";
import { processSyncQueue } from "@/infrastructure/sync/sync-queue";
import { useAppStore } from "@/store/app-store";
import { useEffect } from "react";

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
    const intervalId = window.setInterval(sync, 1000 * 60 * 5); // sync every 5 minutes

    sync();
    return () => {
      window.removeEventListener("focus", onFocus);
      window.clearInterval(intervalId);
    };
  }, [setPending]);

  return null;
}
