"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { getDb } from "@/infrastructure/db/dexie/database";
import { useAppStore } from "@/store/app-store";
import { createShoppingList, addShoppingListItem } from "@/application/shopping-lists";
import { Plus, X } from "lucide-react";

export default function NewShoppingListPage() {
  const t = useTranslations("ShoppingLists");
  const router = useRouter();
  const userId = useAppStore((s) => s.userId);

  const [name, setName] = useState(t("defaultName"));
  const [itemName, setItemName] = useState("");
  const [items, setItems] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!userId) return;
    getDb()
      .shoppingListItems.where("userId")
      .equals(userId)
      .filter((i) => !i.deletedAt)
      .toArray()
      .then((all) => {
        const counts: Record<string, number> = {};
        for (const i of all) counts[i.name] = (counts[i.name] ?? 0) + 1;
        const sorted = Object.entries(counts)
          .sort((a, b) => b[1] - a[1])
          .map(([n]) => n)
          .slice(0, 10);
        setSuggestions(sorted);
      });
  }, [userId]);

  const filteredSuggestions = useMemo(
    () =>
      itemName.trim()
        ? suggestions.filter((s) => s.toLowerCase().includes(itemName.toLowerCase()) && !items.includes(s))
        : suggestions.filter((s) => !items.includes(s)),
    [itemName, suggestions, items]
  );

  function addItem(value: string) {
    const trimmed = value.trim();
    if (!trimmed || items.includes(trimmed)) return;
    setItems((prev) => [...prev, trimmed]);
    setItemName("");
  }

  function removeItem(value: string) {
    setItems((prev) => prev.filter((i) => i !== value));
  }

  async function save() {
    if (!userId || !name.trim()) return;
    setSaving(true);
    try {
      const list = await createShoppingList(userId, name.trim());
      for (const item of items) {
        await addShoppingListItem(userId, list.id, { name: item });
      }
      router.push(`/shopping-lists/${list.id}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell title={t("newList")}>
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="list-name">{t("listName")}</Label>
          <Input id="list-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="item-name">{t("addItems")}</Label>
          <div className="flex gap-2">
            <Input
              id="item-name"
              value={itemName}
              onChange={(e) => setItemName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addItem(itemName);
                }
              }}
              placeholder={t("itemPlaceholder")}
            />
            <Button type="button" variant="secondary" onClick={() => addItem(itemName)}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          {filteredSuggestions.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {filteredSuggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => addItem(s)}
                  className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent"
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>

        {items.length > 0 && (
          <Card>
            <CardContent className="space-y-1.5 py-4">
              {items.map((item) => (
                <div key={item} className="flex items-center justify-between gap-2 py-1">
                  <span>{item}</span>
                  <button type="button" onClick={() => removeItem(item)} className="text-muted-foreground hover:text-foreground">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        <Button className="w-full" onClick={save} disabled={saving || !name.trim()}>
          {t("createList")}
        </Button>
      </div>
    </AppShell>
  );
}
