"use client";

import { useEffect, useState } from "react";
import { v4 as uuid } from "uuid";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { useAppStore } from "@/store/app-store";
import { getDb } from "@/infrastructure/db/dexie/database";
import { formatMoney, bdtToPoisha } from "@/lib/money";
import type { Investment } from "@/infrastructure/db/dexie/schema";
import { enqueueSync } from "@/infrastructure/sync/sync-queue";

const TYPES = [
  { v: 1, l: "DPS" },
  { v: 2, l: "FDR" },
  { v: 3, l: "Stocks" },
  { v: 4, l: "Mutual fund" },
  { v: 5, l: "Gold" },
  { v: 9, l: "Other" },
];

export default function InvestmentsPage() {
  const userId = useAppStore((s) => s.userId);
  const [items, setItems] = useState<Investment[]>([]);
  const [name, setName] = useState("");
  const [invested, setInvested] = useState("");
  const [current, setCurrent] = useState("");
  const [type, setType] = useState(1);

  async function load() {
    if (!userId) return;
    setItems(
      await getDb().investments.where("userId").equals(userId).filter((i) => !i.deletedAt).toArray()
    );
  }

  useEffect(() => {
    load();
  }, [userId]);

  async function add() {
    if (!userId) return;
    const inv = bdtToPoisha(parseFloat(invested) || 0);
    const cur = bdtToPoisha(parseFloat(current) || parseFloat(invested) || 0);
    const now = new Date().toISOString();
    const rec: Investment = {
      id: uuid(),
      userId,
      type,
      name,
      investedPoisha: inv,
      currentValuePoisha: cur,
      startDate: now.slice(0, 10),
      createdAt: now,
      updatedAt: now,
    };
    await getDb().investments.add(rec);
    await enqueueSync("investments", rec.id, "upsert", {
      id: rec.id,
      type_smallint: type,
      name: rec.name,
      invested_poisha: inv,
      current_value_poisha: cur,
      start_date: rec.startDate,
    });
    setName("");
    setInvested("");
    setCurrent("");
    load();
  }

  const total = items.reduce((s, i) => s + i.currentValuePoisha, 0);

  return (
    <AppShell title="Investments">
      <Card className="mb-4">
        <CardContent className="py-4">
          <p className="text-sm text-muted-foreground">Portfolio value</p>
          <p className="text-2xl font-bold">{formatMoney(total)}</p>
        </CardContent>
      </Card>
      <div className="space-y-4">
        <Card>
          <CardContent className="pt-4 space-y-3">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Type</Label>
              <select
                className="flex h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
                value={type}
                onChange={(e) => setType(Number(e.target.value))}
              >
                {TYPES.map((t) => (
                  <option key={t.v} value={t.v}>{t.l}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label>Invested (BDT)</Label>
              <Input type="number" value={invested} onChange={(e) => setInvested(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Current value (BDT)</Label>
              <Input type="number" value={current} onChange={(e) => setCurrent(e.target.value)} />
            </div>
            <Button onClick={add} className="w-full">Add investment</Button>
          </CardContent>
        </Card>
        {items.map((i) => {
          const roi = i.investedPoisha > 0
            ? (((i.currentValuePoisha - i.investedPoisha) / i.investedPoisha) * 100).toFixed(1)
            : "0";
          return (
            <Card key={i.id}>
              <CardContent className="flex justify-between py-4">
                <div>
                  <p className="font-medium">{i.name}</p>
                  <p className="text-xs text-muted-foreground">ROI {roi}%</p>
                </div>
                <p className="font-semibold">{formatMoney(i.currentValuePoisha)}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </AppShell>
  );
}
