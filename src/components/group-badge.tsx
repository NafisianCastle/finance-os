"use client";

import { Users } from "lucide-react";
import { useLiveQuery } from "dexie-react-hooks";
import { getDb } from "@/infrastructure/db/dexie/database";
import { useAppStore } from "@/store/app-store";

export function GroupBadge() {
  const groupId = useAppStore((s) => s.groupId);

  const group = useLiveQuery(
    () => (groupId ? getDb().groups.get(groupId) : undefined),
    [groupId]
  );

  if (!groupId || !group) return null;

  return (
    <div className="flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-xs text-muted-foreground">
      <Users className="h-3 w-3" />
      <span className="max-w-[8rem] truncate">{group.name}</span>
    </div>
  );
}
