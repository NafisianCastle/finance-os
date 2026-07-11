"use client";

import { useEffect, useState } from "react";
import { v4 as uuid } from "uuid";
import { useTranslations } from "next-intl";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { useAppStore } from "@/store/app-store";
import { getDb } from "@/infrastructure/db/dexie/database";
import { useCurrencyFormatter } from "@/hooks/use-currency-formatter";
import type { Goal } from "@/infrastructure/db/dexie/schema";
import { enqueueSync } from "@/infrastructure/sync/sync-queue";
import { Loader2, Target } from "lucide-react";

export default function GoalsPage() {
  const userId = useAppStore((s) => s.userId);
  const { toast } = useToast();
  const t = useTranslations("Goals");
  const { format, toMinor, currencyCode } = useCurrencyFormatter();
  const [goals, setGoals] = useState<Goal[] | null>(null);
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [adding, setAdding] = useState(false);

  async function load() {
    if (!userId) return;
    const list = await getDb().goals.where("userId").equals(userId).filter((g) => !g.deletedAt).toArray();
    setGoals(list);
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
              <Input type="number" value={target} onChange={(e) => setTarget(e.target.value)} />
            </div>
            <Button onClick={addGoal} className="w-full" disabled={adding}>
              {adding && <Loader2 className="h-4 w-4 animate-spin" />}
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
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
    </AppShell>
  );
}
