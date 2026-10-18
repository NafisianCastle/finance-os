"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { parseISO } from "date-fns";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AmountInput } from "@/components/ui/amount-input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { SharedChip, SharedToggle } from "@/components/shared-toggle";
import { useAppStore } from "@/store/app-store";
import { getDb } from "@/infrastructure/db/dexie/database";
import { scoped } from "@/infrastructure/db/dexie/helpers";
import { useCurrencyFormatter } from "@/hooks/use-currency-formatter";
import type { Debt, Account } from "@/infrastructure/db/dexie/schema";
import { DEBT_STATUS } from "@/lib/constants";
import { addDebt, deleteDebt, listDebts, repayDebt, updateDebt } from "@/application/debts";
import { useToast } from "@/components/ui/toast";
import { AlertTriangle, HandCoins } from "lucide-react";

function debtPressureLevel(
  debtToIncomePct: number,
  t: (key: string) => string
): {
  label: string;
  color: string;
  bg: string;
} {
  if (debtToIncomePct < 20) return { label: t("healthy"), color: "text-primary", bg: "bg-primary/10" };
  if (debtToIncomePct < 40) return { label: t("moderate"), color: "text-yellow-600", bg: "bg-yellow-500/10" };
  return { label: t("highPressure"), color: "text-destructive", bg: "bg-destructive/10" };
}

