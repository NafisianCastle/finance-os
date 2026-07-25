"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AmountInput } from "@/components/ui/amount-input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useAppStore } from "@/store/app-store";
import { getDb } from "@/infrastructure/db/dexie/database";
import { useCurrencyFormatter } from "@/hooks/use-currency-formatter";
import type { Account, PlannedPayment } from "@/infrastructure/db/dexie/schema";
import { PLANNED_PAYMENT_DIRECTION, PLANNED_PAYMENT_STATUS, RECURRENCE_INTERVAL, SYSTEM_CATEGORIES } from "@/lib/constants";
import { addPlannedPayment, deletePlannedPayment, markPlannedPaymentPaid } from "@/application/planned-payments";
import { useToast } from "@/components/ui/toast";
import { Repeat } from "lucide-react";

export default function PlannedPaymentsPage() {
  const t = useTranslations("PlannedPayments");
  const { format, toMinor, currencyCode } = useCurrencyFormatter();
  const userId = useAppStore((s) => s.userId);
  const { toast } = useToast();

  const [plans, setPlans] = useState<PlannedPayment[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);

  const [direction, setDirection] = useState<number>(PLANNED_PAYMENT_DIRECTION.PAY);
  const [amount, setAmount] = useState("");
  const [accountId, setAccountId] = useState("");
  const [categoryId, setCategoryId] = useState("other");
  const [counterparty, setCounterparty] = useState("");
  const [nextDueDate, setNextDueDate] = useState(new Date().toISOString().slice(0, 10));
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurrenceInterval, setRecurrenceInterval] = useState<number>(RECURRENCE_INTERVAL.MONTHLY);
  const [note, setNote] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [payingId, setPayingId] = useState<string | null>(null);

  async function load() {
    if (!userId) return;
    const db = getDb();
    const all = await db.plannedPayments
      .where("userId")
      .equals(userId)
      .filter((p) => !p.deletedAt && p.status === PLANNED_PAYMENT_STATUS.ACTIVE)
      .sortBy("nextDueDate");
    setPlans(all);
    const accs = await db.accounts.where("userId").equals(userId).filter((a) => !a.deletedAt).toArray();
    setAccounts(accs);
    setAccountId((prev) => prev || accs[0]?.id || "");
  }

  useEffect(() => {
    const timer = setTimeout(load, 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  async function addPlan() {
    if (!userId || !accountId) return;
    setIsAdding(true);
    try {
      await addPlannedPayment(userId, {
        direction,
        amountPoisha: toMinor(parseFloat(amount) || 0),
        accountId,
        categoryId: direction === PLANNED_PAYMENT_DIRECTION.RECEIVE ? "income" : categoryId,
        counterparty: counterparty || undefined,
        nextDueDate,
        isRecurring,
        recurrenceInterval: isRecurring ? recurrenceInterval : null,
        note: note || undefined,
      });
      setAmount("");
      setCounterparty("");
      setNote("");
      setIsRecurring(false);
      toast(t("planAdded"), "success");
      load();
    } finally {
      setIsAdding(false);
    }
  }

  async function markPaid(plan: PlannedPayment) {
    if (!userId) return;
    setPayingId(plan.id);
    try {
      await markPlannedPaymentPaid(userId, plan);
      toast(t("recorded"), "success");
      load();
    } finally {
      setPayingId(null);
    }
  }

  async function remove(planId: string) {
    if (!userId) return;
    await deletePlannedPayment(userId, planId);
    load();
  }

  const today = new Date().toISOString().slice(0, 10);
  const intervalLabel = (i?: number | null) => {
    if (i === RECURRENCE_INTERVAL.WEEKLY) return t("weekly");
    if (i === RECURRENCE_INTERVAL.YEARLY) return t("yearly");
    return t("monthly");
  };

  return (
    <AppShell title={t("title")}>
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("addPlan")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <Button
                type="button"
                variant={direction === PLANNED_PAYMENT_DIRECTION.PAY ? "default" : "outline"}
                className="flex-1"
                onClick={() => setDirection(PLANNED_PAYMENT_DIRECTION.PAY)}
              >
                {t("iPay")}
              </Button>
              <Button
                type="button"
                variant={direction === PLANNED_PAYMENT_DIRECTION.RECEIVE ? "default" : "outline"}
                className="flex-1"
                onClick={() => setDirection(PLANNED_PAYMENT_DIRECTION.RECEIVE)}
              >
                {t("iReceive")}
              </Button>
            </div>

            <div className="space-y-2">
              <Label>{t("counterparty")}</Label>
              <Input value={counterparty} onChange={(e) => setCounterparty(e.target.value)} placeholder={t("counterpartyPlaceholder")} />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-2">
                <Label>{t("amountLabel", { currency: currencyCode })}</Label>
                <AmountInput value={amount} onChange={setAmount} />
              </div>
              <div className="space-y-2">
                <Label>{t("dueDate")}</Label>
                <Input type="date" value={nextDueDate} onChange={(e) => setNextDueDate(e.target.value)} />
              </div>
            </div>

            <div className="space-y-2">
              <Label>{t("accountLabel")}</Label>
              <select
                className="flex h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </div>

            {direction === PLANNED_PAYMENT_DIRECTION.PAY && (
              <div className="space-y-2">
                <Label>{t("categoryLabel")}</Label>
                <select
                  className="flex h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
                  value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
                >
                  {SYSTEM_CATEGORIES.filter((c) => !["income", "savings", "investment"].includes(c.id)).map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
            )}

            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={isRecurring} onChange={(e) => setIsRecurring(e.target.checked)} />
              {t("recurring")}
            </label>

            {isRecurring && (
              <div className="space-y-2">
                <Label>{t("repeats")}</Label>
                <select
                  className="flex h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
                  value={recurrenceInterval}
                  onChange={(e) => setRecurrenceInterval(Number(e.target.value))}
                >
                  <option value={RECURRENCE_INTERVAL.WEEKLY}>{t("weekly")}</option>
                  <option value={RECURRENCE_INTERVAL.MONTHLY}>{t("monthly")}</option>
                  <option value={RECURRENCE_INTERVAL.YEARLY}>{t("yearly")}</option>
                </select>
              </div>
            )}

            <div className="space-y-2">
              <Label>{t("noteLabel")}</Label>
              <Input value={note} onChange={(e) => setNote(e.target.value)} />
            </div>

            <Button onClick={addPlan} className="w-full" loading={isAdding}>{t("addPlan")}</Button>
          </CardContent>
        </Card>

        {plans.map((p) => {
          const isOverdue = p.nextDueDate < today;
          const isPay = p.direction === PLANNED_PAYMENT_DIRECTION.PAY;
          return (
            <Card key={p.id} className={isOverdue ? "border-destructive/40" : ""}>
              <CardContent className="py-4 space-y-3">
                <div className="flex justify-between items-start gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{p.counterparty || (isPay ? t("iPay") : t("iReceive"))}</p>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      {isOverdue ? (
                        <Badge variant="destructive" className="text-xs">{t("overdue")}</Badge>
                      ) : (
                        <Badge variant="outline" className="text-xs">{isPay ? t("iPay") : t("iReceive")}</Badge>
                      )}
                      <p className="text-xs text-muted-foreground">{t("dueOn", { date: p.nextDueDate })}</p>
                      {p.isRecurring && (
                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                          <Repeat className="h-3 w-3" />
                          {intervalLabel(p.recurrenceInterval)}
                        </span>
                      )}
                    </div>
                  </div>
                  <p className={`shrink-0 font-semibold ${isPay ? "text-destructive" : "text-primary"}`}>
                    {isPay ? "-" : "+"}{format(p.amountPoisha)}
                  </p>
                </div>
                <div className="flex gap-2 border-t pt-3">
                  <Button size="sm" className="flex-1" loading={payingId === p.id} onClick={() => markPaid(p)}>
                    {isPay ? t("markPaid") : t("markReceived")}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => remove(p.id)}>
                    {t("cancel")}
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </AppShell>
  );
}
