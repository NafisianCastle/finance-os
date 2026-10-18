"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { parseISO } from "date-fns";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AmountInput } from "@/components/ui/amount-input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { SharedChip, SharedToggle } from "@/components/shared-toggle";
import { useAppStore } from "@/store/app-store";
import { getDb } from "@/infrastructure/db/dexie/database";
import { scoped } from "@/infrastructure/db/dexie/helpers";
import { useCurrencyFormatter } from "@/hooks/use-currency-formatter";
import type { LoanGiven, Account } from "@/infrastructure/db/dexie/schema";
import { LOAN_STATUS } from "@/lib/constants";
import {
  addLoanGiven,
  deleteLoanGiven,
  isLoanOverdue,
  listLoansGiven,
  recoverLoanGiven,
  updateLoanGiven,
} from "@/application/loans-given";
import { useToast } from "@/components/ui/toast";
import { HandCoins } from "lucide-react";

export default function LoansGivenPage() {
  const userId = useAppStore((s) => s.userId);
  const groupId = useAppStore((s) => s.groupId);
  const { toast } = useToast();
  const confirm = useConfirm();
  const t = useTranslations("LoansGiven");
  const locale = useLocale();
  const { format, toMinor, toMajor, currencyCode } = useCurrencyFormatter();
  const [loans, setLoans] = useState<LoanGiven[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [borrower, setBorrower] = useState("");
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState("");
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
    setLoans(await listLoansGiven(userId, groupId));
    const accs = await scoped(getDb().accounts, userId, groupId).toArray();
    setAccounts(accs);
    setRepayAccountId((prev) => (accs.some((a) => a.id === prev) ? prev : accs[0]?.id || ""));
  }

  useEffect(() => {
    const timer = setTimeout(load, 0);
    return () => clearTimeout(timer);
  }, [userId, groupId]);

  function startRepay(loan: LoanGiven) {
    setRepayingId(loan.id);
    setRepayAmount(toMajor(loan.remainingPoisha).toString());
  }

  async function submitRepay(loan: LoanGiven) {
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
      await recoverLoanGiven(userId, loan, poisha, repayAccountId, groupId);
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
    setBorrower("");
    setAmount("");
    setDueDate("");
  }

  function startEdit(l: LoanGiven) {
    setEditingId(l.id);
    setBorrower(l.borrower);
    setAmount(String(toMajor(l.amountPoisha)));
    setDueDate(l.dueDate ?? "");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function saveLoan() {
    if (!userId) return;
    if (!borrower.trim()) {
      toast(t("enterBorrowerError"), "error");
      return;
    }
    const poisha = toMinor(parseFloat(amount) || 0);
    if (poisha <= 0) {
      toast(t("enterAmountError"), "error");
      return;
    }
    setIsAdding(true);
    try {
      const data = { borrower: borrower.trim(), amountPoisha: poisha, dueDate: dueDate || undefined };
      if (editingId) {
        await updateLoanGiven(userId, editingId, data, groupId);
        toast(t("loanUpdated"), "success");
      } else {
        await addLoanGiven(userId, data, shared ? groupId : null);
        toast(t("loanAdded"), "success");
      }
      resetForm();
      await load();
    } catch {
      toast(t("actionFailed"), "error");
    } finally {
      setIsAdding(false);
    }
  }

  async function removeLoan(l: LoanGiven) {
    if (!userId) return;
    const ok = await confirm({
      title: t("deleteLoanTitle", { name: l.borrower }),
      description: t("deleteLoanDescription"),
      confirmLabel: t("delete"),
      variant: "destructive",
    });
    if (!ok) return;
    setDeletingId(l.id);
    try {
      await deleteLoanGiven(userId, l.id, groupId);
      if (editingId === l.id) resetForm();
      if (repayingId === l.id) setRepayingId(null);
      await load();
      toast(t("loanDeleted", { name: l.borrower }), "success");
    } catch {
      toast(t("actionFailed"), "error");
    } finally {
      setDeletingId(null);
    }
  }

  const statusLabel: Record<number, string> = {
    1: t("statusActive"),
    2: t("statusOverdue"),
    3: t("statusRecovered"),
  };
  const today = new Date().toISOString().slice(0, 10);

  return (
    <AppShell title={t("title")}>
      <div className="space-y-4">
        <Card>
          <CardContent className="pt-4 space-y-3">
            {editingId && <p className="text-sm font-medium">{t("editLoan")}</p>}
            <div className="space-y-2">
              <Label htmlFor="loan-borrower">{t("borrower")}</Label>
              <Input id="loan-borrower" value={borrower} onChange={(e) => setBorrower(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="loan-amount">{t("amountLabel", { currency: currencyCode })}</Label>
              <AmountInput id="loan-amount" value={amount} onChange={setAmount} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="loan-due">{t("dueDateOptional")}</Label>
              <Input id="loan-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
            {!editingId && <SharedToggle checked={shared} onChange={setShared} />}
            <div className="flex gap-2">
              <Button onClick={saveLoan} className="flex-1" loading={isAdding}>
                {editingId ? t("save") : t("addLoan")}
              </Button>
              {editingId && (
                <Button variant="ghost" onClick={resetForm}>
                  {t("cancel")}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
        {loans.length === 0 && (
          <EmptyState icon={HandCoins} title={t("emptyTitle")} description={t("emptyDescription")} />
        )}
        {loans.map((l) => {
          const overdue = isLoanOverdue(l, today);
          return (
            <Card key={l.id} className={overdue ? "border-destructive/40" : ""}>
              <CardContent className="py-4 space-y-3">
                <div className="flex justify-between items-center gap-3">
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <p className="truncate font-medium">{l.borrower}</p>
                      <SharedChip groupId={l.groupId} />
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      {overdue ? (
                        <Badge variant="destructive">{t("statusOverdue")}</Badge>
                      ) : (
                        <Badge variant="outline">{statusLabel[l.status]}</Badge>
                      )}
                      {l.dueDate && (
                        <p className="text-xs text-muted-foreground">{t("dueOn", { date: formatDate(l.dueDate) })}</p>
                      )}
                    </div>
                  </div>
                  <p className="shrink-0 font-semibold text-primary">{format(l.remainingPoisha)}</p>
                </div>
                {l.status !== LOAN_STATUS.RECOVERED && repayingId === l.id ? (
                  <div className="space-y-2 border-t pt-3">
                    <div className="space-y-2">
                      <Label htmlFor={`recover-amt-${l.id}`}>{t("amountReceivedLabel", { currency: currencyCode })}</Label>
                      <AmountInput id={`recover-amt-${l.id}`} value={repayAmount} onChange={setRepayAmount} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={`recover-acc-${l.id}`}>{t("depositInto")}</Label>
                      <select
                        id={`recover-acc-${l.id}`}
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
                      <Button onClick={() => submitRepay(l)} className="flex-1" loading={isRepaying}>{t("confirm")}</Button>
                      <Button variant="outline" onClick={() => setRepayingId(null)} className="flex-1">
                        {t("cancel")}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {l.status !== LOAN_STATUS.RECOVERED && (
                      <Button variant="outline" size="sm" onClick={() => startRepay(l)}>
                        {t("recordRepayment")}
                      </Button>
                    )}
                    <Button variant="outline" size="sm" onClick={() => startEdit(l)}>
                      {t("edit")}
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => removeLoan(l)}
                      loading={deletingId === l.id}
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
