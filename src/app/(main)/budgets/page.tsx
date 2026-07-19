"use client";

import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AmountInput } from "@/components/ui/amount-input";
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
import { isSupabaseConfigured } from "@/infrastructure/supabase/client";
import { enqueueSync, pullRemoteChanges } from "@/infrastructure/sync/sync-queue";
import { TX_TYPES } from "@/lib/constants";
import { useCurrencyFormatter } from "@/hooks/use-currency-formatter";
import { cn, ymKey } from "@/lib/utils";
import { useAppStore } from "@/store/app-store";
import { endOfMonth, isWithinInterval, parseISO, startOfMonth } from "date-fns";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { v4 as uuid } from "uuid";

function budgetHealthLevel(score: number) {
  if (score >= 85) return "Excellent";
  if (score >= 70) return "Good";
  if (score >= 50) return "NeedsAttention";
  return "Overspending";
}

function budgetHealthColor(score: number) {
  if (score >= 70) return "hsl(var(--success))";
  if (score >= 50) return "hsl(var(--warning))";
  return "oklch(var(--destructive))";
}

export default function BudgetsPage() {
  const t = useTranslations("Budgets");
  const { format, toMinor, toMajor, currencyCode } = useCurrencyFormatter();
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
  const [isApplyingSuggestions, setIsApplyingSuggestions] = useState(false);
  const [isSubmittingBudget, setIsSubmittingBudget] = useState(false);
  const [savingEditId, setSavingEditId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function load() {
    if (!userId) return;
    const db = getDb();
    const ym = ymKey();

    // Pull before reading local budgets — on a fresh browser the local cache
    // is empty, and without this, applySuggestions/addBudget below would
    // conclude a category has no budget yet and create a duplicate local row
    // for one that already exists remotely. Only force the expensive
    // since-1970 full pull when the local cache is actually empty; otherwise
    // reuse the normal incremental checkpoint (SyncOnFocus already keeps it
    // fresh) so a Budgets-page mount doesn't repeat a full 11-table pull.
    if (isSupabaseConfigured()) {
      const localBudgetCount = await db.budgets.where("userId").equals(userId).count();
      const lastSyncedAt = localBudgetCount === 0 ? null : useAppStore.getState().lastSyncedAt;
      await pullRemoteChanges(userId, lastSyncedAt);
    }

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
      toast(t("setIncomeFirst"), "error");
      return;
    }
    setIsApplyingSuggestions(true);
    try {
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
      toast(t("suggestionsApplied"), "success");
    } finally {
      setIsApplyingSuggestions(false);
    }
  }

  function startEdit(b: Budget) {
    setEditingId(b.id);
    setEditAmountBdt(String(toMajor(b.allocatedPoisha)));
  }

  async function saveEdit(b: Budget) {
    setError("");
    const amount = Number(editAmountBdt) || 0;
    if (amount <= 0) {
      setError(t("amountMustBePositive"));
      return;
    }
    if (!userId) return;
    setSavingEditId(b.id);
    try {
      const db = getDb();
      const now = new Date().toISOString();
      const poisha = toMinor(amount);
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
      toast(t("budgetUpdated"), "success");
    } finally {
      setSavingEditId(null);
    }
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
      title: t("deleteBudgetTitle", { name: catName }),
      description: t("deleteBudgetDescription"),
      confirmLabel: t("delete"),
      variant: "destructive",
    });
    if (!ok) return;
    setDeletingId(b.id);
    try {
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
      toast(t("budgetDeleted", { name: catName }), "success");
    } finally {
      setDeletingId(null);
    }
  }

  async function addBudget() {
    setError("");
    if (!userId || !newCategoryId) {
      setError(t("selectCategory"));
      return;
    }
    const amount = Number(newAmountBdt) || 0;
    if (amount <= 0) {
      setError(t("amountMustBePositive"));
      return;
    }

    const existing = budgets.find((b) => b.categoryId === newCategoryId);
    if (existing) {
      setError(t("budgetAlreadyExists"));
      return;
    }

    setIsSubmittingBudget(true);
    try {
      const db = getDb();
      const ym = ymKey();
      const now = new Date().toISOString();
      const rec = {
        id: uuid(),
        userId,
        ym,
        categoryId: newCategoryId,
        allocatedPoisha: toMinor(amount),
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
      toast(t("budgetAdded"), "success");
    } finally {
      setIsSubmittingBudget(false);
    }
  }

  if (!loaded) {
    return (
      <AppShell title={t("title")}>
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
    <AppShell title={t("title")}>
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("budgetHealth")}</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">{t("budgetHealthSubtitle")}</p>
          </CardHeader>
          <CardContent>
            {budgets.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("noBudgetsHealth")}</p>
            ) : (
              <>
                <div className="flex items-end gap-2 mb-2">
                  <span className="text-3xl font-bold">{health}</span>
                  <span className="text-muted-foreground">/ 100</span>
                </div>
                <Progress value={health} color={budgetHealthColor(health)} />
                <p className="text-xs text-muted-foreground mt-2">
                  {t(`budgetHealthLevel_${budgetHealthLevel(health)}` as "budgetHealthLevel_Excellent")}
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Button
          className="w-full"
          variant="secondary"
          onClick={applySuggestions}
          loading={isApplyingSuggestions}
        >
          {t("applySuggestedBudgets")}
        </Button>

        <Button
          className="w-full"
          variant="outline"
          onClick={() => {
            setAdding((s) => !s);
            setError("");
          }}
        >
          {adding ? t("cancel") : t("setBudget")}
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
              {t("noBudgetsYet")}
            </p>
            {adding && (
              <Card>
                <CardContent className="space-y-3 pt-4">
                  <div>
                    <Label htmlFor="cat-select">{t("category")}</Label>
                    <select
                      id="cat-select"
                      className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      value={newCategoryId}
                      onChange={(e) => setNewCategoryId(e.target.value)}
                    >
                      <option value="">{t("selectCategoryPlaceholder")}</option>
                      {categories.map((cat) => (
                        <option key={cat.id} value={cat.id}>
                          {cat.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <Label htmlFor="amt-input">{t("amountLabel", { currency: currencyCode })}</Label>
                    <AmountInput
                      id="amt-input"
                      value={newAmountBdt}
                      onChange={setNewAmountBdt}
                      placeholder={t("enterAmount")}
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button onClick={addBudget} loading={isSubmittingBudget}>{t("add")}</Button>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setAdding(false);
                        setNewCategoryId("");
                        setNewAmountBdt("");
                        setError("");
                      }}
                    >
                      {t("cancel")}
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
                    <Label htmlFor="cat-select-2">{t("category")}</Label>
                    <select
                      id="cat-select-2"
                      className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      value={newCategoryId}
                      onChange={(e) => setNewCategoryId(e.target.value)}
                    >
                      <option value="">{t("selectCategoryPlaceholder")}</option>
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
                    <Label htmlFor="amt-input-2">{t("amountLabel", { currency: currencyCode })}</Label>
                    <AmountInput
                      id="amt-input-2"
                      value={newAmountBdt}
                      onChange={setNewAmountBdt}
                      placeholder={t("enterAmount")}
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button onClick={addBudget} loading={isSubmittingBudget}>{t("add")}</Button>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setAdding(false);
                        setNewCategoryId("");
                        setNewAmountBdt("");
                        setError("");
                      }}
                    >
                      {t("cancel")}
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
                    <div className="flex justify-between gap-3 capitalize">
                      <span className="min-w-0 truncate font-medium">{catName}</span>
                      <span className="shrink-0 text-sm text-muted-foreground">
                        {format(spent)} / {format(total)}
                      </span>
                    </div>
                    <Progress value={pct} />
                    {over && (
                      <p className="text-xs text-destructive">
                        {t("overspendingAlert")}
                      </p>
                    )}

                    {editingId === b.id ? (
                      <div className="space-y-2">
                        <div>
                          <Label htmlFor={`amt-${b.id}`}>{t("allocatedLabel", { currency: currencyCode })}</Label>
                          <AmountInput
                            id={`amt-${b.id}`}
                            value={editAmountBdt}
                            onChange={setEditAmountBdt}
                          />
                        </div>
                        <div className="flex gap-2">
                          <Button size="sm" onClick={() => saveEdit(b)} loading={savingEditId === b.id}>
                            {t("save")}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={cancelEdit}
                          >
                            {t("cancel")}
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
                          {t("edit")}
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => deleteBudget(b)}
                          loading={deletingId === b.id}
                        >
                          {t("delete")}
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
