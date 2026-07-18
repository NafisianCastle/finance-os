"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { useAppStore } from "@/store/app-store";
import { getDb } from "@/infrastructure/db/dexie/database";
import type { Transaction } from "@/infrastructure/db/dexie/schema";
import { useCurrencyFormatter } from "@/hooks/use-currency-formatter";
import { TX_TYPES } from "@/lib/constants";
import { Plus, Receipt } from "lucide-react";

export default function TransactionsPage() {
  const t = useTranslations("Transactions");
  const { format } = useCurrencyFormatter();
  const userId = useAppStore((s) => s.userId);
  const [txs, setTxs] = useState<Transaction[] | null>(null);

  useEffect(() => {
    if (!userId) return;
    getDb()
      .transactions.where("userId")
      .equals(userId)
      .filter((t) => !t.deletedAt)
      .toArray()
      .then((list) => setTxs(list.sort((a, b) => b.date.localeCompare(a.date))));
  }, [userId]);

  return (
    <AppShell title={t("title")}>
      <div className="space-y-3">
        <Link href="/transactions/new" className="block">
          <Button className="w-full">
            <Plus className="h-4 w-4" />
            {t("addTransaction")}
          </Button>
        </Link>
        {txs === null ? (
          <div className="space-y-3">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : txs.length === 0 ? (
          <EmptyState
            icon={Receipt}
            title={t("emptyTitle")}
            description={t("emptyDescription")}
          />
        ) : (
          txs.slice(0, 50).map((tx) => (
            <Link key={tx.id} href={`/transactions/${tx.id}`} className="block">
              <Card className="transition-colors hover:bg-accent/40">
                <CardContent className="flex items-center justify-between py-3">
                  <div>
                    <p className="font-medium capitalize">{tx.categoryId}</p>
                    <p className="text-xs text-muted-foreground">{tx.date}{tx.merchant ? ` · ${tx.merchant}` : ""}</p>
                  </div>
                  <span
                    className={
                      tx.type === TX_TYPES.INCOME ? "text-primary font-semibold" : "font-semibold"
                    }
                  >
                    {tx.type === TX_TYPES.INCOME ? "+" : "-"}
                    {format(tx.amountPoisha)}
                  </span>
                </CardContent>
              </Card>
            </Link>
          ))
        )}
      </div>
    </AppShell>
  );
}
