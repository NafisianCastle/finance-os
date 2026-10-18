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
import { SharedChip, SharedToggle } from "@/components/shared-toggle";
import { useCategoryName } from "@/hooks/use-category-name";
import {
  budgetHealthScore,
  suggestBudgets,
} from "@/domain/rules-engine/budget-suggest.rules";
import { getDb } from "@/infrastructure/db/dexie/database";
import { getBudgetsForMonth, scoped } from "@/infrastructure/db/dexie/helpers";
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

/** Full remote `budgets` row (snake_case) for an upsert — includes user_id + group_id. */
function toBudgetPayload(b: Budget): Record<string, unknown> {
  return {
    id: b.id,
    user_id: b.userId,
    group_id: b.groupId ?? null,
    ym_char6: b.ym,
    category_id: b.categoryId,
    allocated_poisha: b.allocatedPoisha,
    carry_poisha: b.carryPoisha ?? 0,
    deleted_at: b.deletedAt ?? null,
  };
}

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
  const groupId = useAppStore((s) => s.groupId);
  const categoryName = useCategoryName();
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
  const [shared, setShared] = useState(true);
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
    // This pull never advances the lastSyncedAt checkpoint (SyncOnFocus owns
    // that), so a failed table pull is harmless here — the duplicate guard
    // below then just works from the local cache.
    if (isSupabaseConfigured()) {
      try {
        const localBudgetCount = await scoped(db.budgets, userId, groupId).count();
        const lastSyncedAt = localBudgetCount === 0 ? null : useAppStore.getState().lastSyncedAt;
        await pullRemoteChanges(userId, groupId, lastSyncedAt);
      } catch (err) {
        console.error("Budgets pull failed", err);
      }
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
    const b = await getBudgetsForMonth(userId, ym, groupId);
    setBudgets(b);

    const txs = await scoped(db.transactions, userId, groupId).toArray();
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
    const timer = setTimeout(load, 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, groupId]);

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
          const updated: Budget = { ...existing, allocatedPoisha: s.suggestedPoisha, updatedAt: now };
          await db.budgets.update(existing.id, {
            allocatedPoisha: s.suggestedPoisha,
            updatedAt: now,
          });
          await enqueueSync("budgets", existing.id, "upsert", toBudgetPayload(updated));
        } else {
          // Suggested budgets are shared with the household by default.
          const rec: Budget = {
            id: uuid(),
            userId,
            groupId: groupId ?? null,
            ym,
            categoryId: s.categoryId,
            allocatedPoisha: s.suggestedPoisha,
            carryPoisha: 0,
            createdAt: now,
            updatedAt: now,
          };
          await db.budgets.put(rec as never);
          await enqueueSync("budgets", rec.id, "upsert", toBudgetPayload(rec));
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
      await enqueueSync(
        "budgets",
        b.id,
        "upsert",
        toBudgetPayload({ ...b, allocatedPoisha: poisha, updatedAt: now })
      );
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
    const catName = categoryName(categoryMap[b.categoryId] ?? b.categoryId);
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
      await enqueueSync(
        "budgets",
        b.id,
        "upsert",
        toBudgetPayload({ ...b, deletedAt: now, updatedAt: now })
      );
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

    const targetGroupId = shared && groupId ? groupId : null;
    const existing = budgets.find((b) => b.categoryId === newCategoryId);
    if (existing) {
      if ((existing.groupId ?? null) !== targetGroupId) {
        // One budget per category per month: a personal and a shared budget
        // for the same category can't coexist.
        toast(t(existing.groupId ? "budgetExistsShared" : "budgetExistsPersonal"), "error");
      } else {
        setError(t("budgetAlreadyExists"));
      }
      return;
    }

    setIsSubmittingBudget(true);
    try {
      const db = getDb();
      const ym = ymKey();
      const now = new Date().toISOString();
      const rec: Budget = {
        id: uuid(),
        userId,
        groupId: targetGroupId,
        ym,
        categoryId: newCategoryId,
        allocatedPoisha: toMinor(amount),
        carryPoisha: 0,
        createdAt: now,
        updatedAt: now,
      };
      await db.budgets.put(rec as never);
      await enqueueSync("budgets", rec.id, "upsert", toBudgetPayload(rec));
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
                          {categoryName(cat)}
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
                  <SharedToggle checked={shared} onChange={setShared} />
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
                            // Only hide same-scope duplicates; picking a category
                            // budgeted in the other scope explains why via a toast.
                            !budgets.some(
                              (b) =>
                                b.categoryId === cat.id &&
                                (b.groupId ?? null) === (shared && groupId ? groupId : null),
                            ),
                        )
                        .map((cat) => (
                          <option key={cat.id} value={cat.id}>
                            {categoryName(cat)}
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
                  <SharedToggle checked={shared} onChange={setShared} />
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
              const catName = categoryName(categoryMap[b.categoryId] ?? b.categoryId);
              return (
                <Card
                  key={b.id}
                  className={cn("transition-colors hover:bg-accent/40", over && "border-destructive/50")}
                >
                  <CardContent className="pt-4 space-y-2">
                    <div className="flex justify-between gap-3">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate font-medium">{catName}</span>
                        <SharedChip groupId={b.groupId} />
                      </span>
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
