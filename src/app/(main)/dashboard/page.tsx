"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { HealthCard } from "@/components/health-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAppStore } from "@/store/app-store";
import { useNotificationStore } from "@/store/notification-store";
import { getDashboardMetrics } from "@/application/analytics";
import { loadNotifications } from "@/application/notifications";
import { formatMoney, poishaToBdt } from "@/lib/money";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip } from "recharts";
import { Brain, Plus, AlertTriangle } from "lucide-react";

export default function DashboardPage() {
  const userId = useAppStore((s) => s.userId);
  const setNotifications = useNotificationStore((s) => s.setNotifications);
  const notifications = useNotificationStore((s) => s.notifications);
  const [metrics, setMetrics] = useState<Awaited<ReturnType<typeof getDashboardMetrics>> | null>(null);

  useEffect(() => {
    if (!userId) return;
    getDashboardMetrics(userId).then(setMetrics);
    loadNotifications(userId).then(setNotifications);
  }, [userId]);

  if (!metrics) {
    return (
      <AppShell title="Dashboard">
        <p className="text-muted-foreground">Loading…</p>
      </AppShell>
    );
  }

  const { netWorth, maturity, cashflow, income, expense, trend } = metrics;

  const overdueNotifs = notifications.filter(
    (n) => n.type === "overdue_debt" || n.type === "overdue_loan"
  );

  return (
    <AppShell title="Dashboard">
      <div className="space-y-4">
        {cashflow.lowCashWarning && (
          <div className="flex items-center gap-2 rounded-lg border border-yellow-500/40 bg-yellow-500/10 p-3 text-sm">
            <AlertTriangle className="h-4 w-4 text-yellow-500 shrink-0" />
            <span>Low cash forecast — review spending this month</span>
          </div>
        )}

        {overdueNotifs.map((n) => (
          <div
            key={n.id}
            className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm"
          >
            <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-destructive">{n.title}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{n.body}</p>
            </div>
          </div>
        ))}

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

        <div className="flex gap-2">
          <Link href="/transactions/new" className="flex-1">
            <Button className="w-full">
              <Plus className="h-4 w-4" />
              Add transaction
            </Button>
          </Link>
          <Link href="/smart-buy" className="flex-1">
            <Button variant="secondary" className="w-full">
              <Brain className="h-4 w-4" />
              Smart Buy
            </Button>
          </Link>
        </div>
      </div>
    </AppShell>
  );
}
