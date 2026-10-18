"use client";

import { loadNotifications } from "@/application/notifications";
import { AppLoadingScreen } from "@/components/app-loading-screen";
import { SyncOnFocus } from "@/components/sync-on-focus";
import { getDb } from "@/infrastructure/db/dexie/database";
import { isSupabaseConfigured } from "@/infrastructure/supabase/client";
import { pullRemoteChanges } from "@/infrastructure/sync/sync-queue";
import { stashPendingJoinCode } from "@/lib/pending-join";
import { useAppStore } from "@/store/app-store";
import { useNotificationStore } from "@/store/notification-store";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const UNAUTHENTICATED_ROUTES = ["/onboarding", "/login", "/signup"];

/**
 * Keeps the header notification bell populated on every page, not only the
 * dashboard: loads on mount / user or group change, and again each time a
 * sync cycle finishes (isSyncing true -> false) so pulled rows are reflected.
 */
function NotificationLoader() {
  const userId = useAppStore((s) => s.userId);
  const groupId = useAppStore((s) => s.groupId);
  const isSyncing = useAppStore((s) => s.isSyncing);
  const setNotifications = useNotificationStore((s) => s.setNotifications);

  useEffect(() => {
    if (!userId || isSyncing) return;
    let cancelled = false;
    loadNotifications(userId)
      .then((n) => {
        if (!cancelled) setNotifications(n);
      })
      .catch((err) => console.error("Failed to load notifications", err));
    return () => {
      cancelled = true;
    };
  }, [userId, groupId, isSyncing, setNotifications]);

  return null;
}

export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const userId = useAppStore((s) => s.userId);
  const hasHydrated = useAppStore((s) => s.hasHydrated);
  const [initializing, setInitializing] = useState(true);
  // Onboarding check hits Dexie (and possibly Supabase); only worth redoing
  // when the signed-in user changes, not on every client-side navigation.
  const checkedUserId = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function checkOnboarding() {
      if (!hasHydrated) return; // wait for persisted userId to load from localStorage first

      // An invite link opened before login/onboarding would otherwise lose its
      // ?code= in the redirect below; stash it so the user lands back on /join.
      const stashInviteCode = () => {
        if (pathname === "/join") {
          stashPendingJoinCode(new URLSearchParams(window.location.search).get("code"));
        }
      };

      if (!userId) {
        if (!UNAUTHENTICATED_ROUTES.includes(pathname)) {
          stashInviteCode();
          router.replace("/onboarding");
        }
        if (!cancelled) setInitializing(false);
        return;
      }

      if (checkedUserId.current === userId) {
        if (!cancelled) setInitializing(false);
        return;
      }

      const db = getDb();
      const authConfigured = isSupabaseConfigured();
      let profile = await db.userProfiles.where("userId").equals(userId).first();

      // Local Dexie is empty on a fresh browser/device — pull from Supabase
      // before concluding onboarding hasn't happened, otherwise this redirects
      // to /onboarding and reseeds duplicate default accounts.
      if (!profile?.onboardingComplete && authConfigured) {
        await pullRemoteChanges(userId, useAppStore.getState().groupId, null);
        profile = await db.userProfiles.where("userId").equals(userId).first();
      }

      if (cancelled) return;
      checkedUserId.current = userId;
      if (!profile?.onboardingComplete && pathname !== "/onboarding") {
        stashInviteCode();
        router.replace("/onboarding");
      }
      setInitializing(false);
    }

    const timer = setTimeout(checkOnboarding, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [userId, pathname, router, hasHydrated]);

  if (initializing) {
    return <AppLoadingScreen />;
  }

  return (
    <>
      <SyncOnFocus />
      <NotificationLoader />
      {children}
    </>
  );
}
