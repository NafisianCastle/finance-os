"use client";

import { useEffect, useState } from "react";
import { v4 as uuid } from "uuid";
import { useTranslations } from "next-intl";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AmountInput } from "@/components/ui/amount-input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { useAppStore } from "@/store/app-store";
import { getDb } from "@/infrastructure/db/dexie/database";
import { useCurrencyFormatter } from "@/hooks/use-currency-formatter";
import type { Account, Goal } from "@/infrastructure/db/dexie/schema";
import { enqueueSync } from "@/infrastructure/sync/sync-queue";
import { addTransaction } from "@/application/transactions";
import { TX_TYPES } from "@/lib/constants";
import { Target } from "lucide-react";

const GOAL_CATEGORY_ID = "savings";

export default function GoalsPage() {
  const userId = useAppStore((s) => s.userId);
  const { toast } = useToast();
  const t = useTranslations("Goals");
  const { format, toMinor, currencyCode } = useCurrencyFormatter();
  const [goals, setGoals] = useState<Goal[] | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [adding, setAdding] = useState(false);
  const [contributingId, setContributingId] = useState<string | null>(null);
  const [contributeAmount, setContributeAmount] = useState("");
  const [contributeAccountId, setContributeAccountId] = useState("");
  const [contributing, setContributing] = useState(false);

  async function load() {
    if (!userId) return;
    const db = getDb();
    const list = await db.goals.where("userId").equals(userId).filter((g) => !g.deletedAt).toArray();
    setGoals(list);
    const accs = await db.accounts.where("userId").equals(userId).filter((a) => !a.deletedAt).toArray();
    setAccounts(accs);
  }

  useEffect(() => {
    load();
  }, [userId]);

  async function addGoal() {
    if (!userId) return;
    if (!name.trim()) {
      toast(t("enterNameError"), "error");
      return;
    }
    const targetBdt = parseFloat(target);
    if (Number.isNaN(targetBdt) || targetBdt <= 0) {
      toast(t("enterTargetError"), "error");
      return;
    }
    setAdding(true);
    const now = new Date().toISOString();
    const g: Goal = {
      id: uuid(),
      userId,
      name: name.trim(),
      targetPoisha: toMinor(targetBdt),
      savedPoisha: 0,
      createdAt: now,
      updatedAt: now,
    };
    await getDb().goals.put(g as never);
    await enqueueSync("goals", g.id, "upsert", {
      id: g.id,
      name: g.name,
      target_poisha: g.targetPoisha,
      saved_poisha: 0,
    });
    setName("");
    setTarget("");
    setAdding(false);
    await load();
    toast(t("goalAdded", { name: g.name }), "success");
  }

  function startContribute(g: Goal) {
    setContributingId(g.id);
    setContributeAmount("");
    setContributeAccountId(accounts[0]?.id ?? "");
  }

  function cancelContribute() {
    setContributingId(null);
    setContributeAmount("");
    setContributeAccountId("");
  }

  async function addContribution(g: Goal) {
    if (!userId) return;
    if (!contributeAccountId) {
      toast(t("selectAccountError"), "error");
      return;
    }
    const amountBdt = parseFloat(contributeAmount);
    if (Number.isNaN(amountBdt) || amountBdt <= 0) {
      toast(t("enterAmountError"), "error");
      return;
    }
    setContributing(true);
    const amountPoisha = toMinor(amountBdt);
    const now = new Date().toISOString();

    // Moves real money out of the account into the goal, same as any other
    // expense — keeps account balances and the Activity list truthful instead
    // of letting savedPoisha be a number disconnected from actual funds.
    await addTransaction(userId, {
      type: TX_TYPES.EXPENSE,
      amountPoisha,
      accountId: contributeAccountId,
      categoryId: GOAL_CATEGORY_ID,
      date: now,
      note: t("contributionNote", { name: g.name }),
    });

    const savedPoisha = g.savedPoisha + amountPoisha;
    await getDb().goals.update(g.id, { savedPoisha, updatedAt: now });
    await enqueueSync("goals", g.id, "upsert", {
      id: g.id,
      name: g.name,
      target_poisha: g.targetPoisha,
      saved_poisha: savedPoisha,
    });
    setContributing(false);
    setContributingId(null);
    setContributeAmount("");
    setContributeAccountId("");
    await load();
    toast(t("progressAdded", { name: g.name }), "success");
  }

  return (
    <AppShell title={t("title")}>
      <div className="space-y-4">
        <Card>
          <CardContent className="pt-4 space-y-3">
            <div className="space-y-2">
              <Label>{t("nameLabel")}</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("namePlaceholder")} />
            </div>
            <div className="space-y-2">
              <Label>{t("targetLabel", { currency: currencyCode })}</Label>
              <AmountInput value={target} onChange={setTarget} />
            </div>
            <Button onClick={addGoal} className="w-full" loading={adding}>
              {t("addGoal")}
            </Button>
          </CardContent>
        </Card>
        {goals === null ? (
          <div className="space-y-3">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : goals.length === 0 ? (
          <EmptyState
            icon={Target}
            title={t("emptyTitle")}
            description={t("emptyDescription")}
          />
        ) : (
          goals.map((g) => {
            const pct = g.targetPoisha > 0 ? (g.savedPoisha / g.targetPoisha) * 100 : 0;
            const remaining = g.targetPoisha - g.savedPoisha;
            const monthlyHint = remaining > 0 ? t("monthlyHint", { amount: format(Math.ceil(remaining / 12)) }) : t("complete");
            return (
              <Card key={g.id} className="transition-colors hover:bg-accent/40">
                <CardContent className="pt-4 space-y-2">
                  <div className="flex justify-between">
                    <span className="font-medium">{g.name}</span>
                    <span className="text-sm">{Math.round(pct)}%</span>
                  </div>
                  <Progress value={pct} />
                  <p className="text-xs text-muted-foreground">
                    {t("savedOfTarget", { saved: format(g.savedPoisha), target: format(g.targetPoisha) })}
                  </p>
                  <p className="text-xs text-primary">{monthlyHint}</p>
                  {contributingId === g.id ? (
                    <div className="space-y-2 pt-1">
                      <select
                        className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        value={contributeAccountId}
                        onChange={(e) => setContributeAccountId(e.target.value)}
                      >
                        <option value="">{t("selectAccountPlaceholder")}</option>
                        {accounts.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name} ({format(a.balancePoisha)})
                          </option>
                        ))}
                      </select>
                      <div className="flex gap-2">
                        <AmountInput
                          value={contributeAmount}
                          onChange={setContributeAmount}
                          placeholder={t("amountPlaceholder", { currency: currencyCode })}
                          className="flex-1"
                        />
                        <Button size="sm" onClick={() => addContribution(g)} loading={contributing}>
                          {t("add")}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={cancelContribute}>
                          {t("cancel")}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-1"
                      onClick={() => startContribute(g)}
                    >
                      {t("addProgress")}
                    </Button>
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
