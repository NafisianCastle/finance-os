"use client";

import { useEffect, useState } from "react";
import { v4 as uuid } from "uuid";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useAppStore } from "@/store/app-store";
import { getDb } from "@/infrastructure/db/dexie/database";
import { formatMoney, bdtToPoisha } from "@/lib/money";
import type { LoanGiven, Account } from "@/infrastructure/db/dexie/schema";
import { LOAN_STATUS } from "@/lib/constants";
import { enqueueSync } from "@/infrastructure/sync/sync-queue";
import { recoverLoanGiven } from "@/application/loans-given";
import { useToast } from "@/components/ui/toast";

export default function LoansGivenPage() {
  const userId = useAppStore((s) => s.userId);
  const { toast } = useToast();
  const [loans, setLoans] = useState<LoanGiven[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [borrower, setBorrower] = useState("");
  const [amount, setAmount] = useState("");
  const [repayingId, setRepayingId] = useState<string | null>(null);
  const [repayAmount, setRepayAmount] = useState("");
  const [repayAccountId, setRepayAccountId] = useState("");

  async function load() {
    if (!userId) return;
    const db = getDb();
    setLoans(
      await db.loansGiven.where("userId").equals(userId).filter((l) => !l.deletedAt).toArray()
    );
    const accs = await db.accounts.where("userId").equals(userId).filter((a) => !a.deletedAt).toArray();
    setAccounts(accs);
    setRepayAccountId((prev) => prev || accs[0]?.id || "");
  }

  useEffect(() => {
    load();
  }, [userId]);

  function startRepay(loan: LoanGiven) {
    setRepayingId(loan.id);
    setRepayAmount((loan.remainingPoisha / 100).toString());
  }

  async function submitRepay(loan: LoanGiven) {
    if (!userId || !repayAccountId) return;
    const poisha = bdtToPoisha(parseFloat(repayAmount) || 0);
    if (poisha <= 0) return;
    await recoverLoanGiven(userId, loan, poisha, repayAccountId);
    setRepayingId(null);
    setRepayAmount("");
    toast("Repayment recorded.", "success");
    load();
  }

  async function addLoan() {
    if (!userId) return;
    const poisha = bdtToPoisha(parseFloat(amount) || 0);
    const now = new Date().toISOString();
    const l: LoanGiven = {
      id: uuid(),
      userId,
      borrower,
      amountPoisha: poisha,
      remainingPoisha: poisha,
      borrowDate: now.slice(0, 10),
      status: LOAN_STATUS.ACTIVE,
      createdAt: now,
      updatedAt: now,
    };
    await getDb().loansGiven.put(l as never);
    await enqueueSync("loans_given", l.id, "upsert", {
      id: l.id,
      borrower: l.borrower,
      amount_poisha: poisha,
      remaining_poisha: poisha,
      borrow_date: l.borrowDate,
      status_smallint: 1,
    });
    setBorrower("");
    setAmount("");
    load();
  }

  const statusLabel: Record<number, string> = { 1: "Active", 2: "Overdue", 3: "Recovered" };

  return (
    <AppShell title="Loans given">
      <div className="space-y-4">
        <Card>
          <CardContent className="pt-4 space-y-3">
            <div className="space-y-2">
              <Label>Borrower</Label>
              <Input value={borrower} onChange={(e) => setBorrower(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Amount (BDT)</Label>
              <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <Button onClick={addLoan} className="w-full">Add loan</Button>
          </CardContent>
        </Card>
        {loans.map((l) => (
          <Card key={l.id}>
            <CardContent className="py-4 space-y-3">
              <div className="flex justify-between items-center">
                <div>
                  <p className="font-medium">{l.borrower}</p>
                  <Badge variant="outline" className="mt-1">{statusLabel[l.status]}</Badge>
                </div>
                <p className="font-semibold text-primary">{formatMoney(l.remainingPoisha)}</p>
              </div>
              {l.status !== LOAN_STATUS.RECOVERED && (
                repayingId === l.id ? (
                  <div className="space-y-2 border-t pt-3">
                    <div className="space-y-2">
                      <Label>Amount received (BDT)</Label>
                      <Input
                        type="number"
                        value={repayAmount}
                        onChange={(e) => setRepayAmount(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Deposit into</Label>
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
                      <Button onClick={() => submitRepay(l)} className="flex-1">Confirm</Button>
                      <Button variant="outline" onClick={() => setRepayingId(null)} className="flex-1">
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button variant="outline" size="sm" onClick={() => startRepay(l)}>
                    Record repayment
                  </Button>
                )
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </AppShell>
  );
}
