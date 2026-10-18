"use client";

import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAppStore } from "@/store/app-store";
import { getDashboardMetrics } from "@/application/analytics";
import { useCurrencyFormatter } from "@/hooks/use-currency-formatter";
import { budgetHealthScore } from "@/domain/rules-engine/budget-suggest.rules";
import { getDb } from "@/infrastructure/db/dexie/database";
import { getBudgetsForMonth, scoped } from "@/infrastructure/db/dexie/helpers";
import type { Transaction } from "@/infrastructure/db/dexie/schema";
import { ymKey } from "@/lib/utils";
import { toCsv } from "@/lib/csv";
import { TX_TYPES } from "@/lib/constants";
import { useCategoryName } from "@/hooks/use-category-name";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  startOfMonth,
  endOfMonth,
  startOfYear,
  endOfYear,
  subMonths,
  parseISO,
  isWithinInterval,
  format,
} from "date-fns";
import { Download, TrendingUp, TrendingDown, Minus, ChevronLeft, ChevronRight } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import dynamic from "next/dynamic";

const CategoryBreakdownChart = dynamic(
  () => import("@/components/charts/reports-charts").then((m) => m.CategoryBreakdownChart),
  { ssr: false }
);
const IncomeExpenseTrendChart = dynamic(
  () => import("@/components/charts/reports-charts").then((m) => m.IncomeExpenseTrendChart),
  { ssr: false }
);

interface SpendingPattern {
  moneyLeaks: { category: string; avgSpend: number; trend: "up" | "flat" | "down" }[];
  lifestyleCreepPct: number;
  microSpendCategories: { category: string; txCount: number; totalPoisha: number }[];
}