export default function DebtPage() {
  const t = useTranslations("Debt");
  const locale = useLocale();
  const { format, toMinor, toMajor, currencyCode } = useCurrencyFormatter();
  const userId = useAppStore((s) => s.userId);
  const groupId = useAppStore((s) => s.groupId);
  const { toast } = useToast();
  const confirm = useConfirm();
  const [debts, setDebts] = useState<Debt[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [monthlyIncome, setMonthlyIncome] = useState(0);
  const [lender, setLender] = useState("");
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [interestRate, setInterestRate] = useState("");
  const [shared, setShared] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [repayingId, setRepayingId] = useState<string | null>(null);
  const [repayAmount, setRepayAmount] = useState("");
  const [repayAccountId, setRepayAccountId] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [isRepaying, setIsRepaying] = useState(false);

  const formatDate = (d: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(parseISO(d));

  async function load() {
    if (!userId) return;
    const db = getDb();
    setDebts(await listDebts(userId, groupId));
    const profile = await db.userProfiles.where("userId").equals(userId).first();
    setMonthlyIncome(profile?.monthlyIncomePoisha ?? 0);
    const accs = await scoped(db.accounts, userId, groupId).toArray();
    setAccounts(accs);
    setRepayAccountId((prev) => (accs.some((a) => a.id === prev) ? prev : accs[0]?.id || ""));
  }

  useEffect(() => {
    const timer = setTimeout(load, 0);
    return () => clearTimeout(timer);
  }, [userId, groupId]);

  function startRepay(debt: Debt) {
    setRepayingId(debt.id);
    setRepayAmount(toMajor(debt.remainingPoisha).toString());
  }

  async function submitRepay(debt: Debt) {
    if (!userId) return;
    if (!repayAccountId) {
      toast(t("selectAccountError"), "error");
      return;
    }
    const poisha = toMinor(parseFloat(repayAmount) || 0);
    if (poisha <= 0) {
      toast(t("enterAmountError"), "error");
      return;
    }
    setIsRepaying(true);
    try {
      await repayDebt(userId, debt, poisha, repayAccountId, groupId);
      setRepayingId(null);
      setRepayAmount("");
      toast(t("repaymentRecorded"), "success");
      await load();
    } catch {
      toast(t("actionFailed"), "error");
    } finally {
      setIsRepaying(false);
    }
  }

  function resetForm() {
    setEditingId(null);
    setLender("");
    setAmount("");
    setDueDate("");
    setInterestRate("");
  }

  function startEdit(d: Debt) {
    setEditingId(d.id);
    setLender(d.lender);
    setAmount(String(toMajor(d.principalPoisha)));
    setInterestRate(d.interestRate != null ? String(d.interestRate) : "");
    setDueDate(d.dueDate ?? "");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function saveDebt() {
    if (!userId) return;
    if (!lender.trim()) {
      toast(t("enterLenderError"), "error");
      return;
    }
    const poisha = toMinor(parseFloat(amount) || 0);
    if (poisha <= 0) {
      toast(t("enterAmountError"), "error");
      return;
    }
    setIsAdding(true);
    try {
      const data = {
        lender: lender.trim(),
        principalPoisha: poisha,
        interestRate: interestRate ? parseFloat(interestRate) : undefined,
        dueDate: dueDate || undefined,
      };
      if (editingId) {
        await updateDebt(userId, editingId, data, groupId);
        toast(t("debtUpdated"), "success");
      } else {
        await addDebt(userId, data, shared ? groupId : null);
        toast(t("debtAdded"), "success");
      }
      resetForm();
      await load();
    } catch {
      toast(t("actionFailed"), "error");
    } finally {
      setIsAdding(false);
    }
  }

  async function removeDebt(d: Debt) {
    if (!userId) return;
    const ok = await confirm({
      title: t("deleteDebtTitle", { name: d.lender }),
      description: t("deleteDebtDescription"),
      confirmLabel: t("delete"),
      variant: "destructive",
    });
    if (!ok) return;
    setDeletingId(d.id);
    try {
      await deleteDebt(userId, d.id, groupId);
      if (editingId === d.id) resetForm();
      if (repayingId === d.id) setRepayingId(null);
      await load();
      toast(t("debtDeleted", { name: d.lender }), "success");
    } catch {
      toast(t("actionFailed"), "error");
    } finally {
      setDeletingId(null);
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  const activeDebts = debts.filter((d) => d.status === DEBT_STATUS.ACTIVE);
  const totalRemaining = activeDebts.reduce((s, d) => s + d.remainingPoisha, 0);
  const overdueDebts = activeDebts.filter((d) => d.dueDate && d.dueDate < today);

  const annualIncome = monthlyIncome * 12;
  const debtToIncomePct = annualIncome > 0 ? (totalRemaining / annualIncome) * 100 : 0;
  const pressure = debtPressureLevel(debtToIncomePct, t);

  const estimatedMonthlyBurden = activeDebts.reduce((s, d) => {
    if (!d.dueDate) return s;
    const monthsLeft = Math.max(
      1,
      Math.round(
        (new Date(d.dueDate).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24 * 30)
      )
    );
    return s + d.remainingPoisha / monthsLeft;
  }, 0);

  return (
    <AppShell title={t("title")}>
      <div className="space-y-4">
        {/* Pressure analysis summary */}
        {activeDebts.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{t("debtPressure")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className={`rounded-lg px-3 py-2 ${pressure.bg}`}>
                <p className={`text-sm font-semibold ${pressure.color}`}>{pressure.label}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {t("debtPercentOfIncome", { percent: debtToIncomePct.toFixed(1) })}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-md bg-muted p-2">
                  <p className="text-muted-foreground">{t("totalOwed")}</p>
                  <p className="font-semibold text-destructive">{format(totalRemaining)}</p>
                </div>
                <div className="rounded-md bg-muted p-2">
                  <p className="text-muted-foreground">{t("estMonthlyBurden")}</p>
                  <p className="font-semibold">{format(estimatedMonthlyBurden)}</p>
                </div>
              </div>
              {overdueDebts.length > 0 && (
                <div className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-2 text-xs">
                  <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0" />
                  <span className="text-destructive font-medium">
                    {t("debtsOverdue", { count: overdueDebts.length })}
                  </span>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Add / edit debt form */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{editingId ? t("editDebt") : t("addDebt")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="debt-lender">{t("lender")}</Label>
              <Input id="debt-lender" value={lender} onChange={(e) => setLender(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-2">
                <Label htmlFor="debt-amount">{t("amountLabel", { currency: currencyCode })}</Label>
                <AmountInput id="debt-amount" value={amount} onChange={setAmount} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="debt-rate">{t("interestRate")}</Label>
                <AmountInput
                  id="debt-rate"
                  max={100}
                  value={interestRate}
                  onChange={setInterestRate}
                  placeholder={t("optional")}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="debt-due">{t("dueDateOptional")}</Label>
              <Input id="debt-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
            {!editingId && <SharedToggle checked={shared} onChange={setShared} />}
            <div className="flex gap-2">
              <Button onClick={saveDebt} className="flex-1" loading={isAdding}>
                {editingId ? t("save") : t("addDebt")}
              </Button>
              {editingId && (
                <Button variant="ghost" onClick={resetForm}>
                  {t("cancel")}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Debt list */}
        {debts.length === 0 && (
          <EmptyState icon={HandCoins} title={t("emptyTitle")} description={t("emptyDescription")} />
        )}
        {debts.map((d) => {
          const isOverdue = d.dueDate && d.dueDate < today && d.status === DEBT_STATUS.ACTIVE;
          return (
            <Card key={d.id} className={isOverdue ? "border-destructive/40" : ""}>
              <CardContent className="py-4 space-y-3">
                <div className="flex justify-between items-start gap-3">
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <p className="truncate font-medium">{d.lender}</p>
                      <SharedChip groupId={d.groupId} />
                    </div>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      {isOverdue ? (
                        <Badge variant="destructive" className="text-xs">{t("overdue")}</Badge>
                      ) : d.status === DEBT_STATUS.PAID ? (
                        <Badge variant="secondary" className="text-xs">{t("paid")}</Badge>
                      ) : (
                        <Badge variant="outline" className="text-xs">{t("active")}</Badge>
                      )}
                      {d.dueDate && (
                        <p className="text-xs text-muted-foreground">{t("dueOn", { date: formatDate(d.dueDate) })}</p>
                      )}
                      {d.interestRate != null && (
                        <p className="text-xs text-muted-foreground">{t("interestRatePerAnnum", { rate: d.interestRate })}</p>
                      )}
                    </div>
                  </div>
                  <p className="shrink-0 font-semibold text-destructive">{format(d.remainingPoisha)}</p>
                </div>
                {d.status !== DEBT_STATUS.PAID && repayingId === d.id ? (
                  <div className="space-y-2 border-t pt-3">
                    <div className="space-y-2">
                      <Label htmlFor={`repay-amt-${d.id}`}>{t("amountPaidLabel", { currency: currencyCode })}</Label>
                      <AmountInput id={`repay-amt-${d.id}`} value={repayAmount} onChange={setRepayAmount} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={`repay-acc-${d.id}`}>{t("payFrom")}</Label>
                      <select
                        id={`repay-acc-${d.id}`}
                        className="flex h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
                        value={repayAccountId}
                        onChange={(e) => setRepayAccountId(e.target.value)}
                      >
                        {accounts.map((a) => (
                          <option key={a.id} value={a.id}>{a.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="flex gap-2">
                      <Button onClick={() => submitRepay(d)} className="flex-1" loading={isRepaying}>{t("confirm")}</Button>
                      <Button variant="outline" onClick={() => setRepayingId(null)} className="flex-1">
                        {t("cancel")}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {d.status !== DEBT_STATUS.PAID && (
                      <Button variant="outline" size="sm" onClick={() => startRepay(d)}>
                        {t("recordRepayment")}
                      </Button>
                    )}
                    <Button variant="outline" size="sm" onClick={() => startEdit(d)}>
                      {t("edit")}
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => removeDebt(d)}
                      loading={deletingId === d.id}
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
    </AppShell>
  );
}
