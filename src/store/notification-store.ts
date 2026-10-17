import { create } from "zustand";

export interface AppNotification {
  id: string;
  type: "overdue_debt" | "overdue_loan" | "low_cash" | "budget_overspend" | "planned_payment_due";
  /** i18n key in the "Notifications" namespace. */
  titleKey: string;
  /** i18n key in the "Notifications" namespace. */
  bodyKey: string;
  /** ICU params for titleKey/bodyKey. `category` holds a raw category id the UI should localise. */
  params: Record<string, string | number>;
  /** @deprecated Pre-i18n English text; no longer emitted. Kept optional so old renderers compile. */
  title?: string;
  /** @deprecated Pre-i18n English text; no longer emitted. */
  body?: string;
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