/** Patterns over the 3 months ending at `refMonth` (the month being viewed). */
function analyzeSpendingPatterns(allTxs: Transaction[], refMonth: Date): SpendingPattern {
  const txs = allTxs.filter((t) => t.type === TX_TYPES.EXPENSE);

  // Build per-category monthly spend for the 3 months ending at refMonth
  const months = [2, 1, 0].map((i) => ({
    start: startOfMonth(subMonths(refMonth, i)),
    end: endOfMonth(subMonths(refMonth, i)),
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
  // BOM so spreadsheet apps detect UTF-8 (Bengali category/type labels).
  const blob = new Blob(["\uFEFF", data], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ReportsPage() {
  const t = useTranslations("Reports");
  const tDash = useTranslations("Dashboard");
  const locale = useLocale();
  const categoryName = useCategoryName();
  const { format: formatMoney, toMajor, currencyCode } = useCurrencyFormatter();
  const userId = useAppStore((s) => s.userId);
  const groupId = useAppStore((s) => s.groupId);
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
  const [exportScope, setExportScope] = useState<"month" | "year" | "custom" | "all">("month");
  const [exportMonth, setExportMonth] = useState(() => format(new Date(), "yyyy-MM"));
  const [exportYear, setExportYear] = useState(() => String(new Date().getFullYear()));
  const [exportStart, setExportStart] = useState(() => format(startOfMonth(new Date()), "yyyy-MM-dd"));
  const [exportEnd, setExportEnd] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [isExporting, setIsExporting] = useState(false);

  useEffect(() => {
    if (!userId) return;
    (async () => {
      const db = getDb();
      const ym = ymKey(selectedMonth);
      const budgets = await getBudgetsForMonth(userId, ym, groupId);
      const txs = await scoped(db.transactions, userId, groupId).toArray();
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
        if (tot > 0 && s > tot) mistakes.push(t("overspentOn", { category: categoryName(b.categoryId) }));
      }
      if (isCurrentMonth) {
        const metrics = await getDashboardMetrics(userId, txs, groupId);
        if (metrics.maturity.score >= 65) {
          wins.push(
            t("maturityLevel", {
              level: tDash(`maturityLevel_${metrics.maturity.level}` as "maturityLevel_Poor"),
            })
          );
        }
        if (metrics.cashflow.lowCashWarning) mistakes.push(t("lowCashForecast"));
      }
      if (mistakes.length === 0) mistakes.push(t("noMajorIssues"));
      setSummary({ income, expense, savingsRatePct, byCategory, wins, mistakes });

      setPatterns(analyzeSpendingPatterns(txs, selectedMonth));

      const monthFormatter = new Intl.DateTimeFormat(locale, { month: "short" });
      const trendData: { month: string; income: number; expense: number }[] = [];
      for (let i = 5; i >= 0; i--) {
        const mStart = startOfMonth(subMonths(selectedMonth, i));
        const mEnd = endOfMonth(subMonths(selectedMonth, i));
        let inc = 0;
        let exp = 0;
        for (const tx of txs) {
          const d = parseISO(tx.date);
          if (!isWithinInterval(d, { start: mStart, end: mEnd })) continue;
          if (tx.type === TX_TYPES.INCOME) inc += tx.amountPoisha;
          if (tx.type === TX_TYPES.EXPENSE) exp += tx.amountPoisha;
        }
        trendData.push({ month: monthFormatter.format(mStart), income: inc, expense: exp });
      }
      setTrend(trendData);
    })();
  }, [userId, groupId, selectedMonth, isCurrentMonth, locale, t, tDash, categoryName]);

  const categoryBreakdown = useMemo(
    () =>
      summary
        ? Object.entries(summary.byCategory)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 6)
            .map(([id, value]) => ({ name: categoryName(id), value }))
        : [],
    [summary, categoryName]
  );

  async function handleExportCSV() {
    if (!userId) return;
    setIsExporting(true);
    try {
      const db = getDb();
      let txs = await scoped(db.transactions, userId, groupId).toArray();
      const [accounts, categories] = await Promise.all([
        scoped(db.accounts, userId, groupId).toArray(),
        db.categories.where("userId").equals(userId).toArray(),
      ]);
      const accountName = new Map(accounts.map((a) => [a.id, a.name]));
      const categoryById = new Map(categories.map((c) => [c.id, c]));

      let suffix = "all";
      if (exportScope === "month") {
        const [y, m] = exportMonth.split("-").map(Number);
        const start = new Date(y, m - 1, 1);
        const end = endOfMonth(start);
        txs = txs.filter((t) => isWithinInterval(parseISO(t.date), { start, end }));
        suffix = exportMonth;
      } else if (exportScope === "year") {
        const y = Number(exportYear);
        const start = startOfYear(new Date(y, 0, 1));
        const end = endOfYear(start);
        txs = txs.filter((t) => isWithinInterval(parseISO(t.date), { start, end }));
        suffix = exportYear;
      } else if (exportScope === "custom") {
        const a = parseISO(exportStart);
        const b = parseISO(exportEnd);
        const start = a <= b ? a : b;
        const end = a <= b ? b : a;
        txs = txs.filter((t) => isWithinInterval(parseISO(t.date), { start, end }));
        suffix = `${exportStart}_to_${exportEnd}`;
      } else {
        suffix = format(new Date(), "yyyy-MM-dd");
      }

      const header = [
        t("csvDate"),
        t("csvType"),
        t("csvCategory"),
        t("csvAmount", { currency: currencyCode }),
        t("csvAccount"),
        t("csvToAccount"),
        t("csvMerchant"),
        t("csvNote"),
      ];
      const rows = txs
        .sort((a, b) => b.date.localeCompare(a.date))
        .map((tx) => {
          const isTransfer = tx.type === TX_TYPES.TRANSFER;
          const type =
            tx.type === TX_TYPES.INCOME
              ? t("csvTypeIncome")
              : tx.type === TX_TYPES.EXPENSE
                ? t("csvTypeExpense")
                : t("csvTypeTransfer");
          return [
            tx.date,
            type,
            isTransfer ? "" : categoryName(categoryById.get(tx.categoryId) ?? tx.categoryId),
            toMajor(tx.amountPoisha).toFixed(2),
            accountName.get(tx.accountId) ?? tx.accountId,
            isTransfer && tx.toAccountId ? accountName.get(tx.toAccountId) ?? tx.toAccountId : "",
            tx.merchant ?? "",
            tx.note ?? "",
          ];
        });
      const csv = toCsv([header, ...rows]);
      downloadCSV(csv, `finance-os-transactions-${suffix}.csv`);
    } finally {
      setIsExporting(false);
    }
  }

  const monthLabel = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(selectedMonth);

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
              <CategoryBreakdownChart data={categoryBreakdown} formatMoney={formatMoney} />
            </CardContent>
          </Card>
        )}

        {trend.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("incomeVsExpense")}</CardTitle>
            </CardHeader>
            <CardContent className="h-40">
              <IncomeExpenseTrendChart
                data={trend}
                formatMoney={formatMoney}
                formatAxisTick={(v) => `${Math.round(toMajor(v) / 1000)}k`}
              />
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
                          {categoryName(l.category)}
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
                        <span>{categoryName(m.category)}</span>
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
            <Select value={exportScope} onValueChange={(v) => setExportScope(v as typeof exportScope)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="month">{t("exportScopeMonth")}</SelectItem>
                <SelectItem value="year">{t("exportScopeYear")}</SelectItem>
                <SelectItem value="custom">{t("exportScopeCustom")}</SelectItem>
                <SelectItem value="all">{t("exportScopeAll")}</SelectItem>
              </SelectContent>
            </Select>

            {exportScope === "month" && (
              <input
                type="month"
                value={exportMonth}
                max={format(new Date(), "yyyy-MM")}
                onChange={(e) => setExportMonth(e.target.value)}
                className="flex h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
              />
            )}

            {exportScope === "year" && (
              <input
                type="number"
                value={exportYear}
                min={2000}
                max={new Date().getFullYear()}
                onChange={(e) => setExportYear(e.target.value)}
                className="flex h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
              />
            )}

            {exportScope === "custom" && (
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={exportStart}
                  max={exportEnd}
                  onChange={(e) => setExportStart(e.target.value)}
                  className="flex h-10 flex-1 rounded-lg border border-input bg-background px-3 text-sm"
                />
                <span className="text-xs text-muted-foreground shrink-0">{t("exportRangeTo")}</span>
                <input
                  type="date"
                  value={exportEnd}
                  min={exportStart}
                  max={format(new Date(), "yyyy-MM-dd")}
                  onChange={(e) => setExportEnd(e.target.value)}
                  className="flex h-10 flex-1 rounded-lg border border-input bg-background px-3 text-sm"
                />
              </div>
            )}

            <Button variant="outline" className="w-full gap-2" onClick={() => handleExportCSV()} loading={isExporting}>
              <Download className="h-4 w-4" />
              {t("downloadCsv")}
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
