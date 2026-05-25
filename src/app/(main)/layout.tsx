"use client";

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAppStore } from "@/store/app-store";
import { getDb } from "@/infrastructure/db/dexie/database";
import { SyncOnFocus } from "@/components/sync-on-focus";

export default function MainLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const userId = useAppStore((s) => s.userId);

  useEffect(() => {
    if (!userId && pathname !== "/onboarding") {
      router.replace("/onboarding");
      return;
    }
    if (userId) {
      getDb()
        .userProfiles.where("userId")
        .equals(userId)
        .first()
        .then((p) => {
          if (!p?.onboardingComplete && pathname !== "/onboarding") {
            router.replace("/onboarding");
          }
        });
    }
  }, [userId, pathname, router]);

  return (
    <>
      <SyncOnFocus />
      {children}
    </>
  );
}
