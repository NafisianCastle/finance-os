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
import type { LoanGiven } from "@/infrastructure/db/dexie/schema";
import { LOAN_STATUS } from "@/lib/constants";
import { enqueueSync } from "@/infrastructure/sync/sync-queue";

export default function LoansGivenPage() {
  const userId = useAppStore((s) => s.userId);
  const [loans, setLoans] = useState<LoanGiven[]>([]);
  const [borrower, setBorrower] = useState("");
  const [amount, setAmount] = useState("");

  async function load() {
    if (!userId) return;
    setLoans(
      await getDb().loansGiven.where("userId").equals(userId).filter((l) => !l.deletedAt).toArray()
    );
  }

  useEffect(() => {
    load();
  }, [userId]);

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
    await getDb().loansGiven.add(l);
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
            <CardContent className="flex justify-between items-center py-4">
              <div>
                <p className="font-medium">{l.borrower}</p>
                <Badge variant="outline" className="mt-1">{statusLabel[l.status]}</Badge>
              </div>
              <p className="font-semibold text-primary">{formatMoney(l.remainingPoisha)}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </AppShell>
  );
}
