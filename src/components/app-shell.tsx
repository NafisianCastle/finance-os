"use client";

import { useTranslations } from "next-intl";
import { BackButton } from "./back-button";
import { BottomNav } from "./bottom-nav";
import { SyncBadge } from "./sync-badge";
import { NotificationCenter } from "./notification-center";
import { FloatingActionButton } from "./floating-action-button";
import { UnsyncedWarningBanner } from "./unsynced-warning-banner";

export function AppShell({ children, title }: { children: React.ReactNode; title?: string }) {
  const t = useTranslations("Common");
  return (
    <div className="mx-auto min-h-screen max-w-md pb-24 md:max-w-2xl">
      <header className="sticky top-0 z-40 border-b border-border bg-background/95 px-4 py-3 backdrop-blur">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <BackButton />
            <h1 className="truncate text-lg font-bold tracking-tight">{title ?? t("appName")}</h1>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <NotificationCenter />
            <SyncBadge />
          </div>
        </div>
      </header>
      <UnsyncedWarningBanner />
      <main className="px-4 py-4">{children}</main>
      <FloatingActionButton />
      <BottomNav />
    </div>
  );
}
