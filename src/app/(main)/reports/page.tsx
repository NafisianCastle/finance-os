"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAppStore } from "@/store/app-store";
import { getDashboardMetrics } from "@/application/analytics";
import { formatMoney } from "@/lib/money";
import { budgetHealthScore } from "@/domain/rules-engine/budget-suggest.rules";
import { getDb } from "@/infrastructure/db/dexie/database";
import { ymKey } from "@/lib/utils";
import { TX_TYPES } from "@/lib/constants";
import { startOfMonth, endOfMonth, parseISO, isWithinInterval } from "date-fns";

export default function ReportsPage() {
  const userId = useAppStore((s) => s.userId);
  const [summary, setSummary] = useState<{
    income: number;
    expense: number;
    wins: string[];
    mistakes: string[];
  } | null>(null);

  useEffect(() => {
    if (!userId) return;
    (async () => {
      const metrics = await getDashboardMetrics(userId);
      const db = getDb();
      const ym = ymKey();
      const budgets = await db.budgets.filter((b) => b.userId === userId && b.ym === ym && !b.deletedAt).toArray();
      const txs = await db.transactions.where("userId").equals(userId).filter((t) => !t.deletedAt).toArray();
      const start = startOfMonth(new Date());
      const end = endOfMonth(new Date());
      const spent: Record<string, number> = {};
      for (const tx of txs) {
        if (tx.type !== TX_TYPES.EXPENSE) continue;
        const d = parseISO(tx.date);
        if (!isWithinInterval(d, { start, end })) continue;
        spent[tx.categoryId] = (spent[tx.categoryId] ?? 0) + tx.amountPoisha;
      }
      const allocs = budgets.map((b) => ({
        allocated: b.allocatedPoisha + b.carryPoisha,
        spent: spent[b.categoryId] ?? 0,
      }));
      const health = budgetHealthScore(allocs);
      const wins: string[] = [];
      const mistakes: string[] = [];
      if (metrics.income > metrics.expense) wins.push("Positive monthly cashflow");
      if (health >= 70) wins.push("Strong budget adherence");
      if (metrics.maturity.score >= 65) wins.push(`Maturity level: ${metrics.maturity.level}`);
      for (const b of budgets) {
        const s = spent[b.categoryId] ?? 0;
        const t = b.allocatedPoisha + b.carryPoisha;
        if (t > 0 && s > t) mistakes.push(`Overspent on ${b.categoryId}`);
      }
      if (metrics.cashflow.lowCashWarning) mistakes.push("Low cash forecast — reduce discretionary spend");
      if (mistakes.length === 0) mistakes.push("No major issues this month — keep it up!");
      setSummary({
        income: metrics.income,
        expense: metrics.expense,
        wins,
        mistakes,
      });
    })();
  }, [userId]);

  if (!summary) {
    return (
      <AppShell title="Reports">
        <p className="text-muted-foreground">Loading…</p>
      </AppShell>
    );
  }

  return (
    <AppShell title="Reports">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Card>
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground">Monthly income</p>
              <p className="text-xl font-bold text-primary">{formatMoney(summary.income)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground">Monthly expenses</p>
              <p className="text-xl font-bold">{formatMoney(summary.expense)}</p>
            </CardContent>
          </Card>
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Wins</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="list-disc pl-4 text-sm space-y-1">
              {summary.wins.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Mistakes & opportunities</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="list-disc pl-4 text-sm space-y-1 text-muted-foreground">
              {summary.mistakes.map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
        <p className="text-xs text-muted-foreground text-center">
          Generated on demand — not stored remotely (saves Supabase space).
        </p>
      </div>
    </AppShell>
  );
}
