"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { HealthCard } from "@/components/health-card";
import { Button, buttonVariants } from "@/components/ui/button";
import { useNotificationText } from "@/components/notification-center";
import { SharedChip } from "@/components/shared-toggle";
import { useCategoryName } from "@/hooks/use-category-name";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAppStore } from "@/store/app-store";
import { useNotificationStore } from "@/store/notification-store";
import { getDashboardMetrics } from "@/application/analytics";
import { loadNotifications } from "@/application/notifications";
import { listPlannedPayments, markPlannedPaymentPaid } from "@/application/planned-payments";
import { getDb } from "@/infrastructure/db/dexie/database";
import { scoped } from "@/infrastructure/db/dexie/helpers";
import { useCurrencyFormatter } from "@/hooks/use-currency-formatter";
import { useToast } from "@/components/ui/toast";
import dynamic from "next/dynamic";
import { Brain, AlertTriangle, X, CalendarClock } from "lucide-react";
import { PLANNED_PAYMENT_DIRECTION, PLANNED_PAYMENT_STATUS } from "@/lib/constants";
import type { PlannedPayment } from "@/infrastructure/db/dexie/schema";

const IncomeExpenseTrendChart = dynamic(
  () => import("@/components/charts/dashboard-charts").then((m) => m.IncomeExpenseTrendChart),
  { ssr: false }
);
const SpendBreakdownChart = dynamic(
  () => import("@/components/charts/dashboard-charts").then((m) => m.SpendBreakdownChart),
  { ssr: false }
);

function maturityColor(score: number) {
  if (score >= 70) return "hsl(var(--success))";
  if (score >= 40) return "hsl(var(--warning))";
  return "oklch(var(--destructive))";
}

