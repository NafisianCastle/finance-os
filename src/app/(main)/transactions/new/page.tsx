"use client";

import { addTransaction } from "@/application/transactions";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getDb } from "@/infrastructure/db/dexie/database";
import type { Account } from "@/infrastructure/db/dexie/schema";
import { TX_TYPES } from "@/lib/constants";
import { bdtToPoisha } from "@/lib/money";
import { useAppStore } from "@/store/app-store";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export default function NewTransactionPage() {
  const router = useRouter();
  const userId = useAppStore((s) => s.userId);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [type, setType] = useState<number>(TX_TYPES.EXPENSE);
  const [amount, setAmount] = useState("");
  const [categoryId, setCategoryId] = useState("food");
  const [accountId, setAccountId] = useState("");
  const [toAccountId, setToAccountId] = useState("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!userId) return;
    getDb()
      .accounts.where("userId")
      .equals(userId)
      .toArray()
      .then((a) => {
        setAccounts(a);
        if (a[0]) setAccountId(a[0].id);
      });
  }, [userId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!userId || !accountId) return;
    setLoading(true);
    await addTransaction(userId, {
      type,
      amountPoisha: bdtToPoisha(parseFloat(amount) || 0),
      accountId,
      categoryId: type === TX_TYPES.INCOME ? "income" : categoryId,
      date: new Date().toISOString().slice(0, 10),
      note: note || undefined,
    });
    setLoading(false);
    router.push("/transactions");
  }

  return (
    <AppShell title="Add transaction">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="flex gap-2">
          {[
            { v: TX_TYPES.EXPENSE, l: "Expense" },
            { v: TX_TYPES.INCOME, l: "Income" },
            { v: TX_TYPES.TRANSFER, l: "Transfer" },
          ].map(({ v, l }) => (
            <Button
              key={v}
              type="button"
              variant={type === v ? "default" : "outline"}
              className="flex-1"
              onClick={() => setType(v)}
            >
              {l}
            </Button>
          ))}
        </div>
        <div className="space-y-2">
          <Label>Amount (BDT)</Label>
          <Input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
          />
        </div>
        <div className="space-y-2">
          <Label>Account</Label>
          <select
            className="flex h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
        {type !== TX_TYPES.INCOME && (
          <div className="space-y-2">
            <Label>Category</Label>
            <select
              className="flex h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
            >
              {[
                "food",
                "transport",
                "shopping",
                "gadgets",
                "entertainment",
                "bills",
                "family",
                "education",
                "health",
                "other",
              ].map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="space-y-2">
          <Label>Note</Label>
          <Input value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <Button type="submit" className="w-full" disabled={loading}>
          Save
        </Button>
      </form>
    </AppShell>
  );
}
