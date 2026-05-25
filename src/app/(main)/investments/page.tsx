"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useAppStore } from "@/store/app-store";
import { formatMoney, bdtToPoisha } from "@/lib/money";
import {
  INVESTMENT_TYPE,
  INVESTMENT_STATUS,
  INVESTMENT_EVENT_TYPE,
  INVESTMENT_EVENT_LABELS,
} from "@/lib/investment-constants";
import {
  loadInvestmentsWithEvents,
  createInvestment,
  addInvestmentEvent,
} from "@/application/investments";

const TYPES = [
  { v: INVESTMENT_TYPE.DPS, l: "DPS" },
  { v: INVESTMENT_TYPE.FDR, l: "FDR" },
  { v: INVESTMENT_TYPE.STOCKS, l: "Stocks" },
  { v: INVESTMENT_TYPE.MUTUAL_FUND, l: "Mutual fund" },
  { v: INVESTMENT_TYPE.BUSINESS, l: "Business / Investor project" },
  { v: INVESTMENT_TYPE.GOLD, l: "Gold" },
  { v: INVESTMENT_TYPE.OTHER, l: "Other" },
];

const STATUS_LABEL: Record<number, string> = {
  [INVESTMENT_STATUS.ACTIVE]: "Active",
  [INVESTMENT_STATUS.COMPLETED]: "Completed",
  [INVESTMENT_STATUS.LOSS]: "Loss",
};

