"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { useTranslations } from "next-intl";
import { AppShell } from "@/components/app-shell";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AmountInput } from "@/components/ui/amount-input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getDb } from "@/infrastructure/db/dexie/database";
import { isVisible, scoped } from "@/infrastructure/db/dexie/helpers";
import { useAppStore } from "@/store/app-store";
import { useCurrencyFormatter } from "@/hooks/use-currency-formatter";
import { useCategoryName } from "@/hooks/use-category-name";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { SharedChip } from "@/components/shared-toggle";
import {
  addShoppingListItem,
  checkoutGroupKey,
  deleteShoppingList,
  deleteShoppingListItem,
  finishShoppingList,
  listShoppingListItems,
  priceItemAfterCheckout,
  renameShoppingList,
  updateShoppingListItem,
} from "@/application/shopping-lists";
import { SYSTEM_CATEGORIES } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { Account, ShoppingListItem } from "@/infrastructure/db/dexie/schema";
import { Plus, Trash2, Check, Pencil, ShoppingCart } from "lucide-react";

type ItemPatch = Partial<Pick<ShoppingListItem, "categoryId" | "accountId">>;

interface ItemRowProps {
  item: ShoppingListItem;
  isCompleted: boolean;
  defaultCategoryId: string;
  defaultAccountId: string;
  accounts: Account[];
  format: (minorUnits: number) => string;
  toMajor: (minorUnits: number) => number;
  onToggle: (item: ShoppingListItem) => void;
  onSavePrice: (item: ShoppingListItem, draft: string) => Promise<void>;
  onRename: (item: ShoppingListItem, name: string) => Promise<void>;
  onDelete: (item: ShoppingListItem) => void;
  onUpdate: (item: ShoppingListItem, patch: ItemPatch) => void;
}

/**
 * One shopping-list row. Lives at module level (not inside the page) so its
 * inputs keep focus across the page's re-renders; draft state is local.
 */
