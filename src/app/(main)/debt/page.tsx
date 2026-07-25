"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { v4 as uuid } from "uuid";
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
import type { Debt, Account } from "@/infrastructure/db/dexie/schema";
import { DEBT_STATUS } from "@/lib/constants";
import { enqueueSync } from "@/infrastructure/sync/sync-queue";
import { repayDebt } from "@/application/debts";
import { useToast } from "@/components/ui/toast";
import { AlertTriangle } from "lucide-react";

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
  const { format, toMinor, currencyCode } = useCurrencyFormatter();
  const userId = useAppStore((s) => s.userId);
  const { toast } = useToast();
  const [debts, setDebts] = useState<Debt[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [monthlyIncome, setMonthlyIncome] = useState(0);
  const [lender, setLender] = useState("");
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [interestRate, setInterestRate] = useState("");
  const [repayingId, setRepayingId] = useState<string | null>(null);
  const [repayAmount, setRepayAmount] = useState("");
  const [repayAccountId, setRepayAccountId] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [isRepaying, setIsRepaying] = useState(false);

  async function load() {
    if (!userId) return;
    const db = getDb();
    const all = await db.debts.where("userId").equals(userId).filter((d) => !d.deletedAt).toArray();
    setDebts(all);
    const profile = await db.userProfiles.where("userId").equals(userId).first();
    setMonthlyIncome(profile?.monthlyIncomePoisha ?? 0);
    const accs = await db.accounts.where("userId").equals(userId).filter((a) => !a.deletedAt).toArray();
    setAccounts(accs);
    setRepayAccountId((prev) => prev || accs[0]?.id || "");
  }

  useEffect(() => {
    const timer = setTimeout(load, 0);
    return () => clearTimeout(timer);
  }, [userId]);

  function startRepay(debt: Debt) {
    setRepayingId(debt.id);
    setRepayAmount((debt.remainingPoisha / 100).toString());
  }

  async function submitRepay(debt: Debt) {
    if (!userId || !repayAccountId) return;
    const poisha = toMinor(parseFloat(repayAmount) || 0);
    if (poisha <= 0) return;
    setIsRepaying(true);
    try {
      await repayDebt(userId, debt, poisha, repayAccountId);
      setRepayingId(null);
      setRepayAmount("");
      toast(t("repaymentRecorded"), "success");
      load();
    } finally {
      setIsRepaying(false);
    }
  }

  async function addDebt() {
    if (!userId) return;
    setIsAdding(true);
    try {
      const poisha = toMinor(parseFloat(amount) || 0);
      const now = new Date().toISOString();
      const d: Debt = {
        id: uuid(),
        userId,
        lender,
        principalPoisha: poisha,
        remainingPoisha: poisha,
        interestRate: interestRate ? parseFloat(interestRate) : undefined,
        borrowDate: now.slice(0, 10),
        dueDate: dueDate || undefined,
        status: DEBT_STATUS.ACTIVE,
        createdAt: now,
        updatedAt: now,
      };
      await getDb().debts.put(d as never);
      await enqueueSync("debts", d.id, "upsert", {
        id: d.id,
        lender: d.lender,
        principal_poisha: poisha,
        remaining_poisha: poisha,
        interest_rate: d.interestRate ?? null,
        borrow_date: d.borrowDate,
        due_date: d.dueDate ?? null,
        status_smallint: 1,
      });
      setLender(""); setAmount(""); setDueDate(""); setInterestRate("");
      load();
    } finally {
      setIsAdding(false);
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

        {/* Add debt form */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("addDebt")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <Label>{t("lender")}</Label>
              <Input value={lender} onChange={(e) => setLender(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-2">
                <Label>{t("amountLabel", { currency: currencyCode })}</Label>
                <AmountInput value={amount} onChange={setAmount} />
              </div>
              <div className="space-y-2">
                <Label>{t("interestRate")}</Label>
                <AmountInput
                  max={100}
                  value={interestRate}
                  onChange={setInterestRate}
                  placeholder={t("optional")}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>{t("dueDateOptional")}</Label>
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
            <Button onClick={addDebt} className="w-full" loading={isAdding}>{t("addDebt")}</Button>
          </CardContent>
        </Card>

        {/* Debt list */}
        {debts.map((d) => {
          const isOverdue = d.dueDate && d.dueDate < today && d.status === DEBT_STATUS.ACTIVE;
          return (
            <Card key={d.id} className={isOverdue ? "border-destructive/40" : ""}>
              <CardContent className="py-4 space-y-3">
                <div className="flex justify-between items-start gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{d.lender}</p>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      {isOverdue ? (
                        <Badge variant="destructive" className="text-xs">{t("overdue")}</Badge>
                      ) : d.status === DEBT_STATUS.PAID ? (
                        <Badge variant="secondary" className="text-xs">{t("paid")}</Badge>
                      ) : (
                        <Badge variant="outline" className="text-xs">{t("active")}</Badge>
                      )}
                      {d.dueDate && (
                        <p className="text-xs text-muted-foreground">{t("dueOn", { date: d.dueDate })}</p>
                      )}
                      {d.interestRate != null && (
                        <p className="text-xs text-muted-foreground">{t("interestRatePerAnnum", { rate: d.interestRate })}</p>
                      )}
                    </div>
                  </div>
                  <p className="shrink-0 font-semibold text-destructive">{format(d.remainingPoisha)}</p>
                </div>
                {d.status !== DEBT_STATUS.PAID && (
                  repayingId === d.id ? (
                    <div className="space-y-2 border-t pt-3">
                      <div className="space-y-2">
                        <Label>{t("amountPaidLabel", { currency: currencyCode })}</Label>
                        <AmountInput value={repayAmount} onChange={setRepayAmount} />
                      </div>
                      <div className="space-y-2">
                        <Label>{t("payFrom")}</Label>
                        <select
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
                    <Button variant="outline" size="sm" onClick={() => startRepay(d)}>
                      {t("recordRepayment")}
                    </Button>
                  )
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </AppShell>
  );
}
