import { create } from "zustand";

export interface AppNotification {
  id: string;
  type: "overdue_debt" | "overdue_loan" | "low_cash" | "budget_overspend" | "planned_payment_due";
  /** English fallback text, used when titleKey/bodyKey are absent. */
  title: string;
  body: string;
  /** Key in the `Notifications` message namespace; preferred over `title`. */
  titleKey?: string;
  /** Key in the `Notifications` message namespace; preferred over `body`. */
  bodyKey?: string;
  /**
   * ICU params for titleKey/bodyKey. A `categoryId` param is resolved to a
   * localized category name and passed as `category` by the notification center.
   */
  params?: Record<string, string | number>;
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
