"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { useTranslations } from "next-intl";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AmountInput } from "@/components/ui/amount-input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getDb } from "@/infrastructure/db/dexie/database";
import { useAppStore } from "@/store/app-store";
import { useCurrencyFormatter } from "@/hooks/use-currency-formatter";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  addShoppingListItem,
  deleteShoppingListItem,
  finishShoppingList,
  priceItemAfterCheckout,
  updateShoppingListItem,
} from "@/application/shopping-lists";
import { SYSTEM_CATEGORIES } from "@/lib/constants";
import type { Account, ShoppingListItem } from "@/infrastructure/db/dexie/schema";
import { Plus, Trash2, Check } from "lucide-react";

export default function ShoppingListDetailPage() {
  const t = useTranslations("ShoppingLists");
  const params = useParams<{ id: string }>();
  const listId = params.id;
  const router = useRouter();
  const userId = useAppStore((s) => s.userId);
  const { format, toMinor, toMajor } = useCurrencyFormatter();
  const { toast } = useToast();
  const confirm = useConfirm();

  const list = useLiveQuery(() => getDb().shoppingLists.get(listId), [listId]);
  const items = useLiveQuery(
    () =>
      getDb()
        .shoppingListItems.where("listId")
        .equals(listId)
        .filter((i) => !i.deletedAt)
        .sortBy("sortOrder"),
    [listId]
  );

  const [newItemName, setNewItemName] = useState("");
  const [priceDrafts, setPriceDrafts] = useState<Record<string, string>>({});
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState("");
  const [categoryId, setCategoryId] = useState("food");
  const [showFinish, setShowFinish] = useState(false);
  const [finishing, setFinishing] = useState(false);

  useEffect(() => {
    if (!userId) return;
    getDb()
      .accounts.where("userId")
      .equals(userId)
      .filter((a) => !a.deletedAt)
      .toArray()
      .then((a) => {
        setAccounts(a);
        setAccountId((prev) => prev || a[0]?.id || "");
      });
  }, [userId]);

  async function addItem() {
    if (!userId || !newItemName.trim()) return;
    await addShoppingListItem(userId, listId, { name: newItemName.trim() });
    setNewItemName("");
  }

  async function toggleChecked(item: ShoppingListItem) {
    if (list?.status === "completed") {
      if (!item.checked) return;
      // Already-finalized trip: only price entry is allowed, not un/checking.
      return;
    }
    await updateShoppingListItem(item.id, { checked: !item.checked });
  }

  async function savePrice(item: ShoppingListItem) {
    const draft = priceDrafts[item.id];
    if (draft === undefined) return;
    const poisha = toMinor(parseFloat(draft) || 0);
    if (list?.status === "completed" && userId) {
      await priceItemAfterCheckout(userId, item.id, poisha);
    } else {
      await updateShoppingListItem(item.id, { actualPricePoisha: poisha, checked: true });
    }
    setPriceDrafts((prev) => {
      const next = { ...prev };
      delete next[item.id];
      return next;
    });
  }

  async function removeItem(itemId: string) {
    await deleteShoppingListItem(itemId);
  }

  async function finish() {
    if (!userId || !accountId) return;
    setFinishing(true);
    try {
      await finishShoppingList(userId, listId, accountId, categoryId);
      toast(t("finishedToast"), "success");
      router.push("/shopping-lists");
    } finally {
      setFinishing(false);
    }
  }

  async function removeList() {
    const ok = await confirm({
      title: t("deleteListTitle"),
      description: t("deleteListDescription"),
      variant: "destructive",
    });
    if (!ok) return;
    const { deleteShoppingList } = await import("@/application/shopping-lists");
    await deleteShoppingList(listId);
    router.push("/shopping-lists");
  }

  const checkedItems = items?.filter((i) => i.checked) ?? [];
  const uncheckedItems = items?.filter((i) => !i.checked) ?? [];
  const runningTotal = checkedItems.reduce((sum, i) => sum + (i.actualPricePoisha ?? 0), 0);
  const uncheckedPriceCount = checkedItems.filter((i) => !i.actualPricePoisha).length;
  const isCompleted = list?.status === "completed";

  function ItemRow({ item }: { item: ShoppingListItem }) {
    const isEditingPrice = priceDrafts[item.id] !== undefined;
    return (
      <div className="flex items-center gap-3 py-2.5">
        <button
          type="button"
          onClick={() => toggleChecked(item)}
          disabled={isCompleted}
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border ${
            item.checked ? "border-primary bg-primary text-primary-foreground" : "border-border"
          } ${isCompleted ? "opacity-60" : ""}`}
        >
          {item.checked && <Check className="h-4 w-4" />}
        </button>

        <div className="min-w-0 flex-1">
          <p className={`truncate ${item.checked ? "text-muted-foreground line-through" : ""}`}>{item.name}</p>
        </div>

        {item.checked ? (
          isEditingPrice ? (
            <div className="flex w-28 items-center gap-1">
              <AmountInput
                autoFocus
                value={priceDrafts[item.id]}
                onChange={(v) => setPriceDrafts((prev) => ({ ...prev, [item.id]: v }))}
                onBlur={() => savePrice(item)}
                onKeyDown={(e) => e.key === "Enter" && savePrice(item)}
                className="h-8 text-right"
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={() =>
                setPriceDrafts((prev) => ({
                  ...prev,
                  [item.id]: item.actualPricePoisha ? String(toMajor(item.actualPricePoisha)) : "",
                }))
              }
              className="shrink-0"
            >
              {item.actualPricePoisha ? (
                <span className="font-medium">{format(item.actualPricePoisha)}</span>
              ) : (
                <Badge variant="warning">{t("needsPrice")}</Badge>
              )}
            </button>
          )
        ) : (
          !isCompleted && (
            <button type="button" onClick={() => removeItem(item.id)} className="shrink-0 text-muted-foreground hover:text-destructive">
              <Trash2 className="h-4 w-4" />
            </button>
          )
        )}
      </div>
    );
  }

  return (
    <AppShell title={list?.name ?? t("title")}>
      <div className="space-y-4 pb-20">
        {!isCompleted && (
          <div className="flex gap-2">
            <Input
              value={newItemName}
              onChange={(e) => setNewItemName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addItem()}
              placeholder={t("itemPlaceholder")}
            />
            <Button type="button" variant="secondary" onClick={addItem}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        )}

        {checkedItems.length > 0 && (
          <Card>
            <CardContent className="divide-y divide-border py-2">
              {checkedItems.map((item) => (
                <ItemRow key={item.id} item={item} />
              ))}
            </CardContent>
          </Card>
        )}

        {uncheckedItems.length > 0 && (
          <Card>
            <CardContent className="divide-y divide-border py-2">
              {uncheckedItems.map((item) => (
                <ItemRow key={item.id} item={item} />
              ))}
            </CardContent>
          </Card>
        )}

        {items?.length === 0 && <p className="text-center text-sm text-muted-foreground">{t("noItems")}</p>}

        {!isCompleted && (
          <button type="button" onClick={removeList} className="text-sm text-muted-foreground underline">
            {t("deleteList")}
          </button>
        )}
      </div>

      {!isCompleted && checkedItems.length > 0 && (
        <div className="fixed bottom-16 left-0 right-0 z-40 border-t border-border bg-card/95 px-4 py-3 backdrop-blur">
          <div className="mx-auto max-w-md space-y-2 md:max-w-2xl">
            {!showFinish ? (
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm text-muted-foreground">
                    {uncheckedPriceCount > 0 ? t("itemsNeedPrice", { count: uncheckedPriceCount }) : t("readyToFinish")}
                  </p>
                  <p className="text-lg font-bold">{format(runningTotal)}</p>
                </div>
                <Button onClick={() => setShowFinish(true)}>{t("finish")}</Button>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <Select value={accountId} onValueChange={setAccountId}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={t("account")} />
                    </SelectTrigger>
                    <SelectContent>
                      {accounts.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={categoryId} onValueChange={setCategoryId}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={t("category")} />
                    </SelectTrigger>
                    <SelectContent>
                      {SYSTEM_CATEGORIES.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex gap-2">
                  <Button variant="secondary" className="flex-1" onClick={() => setShowFinish(false)}>
                    {t("cancel")}
                  </Button>
                  <Button className="flex-1" onClick={finish} disabled={finishing || !accountId}>
                    {t("confirmFinish", { amount: format(runningTotal) })}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </AppShell>
  );
}
