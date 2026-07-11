"use client";

import { useEffect, useState } from "react";
import { v4 as uuid } from "uuid";
import { useTranslations } from "next-intl";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { useAppStore } from "@/store/app-store";
import { getDb } from "@/infrastructure/db/dexie/database";
import { useCurrencyFormatter } from "@/hooks/use-currency-formatter";
import type { HeldLiability } from "@/infrastructure/db/dexie/schema";
import { HELD_STATUS } from "@/lib/constants";
import { enqueueSync } from "@/infrastructure/sync/sync-queue";

export default function LiabilitiesPage() {
  const userId = useAppStore((s) => s.userId);
  const t = useTranslations("Liabilities");
  const { format, toMinor, currencyCode } = useCurrencyFormatter();
  const [items, setItems] = useState<HeldLiability[]>([]);
  const [owner, setOwner] = useState("");
  const [amount, setAmount] = useState("");
  const [purpose, setPurpose] = useState("");

  async function load() {
    if (!userId) return;
    setItems(
      await getDb()
        .heldLiabilities.where("userId")
        .equals(userId)
        .filter((h) => !h.deletedAt)
        .toArray()
    );
  }

  useEffect(() => {
    load();
  }, [userId]);

  async function addHeld() {
    if (!userId) return;
    const poisha = toMinor(parseFloat(amount) || 0);
    const now = new Date().toISOString();
    const h: HeldLiability = {
      id: uuid(),
      userId,
      owner,
      amountPoisha: poisha,
      holdDate: now.slice(0, 10),
      purpose,
      status: HELD_STATUS.ACTIVE,
      createdAt: now,
      updatedAt: now,
    };
    await getDb().heldLiabilities.put(h as never);
    await enqueueSync("held_liabilities", h.id, "upsert", {
      id: h.id,
      owner: h.owner,
      amount_poisha: poisha,
      hold_date: h.holdDate,
      purpose: h.purpose,
      status_smallint: 1,
    });
    setOwner("");
    setAmount("");
    setPurpose("");
    load();
  }

  async function markReturned(id: string) {
    const now = new Date().toISOString();
    await getDb().heldLiabilities.update(id, {
      status: HELD_STATUS.RETURNED,
      returnDate: now.slice(0, 10),
      updatedAt: now,
    });
    await enqueueSync("held_liabilities", id, "upsert", {
      id,
      status_smallint: 2,
      return_date: now.slice(0, 10),
    });
    load();
  }

  return (
    <AppShell title={t("title")}>
      <p className="text-sm text-muted-foreground mb-4">
        {t("description")}
      </p>
      <div className="space-y-4">
        <Card>
          <CardContent className="pt-4 space-y-3">
            <div className="space-y-2">
              <Label>{t("owner")}</Label>
              <Input value={owner} onChange={(e) => setOwner(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>{t("amountLabel", { currency: currencyCode })}</Label>
              <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>{t("purpose")}</Label>
              <Input value={purpose} onChange={(e) => setPurpose(e.target.value)} />
            </div>
            <Button onClick={addHeld} className="w-full">{t("recordHeldMoney")}</Button>
          </CardContent>
        </Card>
        {items.map((h) => (
          <Card key={h.id}>
            <CardContent className="py-4 space-y-2">
              <div className="flex justify-between">
                <div>
                  <p className="font-medium">{h.owner}</p>
                  <p className="text-xs text-muted-foreground">{h.purpose}</p>
                </div>
                <p className="font-semibold text-warning">{format(h.amountPoisha)}</p>
              </div>
              {h.status === HELD_STATUS.ACTIVE && (
                <Button size="sm" variant="outline" onClick={() => markReturned(h.id)}>
                  {t("markReturned")}
                </Button>
              )}
              {h.status === HELD_STATUS.RETURNED && (
                <p className="text-xs text-muted-foreground">{t("returnedOn", { date: h.returnDate ?? "" })}</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </AppShell>
  );
}
