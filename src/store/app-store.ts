import { create } from "zustand";
import { persist } from "zustand/middleware";

interface AppState {
  userId: string | null;
  lastSyncedAt: string | null;
  pendingSyncCount: number;
  isSyncing: boolean;
  hasHydrated: boolean;
  hideAmounts: boolean;
  groupId: string | null;
  setUserId: (id: string | null) => void;
  setLastSyncedAt: (at: string) => void;
  setPendingSyncCount: (n: number) => void;
  setIsSyncing: (syncing: boolean) => void;
  setHasHydrated: (hydrated: boolean) => void;
  toggleHideAmounts: () => void;
  setGroupId: (groupId: string | null) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      userId: null,
      lastSyncedAt: null,
      pendingSyncCount: 0,
      isSyncing: false,
      hasHydrated: false,
      hideAmounts: false,
      groupId: null,
      setUserId: (userId) => set({ userId }),
      setLastSyncedAt: (lastSyncedAt) => set({ lastSyncedAt }),
      setPendingSyncCount: (pendingSyncCount) => set({ pendingSyncCount }),
      setIsSyncing: (isSyncing) => set({ isSyncing }),
      setHasHydrated: (hasHydrated) => set({ hasHydrated }),
      toggleHideAmounts: () => set((s) => ({ hideAmounts: !s.hideAmounts })),
      setGroupId: (groupId) => set({ groupId }),
    }),
    {
      name: "finance-os-app",
      partialize: (s) => ({
        userId: s.userId,
        lastSyncedAt: s.lastSyncedAt,
        hideAmounts: s.hideAmounts,
        groupId: s.groupId,
      }),
      onRehydrateStorage: () => (state) => state?.setHasHydrated(true),
    }
  )
);

/** Local-only demo user when Supabase is not configured */
export const LOCAL_USER_ID = "local-user";
