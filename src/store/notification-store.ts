import { create } from "zustand";

export interface AppNotification {
  id: string;
  type: "overdue_debt" | "overdue_loan" | "low_cash" | "budget_overspend";
  title: string;
  body: string;
  priority: "high" | "medium" | "low";
  href?: string;
}

interface NotificationState {
  notifications: AppNotification[];
  readIds: string[];
  setNotifications: (n: AppNotification[]) => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
}

export const useNotificationStore = create<NotificationState>()((set) => ({
  notifications: [],
  readIds: [],
  setNotifications: (notifications) => set({ notifications }),
  markRead: (id) => set((s) => ({ readIds: [...new Set([...s.readIds, id])] })),
  markAllRead: () =>
    set((s) => ({ readIds: s.notifications.map((n) => n.id) })),
}));
