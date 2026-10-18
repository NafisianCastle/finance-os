"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { parseISO } from "date-fns";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AmountInput } from "@/components/ui/amount-input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { SharedChip, SharedToggle } from "@/components/shared-toggle";
import { useAppStore } from "@/store/app-store";
import { useCurrencyFormatter } from "@/hooks/use-currency-formatter";
import type { HeldLiability } from "@/infrastructure/db/dexie/schema";
import { HELD_STATUS } from "@/lib/constants";
import {
  addLiability,
  deleteLiability,
  listLiabilities,
  markLiabilityReturned,
  updateLiability,
} from "@/application/liabilities";
import { Wallet } from "lucide-react";

export default function LiabilitiesPage() {
  const userId = useAppStore((s) => s.userId);
  const groupId = useAppStore((s) => s.groupId);
  const t = useTranslations("Liabilities");
  const locale = useLocale();
  const { toast } = useToast();
  const confirm = useConfirm();
  const { format, toMinor, toMajor, currencyCode } = useCurrencyFormatter();
  const [items, setItems] = useState<HeldLiability[]>([]);
  const [owner, setOwner] = useState("");
  const [amount, setAmount] = useState("");
  const [purpose, setPurpose] = useState("");
  const [shared, setShared] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [returningId, setReturningId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const formatDate = (d: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(parseISO(d));

  async function load() {
    if (!userId) return;
    setItems(await listLiabilities(userId, groupId));
  }

  useEffect(() => {
    const timer = setTimeout(load, 0);
    return () => clearTimeout(timer);
  }, [userId, groupId]);

  function resetForm() {
    setEditingId(null);
    setOwner("");
    setAmount("");
    setPurpose("");
  }

  function startEdit(h: HeldLiability) {
    setEditingId(h.id);
    setOwner(h.owner);
    setAmount(String(toMajor(h.amountPoisha)));
    setPurpose(h.purpose ?? "");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function saveHeld() {
    if (!userId) return;
    if (!owner.trim()) {
      toast(t("enterOwnerError"), "error");
      return;
    }
    const poisha = toMinor(parseFloat(amount) || 0);
    if (poisha <= 0) {
      toast(t("enterAmountError"), "error");
      return;
    }
    setIsAdding(true);
    try {
      const data = { owner: owner.trim(), amountPoisha: poisha, purpose: purpose.trim() || undefined };
      if (editingId) {
        await updateLiability(userId, editingId, data, groupId);
        toast(t("heldUpdated"), "success");
      } else {
        await addLiability(userId, data, shared ? groupId : null);
        toast(t("heldAdded"), "success");
      }
      resetForm();
      await load();
    } catch {
      toast(t("actionFailed"), "error");
    } finally {
      setIsAdding(false);
    }
  }

  async function markReturned(id: string) {
    if (!userId) return;
    setReturningId(id);
    try {
      await markLiabilityReturned(userId, id, groupId);
      await load();
      toast(t("markedReturned"), "success");
    } catch {
      toast(t("actionFailed"), "error");
    } finally {
      setReturningId(null);
    }
  }

  async function removeHeld(h: HeldLiability) {
    if (!userId) return;
    const ok = await confirm({
      title: t("deleteHeldTitle", { name: h.owner }),
      description: t("deleteHeldDescription"),
      confirmLabel: t("delete"),
      variant: "destructive",
    });
    if (!ok) return;
    setDeletingId(h.id);
    try {
      await deleteLiability(userId, h.id, groupId);
      if (editingId === h.id) resetForm();
      await load();
      toast(t("heldDeleted", { name: h.owner }), "success");
    } catch {
      toast(t("actionFailed"), "error");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <AppShell title={t("title")}>
      <p className="text-sm text-muted-foreground mb-4">
        {t("description")}
      </p>
      <div className="space-y-4">
        <Card>
          <CardContent className="pt-4 space-y-3">
            {editingId && <p className="text-sm font-medium">{t("editHeld")}</p>}
            <div className="space-y-2">
              <Label htmlFor="held-owner">{t("owner")}</Label>
              <Input id="held-owner" value={owner} onChange={(e) => setOwner(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="held-amount">{t("amountLabel", { currency: currencyCode })}</Label>
              <AmountInput id="held-amount" value={amount} onChange={setAmount} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="held-purpose">{t("purpose")}</Label>
              <Input id="held-purpose" value={purpose} onChange={(e) => setPurpose(e.target.value)} />
            </div>
            {!editingId && <SharedToggle checked={shared} onChange={setShared} />}
            <div className="flex gap-2">
              <Button onClick={saveHeld} className="flex-1" loading={isAdding}>
                {editingId ? t("save") : t("recordHeldMoney")}
              </Button>
              {editingId && (
                <Button variant="ghost" onClick={resetForm}>
                  {t("cancel")}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
        {items.length === 0 && (
          <EmptyState icon={Wallet} title={t("emptyTitle")} description={t("emptyDescription")} />
        )}
        {items.map((h) => (
          <Card key={h.id}>
            <CardContent className="py-4 space-y-2">
              <div className="flex justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <p className="truncate font-medium">{h.owner}</p>
                    <SharedChip groupId={h.groupId} />
                  </div>
                  {h.purpose && <p className="truncate text-xs text-muted-foreground">{h.purpose}</p>}
                  {h.status === HELD_STATUS.ACTIVE && h.holdDate && (
                    <p className="text-xs text-muted-foreground">{t("heldSince", { date: formatDate(h.holdDate) })}</p>
                  )}
                </div>
                <p className="shrink-0 font-semibold text-warning">{format(h.amountPoisha)}</p>
              </div>
              {h.status === HELD_STATUS.RETURNED && (
                <p className="text-xs text-muted-foreground">
                  {t("returnedOn", { date: h.returnDate ? formatDate(h.returnDate) : "" })}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                {h.status === HELD_STATUS.ACTIVE && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => markReturned(h.id)}
                    loading={returningId === h.id}
                  >
                    {t("markReturned")}
                  </Button>
                )}
                <Button size="sm" variant="outline" onClick={() => startEdit(h)}>
                  {t("edit")}
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => removeHeld(h)}
                  loading={deletingId === h.id}
                >
                  {t("delete")}
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </AppShell>
  );
}
