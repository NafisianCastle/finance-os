"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAppStore } from "@/store/app-store";
import { getDashboardMetrics } from "@/application/analytics";
import { formatMoney, poishaToBdt } from "@/lib/money";
import { budgetHealthScore } from "@/domain/rules-engine/budget-suggest.rules";
import { getDb } from "@/infrastructure/db/dexie/database";
import { ymKey } from "@/lib/utils";
import { TX_TYPES, SYSTEM_CATEGORIES } from "@/lib/constants";
import {
  startOfMonth,
  endOfMonth,
  subMonths,
  parseISO,
  isWithinInterval,
  format,
} from "date-fns";
import { Download, TrendingUp, TrendingDown, Minus } from "lucide-react";

interface SpendingPattern {
  moneyLeaks: { category: string; avgSpend: number; trend: "up" | "flat" | "down" }[];
  lifestyleCreepPct: number;
  microSpendCategories: { category: string; txCount: number; totalPoisha: number }[];
}

function getCategoryName(id: string): string {
  return SYSTEM_CATEGORIES.find((c) => c.id === id)?.name ?? id;
}

async function analyzeSpendingPatterns(userId: string): Promise<SpendingPattern> {
  const db = getDb();
  const txs = await db.transactions
    .where("userId")
    .equals(userId)
    .filter((t) => !t.deletedAt && t.type === TX_TYPES.EXPENSE)
    .toArray();

  // Build per-category monthly spend for last 3 months
  const months = [2, 1, 0].map((i) => ({
    start: startOfMonth(subMonths(new Date(), i)),
    end: endOfMonth(subMonths(new Date(), i)),
  }));

  const spendByMonthCat: Record<string, number[]> = {};
  const txCountByCat: Record<string, { count: number; total: number }> = {};

  for (const tx of txs) {
    const d = parseISO(tx.date);
    for (let i = 0; i < months.length; i++) {
      if (isWithinInterval(d, months[i])) {
        spendByMonthCat[tx.categoryId] ??= [0, 0, 0];
        spendByMonthCat[tx.categoryId][i] += tx.amountPoisha;
      }
    }
    // Micro-spend: last 2 months
    const inRecent = isWithinInterval(parseISO(tx.date), {
      start: months[0].start,
      end: months[2].end,
    });
    if (inRecent) {
      txCountByCat[tx.categoryId] ??= { count: 0, total: 0 };
      txCountByCat[tx.categoryId].count += 1;
      txCountByCat[tx.categoryId].total += tx.amountPoisha;
    }
  }

  // Money leaks: categories with average spend > 0 across all 3 months
  const moneyLeaks = Object.entries(spendByMonthCat)
    .filter(([, arr]) => arr.every((v) => v > 0))
    .map(([cat, arr]) => {
      const avg = arr.reduce((s, v) => s + v, 0) / 3;
      const trend: "up" | "flat" | "down" =
        arr[2] > arr[0] * 1.15 ? "up" : arr[2] < arr[0] * 0.85 ? "down" : "flat";
      return { category: cat, avgSpend: avg, trend };
    })
    .sort((a, b) => b.avgSpend - a.avgSpend)
    .slice(0, 5);

  // Lifestyle creep: total expense change M-2 → M-0
  const totalByMonth = months.map((m) =>
    txs
      .filter((t) => isWithinInterval(parseISO(t.date), m))
      .reduce((s, t) => s + t.amountPoisha, 0)
  );
  const lifestyleCreepPct =
    totalByMonth[0] > 0
      ? ((totalByMonth[2] - totalByMonth[0]) / totalByMonth[0]) * 100
      : 0;

  // Micro-spend: categories with many small transactions (avg < 500 BDT)
  const microSpendCategories = Object.entries(txCountByCat)
    .filter(([, v]) => v.count >= 5 && v.total / v.count < 50000)
    .map(([cat, v]) => ({ category: cat, txCount: v.count, totalPoisha: v.total }))
    .sort((a, b) => b.totalPoisha - a.totalPoisha)
    .slice(0, 4);

  return { moneyLeaks, lifestyleCreepPct, microSpendCategories };
}

