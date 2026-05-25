"use client";

import { useEffect, useState } from "react";
import { v4 as uuid } from "uuid";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { useAppStore } from "@/store/app-store";
import { getDb } from "@/infrastructure/db/dexie/database";
import { formatMoney, bdtToPoisha } from "@/lib/money";
import type { Debt } from "@/infrastructure/db/dexie/schema";
import { DEBT_STATUS } from "@/lib/constants";
import { enqueueSync } from "@/infrastructure/sync/sync-queue";

export default function DebtPage() {
  const userId = useAppStore((s) => s.userId);
  const [debts, setDebts] = useState<Debt[]>([]);
  const [lender, setLender] = useState("");
  const [amount, setAmount] = useState("");

  async function load() {
    if (!userId) return;
    setDebts(
      await getDb().debts.where("userId").equals(userId).filter((d) => !d.deletedAt).toArray()
    );
  }

  useEffect(() => {
    load();
  }, [userId]);

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
      borrowDate: now.slice(0, 10),
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
      borrow_date: d.borrowDate,
      status_smallint: 1,
    });
    setLender("");
    setAmount("");
    load();
  }

  return (
    <AppShell title="Debt">
      <div className="space-y-4">
        <Card>
          <CardContent className="pt-4 space-y-3">
            <div className="space-y-2">
              <Label>Lender</Label>
              <Input value={lender} onChange={(e) => setLender(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Amount (BDT)</Label>
              <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <Button onClick={addDebt} className="w-full">Add debt</Button>
          </CardContent>
        </Card>
        {debts.map((d) => (
          <Card key={d.id}>
            <CardContent className="flex justify-between py-4">
              <div>
                <p className="font-medium">{d.lender}</p>
                <p className="text-xs text-muted-foreground">Due {d.dueDate ?? "—"}</p>
              </div>
              <p className="font-semibold text-destructive">{formatMoney(d.remainingPoisha)}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </AppShell>
  );
}
