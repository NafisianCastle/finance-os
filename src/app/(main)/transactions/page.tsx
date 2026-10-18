"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { SharedChip } from "@/components/shared-toggle";
import { LOCAL_USER_ID, useAppStore } from "@/store/app-store";
import { getDb } from "@/infrastructure/db/dexie/database";
import { scoped } from "@/infrastructure/db/dexie/helpers";
import type { Transaction } from "@/infrastructure/db/dexie/schema";
import { isSupabaseConfigured } from "@/infrastructure/supabase/client";
import { pullHistoricalTransactions } from "@/infrastructure/sync/sync-queue";
import { useCurrencyFormatter } from "@/hooks/use-currency-formatter";
import { useCategoryName } from "@/hooks/use-category-name";
import { TX_TYPES } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { Plus, Receipt } from "lucide-react";

const PAGE_SIZE = 50;

export default function TransactionsPage() {
  const t = useTranslations("Transactions");
  const locale = useLocale();
  const { toast } = useToast();
  const { format } = useCurrencyFormatter();
  const categoryName = useCategoryName();
  const userId = useAppStore((s) => s.userId);
  const groupId = useAppStore((s) => s.groupId);
  const [txs, setTxs] = useState<Transaction[] | null>(null);
  const [accountNames, setAccountNames] = useState<Map<string, string>>(new Map());
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [loadingOlder, setLoadingOlder] = useState(false);
  // History cursor, tagged with the user/group scope it was fetched for so a
  // group switch starts over from the sync window. `before` is the exclusive
  // upper bound for the next pull; undefined = the sync window cutoff.
  const scopeKey = `${userId ?? ""}|${groupId ?? ""}`;
  const [history, setHistory] = useState<{ scope: string; before?: string; exhausted: boolean }>({
    scope: "",
    exhausted: false,
  });
  const historyBefore = history.scope === scopeKey ? history.before : undefined;
  const historyExhausted = history.scope === scopeKey && history.exhausted;

  const cloudEnabled = !!userId && userId !== LOCAL_USER_ID && isSupabaseConfigured();

  const load = useCallback(async () => {
    if (!userId) return;
    const db = getDb();
    const [list, accounts] = await Promise.all([
      scoped(db.transactions, userId, groupId).toArray(),
      scoped(db.accounts, userId, groupId).toArray(),
    ]);
    setTxs(list.sort((a, b) => b.date.localeCompare(a.date)));
    setAccountNames(new Map(accounts.map((a) => [a.id, a.name])));
  }, [userId, groupId]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { year: "numeric", month: "short", day: "numeric" }),
    [locale]
  );
  const formatDate = (ymd: string) => {
    const d = new Date(`${ymd.slice(0, 10)}T00:00:00`);
    return Number.isNaN(d.getTime()) ? ymd : dateFormatter.format(d);
  };

  const hasMoreLocal = txs !== null && visibleCount < txs.length;
  const showLoadOlder = txs !== null && (hasMoreLocal || (cloudEnabled && !historyExhausted));

  async function handleLoadOlder() {
    if (hasMoreLocal) {
      setVisibleCount((c) => c + PAGE_SIZE);
      return;
    }
    if (!userId) return;
    setLoadingOlder(true);
    try {
      const res = await pullHistoricalTransactions(userId, groupId, historyBefore);
      if (res.error) {
        toast(t("loadOlderFailed"), "error");
        return;
      }
      if (!res.oldestDate) {
        setHistory({ scope: scopeKey, before: historyBefore, exhausted: true });
        toast(t("noOlderTransactions"), "info");
        return;
      }
      setHistory({ scope: scopeKey, before: res.oldestDate, exhausted: false });
      await load();
      setVisibleCount((c) => c + Math.max(res.count, PAGE_SIZE));
    } catch {
      toast(t("loadOlderFailed"), "error");
    } finally {
      setLoadingOlder(false);
    }
  }

  return (
    <AppShell title={t("title")}>
      <div className="space-y-3">
        <Link href="/transactions/new" className={buttonVariants({ className: "w-full" })}>
          <Plus className="h-4 w-4" />
          {t("addTransaction")}
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
          <>
            {txs.slice(0, visibleCount).map((tx) => {
              const isTransfer = tx.type === TX_TYPES.TRANSFER;
              const isIncome = tx.type === TX_TYPES.INCOME;
              const title = isTransfer
                ? t("transferRoute", {
                    from: accountNames.get(tx.accountId) ?? t("unknownAccount"),
                    to: (tx.toAccountId && accountNames.get(tx.toAccountId)) || t("unknownAccount"),
                  })
                : categoryName(tx.categoryId);
              return (
                <Link key={tx.id} href={`/transactions/${tx.id}`} className="block">
                  <Card className="transition-colors hover:bg-accent/40">
                    <CardContent className="flex items-center justify-between gap-3 py-3">
                      <div className="min-w-0">
                        <div className="flex min-w-0 items-center gap-2">
                          <p className="truncate font-medium">{title}</p>
                          <SharedChip groupId={tx.groupId} />
                        </div>
                        <p className="truncate text-xs text-muted-foreground">
                          {isTransfer ? `${t("transfer")} · ` : ""}
                          {formatDate(tx.date)}
                          {tx.merchant ? ` · ${tx.merchant}` : ""}
                        </p>
                      </div>
                      <span
                        className={cn(
                          "shrink-0 font-semibold",
                          isIncome && "text-primary",
                          isTransfer && "text-muted-foreground"
                        )}
                      >
                        {isIncome ? "+" : isTransfer ? "" : "-"}
                        {format(tx.amountPoisha)}
                      </span>
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </>
        )}
        {showLoadOlder && (
          <Button
            variant="outline"
            className="w-full"
            loading={loadingOlder}
            onClick={handleLoadOlder}
          >
            {t("loadOlder")}
          </Button>
        )}
      </div>
    </AppShell>
  );
}
