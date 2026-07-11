"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAppStore } from "@/store/app-store";
import { getDashboardMetrics } from "@/application/analytics";
import { useCurrencyFormatter } from "@/hooks/use-currency-formatter";
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
import { Download, TrendingUp, TrendingDown, Minus, ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
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

const CATEGORY_COLORS = [
  "oklch(var(--chart-1))",
  "oklch(var(--chart-2))",
  "oklch(var(--chart-3))",
  "oklch(var(--chart-4))",
  "oklch(var(--chart-5))",
];

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
  const t = useTranslations("Reports");
  const { format: formatMoney, toMajor, currencyCode } = useCurrencyFormatter();
  const userId = useAppStore((s) => s.userId);
  const [selectedMonth, setSelectedMonth] = useState(() => startOfMonth(new Date()));
  const isCurrentMonth = ymKey(selectedMonth) === ymKey(new Date());
  const [summary, setSummary] = useState<{
    income: number;
    expense: number;
    savingsRatePct: number;
    byCategory: Record<string, number>;
    wins: string[];
    mistakes: string[];
  } | null>(null);
  const [patterns, setPatterns] = useState<SpendingPattern | null>(null);
  const [trend, setTrend] = useState<{ month: string; income: number; expense: number }[]>([]);
  const [exportMonth, setExportMonth] = useState(() => ymKey(new Date()));

  useEffect(() => {
    if (!userId) return;
    (async () => {
      const db = getDb();
      const ym = ymKey(selectedMonth);
      const budgets = await db.budgets
        .filter((b) => b.userId === userId && b.ym === ym && !b.deletedAt)
        .toArray();
      const txs = await db.transactions.where("userId").equals(userId).filter((t) => !t.deletedAt).toArray();
      const start = startOfMonth(selectedMonth);
      const end = endOfMonth(selectedMonth);
      const byCategory: Record<string, number> = {};
      let income = 0;
      let expense = 0;
      for (const tx of txs) {
        if (!isWithinInterval(parseISO(tx.date), { start, end })) continue;
        if (tx.type === TX_TYPES.INCOME) income += tx.amountPoisha;
        if (tx.type === TX_TYPES.EXPENSE) {
          expense += tx.amountPoisha;
          byCategory[tx.categoryId] = (byCategory[tx.categoryId] ?? 0) + tx.amountPoisha;
        }
      }
      const savingsRatePct = income > 0 ? Math.round(((income - expense) / income) * 100) : 0;

      const allocs = budgets.map((b) => ({
        allocated: b.allocatedPoisha + b.carryPoisha,
        spent: byCategory[b.categoryId] ?? 0,
      }));
      const health = budgetHealthScore(allocs);
      const wins: string[] = [];
      const mistakes: string[] = [];
      if (income > expense) wins.push(t("positiveCashflow"));
      if (health >= 70) wins.push(t("strongBudgetAdherence"));
      if (savingsRatePct >= 20) wins.push(t("savingsRateWin", { pct: savingsRatePct }));
      for (const b of budgets) {
        const s = byCategory[b.categoryId] ?? 0;
        const tot = b.allocatedPoisha + b.carryPoisha;
        if (tot > 0 && s > tot) mistakes.push(t("overspentOn", { category: getCategoryName(b.categoryId) }));
      }
      if (isCurrentMonth) {
        const metrics = await getDashboardMetrics(userId);
        if (metrics.maturity.score >= 65) wins.push(t("maturityLevel", { level: metrics.maturity.level }));
        if (metrics.cashflow.lowCashWarning) mistakes.push(t("lowCashForecast"));
      }
      if (mistakes.length === 0) mistakes.push(t("noMajorIssues"));
      setSummary({ income, expense, savingsRatePct, byCategory, wins, mistakes });

      const p = await analyzeSpendingPatterns(userId);
      setPatterns(p);

      const trendData: { month: string; income: number; expense: number }[] = [];
      for (let i = 5; i >= 0; i--) {
        const mStart = startOfMonth(subMonths(new Date(), i));
        const mEnd = endOfMonth(subMonths(new Date(), i));
        let inc = 0;
        let exp = 0;
        for (const tx of txs) {
          const d = parseISO(tx.date);
          if (!isWithinInterval(d, { start: mStart, end: mEnd })) continue;
          if (tx.type === TX_TYPES.INCOME) inc += tx.amountPoisha;
          if (tx.type === TX_TYPES.EXPENSE) exp += tx.amountPoisha;
        }
        trendData.push({ month: mStart.toLocaleString("en", { month: "short" }), income: inc, expense: exp });
      }
      setTrend(trendData);
    })();
  }, [userId, selectedMonth, isCurrentMonth]);

  const categoryBreakdown = summary
    ? Object.entries(summary.byCategory)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([id, value]) => ({ name: getCategoryName(id), value }))
    : [];

  async function handleExportCSV(scope: "all" | "month") {
    if (!userId) return;
    const db = getDb();
    let txs = await db.transactions
      .where("userId")
      .equals(userId)
      .filter((t) => !t.deletedAt)
      .toArray();
    if (scope === "month") {
      const [y, m] = exportMonth.split("-").map(Number);
      const start = new Date(y, m - 1, 1);
      const end = endOfMonth(start);
      txs = txs.filter((t) => isWithinInterval(parseISO(t.date), { start, end }));
    }
    const header = `Date,Type,Category,Amount (${currencyCode}),Account,Merchant,Note`;
    const rows = txs
      .sort((a, b) => b.date.localeCompare(a.date))
      .map((t) => {
        const type = t.type === TX_TYPES.INCOME ? "Income" : t.type === TX_TYPES.EXPENSE ? "Expense" : "Transfer";
        const amount = (toMajor(t.amountPoisha)).toFixed(2);
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
    const suffix = scope === "month" ? exportMonth : format(new Date(), "yyyy-MM-dd");
    downloadCSV(csv, `finance-os-transactions-${suffix}.csv`);
  }

  const monthLabel = format(selectedMonth, "MMMM yyyy");

  return (
    <AppShell title={t("title")}>
      <div className="space-y-4">
        <div className="flex items-center justify-between rounded-lg border border-border bg-card px-2 py-1.5">
          <button
            type="button"
            aria-label={t("previousMonth")}
            onClick={() => setSelectedMonth((m) => startOfMonth(subMonths(m, 1)))}
            className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-accent"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <p className="text-sm font-semibold">{monthLabel}</p>
          <button
            type="button"
            aria-label={t("nextMonth")}
            disabled={isCurrentMonth}
            onClick={() => setSelectedMonth((m) => startOfMonth(subMonths(m, -1)))}
            className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-accent disabled:opacity-30 disabled:pointer-events-none"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        {!summary ? (
          <p className="text-muted-foreground text-sm text-center py-8">{t("loading")}</p>
        ) : (
        <>
        <div className="grid grid-cols-2 gap-3">
          <Card>
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground">{t("income")}</p>
              <p className="text-xl font-bold text-primary">{formatMoney(summary.income)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground">{t("expenses")}</p>
              <p className="text-xl font-bold">{formatMoney(summary.expense)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground">{t("savingsRate")}</p>
              <p className={`text-xl font-bold ${summary.savingsRatePct >= 0 ? "text-primary" : "text-destructive"}`}>
                {summary.savingsRatePct}%
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground">{t("net")}</p>
              <p className={`text-xl font-bold ${summary.income - summary.expense >= 0 ? "text-primary" : "text-destructive"}`}>
                {formatMoney(summary.income - summary.expense)}
              </p>
            </CardContent>
          </Card>
        </div>

        {categoryBreakdown.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("spendByCategory", { month: monthLabel })}</CardTitle>
            </CardHeader>
            <CardContent style={{ height: categoryBreakdown.length * 36 + 8 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={categoryBreakdown}
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
                    {categoryBreakdown.map((entry, i) => (
                      <Cell key={entry.name} fill={CATEGORY_COLORS[i % CATEGORY_COLORS.length]} />
                    ))}
                    <LabelList
                      dataKey="value"
                      position="right"
                      formatter={(v: number) => formatMoney(v)}
                      style={{ fontSize: 11, fill: "oklch(var(--foreground))" }}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}

        {trend.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("incomeVsExpense")}</CardTitle>
            </CardHeader>
            <CardContent className="h-40">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={trend}>
                  <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                  <YAxis
                    tickFormatter={(v) => `${Math.round(toMajor(v as number) / 1000)}k`}
                    tick={{ fontSize: 10 }}
                  />
                  <Tooltip formatter={(v: number) => formatMoney(v)} />
                  <Bar dataKey="income" fill="hsl(160 84% 32%)" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="expense" fill="hsl(0 72% 51%)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("wins")}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="list-disc pl-4 text-sm space-y-1">
              {summary.wins.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("mistakesOpportunities")}</CardTitle>
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
              <CardTitle className="text-base">{t("spendingPatterns")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Lifestyle creep */}
              <div>
                <p className="text-xs font-medium mb-1">
                  {patterns.lifestyleCreepPct > 10
                    ? t("lifestyleCreepDetected")
                    : patterns.lifestyleCreepPct < -10
                    ? t("spendingReduced")
                    : t("spendingStable")}
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
                    {patterns.lifestyleCreepPct >= 0
                      ? t("expensesUp", {
                          pct: Math.abs(patterns.lifestyleCreepPct).toFixed(1),
                        })
                      : t("expensesDown", {
                          pct: Math.abs(patterns.lifestyleCreepPct).toFixed(1),
                        })}
                  </p>
                </div>
              </div>

              {/* Money leaks */}
              {patterns.moneyLeaks.length > 0 && (
                <div>
                  <p className="text-xs font-medium mb-2">{t("moneyLeaks")}</p>
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
                          {t("perMonth", { amount: formatMoney(l.avgSpend) })}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Micro-spend */}
              {patterns.microSpendCategories.length > 0 && (
                <div>
                  <p className="text-xs font-medium mb-2">{t("microSpendCategories")}</p>
                  <ul className="space-y-1.5">
                    {patterns.microSpendCategories.map((m) => (
                      <li key={m.category} className="flex items-center justify-between text-xs">
                        <span>{getCategoryName(m.category)}</span>
                        <span className="text-muted-foreground">
                          {t("txnsCount", { count: m.txCount, amount: formatMoney(m.totalPoisha) })}
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
            <CardTitle className="text-base">{t("exportData")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <input
                type="month"
                value={exportMonth}
                max={ymKey(new Date())}
                onChange={(e) => setExportMonth(e.target.value)}
                className="flex h-10 flex-1 rounded-lg border border-input bg-background px-3 text-sm"
              />
              <Button variant="outline" className="gap-2 shrink-0" onClick={() => handleExportCSV("month")}>
                <Download className="h-4 w-4" />
                {t("exportMonth")}
              </Button>
            </div>
            <Button variant="outline" className="w-full gap-2" onClick={() => handleExportCSV("all")}>
              <Download className="h-4 w-4" />
              {t("exportAll")}
            </Button>
          </CardContent>
        </Card>

        <p className="text-xs text-muted-foreground text-center">
          {t("generatedOnDemand")}
        </p>
        </>
        )}
      </div>
    </AppShell>
  );
}
