"use client";

import { BackButton } from "@/components/back-button";
import { SyncOnFocus } from "@/components/sync-on-focus";
import { getDb } from "@/infrastructure/db/dexie/database";
import { isSupabaseConfigured } from "@/infrastructure/supabase/client";
import { pullRemoteChanges } from "@/infrastructure/sync/sync-queue";
import { LOCAL_USER_ID, useAppStore } from "@/store/app-store";
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

  useEffect(() => {
    const allowUnauthenticated = ["/onboarding", "/login", "/signup"];
    const authConfigured = isSupabaseConfigured();

    if (!userId) {
      if (!allowUnauthenticated.includes(pathname)) {
        router.replace(authConfigured ? "/login" : "/onboarding");
      }
      return;
    }

    if (authConfigured && userId === LOCAL_USER_ID && pathname !== "/login") {
      router.replace("/login");
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
  }, [userId, pathname, router]);

  return (
    <>
      <SyncOnFocus />
      <BackButton />
      {children}
    </>
  );
}
