"use client";

import { useState } from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { useTranslations } from "next-intl";
import { AppShell } from "@/components/app-shell";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { SharedChip } from "@/components/shared-toggle";
import { deleteShoppingList, listShoppingListItems, listShoppingLists } from "@/application/shopping-lists";
import { useAppStore } from "@/store/app-store";
import { cn } from "@/lib/utils";
import { ShoppingCart, Plus, Trash2 } from "lucide-react";
import type { ShoppingList } from "@/infrastructure/db/dexie/schema";

export default function ShoppingListsPage() {
  const t = useTranslations("ShoppingLists");
  const userId = useAppStore((s) => s.userId);
  const groupId = useAppStore((s) => s.groupId);
  const { toast } = useToast();
  const confirm = useConfirm();
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const lists = useLiveQuery(
    async () =>
      userId
        ? (await listShoppingLists(userId, groupId)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        : ([] as ShoppingList[]),
    [userId, groupId]
  );

  const itemCounts = useLiveQuery(async () => {
    if (!lists?.length) return {} as Record<string, { total: number; checked: number }>;
    const out: Record<string, { total: number; checked: number }> = {};
    for (const list of lists) {
      const items = await listShoppingListItems(list.id);
      out[list.id] = { total: items.length, checked: items.filter((i) => i.checked).length };
    }
    return out;
  }, [lists]);

  async function removeList(list: ShoppingList) {
    if (!userId) return;
    const ok = await confirm({
      title: t("deleteListTitle"),
      description: list.status === "completed" ? t("deleteCompletedListDescription") : t("deleteListDescription"),
      confirmLabel: t("delete"),
      variant: "destructive",
    });
    if (!ok) return;
    setDeletingId(list.id);
    try {
      await deleteShoppingList(list.id, userId, groupId);
      toast(t("listDeleted"), "success");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <AppShell title={t("title")}>
      <div className="space-y-4">
        <Link href="/shopping-lists/new" className={cn(buttonVariants({ className: "w-full gap-2" }))}>
          <Plus className="h-4 w-4" />
          {t("newList")}
        </Link>

        {lists?.length === 0 && (
          <EmptyState icon={ShoppingCart} title={t("emptyTitle")} description={t("emptyDescription")} />
        )}

        <div className="space-y-3">
          {lists?.map((list) => {
            const counts = itemCounts?.[list.id];
            return (
              <Card key={list.id} className="transition-colors hover:bg-accent/50">
                <CardContent className="flex items-center gap-2 py-4">
                  <Link href={`/shopping-lists/${list.id}`} className="flex min-w-0 flex-1 items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center gap-2">
                        <p className="truncate font-medium">{list.name}</p>
                        <SharedChip groupId={list.groupId} />
                      </div>
                      {counts && (
                        <p className="text-sm text-muted-foreground">
                          {t("itemsChecked", { checked: counts.checked, total: counts.total })}
                        </p>
                      )}
                    </div>
                    <Badge variant={list.status === "completed" ? "secondary" : "default"}>
                      {list.status === "completed" ? t("completed") : t("active")}
                    </Badge>
                  </Link>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                    aria-label={t("deleteList")}
                    loading={deletingId === list.id}
                    onClick={() => removeList(list)}
                  >
                    {deletingId !== list.id && <Trash2 className="h-4 w-4" />}
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </AppShell>
  );
}
