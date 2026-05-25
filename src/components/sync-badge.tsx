"use client";

import { useEffect, useState } from "react";
import { Cloud, CloudOff } from "lucide-react";
import { useAppStore } from "@/store/app-store";
import { getDb } from "@/infrastructure/db/dexie/database";
import { isSupabaseConfigured } from "@/infrastructure/supabase/client";

export function SyncBadge() {
  const pendingSyncCount = useAppStore((s) => s.pendingSyncCount);
  const [localPending, setLocalPending] = useState(0);

  useEffect(() => {
    const db = getDb();
    db.syncQueue.count().then(setLocalPending);
  }, [pendingSyncCount]);

  const count = Math.max(pendingSyncCount, localPending);
  const configured = isSupabaseConfigured();

  return (
    <div className="flex items-center gap-1 text-xs text-muted-foreground">
      {configured ? <Cloud className="h-4 w-4" /> : <CloudOff className="h-4 w-4" />}
      {count > 0 && (
        <span className="rounded-full bg-warning/20 px-1.5 text-warning">{count}</span>
      )}
    </div>
  );
}
