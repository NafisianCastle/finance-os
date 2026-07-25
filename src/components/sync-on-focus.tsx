"use client";

import { getDb } from "@/infrastructure/db/dexie/database";
import { isSupabaseConfigured } from "@/infrastructure/supabase/client";
import { processSyncQueue, pullRemoteChanges } from "@/infrastructure/sync/sync-queue";
import { LOCAL_USER_ID, useAppStore } from "@/store/app-store";
import { useEffect } from "react";

const SYNC_TIMEOUT_MS = 20_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  return Promise.race([
    promise,
    new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), ms)),
  ]);
}

export function SyncOnFocus() {
  const setPending = useAppStore((s) => s.setPendingSyncCount);

  useEffect(() => {
    if (!isSupabaseConfigured()) return;

    let inFlight = false;

    const sync = async () => {
      // Multiple triggers (focus, online, visibilitychange, interval) can
      // fire close together — avoid overlapping sync cycles stacking up.
      if (inFlight) return;
      const uid = useAppStore.getState().userId;
      // LOCAL_USER_ID is a local-only pseudo-user (not signed up / no Supabase
      // session) — pushing its rows with that as user_id fails RLS since
      // auth.uid() won't match it.
      if (!uid || uid === LOCAL_USER_ID) return;

      inFlight = true;
      useAppStore.getState().setIsSyncing(true);
      try {
        // Low-battery/throttled devices can stall a network call indefinitely
        // — bound each phase so a hung request doesn't block sync forever.
        await withTimeout(processSyncQueue(uid), SYNC_TIMEOUT_MS);
        const lastSyncedAt = useAppStore.getState().lastSyncedAt;
        const syncStartedAt = new Date().toISOString();
        await withTimeout(pullRemoteChanges(uid, lastSyncedAt), SYNC_TIMEOUT_MS);
        useAppStore.getState().setLastSyncedAt(syncStartedAt);
        const count = await getDb().syncQueue.count();
        setPending(count);
      } finally {
        inFlight = false;
        useAppStore.getState().setIsSyncing(false);
      }
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
