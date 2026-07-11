"use client";

import { useEffect, useState } from "react";
import { Check, Cloud, CloudOff, RefreshCw } from "lucide-react";
import { useAppStore } from "@/store/app-store";
import { getDb } from "@/infrastructure/db/dexie/database";
import { isSupabaseConfigured } from "@/infrastructure/supabase/client";

export function SyncBadge() {
  const pendingSyncCount = useAppStore((s) => s.pendingSyncCount);
  const isSyncing = useAppStore((s) => s.isSyncing);
  const [localPending, setLocalPending] = useState(0);

  useEffect(() => {
    const db = getDb();
    db.syncQueue.count().then(setLocalPending);
  }, [pendingSyncCount]);

  const count = Math.max(pendingSyncCount, localPending);
  const configured = isSupabaseConfigured();

  const icon = !configured ? (
    <CloudOff className="h-4 w-4" />
  ) : isSyncing ? (
    <RefreshCw className="h-4 w-4 animate-spin" />
  ) : count > 0 ? (
    <Cloud className="h-4 w-4" />
  ) : (
    <span className="relative">
      <Cloud className="h-4 w-4" />
      <Check className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-background text-success" />
    </span>
  );

  return (
    <div className="flex items-center gap-1 text-xs text-muted-foreground">
      {icon}
      {count > 0 && !isSyncing && (
        <span className="rounded-full bg-warning/20 px-1.5 text-warning">{count}</span>
      )}
    </div>
  );
}
