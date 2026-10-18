"use client";

import { buildRuleContext } from "@/application/context-builder";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { AmountInput } from "@/components/ui/amount-input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { evaluateSmartBuy } from "@/domain/rules-engine/evaluate";
import {
  formatSafeRange,
  reasonsToLocalizedText,
  recoLabel,
  tierLabel,
} from "@/domain/rules-engine/reason-templates";
import type { SmartBuyResult } from "@/domain/rules-engine/types";
import { getDb } from "@/infrastructure/db/dexie/database";
import { scoped } from "@/infrastructure/db/dexie/helpers";
import { useCategoryName } from "@/hooks/use-category-name";
import {
  enqueueSync,
  pruneBuyEvaluations,
  toLeanBuyEval,
} from "@/infrastructure/sync/sync-queue";
import { PRIORITY } from "@/lib/constants";
import { useCurrencyFormatter } from "@/hooks/use-currency-formatter";
import { useAppStore } from "@/store/app-store";
import { useToast } from "@/components/ui/toast";
import type { BuyEvaluation } from "@/infrastructure/db/dexie/schema";
import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { v4 as uuid } from "uuid";
export default function SmartBuyPage() {
  const t = useTranslations("SmartBuy");
  const tReasons = useTranslations("SmartBuyReasons");
  const uiLocale = useLocale();
  const categoryName = useCategoryName();
  const { format, toMinor, currencyCode, locale } = useCurrencyFormatter();
  const userId = useAppStore((s) => s.userId);
  const groupId = useAppStore((s) => s.groupId);
  const { toast } = useToast();
  const [product, setProduct] = useState("");
  const [categoryId, setCategoryId] = useState("gadgets");
  const [price, setPrice] = useState("");
  const [priority, setPriority] = useState<number>(PRIORITY.USEFUL);
  const [result, setResult] = useState<SmartBuyResult | null>(null);
  const [history, setHistory] = useState<BuyEvaluation[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  const categoryOptions = [
    "gadgets",
    "shopping",
    "entertainment",
    "transport",
    "food",
    "other",
  ];

  const priorityOptions = [
    { v: PRIORITY.NEED, l: t("priorityNeed") },
    { v: PRIORITY.USEFUL, l: t("priorityUseful") },
    { v: PRIORITY.LUXURY, l: t("priorityLuxury") },
    { v: PRIORITY.IMPULSE, l: t("priorityImpulse") },
  ];

  function tierText(tier: number) {
    return (
      {
        1: t("tierCheap"),
        2: t("tierReasonable"),
        3: t("tierStretch"),
        4: t("tierExpensive"),
        5: t("tierUnsafe"),
      }[tier] ?? tierLabel(tier)
    );
  }

  function recoText(reco: number, saveMonths?: number) {
    const labels: Record<number, string> = {
      1: t("recoBuyNow"),
      2: t("recoWaitSalary"),
      3: saveMonths ? t("recoSaveMonths", { count: saveMonths }) : t("recoSaveBeforeBuying"),
      4: t("recoAvoid"),
    };
    return labels[reco] ?? recoLabel(reco, saveMonths);
  }

  async function loadHistory() {
    if (!userId) return;
    const list = await scoped(getDb().buyEvaluations, userId, groupId).toArray();
    setHistory(list.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  }

  useEffect(() => {
    const timer = setTimeout(loadHistory, 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, groupId]);

  // Auto-evaluate when price, category, or priority changes
  useEffect(() => {
    // Ignore results of a superseded evaluation (inputs changed mid-await).
    let cancelled = false;
    async function autoEvaluate() {
      if (!userId) return;
      const amount = parseFloat(price);
      if (!price || !(amount > 0)) {
        setResult(null);
        return;
      }

      try {
        const ctx = await buildRuleContext(userId, categoryId, groupId);
        const input = {
          productName: product,
          categoryId,
          pricePoisha: toMinor(amount),
          priority,
        };
        const res = evaluateSmartBuy(ctx, input);
        if (!cancelled) setResult(res);
      } catch (error) {
        console.error("Error auto-evaluating smart buy:", error);
      }
    }

    void autoEvaluate();
    return () => {
      cancelled = true;
    };
  }, [userId, groupId, price, categoryId, priority, product, toMinor]);

  async function handleEvaluate() {
    if (!userId || !result) return;

    setIsSaving(true);
    try {
      const now = new Date().toISOString();
      const pricePoisha = toMinor(parseFloat(price) || 0);
      // Buy evaluations are personal decisions — never shared with the group.
      const evalRecord: BuyEvaluation = {
        id: uuid(),
        userId,
        groupId: null,
        productName: product.slice(0, 80),
        categoryId,
        pricePoisha,
        priority,
        score: result.affordabilityScore,
        tier: result.tier,
        recommendation: result.recommendation,
        reasonCodes: result.reasonCodes,
        saveMonths: result.saveMonths,
        createdAt: now,
        updatedAt: now,
      };
      await getDb().buyEvaluations.put(evalRecord as never);
      await pruneBuyEvaluations(userId);
      await enqueueSync(
        "buy_evaluations",
        evalRecord.id,
        "upsert",
        { ...toLeanBuyEval(evalRecord), user_id: evalRecord.userId, group_id: null },
      );
      await loadHistory();
      toast(
        t("savedToast", { name: evalRecord.productName || t("untitledEvaluation") }),
        "success",
      );
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <AppShell title={t("title")}>
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">{t("description")}</p>
        <div className="space-y-2">
          <Label>{t("productLabel")}</Label>
          <Input
            value={product}
            onChange={(e) => setProduct(e.target.value)}
            placeholder={t("productPlaceholder")}
          />
        </div>
        <div className="space-y-2">
          <Label>{t("categoryLabel")}</Label>
          <select
            className="flex h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
          >
            {categoryOptions.map((c) => (
              <option key={c} value={c}>
                {categoryName(c)}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label>{t("priceLabel", { currency: currencyCode })}</Label>
          <AmountInput value={price} onChange={setPrice} placeholder="120000" />
        </div>
        <div className="space-y-2">
          <Label>{t("priorityLabel")}</Label>
          <div className="grid grid-cols-2 gap-2">
            {priorityOptions.map(({ v, l }) => (
              <Button
                key={v}
                type="button"
                variant={priority === v ? "default" : "outline"}
                size="sm"
                onClick={() => setPriority(v)}
              >
                {l}
              </Button>
            ))}
          </div>
        </div>
        <Button className="w-full" onClick={handleEvaluate} loading={isSaving} disabled={!result}>
          {t("saveEvaluation")}
        </Button>

        {result && (
          <Card className={result.hardUnsafe ? "border-destructive" : ""}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>{t("result")}</CardTitle>
                <Badge
                  variant={result.hardUnsafe ? "destructive" : "secondary"}
                >
                  {tierText(result.tier)}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span>{t("affordabilityScore")}</span>
                  <span className="font-semibold">
                    {result.affordabilityScore}/100
                  </span>
                </div>
                <Progress value={result.affordabilityScore} />
              </div>
              <p className="font-medium text-primary">
                {recoText(result.recommendation, result.saveMonths)}
              </p>
              <div>
                <p className="text-sm font-medium mb-2">{t("reasoning")}</p>
                <ul className="list-disc pl-4 text-sm text-muted-foreground space-y-1">
                  {reasonsToLocalizedText(result.reasonCodes, result.reasonMetadata, tReasons).map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              </div>
              <div className="rounded-lg bg-muted p-3 text-sm">
                <p className="font-medium">{t("suggestedSafeRange")}</p>
                <p>
                  {formatSafeRange(
                    result.safePriceMinPoisha,
                    result.safePriceMaxPoisha,
                    currencyCode,
                    locale,
                  )}
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {history.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium">{t("pastEvaluations")}</p>
            {history.map((h) => (
              <Card key={h.id}>
                <CardContent className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{h.productName || t("untitled")}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {format(h.pricePoisha)} · {categoryName(h.categoryId)} ·{" "}
                      {new Intl.DateTimeFormat(uiLocale, { dateStyle: "medium" }).format(new Date(h.createdAt))}
                    </p>
                  </div>
                  <Badge variant={h.tier >= 5 ? "destructive" : "secondary"} className="shrink-0">
                    {tierText(h.tier)}
                  </Badge>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
