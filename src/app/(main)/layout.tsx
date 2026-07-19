"use client";

import { SyncOnFocus } from "@/components/sync-on-focus";
import { getDb } from "@/infrastructure/db/dexie/database";
import { isSupabaseConfigured } from "@/infrastructure/supabase/client";
import { pullRemoteChanges } from "@/infrastructure/sync/sync-queue";
import { useAppStore } from "@/store/app-store";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const userId = useAppStore((s) => s.userId);
  const hasHydrated = useAppStore((s) => s.hasHydrated);

  useEffect(() => {
    if (!hasHydrated) return; // wait for persisted userId to load from localStorage first

    const allowUnauthenticated = ["/onboarding", "/login", "/signup"];
    const authConfigured = isSupabaseConfigured();

    if (!userId) {
      if (!allowUnauthenticated.includes(pathname)) {
        router.replace("/onboarding");
      }
      return;
    }

    async function checkOnboarding() {
      const db = getDb();
      let profile = await db.userProfiles.where("userId").equals(userId!).first();

      // Local Dexie is empty on a fresh browser/device — pull from Supabase
      // before concluding onboarding hasn't happened, otherwise this redirects
      // to /onboarding and reseeds duplicate default accounts.
      if (!profile?.onboardingComplete && authConfigured) {
        await pullRemoteChanges(userId!, null);
        profile = await db.userProfiles.where("userId").equals(userId!).first();
      }

      if (!profile?.onboardingComplete && pathname !== "/onboarding") {
        router.replace("/onboarding");
      }
    }

    checkOnboarding();
  }, [userId, pathname, router, hasHydrated]);

  return (
    <>
      <SyncOnFocus />
      {children}
    </>
  );
}
