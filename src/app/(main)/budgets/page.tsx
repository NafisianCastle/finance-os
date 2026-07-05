"use client";

import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  budgetHealthScore,
  suggestBudgets,
} from "@/domain/rules-engine/budget-suggest.rules";
import { getDb } from "@/infrastructure/db/dexie/database";
import type { Budget, Category } from "@/infrastructure/db/dexie/schema";
import { enqueueSync } from "@/infrastructure/sync/sync-queue";
import { TX_TYPES } from "@/lib/constants";
import { bdtToPoisha, formatMoney, poishaToBdt } from "@/lib/money";
import { cn, ymKey } from "@/lib/utils";
import { useAppStore } from "@/store/app-store";
import { endOfMonth, isWithinInterval, parseISO, startOfMonth } from "date-fns";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { v4 as uuid } from "uuid";

export default function BudgetsPage() {
  const userId = useAppStore((s) => s.userId);
  const { toast } = useToast();
  const confirm = useConfirm();
  const [loaded, setLoaded] = useState(false);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryMap, setCategoryMap] = useState<Record<string, Category>>({});
  const [spentMap, setSpentMap] = useState<Record<string, number>>({});
  const [health, setHealth] = useState(0);
  const [income, setIncome] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editAmountBdt, setEditAmountBdt] = useState<string>("");
  const [adding, setAdding] = useState(false);
  const [newCategoryId, setNewCategoryId] = useState("");
  const [newAmountBdt, setNewAmountBdt] = useState("");
  const [error, setError] = useState<string>("");

  async function load() {
    if (!userId) return;
    const db = getDb();
    const ym = ymKey();

    // Load categories
    const cats = await db.categories.where("userId").equals(userId).toArray();
    setCategories(cats);
    const catMap: Record<string, Category> = {};
    for (const cat of cats) {
      catMap[cat.id] = cat;
    }
    setCategoryMap(catMap);

    const profile = await db.userProfiles
      .where("userId")
      .equals(userId)
      .first();
    const inc = profile?.monthlyIncomePoisha ?? 0;
    setIncome(inc);
    const b = await db.budgets
      .filter((bg) => bg.userId === userId && bg.ym === ym && !bg.deletedAt)
      .toArray();
    setBudgets(b);

    const txs = await db.transactions
      .where("userId")
      .equals(userId)
      .filter((t) => !t.deletedAt)
      .toArray();
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
    setLoaded(true);
  }

  useEffect(() => {
    load();
  }, [userId]);

  async function applySuggestions() {
    if (!userId) return;
    if (income <= 0) {
      toast("Set your monthly income in Settings first.", "error");
      return;
    }
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
        await db.budgets.put(rec as never);
        await enqueueSync("budgets", rec.id, "upsert", {
          id: rec.id,
          ym_char6: ym,
          category_id: s.categoryId,
          allocated_poisha: s.suggestedPoisha,
          carry_poisha: 0,
        });
      }
    }
    await load();
    toast("Suggested budgets applied.", "success");
  }

  function startEdit(b: Budget) {
    setEditingId(b.id);
    setEditAmountBdt(String(poishaToBdt(b.allocatedPoisha)));
  }

  async function saveEdit(b: Budget) {
    setError("");
    const amount = Number(editAmountBdt) || 0;
    if (amount <= 0) {
      setError("Amount must be greater than 0");
      return;
    }
    if (!userId) return;
    const db = getDb();
    const now = new Date().toISOString();
    const poisha = bdtToPoisha(amount);
    await db.budgets.update(b.id, { allocatedPoisha: poisha, updatedAt: now });
    await enqueueSync("budgets", b.id, "upsert", {
      id: b.id,
      ym_char6: b.ym,
      category_id: b.categoryId,
      allocated_poisha: poisha,
      carry_poisha: b.carryPoisha ?? 0,
    });
    setEditingId(null);
    await load();
    toast("Budget updated.", "success");
  }

  function cancelEdit() {
    setEditingId(null);
    setEditAmountBdt("");
    setError("");
  }

  async function deleteBudget(b: Budget) {
    if (!userId) return;
    const catName = categoryMap[b.categoryId]?.name || b.categoryId;
    const ok = await confirm({
      title: `Delete "${catName}" budget?`,
      description: "This can't be undone.",
      confirmLabel: "Delete",
      variant: "destructive",
    });
    if (!ok) return;
    const db = getDb();
    const now = new Date().toISOString();
    await db.budgets.update(b.id, { deletedAt: now, updatedAt: now });
    await enqueueSync("budgets", b.id, "upsert", {
      id: b.id,
      ym_char6: b.ym,
      category_id: b.categoryId,
      allocated_poisha: b.allocatedPoisha,
      carry_poisha: b.carryPoisha ?? 0,
      deleted_at: now,
    });
    await load();
    toast(`Budget "${catName}" deleted.`, "success");
  }

  async function addBudget() {
    setError("");
    if (!userId || !newCategoryId) {
      setError("Please select a category");
      return;
    }
    const amount = Number(newAmountBdt) || 0;
    if (amount <= 0) {
      setError("Amount must be greater than 0");
      return;
    }

    const existing = budgets.find((b) => b.categoryId === newCategoryId);
    if (existing) {
      setError("Budget already exists for this category. Use Edit instead.");
      return;
    }

    const db = getDb();
    const ym = ymKey();
    const now = new Date().toISOString();
    const rec = {
      id: uuid(),
      userId,
      ym,
      categoryId: newCategoryId,
      allocatedPoisha: bdtToPoisha(amount),
      carryPoisha: 0,
      createdAt: now,
      updatedAt: now,
    } as Budget;
    await db.budgets.put(rec as never);
    await enqueueSync("budgets", rec.id, "upsert", {
      id: rec.id,
      ym_char6: ym,
      category_id: rec.categoryId,
      allocated_poisha: rec.allocatedPoisha,
      carry_poisha: 0,
    });
    setAdding(false);
    setNewCategoryId("");
    setNewAmountBdt("");
    await load();
    toast("Budget added.", "success");
  }

  if (!loaded) {
    return (
      <AppShell title="Budgets">
        <div className="space-y-4">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      </AppShell>
    );
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

        <Button
          className="w-full"
          variant="secondary"
          onClick={applySuggestions}
        >
          Apply suggested budgets
        </Button>

        <Button
          className="w-full"
          variant="outline"
          onClick={() => {
            setAdding((s) => !s);
            setError("");
          }}
        >
          {adding ? "Cancel" : "Set budget"}
        </Button>

        {error && (
          <Card className="border-destructive/50 bg-destructive/5">
            <CardContent className="pt-4">
              <p className="text-sm text-destructive">{error}</p>
            </CardContent>
          </Card>
        )}

        {budgets.length === 0 ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground text-center py-4">
              No budgets yet. Apply suggestions based on your income.
            </p>
            {adding && (
              <Card>
                <CardContent className="space-y-3 pt-4">
                  <div>
                    <Label htmlFor="cat-select">Category</Label>
                    <select
                      id="cat-select"
                      className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      value={newCategoryId}
                      onChange={(e) => setNewCategoryId(e.target.value)}
                    >
                      <option value="">-- Select Category --</option>
                      {categories.map((cat) => (
                        <option key={cat.id} value={cat.id}>
                          {cat.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <Label htmlFor="amt-input">Amount (BDT)</Label>
                    <Input
                      id="amt-input"
                      type="number"
                      min="0"
                      step="1"
                      value={newAmountBdt}
                      onChange={(e) => setNewAmountBdt(e.target.value)}
                      placeholder="Enter amount"
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button onClick={addBudget}>Add</Button>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setAdding(false);
                        setNewCategoryId("");
                        setNewAmountBdt("");
                        setError("");
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {adding && (
              <Card>
                <CardContent className="space-y-3 pt-4">
                  <div>
                    <Label htmlFor="cat-select-2">Category</Label>
                    <select
                      id="cat-select-2"
                      className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      value={newCategoryId}
                      onChange={(e) => setNewCategoryId(e.target.value)}
                    >
                      <option value="">-- Select Category --</option>
                      {categories
                        .filter(
                          (cat) =>
                            !budgets.some((b) => b.categoryId === cat.id),
                        )
                        .map((cat) => (
                          <option key={cat.id} value={cat.id}>
                            {cat.name}
                          </option>
                        ))}
                    </select>
                  </div>
                  <div>
                    <Label htmlFor="amt-input-2">Amount (BDT)</Label>
                    <Input
                      id="amt-input-2"
                      type="number"
                      min="0"
                      step="1"
                      value={newAmountBdt}
                      onChange={(e) => setNewAmountBdt(e.target.value)}
                      placeholder="Enter amount"
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button onClick={addBudget}>Add</Button>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setAdding(false);
                        setNewCategoryId("");
                        setNewAmountBdt("");
                        setError("");
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
            {budgets.map((b) => {
              const spent = spentMap[b.categoryId] ?? 0;
              const total = b.allocatedPoisha + b.carryPoisha;
              const pct = total > 0 ? Math.min(100, (spent / total) * 100) : 0;
              const over = spent > total;
              const catName = categoryMap[b.categoryId]?.name || b.categoryId;
              return (
                <Card
                  key={b.id}
                  className={cn("transition-colors hover:bg-accent/40", over && "border-destructive/50")}
                >
                  <CardContent className="pt-4 space-y-2">
                    <div className="flex justify-between capitalize">
                      <span className="font-medium">{catName}</span>
                      <span className="text-sm text-muted-foreground">
                        {formatMoney(spent)} / {formatMoney(total)}
                      </span>
                    </div>
                    <Progress value={pct} />
                    {over && (
                      <p className="text-xs text-destructive">
                        Overspending alert
                      </p>
                    )}

                    {editingId === b.id ? (
                      <div className="space-y-2">
                        <div>
                          <Label htmlFor={`amt-${b.id}`}>Allocated (BDT)</Label>
                          <Input
                            id={`amt-${b.id}`}
                            type="number"
                            min="0"
                            step="1"
                            value={editAmountBdt}
                            onChange={(e) => setEditAmountBdt(e.target.value)}
                          />
                        </div>
                        <div className="flex gap-2">
                          <Button size="sm" onClick={() => saveEdit(b)}>
                            Save
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={cancelEdit}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => startEdit(b)}
                        >
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => deleteBudget(b)}
                        >
                          Delete
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}
