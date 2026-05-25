"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useAppStore } from "@/store/app-store";
import { getDb } from "@/infrastructure/db/dexie/database";
import { suggestBudgets, budgetHealthScore } from "@/domain/rules-engine/budget-suggest.rules";
import { formatMoney } from "@/lib/money";
import { ymKey } from "@/lib/utils";
import { v4 as uuid } from "uuid";
import { TX_TYPES } from "@/lib/constants";
import { startOfMonth, endOfMonth, parseISO, isWithinInterval } from "date-fns";
import type { Budget } from "@/infrastructure/db/dexie/schema";
import { enqueueSync } from "@/infrastructure/sync/sync-queue";

export default function BudgetsPage() {
  const userId = useAppStore((s) => s.userId);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [spentMap, setSpentMap] = useState<Record<string, number>>({});
  const [health, setHealth] = useState(0);
  const [income, setIncome] = useState(0);

  async function load() {
    if (!userId) return;
    const db = getDb();
    const ym = ymKey();
    const profile = await db.userProfiles.where("userId").equals(userId).first();
    const inc = profile?.monthlyIncomePoisha ?? 0;
    setIncome(inc);
    const b = await db.budgets.filter((bg) => bg.userId === userId && bg.ym === ym && !bg.deletedAt).toArray();
    setBudgets(b);

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
    setSpentMap(spent);
    const allocs = b.map((bg) => ({
      allocated: bg.allocatedPoisha + bg.carryPoisha,
      spent: spent[bg.categoryId] ?? 0,
    }));
    setHealth(budgetHealthScore(allocs));
  }

  useEffect(() => {
    load();
  }, [userId]);

  async function applySuggestions() {
    if (!userId || income <= 0) return;
    const suggestions = suggestBudgets(income);
    const ym = ymKey();
    const now = new Date().toISOString();
    const db = getDb();
    for (const s of suggestions) {
      const existing = budgets.find((b) => b.categoryId === s.categoryId);
      if (existing) {
        await db.budgets.update(existing.id, {
          allocatedPoisha: s.suggestedPoisha,
          updatedAt: now,
        });
      } else {
        const rec = {
          id: uuid(),
          userId,
          ym,
          categoryId: s.categoryId,
          allocatedPoisha: s.suggestedPoisha,
          carryPoisha: 0,
          createdAt: now,
          updatedAt: now,
        };
        await db.budgets.add(rec);
        await enqueueSync("budgets", rec.id, "upsert", {
          id: rec.id,
          ym_char6: ym,
          category_id: s.categoryId,
          allocated_poisha: s.suggestedPoisha,
          carry_poisha: 0,
        });
      }
    }
    load();
  }

  return (
    <AppShell title="Budgets">
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Budget health</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-2 mb-2">
              <span className="text-3xl font-bold">{health}</span>
              <span className="text-muted-foreground">/ 100</span>
            </div>
            <Progress value={health} />
          </CardContent>
        </Card>

        <Button className="w-full" variant="secondary" onClick={applySuggestions}>
          Apply suggested budgets
        </Button>

        {budgets.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            No budgets yet. Apply suggestions based on your income.
          </p>
        ) : (
          budgets.map((b) => {
            const spent = spentMap[b.categoryId] ?? 0;
            const total = b.allocatedPoisha + b.carryPoisha;
            const pct = total > 0 ? Math.min(100, (spent / total) * 100) : 0;
            const over = spent > total;
            return (
              <Card key={b.id} className={over ? "border-destructive/50" : ""}>
                <CardContent className="pt-4 space-y-2">
                  <div className="flex justify-between capitalize">
                    <span className="font-medium">{b.categoryId}</span>
                    <span className="text-sm text-muted-foreground">
                      {formatMoney(spent)} / {formatMoney(total)}
                    </span>
                  </div>
                  <Progress value={pct} />
                  {over && (
                    <p className="text-xs text-destructive">Overspending alert</p>
                  )}
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
    </AppShell>
  );
}
