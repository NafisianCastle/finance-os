"use client";

import { BackButton } from "@/components/back-button";
import { SyncOnFocus } from "@/components/sync-on-focus";
import { getDb } from "@/infrastructure/db/dexie/database";
import { isSupabaseConfigured } from "@/infrastructure/supabase/client";
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

    getDb()
      .userProfiles.where("userId")
      .equals(userId)
      .first()
      .then((p) => {
        if (!p?.onboardingComplete && pathname !== "/onboarding") {
          router.replace("/onboarding");
        }
      });
  }, [userId, pathname, router]);

  return (
    <>
      <SyncOnFocus />
      <BackButton />
      {children}
    </>
  );
}