function ItemRow({
  item,
  isCompleted,
  defaultCategoryId,
  defaultAccountId,
  accounts,
  format,
  toMajor,
  onToggle,
  onSavePrice,
  onRename,
  onDelete,
  onUpdate,
}: ItemRowProps) {
  const t = useTranslations("ShoppingLists");
  const categoryName = useCategoryName();
  const [priceDraft, setPriceDraft] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [showOverride, setShowOverride] = useState(false);

  async function commitPrice() {
    if (priceDraft === null) return;
    const draft = priceDraft;
    setPriceDraft(null);
    await onSavePrice(item, draft);
  }

  async function commitName() {
    if (nameDraft === null) return;
    const draft = nameDraft.trim();
    setNameDraft(null);
    if (draft && draft !== item.name) await onRename(item, draft);
  }

  const itemCategoryId = item.categoryId ?? defaultCategoryId;
  const itemAccountId = item.accountId ?? defaultAccountId;

  return (
    <div className="flex flex-col gap-1.5 py-2.5">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => onToggle(item)}
          disabled={isCompleted}
          aria-pressed={item.checked}
          className={cn(
            "flex h-6 w-6 shrink-0 items-center justify-center rounded-md border",
            item.checked ? "border-primary bg-primary text-primary-foreground" : "border-border",
            isCompleted && "opacity-60"
          )}
        >
          {item.checked && <Check className="h-4 w-4" />}
        </button>

        <div className="min-w-0 flex-1">
          {nameDraft !== null ? (
            <Input
              autoFocus
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={commitName}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitName();
                if (e.key === "Escape") setNameDraft(null);
              }}
              aria-label={t("itemName")}
              className="h-8"
            />
          ) : isCompleted ? (
            <p className={cn("truncate", item.checked && "text-muted-foreground line-through")}>{item.name}</p>
          ) : (
            <button
              type="button"
              onClick={() => setNameDraft(item.name)}
              className={cn("block w-full truncate text-left", item.checked && "text-muted-foreground line-through")}
              aria-label={t("editItemName", { name: item.name })}
            >
              {item.name}
            </button>
          )}
        </div>

        {item.checked &&
          (priceDraft !== null ? (
            <div className="flex w-28 items-center gap-1">
              <AmountInput
                autoFocus
                value={priceDraft}
                onChange={setPriceDraft}
                onBlur={commitPrice}
                onKeyDown={(e) => e.key === "Enter" && commitPrice()}
                className="h-8 text-right"
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setPriceDraft(item.actualPricePoisha ? String(toMajor(item.actualPricePoisha)) : "")}
              className="shrink-0"
            >
              {item.actualPricePoisha ? (
                <span className="font-medium">{format(item.actualPricePoisha)}</span>
              ) : (
                <Badge variant="warning">{t("needsPrice")}</Badge>
              )}
            </button>
          ))}

        <button
          type="button"
          onClick={() => onDelete(item)}
          aria-label={t("deleteItem")}
          className="shrink-0 text-muted-foreground hover:text-destructive"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      {item.checked && !isCompleted && (
        <div className="ml-9">
          {showOverride ? (
            <div className="flex items-center gap-2">
              <Select value={itemCategoryId} onValueChange={(v) => onUpdate(item, { categoryId: v })}>
                <SelectTrigger className="h-7 w-auto min-w-0 gap-1 px-2 text-xs">
                  <SelectValue placeholder={t("category")} />
                </SelectTrigger>
                <SelectContent>
                  {SYSTEM_CATEGORIES.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {categoryName(c.id)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={itemAccountId} onValueChange={(v) => onUpdate(item, { accountId: v })}>
                <SelectTrigger className="h-7 w-auto min-w-0 gap-1 px-2 text-xs">
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
              <button
                type="button"
                onClick={() => setShowOverride(false)}
                className="text-xs text-muted-foreground underline"
              >
                {t("done")}
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => setShowOverride(true)}>
              <Badge variant="secondary">
                {categoryName(itemCategoryId)} · {accounts.find((a) => a.id === itemAccountId)?.name ?? "-"}
              </Badge>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function ShoppingListDetailPage() {
  const t = useTranslations("ShoppingLists");
  const params = useParams<{ id: string }>();
  const listId = params.id;
  const router = useRouter();
  const userId = useAppStore((s) => s.userId);
  const groupId = useAppStore((s) => s.groupId);
  const { format, toMinor, toMajor } = useCurrencyFormatter();
  const categoryName = useCategoryName();
  const { toast } = useToast();
  const confirm = useConfirm();

  // undefined = loading, null = missing or not visible to this user/group.
  const list = useLiveQuery(async () => {
    if (!userId) return null;
    const l = await getDb().shoppingLists.get(listId);
    return l && isVisible(l, userId, groupId) ? l : null;
  }, [listId, userId, groupId]);
  const items = useLiveQuery(
    () => (list ? listShoppingListItems(list.id) : Promise.resolve([] as ShoppingListItem[])),
    [list?.id]
  );
  const accounts =
    useLiveQuery(
      () => (userId ? scoped(getDb().accounts, userId, groupId).toArray() : Promise.resolve([] as Account[])),
      [userId, groupId]
    ) ?? [];

  const [newItemName, setNewItemName] = useState("");
  const [accountIdChoice, setAccountId] = useState("");
  const [categoryId, setCategoryId] = useState("food");
  const [showFinish, setShowFinish] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [titleDraft, setTitleDraft] = useState<string | null>(null);

  const accountId = accounts.some((a) => a.id === accountIdChoice) ? accountIdChoice : accounts[0]?.id ?? "";
  const isCompleted = list?.status === "completed";

  async function addItem() {
    if (!userId || !newItemName.trim()) return;
    await addShoppingListItem(userId, listId, { name: newItemName.trim() }, groupId);
    setNewItemName("");
  }

  async function toggleChecked(item: ShoppingListItem) {
    if (isCompleted) return;
    const checked = !item.checked;
    await updateShoppingListItem(
      item.id,
      {
        checked,
        ...(checked ? { categoryId: item.categoryId ?? categoryId, accountId: item.accountId ?? accountId } : {}),
      },
      userId ?? undefined,
      groupId
    );
  }

  async function savePrice(item: ShoppingListItem, draft: string) {
    if (!userId) return;
    const poisha = toMinor(parseFloat(draft) || 0);
    if (poisha < 0) return;
    if (isCompleted) {
      await priceItemAfterCheckout(userId, item.id, poisha, groupId);
    } else {
      await updateShoppingListItem(item.id, { actualPricePoisha: poisha, checked: true }, userId, groupId);
    }
  }

  async function renameItem(item: ShoppingListItem, name: string) {
    if (!userId) return;
    await updateShoppingListItem(item.id, { name }, userId, groupId);
  }

  async function updateItem(item: ShoppingListItem, patch: ItemPatch) {
    if (!userId) return;
    await updateShoppingListItem(item.id, patch, userId, groupId);
  }

  async function removeItem(item: ShoppingListItem) {
    if (!userId) return;
    if (item.checked) {
      const ok = await confirm({
        title: t("deleteItemTitle", { name: item.name }),
        description: isCompleted ? t("deleteCheckedItemDescription") : undefined,
        confirmLabel: t("delete"),
        variant: "destructive",
      });
      if (!ok) return;
    }
    await deleteShoppingListItem(item.id, userId, groupId);
  }

  async function saveTitle() {
    if (titleDraft === null || !userId) return;
    const name = titleDraft.trim();
    setTitleDraft(null);
    if (!name || name === list?.name) return;
    await renameShoppingList(userId, listId, name, groupId);
    toast(t("listRenamed"), "success");
  }

  async function finish() {
    if (!userId || !accountId) return;
    setFinishing(true);
    try {
      await finishShoppingList(userId, listId, accountId, groupId);
      toast(t("finishedToast"), "success");
      router.push("/shopping-lists");
    } finally {
      setFinishing(false);
    }
  }

  async function removeList() {
    if (!userId) return;
    const ok = await confirm({
      title: t("deleteListTitle"),
      description: isCompleted ? t("deleteCompletedListDescription") : t("deleteListDescription"),
      confirmLabel: t("delete"),
      variant: "destructive",
    });
    if (!ok) return;
    await deleteShoppingList(listId, userId, groupId);
    toast(t("listDeleted"), "success");
    router.push("/shopping-lists");
  }

  if (list === undefined) {
    return (
      <AppShell title={t("title")}>
        <div className="space-y-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      </AppShell>
    );
  }

  if (list === null) {
    return (
      <AppShell title={t("title")}>
        <EmptyState
          icon={ShoppingCart}
          title={t("notFoundTitle")}
          description={t("notFoundDescription")}
          action={
            <Link href="/shopping-lists" className={buttonVariants({ variant: "outline" })}>
              {t("backToLists")}
            </Link>
          }
        />
      </AppShell>
    );
  }

  const checkedItems = items?.filter((i) => i.checked) ?? [];
  const uncheckedItems = items?.filter((i) => !i.checked) ?? [];
  const runningTotal = checkedItems.reduce((sum, i) => sum + (i.actualPricePoisha ?? 0), 0);
  const uncheckedPriceCount = checkedItems.filter((i) => !i.actualPricePoisha).length;
  const showFinishBar = !isCompleted && checkedItems.length > 0;

  const finishGroups = Object.values(
    checkedItems.reduce<Record<string, { key: string; categoryName: string; accountName: string; count: number; total: number }>>(
      (acc, item) => {
        const itemAccountId = item.accountId ?? accountId;
        const itemCategoryId = item.categoryId ?? categoryId;
        const key = checkoutGroupKey(itemAccountId, itemCategoryId);
        if (!acc[key]) {
          acc[key] = {
            key,
            categoryName: categoryName(itemCategoryId),
            accountName: accounts.find((a) => a.id === itemAccountId)?.name ?? "-",
            count: 0,
            total: 0,
          };
        }
        acc[key].count += 1;
        acc[key].total += item.actualPricePoisha ?? 0;
        return acc;
      },
      {}
    )
  );

  const rowProps = {
    isCompleted,
    defaultCategoryId: categoryId,
    defaultAccountId: accountId,
    accounts,
    format,
    toMajor,
    onToggle: toggleChecked,
    onSavePrice: savePrice,
    onRename: renameItem,
    onDelete: removeItem,
    onUpdate: updateItem,
  };

  return (
    <AppShell title={list.name}>
      {/* Extra bottom padding so the fixed finish bar never hides the last rows. */}
      <div className={cn("space-y-4", showFinishBar ? (showFinish ? "pb-72" : "pb-36") : "pb-20")}>
        <div className="flex items-center gap-2">
          {titleDraft !== null ? (
            <Input
              autoFocus
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={saveTitle}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveTitle();
                if (e.key === "Escape") setTitleDraft(null);
              }}
              aria-label={t("listName")}
            />
          ) : (
            <>
              <h2 className="min-w-0 truncate text-lg font-semibold">{list.name}</h2>
              <SharedChip groupId={list.groupId} />
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 shrink-0 text-muted-foreground"
                aria-label={t("renameList")}
                onClick={() => setTitleDraft(list.name)}
              >
                <Pencil className="h-4 w-4" />
              </Button>
              {isCompleted && <Badge variant="secondary">{t("completed")}</Badge>}
            </>
          )}
        </div>

        {!isCompleted && (
          <div className="flex gap-2">
            <Input
              value={newItemName}
              onChange={(e) => setNewItemName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addItem()}
              placeholder={t("itemPlaceholder")}
            />
            <Button type="button" variant="secondary" onClick={addItem} aria-label={t("addItems")}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        )}

        {!isCompleted && checkedItems.length > 0 && (
          <div className="flex items-center gap-2">
            <Label className="shrink-0 text-xs text-muted-foreground">{t("defaultFor")}</Label>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger className="h-8 w-auto min-w-0 gap-1 px-2 text-xs">
                <SelectValue placeholder={t("category")} />
              </SelectTrigger>
              <SelectContent>
                {SYSTEM_CATEGORIES.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {categoryName(c.id)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger className="h-8 w-auto min-w-0 gap-1 px-2 text-xs">
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
          </div>
        )}

        {checkedItems.length > 0 && (
          <Card>
            <CardContent className="divide-y divide-border py-2">
              {checkedItems.map((item) => (
                <ItemRow key={item.id} item={item} {...rowProps} />
              ))}
            </CardContent>
          </Card>
        )}

        {uncheckedItems.length > 0 && (
          <Card>
            <CardContent className="divide-y divide-border py-2">
              {uncheckedItems.map((item) => (
                <ItemRow key={item.id} item={item} {...rowProps} />
              ))}
            </CardContent>
          </Card>
        )}

        {items?.length === 0 && <p className="text-center text-sm text-muted-foreground">{t("noItems")}</p>}

        <button type="button" onClick={removeList} className="text-sm text-muted-foreground underline">
          {t("deleteList")}
        </button>
      </div>

      {showFinishBar && (
        // Sits just above the bottom nav (which grows with the safe-area inset).
        // Right padding keeps content clear of the floating add button, which
        // overlaps this bar's right edge at bottom 5.5rem / right 1rem.
        <div className="fixed bottom-[calc(4rem+env(safe-area-inset-bottom))] left-0 right-0 z-40 border-t border-border bg-card/95 py-3 pl-4 pr-20 backdrop-blur">
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
                <p className="text-xs text-muted-foreground">{t("groupsHint")}</p>
                <div className="space-y-1 rounded-md border border-border p-2">
                  {finishGroups.map((g) => (
                    <div key={g.key} className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">
                        {g.categoryName} · {g.accountName} ({g.count})
                      </span>
                      <span className="font-medium">{format(g.total)}</span>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Button variant="secondary" className="flex-1" onClick={() => setShowFinish(false)}>
                    {t("cancel")}
                  </Button>
                  <Button className="flex-1" onClick={finish} loading={finishing} disabled={!accountId}>
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
