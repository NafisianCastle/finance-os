"use client";

import { buildRuleContext } from "@/application/context-builder";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { evaluateSmartBuy } from "@/domain/rules-engine/evaluate";
import {
  formatSafeRange,
  reasonsToText,
  recoLabel,
  tierLabel,
} from "@/domain/rules-engine/reason-templates";
import type { SmartBuyResult } from "@/domain/rules-engine/types";
import { getDb } from "@/infrastructure/db/dexie/database";
import {
  enqueueSync,
  pruneBuyEvaluations,
  toLeanBuyEval,
} from "@/infrastructure/sync/sync-queue";
import { PRIORITY } from "@/lib/constants";
import { bdtToPoisha, formatMoney } from "@/lib/money";
import { useAppStore } from "@/store/app-store";
import { useToast } from "@/components/ui/toast";
import type { BuyEvaluation } from "@/infrastructure/db/dexie/schema";
import { useEffect, useState } from "react";
import { v4 as uuid } from "uuid";
export default function SmartBuyPage() {
  const userId = useAppStore((s) => s.userId);
  const { toast } = useToast();
  const [product, setProduct] = useState("");
  const [categoryId, setCategoryId] = useState("gadgets");
  const [price, setPrice] = useState("");
  const [priority, setPriority] = useState<number>(PRIORITY.USEFUL);
  const [result, setResult] = useState<SmartBuyResult | null>(null);
  const [meta, setMeta] = useState<Record<string, number>>({});
  const [history, setHistory] = useState<BuyEvaluation[]>([]);

  async function loadHistory() {
    if (!userId) return;
    const list = await getDb()
      .buyEvaluations.where("userId")
      .equals(userId)
      .filter((e) => !e.deletedAt)
      .toArray();
    setHistory(list.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  }

  useEffect(() => {
    loadHistory();
  }, [userId]);

  // Auto-evaluate when price, category, or priority changes
  useEffect(() => {
    async function autoEvaluate() {
      if (!userId || !price) return;

      try {
        const ctx = await buildRuleContext(userId, categoryId);
        const input = {
          productName: product,
          categoryId,
          pricePoisha: bdtToPoisha(parseFloat(price) || 0),
          priority,
        };
        const res = evaluateSmartBuy(ctx, input);
        setResult(res);
        const ratioPct = Math.round(
          (input.pricePoisha / ctx.monthlyIncomePoisha) * 100,
        );
        setMeta({ ratioPct });
      } catch (error) {
        console.error("Error auto-evaluating smart buy:", error);
      }
    }

    autoEvaluate();
  }, [userId, price, categoryId, priority, product]);

  async function handleEvaluate() {
    if (!userId || !result) return;

    const now = new Date().toISOString();
    const pricePoisha = bdtToPoisha(parseFloat(price) || 0);
    const evalRecord = {
      id: uuid(),
      userId,
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
      toLeanBuyEval(evalRecord),
    );
    await loadHistory();
    toast(`Saved "${evalRecord.productName || "evaluation"}".`, "success");
  }

  return (
    <AppShell title="Smart Buy">
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Deterministic rules engine — no AI. Evaluates affordability against
          your real finances.
        </p>
        <div className="space-y-2">
          <Label>Product</Label>
          <Input
            value={product}
            onChange={(e) => setProduct(e.target.value)}
            placeholder="iPhone 15"
          />
        </div>
        <div className="space-y-2">
          <Label>Category</Label>
          <select
            className="flex h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
          >
            {[
              "gadgets",
              "shopping",
              "entertainment",
              "transport",
              "food",
              "other",
            ].map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label>Price (BDT)</Label>
          <Input
            type="number"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="120000"
          />
        </div>
        <div className="space-y-2">
          <Label>Priority</Label>
          <div className="grid grid-cols-2 gap-2">
            {[
              { v: PRIORITY.NEED, l: "Need" },
              { v: PRIORITY.USEFUL, l: "Useful" },
              { v: PRIORITY.LUXURY, l: "Luxury" },
              { v: PRIORITY.IMPULSE, l: "Impulse" },
            ].map(({ v, l }) => (
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
        <Button className="w-full" onClick={handleEvaluate}>
          Save evaluation
        </Button>

        {result && (
          <Card className={result.hardUnsafe ? "border-destructive" : ""}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Result</CardTitle>
                <Badge
                  variant={result.hardUnsafe ? "destructive" : "secondary"}
                >
                  {tierLabel(result.tier)}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span>Affordability score</span>
                  <span className="font-semibold">
                    {result.affordabilityScore}/100
                  </span>
                </div>
                <Progress value={result.affordabilityScore} />
              </div>
              <p className="font-medium text-primary">
                {recoLabel(result.recommendation, result.saveMonths)}
              </p>
              <div>
                <p className="text-sm font-medium mb-2">Reasoning</p>
                <ul className="list-disc pl-4 text-sm text-muted-foreground space-y-1">
                  {reasonsToText(result.reasonCodes, meta).map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              </div>
              <div className="rounded-lg bg-muted p-3 text-sm">
                <p className="font-medium">Suggested safe range</p>
                <p>
                  {formatSafeRange(
                    result.safePriceMinPoisha,
                    result.safePriceMaxPoisha,
                  )}
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {history.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium">Past evaluations</p>
            {history.map((h) => (
              <Card key={h.id}>
                <CardContent className="flex items-center justify-between py-3">
                  <div>
                    <p className="font-medium">{h.productName || "Untitled"}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatMoney(h.pricePoisha)} · {new Date(h.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <Badge variant={h.tier >= 5 ? "destructive" : "secondary"}>
                    {tierLabel(h.tier)}
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