function downloadCSV(data: string, filename: string) {
  const blob = new Blob([data], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ReportsPage() {
  const userId = useAppStore((s) => s.userId);
  const [summary, setSummary] = useState<{
    income: number;
    expense: number;
    wins: string[];
    mistakes: string[];
  } | null>(null);
  const [patterns, setPatterns] = useState<SpendingPattern | null>(null);

  useEffect(() => {
    if (!userId) return;
    (async () => {
      const metrics = await getDashboardMetrics(userId);
      const db = getDb();
      const ym = ymKey();
      const budgets = await db.budgets
        .filter((b) => b.userId === userId && b.ym === ym && !b.deletedAt)
        .toArray();
      const txs = await db.transactions.where("userId").equals(userId).filter((t) => !t.deletedAt).toArray();
      const start = startOfMonth(new Date());
      const end = endOfMonth(new Date());
      const spent: Record<string, number> = {};
      for (const tx of txs) {
        if (tx.type !== TX_TYPES.EXPENSE) continue;
        if (!isWithinInterval(parseISO(tx.date), { start, end })) continue;
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
      setSummary({ income: metrics.income, expense: metrics.expense, wins, mistakes });

      const p = await analyzeSpendingPatterns(userId);
      setPatterns(p);
    })();
  }, [userId]);

  async function handleExportCSV() {
    if (!userId) return;
    const db = getDb();
    const txs = await db.transactions
      .where("userId")
      .equals(userId)
      .filter((t) => !t.deletedAt)
      .toArray();
    const header = "Date,Type,Category,Amount (BDT),Account,Merchant,Note";
    const rows = txs
      .sort((a, b) => b.date.localeCompare(a.date))
      .map((t) => {
        const type = t.type === TX_TYPES.INCOME ? "Income" : t.type === TX_TYPES.EXPENSE ? "Expense" : "Transfer";
        const amount = (poishaToBdt(t.amountPoisha)).toFixed(2);
        return [
          t.date,
          type,
          t.categoryId,
          amount,
          t.accountId,
          t.merchant ?? "",
          (t.note ?? "").replace(/,/g, ";"),
        ].join(",");
      });
    const csv = [header, ...rows].join("\n");
    downloadCSV(csv, `finance-os-transactions-${format(new Date(), "yyyy-MM-dd")}.csv`);
  }

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
              {summary.wins.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Mistakes & opportunities</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="list-disc pl-4 text-sm space-y-1 text-muted-foreground">
              {summary.mistakes.map((m, i) => <li key={i}>{m}</li>)}
            </ul>
          </CardContent>
        </Card>

        {/* Spending patterns */}
        {patterns && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Spending patterns</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Lifestyle creep */}
              <div>
                <p className="text-xs font-medium mb-1">
                  {patterns.lifestyleCreepPct > 10
                    ? "Lifestyle creep detected"
                    : patterns.lifestyleCreepPct < -10
                    ? "Spending reduced"
                    : "Spending stable"}
                </p>
                <div className="flex items-center gap-2">
                  {patterns.lifestyleCreepPct > 10 ? (
                    <TrendingUp className="h-4 w-4 text-destructive" />
                  ) : patterns.lifestyleCreepPct < -10 ? (
                    <TrendingDown className="h-4 w-4 text-primary" />
                  ) : (
                    <Minus className="h-4 w-4 text-muted-foreground" />
                  )}
                  <p className="text-sm text-muted-foreground">
                    Expenses{" "}
                    {patterns.lifestyleCreepPct >= 0 ? "up" : "down"}{" "}
                    <span className={patterns.lifestyleCreepPct > 10 ? "text-destructive font-medium" : "font-medium"}>
                      {Math.abs(patterns.lifestyleCreepPct).toFixed(1)}%
                    </span>{" "}
                    vs 2 months ago
                  </p>
                </div>
              </div>

              {/* Money leaks */}
              {patterns.moneyLeaks.length > 0 && (
                <div>
                  <p className="text-xs font-medium mb-2">Consistent spend (money leaks)</p>
                  <ul className="space-y-1.5">
                    {patterns.moneyLeaks.map((l) => (
                      <li key={l.category} className="flex items-center justify-between text-xs">
                        <span className="flex items-center gap-1.5">
                          {l.trend === "up" ? (
                            <TrendingUp className="h-3 w-3 text-destructive" />
                          ) : l.trend === "down" ? (
                            <TrendingDown className="h-3 w-3 text-primary" />
                          ) : (
                            <Minus className="h-3 w-3 text-muted-foreground" />
                          )}
                          {getCategoryName(l.category)}
                        </span>
                        <span className="text-muted-foreground">
                          ~{formatMoney(l.avgSpend)}/mo
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Micro-spend */}
              {patterns.microSpendCategories.length > 0 && (
                <div>
                  <p className="text-xs font-medium mb-2">Micro-spend categories</p>
                  <ul className="space-y-1.5">
                    {patterns.microSpendCategories.map((m) => (
                      <li key={m.category} className="flex items-center justify-between text-xs">
                        <span>{getCategoryName(m.category)}</span>
                        <span className="text-muted-foreground">
                          {m.txCount} txns · {formatMoney(m.totalPoisha)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Export */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Export data</CardTitle>
          </CardHeader>
          <CardContent>
            <Button variant="outline" className="w-full gap-2" onClick={handleExportCSV}>
              <Download className="h-4 w-4" />
              Export transactions as CSV
            </Button>
          </CardContent>
        </Card>

        <p className="text-xs text-muted-foreground text-center">
          Generated on demand — not stored remotely.
        </p>
      </div>
    </AppShell>
  );
}
