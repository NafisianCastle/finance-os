"use client";

import { useState } from "react";
import { Bell } from "lucide-react";
import { useNotificationStore } from "@/store/notification-store";

const PRIORITY_COLOR: Record<string, string> = {
  high: "text-destructive",
  medium: "text-yellow-500",
  low: "text-muted-foreground",
};

const PRIORITY_DOT: Record<string, string> = {
  high: "bg-destructive",
  medium: "bg-yellow-500",
  low: "bg-muted-foreground",
};

export function NotificationCenter() {
  const { notifications, readIds, markRead, markAllRead } = useNotificationStore();
  const [open, setOpen] = useState(false);

  const unread = notifications.filter((n) => !readIds.includes(n.id));

  function toggle() {
    setOpen((v) => !v);
    if (!open && unread.length > 0) markAllRead();
  }

  if (notifications.length === 0) return null;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={toggle}
        className="relative flex items-center justify-center w-8 h-8 rounded-full hover:bg-muted transition-colors"
        aria-label={`Notifications${unread.length > 0 ? ` (${unread.length} unread)` : ""}`}
      >
        <Bell className="h-4 w-4" />
        {unread.length > 0 && (
          <span className="absolute top-0.5 right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground">
            {unread.length > 9 ? "9+" : unread.length}
          </span>
        )}
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 top-10 z-50 w-80 max-h-96 overflow-y-auto rounded-xl border border-border bg-background shadow-lg">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
              <p className="text-sm font-semibold">Notifications</p>
              <span className="text-xs text-muted-foreground">{notifications.length} total</span>
            </div>
            {notifications.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">All clear</p>
            ) : (
              <ul>
                {notifications.map((n) => (
                  <li
                    key={n.id}
                    onClick={() => markRead(n.id)}
                    className={`flex gap-3 px-4 py-3 border-b border-border last:border-0 cursor-default ${
                      readIds.includes(n.id) ? "opacity-60" : ""
                    }`}
                  >
                    <span
                      className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${PRIORITY_DOT[n.priority]}`}
                    />
                    <div>
                      <p className={`text-sm font-medium ${PRIORITY_COLOR[n.priority]}`}>
                        {n.title}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">{n.body}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
