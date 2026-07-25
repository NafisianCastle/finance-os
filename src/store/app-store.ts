import { create } from "zustand";
import { persist } from "zustand/middleware";

interface AppState {
  userId: string | null;
  lastSyncedAt: string | null;
  pendingSyncCount: number;
  isSyncing: boolean;
  hasHydrated: boolean;
  setUserId: (id: string | null) => void;
  setLastSyncedAt: (at: string) => void;
  setPendingSyncCount: (n: number) => void;
  setIsSyncing: (syncing: boolean) => void;
  setHasHydrated: (hydrated: boolean) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      userId: null,
      lastSyncedAt: null,
      pendingSyncCount: 0,
      isSyncing: false,
      hasHydrated: false,
      setUserId: (userId) => set({ userId }),
      setLastSyncedAt: (lastSyncedAt) => set({ lastSyncedAt }),
      setPendingSyncCount: (pendingSyncCount) => set({ pendingSyncCount }),
      setIsSyncing: (isSyncing) => set({ isSyncing }),
      setHasHydrated: (hasHydrated) => set({ hasHydrated }),
    }),
    {
      name: "finance-os-app",
      partialize: (s) => ({ userId: s.userId, lastSyncedAt: s.lastSyncedAt }),
      onRehydrateStorage: () => (state) => state?.setHasHydrated(true),
    }
  )
);

/** Local-only demo user when Supabase is not configured */
export const LOCAL_USER_ID = "local-user";