export default function InvestmentsPage() {
  const userId = useAppStore((s) => s.userId);
  const [rows, setRows] = useState<
    Awaited<ReturnType<typeof loadInvestmentsWithEvents>>
  >([]);
  const [expanded, setExpanded] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [investor, setInvestor] = useState("");
  const [invested, setInvested] = useState("");
  const [declaredProfit, setDeclaredProfit] = useState("");
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState("");
  const [type, setType] = useState(INVESTMENT_TYPE.BUSINESS);

  const [eventType, setEventType] = useState(INVESTMENT_EVENT_TYPE.CAPITAL_RETURN);
  const [eventAmount, setEventAmount] = useState("");
  const [eventDate, setEventDate] = useState(new Date().toISOString().slice(0, 10));

  async function load() {
    if (!userId) return;
    setRows(await loadInvestmentsWithEvents(userId));
  }

  useEffect(() => {
    load();
  }, [userId]);

  async function handleCreate() {
    if (!userId || !name) return;
    await createInvestment(userId, {
      type,
      name,
      investorName: investor || undefined,
      investedPoisha: bdtToPoisha(parseFloat(invested) || 0),
      declaredProfitPoisha: declaredProfit
        ? bdtToPoisha(parseFloat(declaredProfit))
        : undefined,
      projectStartDate: startDate,
      projectEndDate: endDate || undefined,
    });
    setName("");
    setInvestor("");
    setInvested("");
    setDeclaredProfit("");
    setEndDate("");
    load();
  }

  async function handleAddEvent(investmentId: string) {
    if (!userId || !eventAmount) return;
    await addInvestmentEvent(userId, investmentId, {
      type: eventType,
      amountPoisha: bdtToPoisha(parseFloat(eventAmount) || 0),
      eventDate,
    });
    setEventAmount("");
    load();
  }

  const portfolioTotal = rows.reduce((s, r) => s + r.metrics.effectiveValuePoisha, 0);
  const totalReturn = rows.reduce((s, r) => s + r.metrics.totalReturnPoisha, 0);

  return (
    <AppShell title="Investments">
      <div className="space-y-4">
        <Card>
          <CardContent className="py-4 grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs text-muted-foreground">Portfolio value</p>
              <p className="text-xl font-bold">{formatMoney(portfolioTotal)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Total return</p>
              <p
                className={`text-xl font-bold ${totalReturn >= 0 ? "text-primary" : "text-destructive"}`}
              >
                {totalReturn >= 0 ? "+" : ""}
                {formatMoney(totalReturn)}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">New investment</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <Label>Project / asset name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Shop expansion" />
            </div>
            <div className="space-y-2">
              <Label>Investor name (optional)</Label>
              <Input value={investor} onChange={(e) => setInvestor(e.target.value)} placeholder="Rahim Ventures" />
            </div>
            <div className="space-y-2">
              <Label>Type</Label>
              <select
                className="flex h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
                value={type}
                onChange={(e) => setType(Number(e.target.value))}
              >
                {TYPES.map((t) => (
                  <option key={t.v} value={t.v}>
                    {t.l}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-2">
                <Label>Capital invested (BDT)</Label>
                <Input type="number" value={invested} onChange={(e) => setInvested(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Declared profit (BDT)</Label>
                <Input
                  type="number"
                  value={declaredProfit}
                  onChange={(e) => setDeclaredProfit(e.target.value)}
                  placeholder="Profit promised upfront"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-2">
                <Label>Project start</Label>
                <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Project end</Label>
                <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Declared profit is what the investor promises upfront — used to compare with actual profit received.
            </p>
            <Button onClick={handleCreate} className="w-full">
              Add investment
            </Button>
          </CardContent>
        </Card>

        {rows.map(({ investment: inv, metrics: m, events }) => (
          <Card key={inv.id} className={m.isLoss ? "border-destructive/40" : ""}>
            <CardContent className="pt-4 space-y-3">
              <button
                type="button"
                className="w-full text-left"
                onClick={() => setExpanded(expanded === inv.id ? null : inv.id)}
              >
                <div className="flex justify-between items-start gap-2">
                  <div>
                    <p className="font-medium">{inv.name}</p>
                    {inv.investorName && (
                      <p className="text-xs text-muted-foreground">{inv.investorName}</p>
                    )}
                    <p className="text-xs text-muted-foreground mt-1">
                      {inv.projectStartDate}
                      {inv.projectEndDate ? ` → ${inv.projectEndDate}` : ""}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <Badge variant={m.isLoss ? "destructive" : "secondary"}>
                      {STATUS_LABEL[inv.status] ?? "Active"}
                    </Badge>
                    <p className="font-semibold mt-1">{formatMoney(m.effectiveValuePoisha)}</p>
                  </div>
                </div>
              </button>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-md bg-muted p-2">
                  <p className="text-muted-foreground">Invested</p>
                  <p className="font-medium">{formatMoney(m.investedPoisha)}</p>
                </div>
                <div className="rounded-md bg-muted p-2">
                  <p className="text-muted-foreground">Declared profit</p>
                  <p className="font-medium">{formatMoney(m.declaredProfitPoisha)}</p>
                </div>
                <div className="rounded-md bg-muted p-2">
                  <p className="text-muted-foreground">Capital returned</p>
                  <p className="font-medium">{formatMoney(m.capitalReturnedPoisha)}</p>
                </div>
                <div className="rounded-md bg-muted p-2">
                  <p className="text-muted-foreground">Profit received</p>
                  <p className="font-medium">{formatMoney(m.profitReceivedPoisha)}</p>
                </div>
                <div className="rounded-md bg-muted p-2">
                  <p className="text-muted-foreground">Remaining capital</p>
                  <p className="font-medium">{formatMoney(m.remainingCapitalPoisha)}</p>
                </div>
                <div className="rounded-md bg-muted p-2">
                  <p className="text-muted-foreground">Loss</p>
                  <p className="font-medium text-destructive">{formatMoney(m.lossPoisha)}</p>
                </div>
              </div>

              <div className="flex justify-between text-sm border-t border-border pt-2">
                <span>
                  Total return:{" "}
                  <strong className={m.totalReturnPoisha >= 0 ? "text-primary" : "text-destructive"}>
                    {m.totalReturnPoisha >= 0 ? "+" : ""}
                    {formatMoney(m.totalReturnPoisha)}
                  </strong>
                </span>
                <span>ROI {m.roiPct.toFixed(1)}%</span>
              </div>
              {m.declaredVsActualPoisha !== null && (
                <p className="text-xs text-muted-foreground">
                  vs declared profit:{" "}
                  {m.declaredVsActualPoisha >= 0 ? "+" : ""}
                  {formatMoney(m.declaredVsActualPoisha)} (
                  {m.profitReceivedPoisha >= m.declaredProfitPoisha ? "on track" : "below declared"})
                </p>
              )}

              {expanded === inv.id && (
                <div className="space-y-3 border-t border-border pt-3">
                  {events.length > 0 && (
                    <ul className="text-xs space-y-1 text-muted-foreground">
                      {events
                        .slice()
                        .sort((a, b) => b.eventDate.localeCompare(a.eventDate))
                        .map((e) => (
                          <li key={e.id} className="flex justify-between">
                            <span>
                              {INVESTMENT_EVENT_LABELS[e.type]} · {e.eventDate}
                            </span>
                            <span>{formatMoney(e.amountPoisha)}</span>
                          </li>
                        ))}
                    </ul>
                  )}
                  <p className="text-sm font-medium">Record cashflow</p>
                  <select
                    className="flex h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
                    value={eventType}
                    onChange={(e) => setEventType(Number(e.target.value))}
                  >
                    {Object.entries(INVESTMENT_EVENT_LABELS).map(([k, label]) => (
                      <option key={k} value={k}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      type="number"
                      placeholder="Amount BDT"
                      value={eventAmount}
                      onChange={(e) => setEventAmount(e.target.value)}
                    />
                    <Input type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} />
                  </div>
                  <Button size="sm" className="w-full" onClick={() => handleAddEvent(inv.id)}>
                    Add {INVESTMENT_EVENT_LABELS[eventType]}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </AppShell>
  );
}
