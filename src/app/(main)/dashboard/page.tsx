"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { HealthCard } from "@/components/health-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAppStore } from "@/store/app-store";
import { useNotificationStore } from "@/store/notification-store";
import { getDashboardMetrics } from "@/application/analytics";
import { loadNotifications } from "@/application/notifications";
import { getDb } from "@/infrastructure/db/dexie/database";
import { useCurrencyFormatter } from "@/hooks/use-currency-formatter";
import dynamic from "next/dynamic";
import { Brain, AlertTriangle, X } from "lucide-react";
import { SYSTEM_CATEGORIES } from "@/lib/constants";

const IncomeExpenseTrendChart = dynamic(
  () => import("@/components/charts/dashboard-charts").then((m) => m.IncomeExpenseTrendChart),
  { ssr: false }
);
const SpendBreakdownChart = dynamic(
  () => import("@/components/charts/dashboard-charts").then((m) => m.SpendBreakdownChart),
  { ssr: false }
);

const CATEGORY_NAME: Record<string, string> = Object.fromEntries(
  SYSTEM_CATEGORIES.map((c) => [c.id, c.name])
);

function maturityColor(score: number) {
  if (score >= 70) return "hsl(var(--success))";
  if (score >= 40) return "hsl(var(--warning))";
  return "oklch(var(--destructive))";
}

export default function DashboardPage() {
  const t = useTranslations("Dashboard");
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
  const MATURITY_LEVEL_DESC: Record<string, string> = {
    Poor: t("maturityLevelDesc_Poor"),
    Improving: t("maturityLevelDesc_Improving"),
    Stable: t("maturityLevelDesc_Stable"),
    Disciplined: t("maturityLevelDesc_Disciplined"),
    "Wealth Builder": t("maturityLevelDesc_Wealth Builder"),
  };
  const userId = useAppStore((s) => s.userId);
  const setNotifications = useNotificationStore((s) => s.setNotifications);
  const notifications = useNotificationStore((s) => s.notifications);
  const markRead = useNotificationStore((s) => s.markRead);
  const readIds = useNotificationStore((s) => s.readIds);
  const [metrics, setMetrics] = useState<Awaited<ReturnType<typeof getDashboardMetrics>> | null>(null);

  const spendBreakdown = useMemo(() => {
    if (!metrics) return [];
    const categoryEntries = Object.entries(metrics.byCategory).sort((a, b) => b[1] - a[1]);
    const topCategories = categoryEntries.slice(0, 4);
    const otherTotal = categoryEntries.slice(4).reduce((s, [, v]) => s + v, 0);
    return [
      ...topCategories.map(([id, value]) => ({ name: CATEGORY_NAME[id] ?? id, value })),
      ...(otherTotal > 0 ? [{ name: t("other"), value: otherTotal }] : []),
    ];
  }, [metrics, t]);

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
    if (!userId) return;
    (async () => {
      const txs = await getDb()
        .transactions.where("userId")
        .equals(userId)
        .filter((t) => !t.deletedAt)
        .toArray();
      setMetrics(await getDashboardMetrics(userId, txs));
      setNotifications(await loadNotifications(userId, txs));
    })();
  }, [userId, setNotifications]);

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
        </div>
      </AppShell>
    );
  }

  const { netWorth, maturity, cashflow, income, expense, trend } = metrics;

  const overdueNotifs = notifications.filter(
    (n) => (n.type === "overdue_debt" || n.type === "overdue_loan") && !readIds.includes(n.id)
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

        {visibleOverdue.map((n) => (
          <Link
            key={n.id}
            href={n.href ?? "/more"}
            className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm"
          >
            <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-medium text-destructive">{n.title}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{n.body}</p>
            </div>
            <button
              type="button"
              aria-label={t("dismiss")}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                markRead(n.id);
              }}
              className="shrink-0 rounded-full p-1 text-muted-foreground hover:bg-destructive/20 hover:text-destructive"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </Link>
        ))}

        {hiddenOverdueCount > 0 && (
          <p className="text-xs text-muted-foreground px-1">
            {t("moreOverdue", { count: hiddenOverdueCount })}
          </p>
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
            <Badge variant="secondary">{maturity.level}</Badge>
          </CardHeader>
          <CardContent className="space-y-2">
            {maturity.measuredCount === 0 ? (
              <p className="text-sm text-muted-foreground">{t("maturityNoData")}</p>
            ) : (
              <>
                <div className="flex items-end gap-2">
                  <span className="text-3xl font-bold">{maturity.score}</span>
                  <span className="text-muted-foreground pb-1">/ 100</span>
                </div>
                <Progress value={maturity.score} color={maturityColor(maturity.score)} />
              </>
            )}
            <p className="text-xs text-muted-foreground">
              {MATURITY_LEVEL_DESC[maturity.level] ?? ""}
            </p>
            {maturity.measuredCount < maturity.totalCount && maturity.measuredCount > 0 && (
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
            <IncomeExpenseTrendChart data={trend} format={format} formatCompact={formatCompact} />
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

        <Link href="/smart-buy" className="block">
          <Button variant="secondary" className="w-full">
            <Brain className="h-4 w-4" />
            {t("smartBuy")}
          </Button>
        </Link>
      </div>
    </AppShell>
  );
}
