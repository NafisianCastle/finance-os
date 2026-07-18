"use client";

import { deleteTransaction, updateTransaction } from "@/application/transactions";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { TransactionForm } from "@/components/transactions/transaction-form";
import { getDb } from "@/infrastructure/db/dexie/database";
import type { Transaction } from "@/infrastructure/db/dexie/schema";
import { useAppStore } from "@/store/app-store";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Trash2 } from "lucide-react";

export default function EditTransactionPage() {
  const t = useTranslations("NewTransaction");
  const tList = useTranslations("Transactions");
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const userId = useAppStore((s) => s.userId);
  const [tx, setTx] = useState<Transaction | null | undefined>(undefined);

  useEffect(() => {
    if (!userId || !params.id) return;
    getDb()
      .transactions.get(params.id)
      .then((found) => setTx(found && found.userId === userId && !found.deletedAt ? found : null));
  }, [userId, params.id]);

  async function handleDelete() {
    if (!userId || !tx) return;
    if (!window.confirm(tList("deleteConfirm"))) return;
    await deleteTransaction(userId, tx.id);
    router.push("/transactions");
  }

  if (tx === undefined) return <AppShell title={t("editTitle")}>{null}</AppShell>;
  if (tx === null) return <AppShell title={t("editTitle")}>{tList("notFound")}</AppShell>;

  return (
    <AppShell title={t("editTitle")}>
      <TransactionForm
        initial={tx}
        submitLabel={t("save")}
        onSubmit={async (data) => {
          if (!userId) return;
          await updateTransaction(userId, tx.id, data);
          router.push("/transactions");
        }}
        extraAction={
          <Button type="button" variant="outline" className="w-full text-destructive" onClick={handleDelete}>
            <Trash2 className="h-4 w-4" />
            {tList("delete")}
          </Button>
        }
      />
    </AppShell>
  );
}
