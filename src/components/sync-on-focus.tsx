"use client";

import { getDb } from "@/infrastructure/db/dexie/database";
import { isSupabaseConfigured } from "@/infrastructure/supabase/client";
import { processSyncQueue, pullRemoteChanges } from "@/infrastructure/sync/sync-queue";
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
      const lastSyncedAt = useAppStore.getState().lastSyncedAt;
      const syncStartedAt = new Date().toISOString();
      await pullRemoteChanges(uid, lastSyncedAt);
      useAppStore.getState().setLastSyncedAt(syncStartedAt);
      const count = await getDb().syncQueue.count();
      setPending(count);
    };

    const onTrigger = () => sync();
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") sync();
    };
    // "focus" alone is unreliable in iOS standalone PWA mode (no background
    // sync API on iOS — the outbox only drains while the app is actually
    // foregrounded), so also watch visibilitychange and the online event to
    // catch reconnects as early as possible.
    window.addEventListener("focus", onTrigger);
    window.addEventListener("online", onTrigger);
    document.addEventListener("visibilitychange", onVisibilityChange);
    const intervalId = window.setInterval(sync, 1000 * 60 * 5); // sync every 5 minutes

    sync();
    return () => {
      window.removeEventListener("focus", onTrigger);
      window.removeEventListener("online", onTrigger);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.clearInterval(intervalId);
    };
  }, [setPending]);

  return null;
}