export default function DashboardPage() {
  const t = useTranslations("Dashboard");
  const locale = useLocale();
  const categoryName = useCategoryName();
  const notificationText = useNotificationText();
  const { format, formatCompact } = useCurrencyFormatter();
  const MATURITY_LABELS: Record<string, string> = {
    budget: t("maturityBudget"),
    savings: t("maturitySavings"),
    debt: t("maturityDebt"),
    smartBuy: t("maturitySmartBuy"),
    goals: t("maturityGoals"),
    impulse: t("maturityImpulse"),
  };
  const MATURITY_DESCRIPTIONS: Record<string, string> = {
    budget: t("maturityBudgetDesc"),
    savings: t("maturitySavingsDesc"),
    debt: t("maturityDebtDesc"),
    smartBuy: t("maturitySmartBuyDesc"),
    goals: t("maturityGoalsDesc"),
    impulse: t("maturityImpulseDesc"),
  };
  const userId = useAppStore((s) => s.userId);
  const groupId = useAppStore((s) => s.groupId);
  const setNotifications = useNotificationStore((s) => s.setNotifications);
  const notifications = useNotificationStore((s) => s.notifications);
  const markRead = useNotificationStore((s) => s.markRead);
  const readIds = useNotificationStore((s) => s.readIds);
  const { toast } = useToast();
  const [metrics, setMetrics] = useState<Awaited<ReturnType<typeof getDashboardMetrics>> | null>(null);
  const [upcomingPayments, setUpcomingPayments] = useState<PlannedPayment[]>([]);
  const [payingId, setPayingId] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    if (!userId) return;
    const txs = await scoped(getDb().transactions, userId, groupId).toArray();
    const [m, notifs, plans] = await Promise.all([
      getDashboardMetrics(userId, txs, groupId),
      loadNotifications(userId, txs, groupId),
      listPlannedPayments(userId, groupId),
    ]);
    setMetrics(m);
    setNotifications(notifs);
    setUpcomingPayments(
      plans
        .filter((p) => p.status === PLANNED_PAYMENT_STATUS.ACTIVE)
        .sort((a, b) => a.nextDueDate.localeCompare(b.nextDueDate))
        .slice(0, 3)
    );
  }, [userId, groupId, setNotifications]);

  async function confirmPaid(plan: PlannedPayment) {
    if (!userId) return;
    setPayingId(plan.id);
    try {
      await markPlannedPaymentPaid(userId, plan, groupId);
      toast(t("plannedPaymentRecorded"), "success");
      // Paying moves balances and clears the "due" notification — refresh all.
      await loadAll();
    } finally {
      setPayingId(null);
    }
  }

  const dueDateFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", year: "numeric" }),
    [locale]
  );
  const formatDueDate = (ymd: string) => {
    const d = new Date(`${ymd.slice(0, 10)}T00:00:00`);
    return Number.isNaN(d.getTime()) ? ymd : dueDateFormatter.format(d);
  };

  const spendBreakdown = useMemo(() => {
    if (!metrics) return [];
    const categoryEntries = Object.entries(metrics.byCategory).sort((a, b) => b[1] - a[1]);
    const topCategories = categoryEntries.slice(0, 4);
    const otherTotal = categoryEntries.slice(4).reduce((s, [, v]) => s + v, 0);
    return [
      ...topCategories.map(([id, value]) => ({ name: categoryName(id), value })),
      ...(otherTotal > 0 ? [{ name: t("other"), value: otherTotal }] : []),
    ];
  }, [metrics, t, categoryName]);

  const maturityBreakdown = useMemo(() => {
    if (!metrics) return [];
    return Object.entries(metrics.maturity.components).map(([key, value]) => ({
      key,
      name: MATURITY_LABELS[key] ?? key,
      description: MATURITY_DESCRIPTIONS[key] ?? "",
      value,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- MATURITY_LABELS/MATURITY_DESCRIPTIONS are fresh object literals every render; t is their real dependency
  }, [metrics, t]);

  useEffect(() => {
    const timer = setTimeout(() => void loadAll(), 0);
    return () => clearTimeout(timer);
  }, [loadAll]);

  if (!metrics) {
    return (
      <AppShell title={t("title")}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <div className="grid grid-cols-2 gap-3">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-11 w-full" />
        </div>
      </AppShell>
    );
  }

  const { netWorth, maturity, cashflow, income, expense, trend } = metrics;
  // analytics labels trend months in English; the series always ends at the
  // current month, so relabel each point with the locale's month name.
  const monthFormatter = new Intl.DateTimeFormat(locale, { month: "short" });
  const now = new Date();
  const localizedTrend = trend.map((point, i) => ({
    ...point,
    month: monthFormatter.format(new Date(now.getFullYear(), now.getMonth() - (trend.length - 1 - i), 1)),
  }));

  const overdueNotifs = notifications.filter(
    (n) =>
      (n.type === "overdue_debt" || n.type === "overdue_loan" || n.type === "planned_payment_due") &&
      !readIds.includes(n.id)
  );
  const OVERDUE_CAP = 2;
  const visibleOverdue = overdueNotifs.slice(0, OVERDUE_CAP);
  const hiddenOverdueCount = overdueNotifs.length - visibleOverdue.length;

  return (
    <AppShell title={t("title")}>
      <div className="space-y-4">
        {cashflow.lowCashWarning && (
          <div className="flex items-center gap-2 rounded-lg border border-yellow-500/40 bg-yellow-500/10 p-3 text-sm">
            <AlertTriangle className="h-4 w-4 text-yellow-500 shrink-0" />
            <span>{t("lowCashWarning")}</span>
          </div>
        )}

        {visibleOverdue.map((n) => {
          const text = notificationText(n);
          return (
            <div
              key={n.id}
              className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm"
            >
              <Link href={n.href ?? "/more"} className="flex flex-1 items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="font-medium text-destructive">{text.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{text.body}</p>
                </div>
              </Link>
              <button
                type="button"
                aria-label={t("dismiss")}
                onClick={() => markRead(n.id)}
                className="shrink-0 rounded-full p-1 text-muted-foreground hover:bg-destructive/20 hover:text-destructive"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}

        {hiddenOverdueCount > 0 && (
          <p className="text-xs text-muted-foreground px-1">
            {t("moreOverdue", { count: hiddenOverdueCount })}
          </p>
        )}

        {upcomingPayments.length > 0 && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <CalendarClock className="h-4 w-4 text-primary" />
                {t("upcomingPayments")}
              </CardTitle>
              <Link href="/planned-payments" className="text-xs text-muted-foreground hover:underline">
                {t("viewAll")}
              </Link>
            </CardHeader>
            <CardContent className="space-y-3">
              {upcomingPayments.map((p) => {
                const today = new Date().toISOString().slice(0, 10);
                const isDue = p.nextDueDate <= today;
                const isPay = p.direction === PLANNED_PAYMENT_DIRECTION.PAY;
                return (
                  <div key={p.id} className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center gap-2">
                        <p className="truncate text-sm font-medium">
                          {p.counterparty || (isPay ? t("iPay") : t("iReceive"))}
                        </p>
                        <SharedChip groupId={p.groupId} />
                      </div>
                      <p className={`text-xs ${isDue ? "text-destructive" : "text-muted-foreground"}`}>
                        {isDue ? t("dueNow") : t("dueOn", { date: formatDueDate(p.nextDueDate) })}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`text-sm font-semibold ${isPay ? "text-destructive" : "text-primary"}`}>
                        {isPay ? "-" : "+"}{format(p.amountPoisha)}
                      </span>
                      {isDue && (
                        <Button size="sm" loading={payingId === p.id} onClick={() => confirmPaid(p)}>
                          {isPay ? t("confirmPaid") : t("confirmReceived")}
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-2 gap-3">
          <HealthCard title={t("netWorth")} value={format(netWorth.netWorthPoisha)} variant="success" />
          <HealthCard
            title={t("spendable")}
            value={format(netWorth.spendablePoisha)}
            subtitle={t("excludesHeldMoney")}
          />
        </div>

        {netWorth.heldLiabilitiesPoisha > 0 && (
          <HealthCard
            title={t("heldForOthers")}
            value={format(netWorth.heldLiabilitiesPoisha)}
            subtitle={t("notYourWealth")}
            variant="warning"
          />
        )}

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base">{t("financialMaturity")}</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">{t("maturitySubtitle")}</p>
            </div>
            {maturity.measuredCount >= 2 && (
              <Badge variant="secondary">
                {t(`maturityLevel_${maturity.level}` as "maturityLevel_Poor")}
              </Badge>
            )}
          </CardHeader>
          <CardContent className="space-y-2">
            {maturity.measuredCount < 2 ? (
              <p className="text-sm text-muted-foreground">{t("maturityNoData")}</p>
            ) : (
              <>
                <div className="flex items-end gap-2">
                  <span className="text-3xl font-bold">{maturity.score}</span>
                  <span className="text-muted-foreground pb-1">/ 100</span>
                </div>
                <Progress value={maturity.score} color={maturityColor(maturity.score)} />
                <p className="text-xs text-muted-foreground">
                  {t(`maturityLevelDesc_${maturity.level}` as "maturityLevelDesc_Poor")}
                </p>
              </>
            )}
            {maturity.measuredCount >= 2 && maturity.measuredCount < maturity.totalCount && (
              <p className="text-xs text-muted-foreground">
                {t("maturityPartialData", { measured: maturity.measuredCount, total: maturity.totalCount })}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("monthEndForecast")}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xl font-semibold">{format(cashflow.projectedMonthEndPoisha)}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {t("dailyBurn", { amount: format(cashflow.dailyBurnPoisha) })}
            </p>
          </CardContent>
        </Card>

        <div className="grid grid-cols-2 gap-3">
          <HealthCard title={t("income")} value={format(income)} />
          <HealthCard title={t("expenses")} value={format(expense)} />
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("incomeVsExpense")}</CardTitle>
          </CardHeader>
          <CardContent className="h-40">
            <IncomeExpenseTrendChart
              data={localizedTrend}
              format={format}
              formatCompact={formatCompact}
              incomeLabel={t("income")}
              expenseLabel={t("expenses")}
            />
          </CardContent>
        </Card>

        {spendBreakdown.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("topSpending")}</CardTitle>
            </CardHeader>
            <CardContent style={{ height: spendBreakdown.length * 36 + 8 }}>
              <SpendBreakdownChart data={spendBreakdown} format={format} otherLabel={t("other")} />
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("maturityBreakdown")}</CardTitle>
            <p className="text-xs text-muted-foreground">{t("maturityBreakdownDesc")}</p>
          </CardHeader>
          <CardContent className="space-y-3">
            {maturityBreakdown.map((item) => (
              <div key={item.key} className="space-y-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-medium">{item.name}</span>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {item.value === null ? t("noDataYet") : `${Math.round(item.value)} / 100`}
                  </span>
                </div>
                <Progress value={item.value ?? 0} color={item.value === null ? "hsl(var(--muted-foreground))" : maturityColor(item.value)} />
                <p className="text-xs text-muted-foreground">{item.description}</p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Link href="/smart-buy" className={buttonVariants({ variant: "secondary", className: "w-full" })}>
          <Brain className="h-4 w-4" />
          {t("smartBuy")}
        </Link>
      </div>
    </AppShell>
  );
}
