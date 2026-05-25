import { create } from "zustand";
import { persist } from "zustand/middleware";

interface AppState {
  userId: string | null;
  lastSyncedAt: string | null;
  pendingSyncCount: number;
  setUserId: (id: string | null) => void;
  setLastSyncedAt: (at: string) => void;
  setPendingSyncCount: (n: number) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      userId: null,
      lastSyncedAt: null,
      pendingSyncCount: 0,
      setUserId: (userId) => set({ userId }),
      setLastSyncedAt: (lastSyncedAt) => set({ lastSyncedAt }),
      setPendingSyncCount: (pendingSyncCount) => set({ pendingSyncCount }),
    }),
    { name: "finance-os-app" }
  )
);

/** Local-only demo user when Supabase is not configured */
export const LOCAL_USER_ID = "local-user";
