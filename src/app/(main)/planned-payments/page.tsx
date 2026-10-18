"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AmountInput } from "@/components/ui/amount-input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useAppStore } from "@/store/app-store";
import { getDb } from "@/infrastructure/db/dexie/database";
import { scoped } from "@/infrastructure/db/dexie/helpers";
import { useCurrencyFormatter } from "@/hooks/use-currency-formatter";
import type { Account, PlannedPayment } from "@/infrastructure/db/dexie/schema";
import { PLANNED_PAYMENT_DIRECTION, PLANNED_PAYMENT_STATUS, RECURRENCE_INTERVAL, SYSTEM_CATEGORIES } from "@/lib/constants";
import {
  addPlannedPayment,
  deletePlannedPayment,
  listPlannedPayments,
  markPlannedPaymentPaid,
  updatePlannedPayment,
} from "@/application/planned-payments";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { SharedChip, SharedToggle } from "@/components/shared-toggle";
import { useCategoryName } from "@/hooks/use-category-name";
import { CalendarClock, Repeat } from "lucide-react";

const todayIso = () => new Date().toISOString().slice(0, 10);

export default function PlannedPaymentsPage() {
  const t = useTranslations("PlannedPayments");
  const locale = useLocale();
  const { format, toMinor, toMajor, currencyCode } = useCurrencyFormatter();
  const userId = useAppStore((s) => s.userId);
  const groupId = useAppStore((s) => s.groupId);
  const { toast } = useToast();
  const confirm = useConfirm();
  const categoryName = useCategoryName();

  const [plans, setPlans] = useState<PlannedPayment[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [direction, setDirection] = useState<number>(PLANNED_PAYMENT_DIRECTION.PAY);
  const [amount, setAmount] = useState("");
  const [accountId, setAccountId] = useState("");
  const [categoryId, setCategoryId] = useState("other");
  const [counterparty, setCounterparty] = useState("");
  const [nextDueDate, setNextDueDate] = useState(todayIso());
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurrenceInterval, setRecurrenceInterval] = useState<number>(RECURRENCE_INTERVAL.MONTHLY);
  const [note, setNote] = useState("");
  const [shared, setShared] = useState(true);
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [payingId, setPayingId] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  async function load() {
    if (!userId) return;
    const all = (await listPlannedPayments(userId, groupId))
      .filter((p) => p.status === PLANNED_PAYMENT_STATUS.ACTIVE)
      .sort((a, b) => a.nextDueDate.localeCompare(b.nextDueDate));
    setPlans(all);
    const accs = await scoped(getDb().accounts, userId, groupId).toArray();
    setAccounts(accs);
    setAccountId((prev) => (prev && accs.some((a) => a.id === prev) ? prev : accs[0]?.id || ""));
  }

  useEffect(() => {
    const timer = setTimeout(load, 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, groupId]);

  function resetForm() {
    setEditingId(null);
    setDirection(PLANNED_PAYMENT_DIRECTION.PAY);
    setAmount("");
    setCategoryId("other");
    setCounterparty("");
    setNextDueDate(todayIso());
    setIsRecurring(false);
    setRecurrenceInterval(RECURRENCE_INTERVAL.MONTHLY);
    setNote("");
    setError("");
  }

  function startEdit(plan: PlannedPayment) {
    setEditingId(plan.id);
    setDirection(plan.direction);
    setAmount(String(toMajor(plan.amountPoisha)));
    setAccountId(plan.accountId);
    setCategoryId(plan.direction === PLANNED_PAYMENT_DIRECTION.RECEIVE ? "other" : plan.categoryId);
    setCounterparty(plan.counterparty ?? "");
    setNextDueDate(plan.nextDueDate);
    setIsRecurring(plan.isRecurring);
    setRecurrenceInterval(plan.recurrenceInterval ?? RECURRENCE_INTERVAL.MONTHLY);
    setNote(plan.note ?? "");
    setError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function savePlan() {
    if (!userId) return;
    setError("");
    const amountMajor = parseFloat(amount) || 0;
    if (amountMajor <= 0) {
      setError(t("amountMustBePositive"));
      return;
    }
    if (!accountId) {
      setError(t("selectAccount"));
      return;
    }
    setIsSaving(true);
    try {
      const data = {
        direction,
        amountPoisha: toMinor(amountMajor),
        accountId,
        categoryId: direction === PLANNED_PAYMENT_DIRECTION.RECEIVE ? "income" : categoryId,
        counterparty: counterparty.trim() || undefined,
        nextDueDate,
        isRecurring,
        recurrenceInterval: isRecurring ? recurrenceInterval : null,
        note: note.trim() || undefined,
      };
      if (editingId) {
        await updatePlannedPayment(userId, editingId, data, groupId);
        toast(t("planUpdated"), "success");
      } else {
        await addPlannedPayment(userId, data, shared ? groupId : null);
        toast(t("planAdded"), "success");
      }
      resetForm();
      await load();
    } finally {
      setIsSaving(false);
    }
  }

  async function markPaid(plan: PlannedPayment) {
    if (!userId) return;
    setPayingId(plan.id);
    try {
      await markPlannedPaymentPaid(userId, plan, groupId);
      if (editingId === plan.id) resetForm();
      toast(t("recorded"), "success");
      await load();
    } finally {
      setPayingId(null);
    }
  }

  async function remove(plan: PlannedPayment) {
    if (!userId) return;
    const ok = await confirm({
      title: t("cancelPlanTitle"),
      description: t("cancelPlanDescription"),
      confirmLabel: t("cancelPlan"),
      variant: "destructive",
    });
    if (!ok) return;
    setCancellingId(plan.id);
    try {
      await deletePlannedPayment(userId, plan.id, groupId);
      if (editingId === plan.id) resetForm();
      toast(t("planCancelled"), "success");
      await load();
    } finally {
      setCancellingId(null);
    }
  }

  const today = todayIso();
  const dateFormatter = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" });
  const formatDate = (d: string) => {
    const date = new Date(`${d}T00:00:00Z`);
    return Number.isNaN(date.getTime()) ? d : dateFormatter.format(date);
  };
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
            <CardTitle className="text-base">{editingId ? t("editPlan") : t("addPlan")}</CardTitle>
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
                    <option key={c.id} value={c.id}>{categoryName(c.id)}</option>
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

            {!editingId && <SharedToggle checked={shared} onChange={setShared} />}

            {error && <p className="text-sm text-destructive">{error}</p>}

            <div className="flex gap-2">
              <Button onClick={savePlan} className="flex-1" loading={isSaving}>
                {editingId ? t("save") : t("addPlan")}
              </Button>
              {editingId && (
                <Button variant="ghost" onClick={resetForm}>
                  {t("cancel")}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {plans.length === 0 && (
          <EmptyState icon={CalendarClock} title={t("emptyTitle")} description={t("emptyDescription")} />
        )}

        {plans.map((p) => {
          const isOverdue = p.nextDueDate < today;
          const isPay = p.direction === PLANNED_PAYMENT_DIRECTION.PAY;
          return (
            <Card key={p.id} className={isOverdue ? "border-destructive/40" : ""}>
              <CardContent className="py-4 space-y-3">
                <div className="flex justify-between items-start gap-3">
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <p className="truncate font-medium">{p.counterparty || (isPay ? t("iPay") : t("iReceive"))}</p>
                      <SharedChip groupId={p.groupId} />
                    </div>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      {isOverdue ? (
                        <Badge variant="destructive" className="text-xs">{t("overdue")}</Badge>
                      ) : (
                        <Badge variant="outline" className="text-xs">{isPay ? t("iPay") : t("iReceive")}</Badge>
                      )}
                      <p className="text-xs text-muted-foreground">{t("dueOn", { date: formatDate(p.nextDueDate) })}</p>
                      {isPay && <span className="text-xs text-muted-foreground">{categoryName(p.categoryId)}</span>}
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
                  <Button size="sm" variant="outline" onClick={() => startEdit(p)}>
                    {t("edit")}
                  </Button>
                  <Button size="sm" variant="outline" loading={cancellingId === p.id} onClick={() => remove(p)}>
                    {t("cancelPlan")}
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
