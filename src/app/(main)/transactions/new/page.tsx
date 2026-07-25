"use client";

import { addTransaction } from "@/application/transactions";
import { AppShell } from "@/components/app-shell";
import { TransactionForm } from "@/components/transactions/transaction-form";
import { useAppStore } from "@/store/app-store";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

export default function NewTransactionPage() {
  const t = useTranslations("NewTransaction");
  const router = useRouter();
  const userId = useAppStore((s) => s.userId);

  return (
    <AppShell title={t("title")}>
      <TransactionForm
        submitLabel={t("save")}
        onSubmit={async (data) => {
          if (!userId) return;
          await addTransaction(userId, data);
          router.push("/transactions");
        }}
      />
    </AppShell>
  );
}
