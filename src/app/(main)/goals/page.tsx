"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { differenceInCalendarMonths, parseISO } from "date-fns";
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
import { useConfirm } from "@/components/ui/confirm-dialog";
import { SharedChip, SharedToggle } from "@/components/shared-toggle";
import { useAppStore } from "@/store/app-store";
import { getDb } from "@/infrastructure/db/dexie/database";
import { scoped } from "@/infrastructure/db/dexie/helpers";
import { useCurrencyFormatter } from "@/hooks/use-currency-formatter";
import type { Account, Goal } from "@/infrastructure/db/dexie/schema";
import {
  addGoal,
  contributeToGoal,
  deleteGoal,
  listGoals,
  updateGoal,
} from "@/application/goals";
import { Target } from "lucide-react";

export default function GoalsPage() {
  const userId = useAppStore((s) => s.userId);
  const groupId = useAppStore((s) => s.groupId);
  const { toast } = useToast();
  const confirm = useConfirm();
  const t = useTranslations("Goals");
  const locale = useLocale();
  const { format, toMinor, toMajor, currencyCode } = useCurrencyFormatter();
  const [goals, setGoals] = useState<Goal[] | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [deadline, setDeadline] = useState("");
  const [shared, setShared] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [contributingId, setContributingId] = useState<string | null>(null);
  const [contributeAmount, setContributeAmount] = useState("");
  const [contributeAccountId, setContributeAccountId] = useState("");
  const [contributing, setContributing] = useState(false);

  const formatDate = (d: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(parseISO(d));

  async function load() {
    if (!userId) return;
    setGoals(await listGoals(userId, groupId));
    setAccounts(await scoped(getDb().accounts, userId, groupId).toArray());
  }

  useEffect(() => {
    const timer = setTimeout(load, 0);
    return () => clearTimeout(timer);
  }, [userId, groupId]);

  function resetForm() {
    setEditingId(null);
    setName("");
    setTarget("");
    setDeadline("");
  }

  function startEdit(g: Goal) {
    setEditingId(g.id);
    setName(g.name);
    setTarget(String(toMajor(g.targetPoisha)));
    setDeadline(g.deadline ?? "");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function saveGoal() {
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
    setSaving(true);
    try {
      const data = { name: name.trim(), targetPoisha: toMinor(targetBdt), deadline };
      if (editingId) {
        await updateGoal(userId, editingId, data, groupId);
        toast(t("goalUpdated"), "success");
      } else {
        await addGoal(userId, data, shared ? groupId : null);
        toast(t("goalAdded", { name: data.name }), "success");
      }
      resetForm();
      await load();
    } catch {
      toast(t("actionFailed"), "error");
    } finally {
      setSaving(false);
    }
  }

  async function removeGoal(g: Goal) {
    if (!userId) return;
    const ok = await confirm({
      title: t("deleteGoalTitle", { name: g.name }),
      description: t("deleteGoalDescription"),
      confirmLabel: t("delete"),
      variant: "destructive",
    });
    if (!ok) return;
    setDeletingId(g.id);
    try {
      await deleteGoal(userId, g.id, groupId);
      if (editingId === g.id) resetForm();
      await load();
      toast(t("goalDeleted", { name: g.name }), "success");
    } catch {
      toast(t("actionFailed"), "error");
    } finally {
      setDeletingId(null);
    }
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
    try {
      await contributeToGoal(
        userId,
        g.id,
        toMinor(amountBdt),
        contributeAccountId,
        t("contributionNote", { name: g.name }),
        groupId
      );
      cancelContribute();
      await load();
      toast(t("progressAdded", { name: g.name }), "success");
    } catch {
      toast(t("actionFailed"), "error");
    } finally {
      setContributing(false);
    }
  }

  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);

  return (
    <AppShell title={t("title")}>
      <div className="space-y-4">
        <Card>
          <CardContent className="pt-4 space-y-3">
            {editingId && <p className="text-sm font-medium">{t("editGoal")}</p>}
            <div className="space-y-2">
              <Label htmlFor="goal-name">{t("nameLabel")}</Label>
              <Input id="goal-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("namePlaceholder")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="goal-target">{t("targetLabel", { currency: currencyCode })}</Label>
              <AmountInput id="goal-target" value={target} onChange={setTarget} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="goal-deadline">{t("deadlineLabel")}</Label>
              <Input id="goal-deadline" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
            </div>
            {!editingId && <SharedToggle checked={shared} onChange={setShared} />}
            <div className="flex gap-2">
              <Button onClick={saveGoal} className="flex-1" loading={saving}>
                {editingId ? t("save") : t("addGoal")}
              </Button>
              {editingId && (
                <Button variant="ghost" onClick={resetForm}>
                  {t("cancel")}
                </Button>
              )}
            </div>
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
            let monthlyHint: string;
            if (remaining <= 0) {
              monthlyHint = t("complete");
            } else if (g.deadline && g.deadline < todayStr) {
              monthlyHint = t("pastDeadline");
            } else if (g.deadline) {
              const months = Math.max(1, differenceInCalendarMonths(parseISO(g.deadline), today));
              monthlyHint = t("monthlyHintDeadline", {
                amount: format(Math.ceil(remaining / months)),
                date: formatDate(g.deadline),
              });
            } else {
              monthlyHint = t("monthlyHint", { amount: format(Math.ceil(remaining / 12)) });
            }
            return (
              <Card key={g.id} className="transition-colors hover:bg-accent/40">
                <CardContent className="pt-4 space-y-2">
                  <div className="flex justify-between gap-3">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate font-medium">{g.name}</span>
                      <SharedChip groupId={g.groupId} />
                    </span>
                    <span className="shrink-0 text-sm">{Math.round(pct)}%</span>
                  </div>
                  <Progress value={pct} />
                  <p className="text-xs text-muted-foreground">
                    {t("savedOfTarget", { saved: format(g.savedPoisha), target: format(g.targetPoisha) })}
                  </p>
                  {g.deadline && (
                    <p className="text-xs text-muted-foreground">{t("deadlineOn", { date: formatDate(g.deadline) })}</p>
                  )}
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
                    <div className="flex flex-wrap gap-2 pt-1">
                      <Button size="sm" variant="outline" onClick={() => startContribute(g)}>
                        {t("addProgress")}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => startEdit(g)}>
                        {t("edit")}
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => removeGoal(g)}
                        loading={deletingId === g.id}
                      >
                        {t("delete")}
                      </Button>
                    </div>
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
