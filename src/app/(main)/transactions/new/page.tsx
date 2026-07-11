"use client";

import { addTransaction } from "@/application/transactions";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getDb } from "@/infrastructure/db/dexie/database";
import type { Account } from "@/infrastructure/db/dexie/schema";
import { TX_TYPES, SYSTEM_CATEGORIES } from "@/lib/constants";
import { useCurrencyFormatter } from "@/hooks/use-currency-formatter";
import { useAppStore } from "@/store/app-store";
import { useRouter } from "next/navigation";
import { useEffect, useState, useRef } from "react";
import { useTranslations } from "next-intl";

export default function NewTransactionPage() {
  const t = useTranslations("NewTransaction");
  const { toMinor, currencyCode } = useCurrencyFormatter();
  const router = useRouter();
  const userId = useAppStore((s) => s.userId);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [type, setType] = useState<number>(TX_TYPES.EXPENSE);
  const [amount, setAmount] = useState("");
  const [categoryId, setCategoryId] = useState("food");
  const [accountId, setAccountId] = useState("");
  const [note, setNote] = useState("");
  const [merchant, setMerchant] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = useState(false);

  // Merchant auto-detection
  const [merchantSuggestions, setMerchantSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const merchantRef = useRef<HTMLDivElement>(null);

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

  // Load merchant suggestions when category changes
  useEffect(() => {
    if (!userId || type === TX_TYPES.INCOME) return;
    getDb()
      .transactions.where("userId")
      .equals(userId)
      .filter((t) => !t.deletedAt && t.type === TX_TYPES.EXPENSE && t.categoryId === categoryId && !!t.merchant)
      .toArray()
      .then((txs) => {
        const counts: Record<string, number> = {};
        for (const tx of txs) {
          if (tx.merchant) counts[tx.merchant] = (counts[tx.merchant] ?? 0) + 1;
        }
        const sorted = Object.entries(counts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([name]) => name);
        setMerchantSuggestions(sorted);
      });
  }, [userId, categoryId, type]);

  // Close suggestions on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (merchantRef.current && !merchantRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const filteredSuggestions = merchant
    ? merchantSuggestions.filter((s) => s.toLowerCase().includes(merchant.toLowerCase()))
    : merchantSuggestions;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!userId || !accountId) return;
    setLoading(true);
    await addTransaction(userId, {
      type,
      amountPoisha: toMinor(parseFloat(amount) || 0),
      accountId,
      categoryId: type === TX_TYPES.INCOME ? "income" : categoryId,
      date,
      note: note || undefined,
      merchant: merchant || undefined,
    });
    setLoading(false);
    router.push("/transactions");
  }

  const typeOptions = [
    { v: TX_TYPES.EXPENSE, l: t("expense") },
    { v: TX_TYPES.INCOME, l: t("income") },
    { v: TX_TYPES.TRANSFER, l: t("transfer") },
  ];

  return (
    <AppShell title={t("title")}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="flex gap-2">
          {typeOptions.map(({ v, l }) => (
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
          <Label>{t("amountLabel", { currency: currencyCode })}</Label>
          <Input
            type="number"
            inputMode="decimal"
            autoFocus
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
          />
        </div>

        <div className="space-y-2">
          <Label>{t("dateLabel")}</Label>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
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

        {type !== TX_TYPES.INCOME && (
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

        {type === TX_TYPES.EXPENSE && (
          <div className="space-y-2" ref={merchantRef}>
            <Label>{t("merchantLabel")}</Label>
            <Input
              value={merchant}
              onChange={(e) => { setMerchant(e.target.value); setShowSuggestions(true); }}
              onFocus={() => setShowSuggestions(true)}
              placeholder={t("merchantPlaceholder")}
              autoComplete="off"
            />
            {showSuggestions && filteredSuggestions.length > 0 && (
              <div className="rounded-lg border border-border bg-background shadow-md overflow-hidden">
                {filteredSuggestions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className="w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors"
                    onClick={() => { setMerchant(s); setShowSuggestions(false); }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="space-y-2">
          <Label>{t("noteLabel")}</Label>
          <Input value={note} onChange={(e) => setNote(e.target.value)} />
        </div>

        <Button type="submit" className="w-full" disabled={loading}>
          {t("save")}
        </Button>
      </form>
    </AppShell>
  );
}
