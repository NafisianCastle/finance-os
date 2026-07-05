"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { HealthCard } from "@/components/health-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAppStore } from "@/store/app-store";
import { useNotificationStore } from "@/store/notification-store";
import { getDashboardMetrics } from "@/application/analytics";
import { loadNotifications } from "@/application/notifications";
import { formatMoney, poishaToBdt } from "@/lib/money";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip,
  Cell,
  LabelList,
} from "recharts";
import { Brain, AlertTriangle, X } from "lucide-react";
import { SYSTEM_CATEGORIES } from "@/lib/constants";

const CATEGORY_NAME: Record<string, string> = Object.fromEntries(
  SYSTEM_CATEGORIES.map((c) => [c.id, c.name])
);

const CATEGORY_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

const MATURITY_LABELS: Record<string, string> = {
  budget: "Budget",
  savings: "Savings",
  debt: "Debt",
  smartBuy: "Smart Buy",
  goals: "Goals",
  impulse: "Impulse control",
};

function maturityColor(score: number) {
  if (score >= 70) return "hsl(var(--success))";
  if (score >= 40) return "hsl(var(--warning))";
  return "var(--destructive)";
}

export default function DashboardPage() {
  const userId = useAppStore((s) => s.userId);
  const setNotifications = useNotificationStore((s) => s.setNotifications);
  const notifications = useNotificationStore((s) => s.notifications);
  const markRead = useNotificationStore((s) => s.markRead);
  const readIds = useNotificationStore((s) => s.readIds);
  const [metrics, setMetrics] = useState<Awaited<ReturnType<typeof getDashboardMetrics>> | null>(null);

  useEffect(() => {
    if (!userId) return;
    getDashboardMetrics(userId).then(setMetrics);
    loadNotifications(userId).then(setNotifications);
  }, [userId]);

  if (!metrics) {
    return (
      <AppShell title="Dashboard">
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

  const { netWorth, maturity, cashflow, income, expense, byCategory, trend } = metrics;

  const overdueNotifs = notifications.filter(
    (n) => (n.type === "overdue_debt" || n.type === "overdue_loan") && !readIds.includes(n.id)
  );
  const OVERDUE_CAP = 2;
  const visibleOverdue = overdueNotifs.slice(0, OVERDUE_CAP);
  const hiddenOverdueCount = overdueNotifs.length - visibleOverdue.length;

  const categoryEntries = Object.entries(byCategory).sort((a, b) => b[1] - a[1]);
  const topCategories = categoryEntries.slice(0, 4);
  const otherTotal = categoryEntries.slice(4).reduce((s, [, v]) => s + v, 0);
  const spendBreakdown = [
    ...topCategories.map(([id, value]) => ({ name: CATEGORY_NAME[id] ?? id, value })),
    ...(otherTotal > 0 ? [{ name: "Other", value: otherTotal }] : []),
  ];

  const maturityBreakdown = Object.entries(maturity.components).map(([key, value]) => ({
    name: MATURITY_LABELS[key] ?? key,
    value,
  }));

  return (
    <AppShell title="Dashboard">
      <div className="space-y-4">
        {cashflow.lowCashWarning && (
          <div className="flex items-center gap-2 rounded-lg border border-yellow-500/40 bg-yellow-500/10 p-3 text-sm">
            <AlertTriangle className="h-4 w-4 text-yellow-500 shrink-0" />
            <span>Low cash forecast — review spending this month</span>
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
              aria-label="Dismiss"
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
            +{hiddenOverdueCount} more overdue — see notifications
          </p>
        )}

        <div className="grid grid-cols-2 gap-3">
          <HealthCard title="Net worth" value={formatMoney(netWorth.netWorthPoisha)} variant="success" />
          <HealthCard
            title="Spendable"
            value={formatMoney(netWorth.spendablePoisha)}
            subtitle="Excludes held money"
          />
        </div>

        {netWorth.heldLiabilitiesPoisha > 0 && (
          <HealthCard
            title="Held for others"
            value={formatMoney(netWorth.heldLiabilitiesPoisha)}
            subtitle="Not your wealth — liability"
            variant="warning"
          />
        )}

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Financial maturity</CardTitle>
            <Badge variant="secondary">{maturity.level}</Badge>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-2">
              <span className="text-3xl font-bold">{maturity.score}</span>
              <span className="text-muted-foreground pb-1">/ 100</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Month-end forecast</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xl font-semibold">{formatMoney(cashflow.projectedMonthEndPoisha)}</p>
            <p className="text-xs text-muted-foreground mt-1">
              Daily burn ~{formatMoney(cashflow.dailyBurnPoisha)}
            </p>
          </CardContent>
        </Card>

        <div className="grid grid-cols-2 gap-3">
          <HealthCard title="Income" value={formatMoney(income)} />
          <HealthCard title="Expenses" value={formatMoney(expense)} />
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Income vs expense</CardTitle>
          </CardHeader>
          <CardContent className="h-40">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={trend}>
                <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                <YAxis
                  tickFormatter={(v) => `৳${poishaToBdt(v as number) / 1000}k`}
                  tick={{ fontSize: 10 }}
                />
                <Tooltip formatter={(v: number) => formatMoney(v)} />
                <Bar dataKey="income" fill="hsl(160 84% 32%)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="expense" fill="hsl(0 72% 51%)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {spendBreakdown.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Top spending this month</CardTitle>
            </CardHeader>
            <CardContent style={{ height: spendBreakdown.length * 36 + 8 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={spendBreakdown}
                  layout="vertical"
                  margin={{ top: 0, right: 40, bottom: 0, left: 0 }}
                >
                  <XAxis type="number" hide />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={90}
                    tick={{ fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip formatter={(v: number) => formatMoney(v)} />
                  <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={16}>
                    {spendBreakdown.map((entry, i) => (
                      <Cell
                        key={entry.name}
                        fill={
                          entry.name === "Other"
                            ? "var(--muted-foreground)"
                            : CATEGORY_COLORS[i % CATEGORY_COLORS.length]
                        }
                      />
                    ))}
                    <LabelList
                      dataKey="value"
                      position="right"
                      formatter={(v: number) => formatMoney(v)}
                      style={{ fontSize: 11, fill: "var(--foreground)" }}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Maturity breakdown</CardTitle>
          </CardHeader>
          <CardContent style={{ height: maturityBreakdown.length * 32 + 8 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={maturityBreakdown}
                layout="vertical"
                margin={{ top: 0, right: 32, bottom: 0, left: 0 }}
              >
                <XAxis type="number" domain={[0, 100]} hide />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={90}
                  tick={{ fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip formatter={(v: number) => `${v} / 100`} />
                <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={14}>
                  {maturityBreakdown.map((entry) => (
                    <Cell key={entry.name} fill={maturityColor(entry.value)} />
                  ))}
                  <LabelList
                    dataKey="value"
                    position="right"
                    formatter={(v: number) => `${v}`}
                    style={{ fontSize: 11, fill: "var(--foreground)" }}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Link href="/smart-buy">
          <Button variant="secondary" className="w-full">
            <Brain className="h-4 w-4" />
            Smart Buy
          </Button>
        </Link>
      </div>
    </AppShell>
  );
}
