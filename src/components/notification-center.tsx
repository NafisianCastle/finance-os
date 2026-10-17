"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCategoryName } from "@/hooks/use-category-name";
import { useNotificationStore, type AppNotification } from "@/store/notification-store";

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

/**
 * Resolves a notification to display text: translated via the
 * `Notifications` namespace when titleKey/bodyKey are set, otherwise the
 * notification's own title/body. A `categoryId` param becomes a localized
 * `category` param.
 */
export function useNotificationText() {
  const t = useTranslations("Notifications");
  const categoryName = useCategoryName();
  return useCallback(
    (n: AppNotification): { title: string; body: string } => {
      const params: Record<string, string | number> = { ...n.params };
      if (typeof params.categoryId === "string") {
        params.category = categoryName(params.categoryId);
      }
      const tr = (key: string | undefined, fallback: string) =>
        key && t.has(key) ? t(key, params) : fallback;
      return { title: tr(n.titleKey, n.title), body: tr(n.bodyKey, n.body) };
    },
    [t, categoryName],
  );
}

export function NotificationCenter() {
  const t = useTranslations("Notifications");
  const text = useNotificationText();
  const { notifications, readIds, markRead, markAllRead } = useNotificationStore();
  const [open, setOpen] = useState(false);

  const unread = notifications.filter((n) => !readIds.includes(n.id));

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  if (notifications.length === 0) return null;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative flex items-center justify-center w-8 h-8 rounded-full hover:bg-muted transition-colors"
        aria-label={unread.length > 0 ? t("ariaLabelUnread", { count: unread.length }) : t("title")}
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
              <p className="text-sm font-semibold">{t("title")}</p>
              {unread.length > 0 ? (
                <button
                  type="button"
                  onClick={() => markAllRead()}
                  className="text-xs text-primary hover:underline"
                >
                  {t("markAllRead")}
                </button>
              ) : (
                <span className="text-xs text-muted-foreground">
                  {t("total", { count: notifications.length })}
                </span>
              )}
            </div>
            <ul>
              {notifications.map((n) => {
                const isRead = readIds.includes(n.id);
                const { title, body } = text(n);
                const content = (
                  <>
                    <span
                      className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${PRIORITY_DOT[n.priority]}`}
                    />
                    <div>
                      <p className={`text-sm font-medium ${PRIORITY_COLOR[n.priority]}`}>
                        {title}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">{body}</p>
                    </div>
                  </>
                );
                const itemClassName = `flex gap-3 px-4 py-3 border-b border-border last:border-0 text-left hover:bg-muted/60 transition-colors ${
                  isRead ? "opacity-60" : ""
                }`;

                return (
                  <li key={n.id}>
                    {n.href ? (
                      <Link
                        href={n.href}
                        onClick={() => {
                          markRead(n.id);
                          setOpen(false);
                        }}
                        className={`${itemClassName} w-full`}
                      >
                        {content}
                      </Link>
                    ) : (
                      <button
                        type="button"
                        onClick={() => markRead(n.id)}
                        className={`${itemClassName} w-full`}
                      >
                        {content}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
