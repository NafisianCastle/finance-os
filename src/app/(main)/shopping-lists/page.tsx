"use client";

import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { useTranslations } from "next-intl";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { getDb } from "@/infrastructure/db/dexie/database";
import { useAppStore } from "@/store/app-store";
import { ShoppingCart, Plus } from "lucide-react";
import type { ShoppingList } from "@/infrastructure/db/dexie/schema";

export default function ShoppingListsPage() {
  const t = useTranslations("ShoppingLists");
  const userId = useAppStore((s) => s.userId);

  const lists = useLiveQuery(
    () =>
      userId
        ? getDb()
            .shoppingLists.where("userId")
            .equals(userId)
            .filter((l) => !l.deletedAt)
            .reverse()
            .sortBy("updatedAt")
        : Promise.resolve([] as ShoppingList[]),
    [userId]
  );

  const itemCounts = useLiveQuery(async () => {
    if (!lists?.length) return {} as Record<string, { total: number; checked: number }>;
    const db = getDb();
    const out: Record<string, { total: number; checked: number }> = {};
    for (const list of lists) {
      const items = await db.shoppingListItems.where("listId").equals(list.id).filter((i) => !i.deletedAt).toArray();
      out[list.id] = { total: items.length, checked: items.filter((i) => i.checked).length };
    }
    return out;
  }, [lists]);

  return (
    <AppShell title={t("title")}>
      <div className="space-y-4">
        <Link href="/shopping-lists/new">
          <Button className="w-full gap-2">
            <Plus className="h-4 w-4" />
            {t("newList")}
          </Button>
        </Link>

        {lists?.length === 0 && (
          <EmptyState icon={ShoppingCart} title={t("emptyTitle")} description={t("emptyDescription")} />
        )}

        <div className="space-y-3">
          {lists?.map((list) => {
            const counts = itemCounts?.[list.id];
            return (
              <Link key={list.id} href={`/shopping-lists/${list.id}`} className="block">
                <Card className="transition-colors hover:bg-accent/50">
                  <CardContent className="flex items-center justify-between gap-3 py-4">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{list.name}</p>
                      {counts && (
                        <p className="text-sm text-muted-foreground">
                          {t("itemsChecked", { checked: counts.checked, total: counts.total })}
                        </p>
                      )}
                    </div>
                    <Badge variant={list.status === "completed" ? "secondary" : "default"}>
                      {list.status === "completed" ? t("completed") : t("active")}
                    </Badge>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      </div>
    </AppShell>
  );
}
