"use client";

import { useEffect, useState } from "react";
import { v4 as uuid } from "uuid";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useAppStore } from "@/store/app-store";
import { getDb } from "@/infrastructure/db/dexie/database";
import { formatMoney, bdtToPoisha } from "@/lib/money";
import type { Debt } from "@/infrastructure/db/dexie/schema";
import { DEBT_STATUS } from "@/lib/constants";
import { enqueueSync } from "@/infrastructure/sync/sync-queue";
import { AlertTriangle } from "lucide-react";

function debtPressureLevel(debtToIncomePct: number): {
  label: string;
  color: string;
  bg: string;
} {
  if (debtToIncomePct < 20) return { label: "Healthy", color: "text-primary", bg: "bg-primary/10" };
  if (debtToIncomePct < 40) return { label: "Moderate", color: "text-yellow-600", bg: "bg-yellow-500/10" };
  return { label: "High pressure", color: "text-destructive", bg: "bg-destructive/10" };
}

export default function DebtPage() {
  const userId = useAppStore((s) => s.userId);
  const [debts, setDebts] = useState<Debt[]>([]);
  const [monthlyIncome, setMonthlyIncome] = useState(0);
  const [lender, setLender] = useState("");
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [interestRate, setInterestRate] = useState("");

  async function load() {
    if (!userId) return;
    const db = getDb();
    const all = await db.debts.where("userId").equals(userId).filter((d) => !d.deletedAt).toArray();
    setDebts(all);
    const profile = await db.userProfiles.where("userId").equals(userId).first();
    setMonthlyIncome(profile?.monthlyIncomePoisha ?? 0);
  }

  useEffect(() => { load(); }, [userId]);

  async function addDebt() {
    if (!userId) return;
    const poisha = bdtToPoisha(parseFloat(amount) || 0);
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
    await getDb().debts.add(d);
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
  }

  const today = new Date().toISOString().slice(0, 10);
  const activeDebts = debts.filter((d) => d.status === DEBT_STATUS.ACTIVE);
  const totalRemaining = activeDebts.reduce((s, d) => s + d.remainingPoisha, 0);
  const overdueDebts = activeDebts.filter((d) => d.dueDate && d.dueDate < today);

  const annualIncome = monthlyIncome * 12;
  const debtToIncomePct = annualIncome > 0 ? (totalRemaining / annualIncome) * 100 : 0;
  const pressure = debtPressureLevel(debtToIncomePct);

  const estimatedMonthlyBurden = activeDebts.reduce((s, d) => {
    if (!d.dueDate) return s;
    const monthsLeft = Math.max(
      1,
      Math.round(
        (new Date(d.dueDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24 * 30)
      )
    );
    return s + d.remainingPoisha / monthsLeft;
  }, 0);

  return (
    <AppShell title="Debt">
      <div className="space-y-4">
        {/* Pressure analysis summary */}
        {activeDebts.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Debt pressure</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className={`rounded-lg px-3 py-2 ${pressure.bg}`}>
                <p className={`text-sm font-semibold ${pressure.color}`}>{pressure.label}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Debt is {debtToIncomePct.toFixed(1)}% of annual income
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-md bg-muted p-2">
                  <p className="text-muted-foreground">Total owed</p>
                  <p className="font-semibold text-destructive">{formatMoney(totalRemaining)}</p>
                </div>
                <div className="rounded-md bg-muted p-2">
                  <p className="text-muted-foreground">Est. monthly burden</p>
                  <p className="font-semibold">{formatMoney(estimatedMonthlyBurden)}</p>
                </div>
              </div>
              {overdueDebts.length > 0 && (
                <div className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-2 text-xs">
                  <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0" />
                  <span className="text-destructive font-medium">
                    {overdueDebts.length} debt{overdueDebts.length > 1 ? "s" : ""} overdue
                  </span>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Add debt form */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Add debt</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <Label>Lender</Label>
              <Input value={lender} onChange={(e) => setLender(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-2">
                <Label>Amount (BDT)</Label>
                <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Interest rate %</Label>
                <Input
                  type="number"
                  value={interestRate}
                  onChange={(e) => setInterestRate(e.target.value)}
                  placeholder="Optional"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Due date (optional)</Label>
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
            <Button onClick={addDebt} className="w-full">Add debt</Button>
          </CardContent>
        </Card>

        {/* Debt list */}
        {debts.map((d) => {
          const isOverdue = d.dueDate && d.dueDate < today && d.status === DEBT_STATUS.ACTIVE;
          return (
            <Card key={d.id} className={isOverdue ? "border-destructive/40" : ""}>
              <CardContent className="flex justify-between items-start py-4">
                <div>
                  <p className="font-medium">{d.lender}</p>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    {isOverdue ? (
                      <Badge variant="destructive" className="text-xs">Overdue</Badge>
                    ) : d.status === DEBT_STATUS.PAID ? (
                      <Badge variant="secondary" className="text-xs">Paid</Badge>
                    ) : (
                      <Badge variant="outline" className="text-xs">Active</Badge>
                    )}
                    {d.dueDate && (
                      <p className="text-xs text-muted-foreground">Due {d.dueDate}</p>
                    )}
                    {d.interestRate != null && (
                      <p className="text-xs text-muted-foreground">{d.interestRate}% p.a.</p>
                    )}
                  </div>
                </div>
                <p className="font-semibold text-destructive">{formatMoney(d.remainingPoisha)}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </AppShell>
  );
}
