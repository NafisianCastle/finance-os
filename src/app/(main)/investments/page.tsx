"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useAppStore } from "@/store/app-store";
import { formatMoney, bdtToPoisha, poishaToBdt } from "@/lib/money";
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
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
} from "recharts";
import { startOfMonth, endOfMonth, subMonths, parseISO, isWithinInterval } from "date-fns";

const TYPES = [
  { v: INVESTMENT_TYPE.DPS, l: "DPS" },
  { v: INVESTMENT_TYPE.FDR, l: "FDR" },
  { v: INVESTMENT_TYPE.STOCKS, l: "Stocks" },
  { v: INVESTMENT_TYPE.MUTUAL_FUND, l: "Mutual fund" },
  { v: INVESTMENT_TYPE.BUSINESS, l: "Business / Investor project" },
  { v: INVESTMENT_TYPE.GOLD, l: "Gold" },
  { v: INVESTMENT_TYPE.OTHER, l: "Other" },
];

const TYPE_LABELS: Record<number, string> = {
  [INVESTMENT_TYPE.DPS]: "DPS",
  [INVESTMENT_TYPE.FDR]: "FDR",
  [INVESTMENT_TYPE.STOCKS]: "Stocks",
  [INVESTMENT_TYPE.MUTUAL_FUND]: "Mutual Fund",
  [INVESTMENT_TYPE.GOLD]: "Gold",
  [INVESTMENT_TYPE.BUSINESS]: "Business",
  [INVESTMENT_TYPE.OTHER]: "Other",
};

const PIE_COLORS = [
  "#10b981", "#3b82f6", "#f59e0b", "#ef4444",
  "#8b5cf6", "#ec4899", "#06b6d4", "#84cc16",
];

const UNIT_TYPES = new Set<number>([INVESTMENT_TYPE.STOCKS, INVESTMENT_TYPE.MUTUAL_FUND]);
const UNIT_LABEL: Record<number, string> = {
  [INVESTMENT_TYPE.STOCKS]: "Shares",
  [INVESTMENT_TYPE.MUTUAL_FUND]: "Units",
};
const RATE_TYPES = new Set<number>([INVESTMENT_TYPE.DPS, INVESTMENT_TYPE.FDR]);
const GOLD_TYPES = new Set<number>([INVESTMENT_TYPE.GOLD]);
const PURITY_OPTIONS = ["18k", "21k", "22k", "24k"];

const STATUS_LABEL: Record<number, string> = {
  [INVESTMENT_STATUS.ACTIVE]: "Active",
  [INVESTMENT_STATUS.COMPLETED]: "Completed",
  [INVESTMENT_STATUS.LOSS]: "Loss",
};

type AnalyticsTab = "allocation" | "performers" | "income";

export default function InvestmentsPage() {
  const userId = useAppStore((s) => s.userId);
  const [rows, setRows] = useState<Awaited<ReturnType<typeof loadInvestmentsWithEvents>>>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [analyticsTab, setAnalyticsTab] = useState<AnalyticsTab>("allocation");

  const [name, setName] = useState("");
  const [investor, setInvestor] = useState("");
  const [invested, setInvested] = useState("");
  const [declaredProfit, setDeclaredProfit] = useState("");
  const [declaredProfitMode, setDeclaredProfitMode] = useState<"amount" | "percent">("amount");
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState("");
  const [type, setType] = useState<number>(INVESTMENT_TYPE.BUSINESS);
  const [quantity, setQuantity] = useState("");
  const [pricePerUnit, setPricePerUnit] = useState("");
  const [interestRatePct, setInterestRatePct] = useState("");
  const [purity, setPurity] = useState("22k");

  const [eventType, setEventType] = useState<number>(INVESTMENT_EVENT_TYPE.CAPITAL_RETURN);
  const [eventAmount, setEventAmount] = useState("");
  const [eventAmountMode, setEventAmountMode] = useState<"amount" | "percent">("amount");
  const [eventDate, setEventDate] = useState(new Date().toISOString().slice(0, 10));

  async function load() {
    if (!userId) return;
    setRows(await loadInvestmentsWithEvents(userId));
  }

  useEffect(() => { load(); }, [userId]);

  async function handleCreate() {
    if (!userId || !name) return;
    const isUnitType = UNIT_TYPES.has(type);
    const quantityNum = quantity ? parseFloat(quantity) : undefined;
    const pricePerUnitPoisha = pricePerUnit ? bdtToPoisha(parseFloat(pricePerUnit)) : undefined;
    const investedPoisha =
      isUnitType && quantityNum && pricePerUnitPoisha
        ? Math.round(quantityNum * pricePerUnitPoisha)
        : bdtToPoisha(parseFloat(invested) || 0);
    const declaredProfitPoisha = declaredProfit
      ? declaredProfitMode === "percent"
        ? Math.round(investedPoisha * (parseFloat(declaredProfit) / 100))
        : bdtToPoisha(parseFloat(declaredProfit))
      : undefined;
    await createInvestment(userId, {
      type,
      name,
      investorName: investor || undefined,
      investedPoisha,
      declaredProfitPoisha,
      projectStartDate: startDate,
      projectEndDate: endDate || undefined,
      quantity: quantityNum,
      pricePerUnitPoisha: isUnitType ? pricePerUnitPoisha : undefined,
      interestRatePct: RATE_TYPES.has(type) && interestRatePct ? parseFloat(interestRatePct) : undefined,
      purity: GOLD_TYPES.has(type) ? purity : undefined,
    });
    setName(""); setInvestor(""); setInvested(""); setDeclaredProfit(""); setDeclaredProfitMode("amount"); setEndDate("");
    setQuantity(""); setPricePerUnit(""); setInterestRatePct("");
    load();
  }

  async function handleAddEvent(investmentId: string, investedPoisha: number) {
    if (!userId || !eventAmount) return;
    const amountPoisha =
      eventType === INVESTMENT_EVENT_TYPE.PROFIT_DECLARED && eventAmountMode === "percent"
        ? Math.round(investedPoisha * (parseFloat(eventAmount) / 100))
        : bdtToPoisha(parseFloat(eventAmount) || 0);
    await addInvestmentEvent(userId, investmentId, {
      type: eventType,
      amountPoisha,
      eventDate,
    });
    setEventAmount("");
    setEventAmountMode("amount");
    load();
  }

  const portfolioTotal = rows.reduce((s, r) => s + r.metrics.effectiveValuePoisha, 0);
  const totalReturn = rows.reduce((s, r) => s + r.metrics.totalReturnPoisha, 0);

  // Allocation pie data
  const allocationMap: Record<string, number> = {};
  for (const { investment: inv, metrics: m } of rows) {
    const label = TYPE_LABELS[inv.type] ?? "Other";
    allocationMap[label] = (allocationMap[label] ?? 0) + m.effectiveValuePoisha;
  }
  const allocationData = Object.entries(allocationMap)
    .filter(([, v]) => v > 0)
    .map(([name, value]) => ({ name, value }));

  // Best/worst performers by ROI
  const ranked = [...rows]
    .filter((r) => r.metrics.investedPoisha > 0)
    .sort((a, b) => b.metrics.roiPct - a.metrics.roiPct);
  const best = ranked.slice(0, 3);
  const worst = ranked.length > 3 ? ranked.slice(-3).reverse() : [];

  // Passive income trend — last 6 months profit received
  const passiveTrend: { month: string; profit: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const start = startOfMonth(subMonths(new Date(), i));
    const end = endOfMonth(subMonths(new Date(), i));
    let profit = 0;
    for (const { events } of rows) {
      for (const ev of events) {
        if (ev.type !== INVESTMENT_EVENT_TYPE.PROFIT_RECEIVED) continue;
        const d = parseISO(ev.eventDate);
        if (isWithinInterval(d, { start, end })) profit += ev.amountPoisha;
      }
    }
    passiveTrend.push({ month: start.toLocaleString("en", { month: "short" }), profit });
  }
  const totalPassive6m = passiveTrend.reduce((s, m) => s + m.profit, 0);

  return (
    <AppShell title="Investments">
      <div className="space-y-4">
        {/* Summary */}
        <Card>
          <CardContent className="py-4 grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs text-muted-foreground">Portfolio value</p>
              <p className="text-xl font-bold">{formatMoney(portfolioTotal)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Total return</p>
              <p className={`text-xl font-bold ${totalReturn >= 0 ? "text-primary" : "text-destructive"}`}>
                {totalReturn >= 0 ? "+" : ""}{formatMoney(totalReturn)}
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Portfolio analytics */}
        {rows.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Portfolio analytics</CardTitle>
              <div className="flex gap-1 mt-1">
                {(["allocation", "performers", "income"] as AnalyticsTab[]).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setAnalyticsTab(tab)}
                    className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                      analyticsTab === tab
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {tab === "allocation" ? "Allocation" : tab === "performers" ? "Performers" : "Passive income"}
                  </button>
                ))}
              </div>
            </CardHeader>
            <CardContent>
              {analyticsTab === "allocation" && (
                <div>
                  {allocationData.length > 0 ? (
                    <>
                      <ResponsiveContainer width="100%" height={180}>
                        <PieChart>
                          <Pie
                            data={allocationData}
                            dataKey="value"
                            nameKey="name"
                            cx="50%"
                            cy="50%"
                            outerRadius={70}
                            label={({ name, percent }) =>
                              percent > 0.05 ? `${name} ${(percent * 100).toFixed(0)}%` : ""
                            }
                            labelLine={false}
                          >
                            {allocationData.map((_, i) => (
                              <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                            ))}
                          </Pie>
                          <Tooltip formatter={(v: number) => formatMoney(v)} />
                        </PieChart>
                      </ResponsiveContainer>
                      <ul className="mt-2 space-y-1">
                        {allocationData.map((d, i) => (
                          <li key={d.name} className="flex justify-between text-xs">
                            <span className="flex items-center gap-1.5">
                              <span
                                className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                                style={{ background: PIE_COLORS[i % PIE_COLORS.length] }}
                              />
                              {d.name}
                            </span>
                            <span className="text-muted-foreground">{formatMoney(d.value)}</span>
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground py-4 text-center">No active allocation data</p>
                  )}
                </div>
              )}

              {analyticsTab === "performers" && (
                <div className="space-y-4">
                  {best.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-primary mb-2">Best performers</p>
                      {best.map(({ investment: inv, metrics: m }) => (
                        <div key={inv.id} className="flex justify-between items-center py-1.5 border-b border-border last:border-0">
                          <div>
                            <p className="text-sm font-medium truncate max-w-[180px]">{inv.name}</p>
                            <p className="text-xs text-muted-foreground">{TYPE_LABELS[inv.type]}</p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className={`text-sm font-semibold ${m.roiPct < 0 ? "text-destructive" : "text-primary"}`}>
                              {m.roiPct >= 0 ? "+" : ""}{m.roiPct.toFixed(1)}%
                            </p>
                            <p className="text-xs text-muted-foreground">{formatMoney(m.totalReturnPoisha)}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {worst.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-destructive mb-2">Worst performers</p>
                      {worst.map(({ investment: inv, metrics: m }) => (
                        <div key={inv.id} className="flex justify-between items-center py-1.5 border-b border-border last:border-0">
                          <div>
                            <p className="text-sm font-medium truncate max-w-[180px]">{inv.name}</p>
                            <p className="text-xs text-muted-foreground">{TYPE_LABELS[inv.type]}</p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className={`text-sm font-semibold ${m.roiPct < 0 ? "text-destructive" : "text-muted-foreground"}`}>
                              {m.roiPct >= 0 ? "+" : ""}{m.roiPct.toFixed(1)}%
                            </p>
                            <p className="text-xs text-muted-foreground">{formatMoney(m.totalReturnPoisha)}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {ranked.length === 0 && (
                    <p className="text-sm text-muted-foreground py-4 text-center">No performance data yet</p>
                  )}
                </div>
              )}

              {analyticsTab === "income" && (
                <div>
                  <div className="flex justify-between items-baseline mb-3">
                    <p className="text-xs text-muted-foreground">Last 6 months</p>
                    <p className="text-sm font-semibold text-primary">{formatMoney(totalPassive6m)}</p>
                  </div>
                  <ResponsiveContainer width="100%" height={140}>
                    <BarChart data={passiveTrend} barSize={20}>
                      <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                      <YAxis
                        tickFormatter={(v) => `৳${(poishaToBdt(v as number) / 1000).toFixed(0)}k`}
                        tick={{ fontSize: 10 }}
                        width={40}
                      />
                      <Tooltip formatter={(v: number) => formatMoney(v)} />
                      <Bar dataKey="profit" fill="#10b981" radius={[4, 4, 0, 0]} name="Profit received" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* New investment form */}
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
                {TYPES.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}
              </select>
            </div>
            {UNIT_TYPES.has(type) && (
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-2">
                  <Label>{UNIT_LABEL[type]}</Label>
                  <Input type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="e.g. 100" />
                </div>
                <div className="space-y-2">
                  <Label>Price per unit (BDT)</Label>
                  <Input type="number" value={pricePerUnit} onChange={(e) => setPricePerUnit(e.target.value)} />
                </div>
              </div>
            )}

            {GOLD_TYPES.has(type) && (
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-2">
                  <Label>Weight (grams)</Label>
                  <Input type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="e.g. 10" />
                </div>
                <div className="space-y-2">
                  <Label>Purity</Label>
                  <select
                    className="flex h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
                    value={purity}
                    onChange={(e) => setPurity(e.target.value)}
                  >
                    {PURITY_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
              </div>
            )}

            {RATE_TYPES.has(type) && (
              <div className="space-y-2">
                <Label>Interest / profit rate (% per year)</Label>
                <Input type="number" value={interestRatePct} onChange={(e) => setInterestRatePct(e.target.value)} placeholder="e.g. 8.5" />
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-2">
                <Label>Capital invested (BDT)</Label>
                {UNIT_TYPES.has(type) ? (
                  <Input
                    type="number"
                    value={
                      quantity && pricePerUnit
                        ? (parseFloat(quantity) * parseFloat(pricePerUnit)).toFixed(2)
                        : ""
                    }
                    disabled
                    placeholder="Auto from qty × price"
                  />
                ) : (
                  <Input type="number" value={invested} onChange={(e) => setInvested(e.target.value)} />
                )}
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Declared profit</Label>
                  <div className="flex rounded-full bg-muted p-0.5 text-xs">
                    {(["amount", "percent"] as const).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setDeclaredProfitMode(mode)}
                        className={`px-2 py-0.5 rounded-full font-medium transition-colors ${
                          declaredProfitMode === mode
                            ? "bg-primary text-primary-foreground"
                            : "text-muted-foreground"
                        }`}
                      >
                        {mode === "amount" ? "Tk" : "%"}
                      </button>
                    ))}
                  </div>
                </div>
                <Input
                  type="number"
                  value={declaredProfit}
                  onChange={(e) => setDeclaredProfit(e.target.value)}
                  placeholder={declaredProfitMode === "percent" ? "e.g. 12 (% of invested)" : "Optional"}
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
            <Button onClick={handleCreate} className="w-full">Add investment</Button>
          </CardContent>
        </Card>

        {/* Investment list */}
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
                    {inv.investorName && <p className="text-xs text-muted-foreground">{inv.investorName}</p>}
                    <p className="text-xs text-muted-foreground mt-1">
                      {inv.projectStartDate}{inv.projectEndDate ? ` → ${inv.projectEndDate}` : ""}
                    </p>
                    {(inv.quantity || inv.interestRatePct || inv.purity) && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {inv.quantity && `${inv.quantity} ${UNIT_LABEL[inv.type] ?? "g"}`}
                        {inv.purity && ` · ${inv.purity}`}
                        {inv.interestRatePct && ` · ${inv.interestRatePct}%/yr`}
                      </p>
                    )}
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
                    {m.totalReturnPoisha >= 0 ? "+" : ""}{formatMoney(m.totalReturnPoisha)}
                  </strong>
                </span>
                <span>ROI {m.roiPct.toFixed(1)}%</span>
              </div>
              {m.declaredVsActualPoisha !== null && (
                <p className="text-xs text-muted-foreground">
                  vs declared profit: {m.declaredVsActualPoisha >= 0 ? "+" : ""}
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
                            <span>{INVESTMENT_EVENT_LABELS[e.type]} · {e.eventDate}</span>
                            <span>{formatMoney(e.amountPoisha)}</span>
                          </li>
                        ))}
                    </ul>
                  )}
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium">Record cashflow</p>
                    {eventType === INVESTMENT_EVENT_TYPE.PROFIT_DECLARED && (
                      <div className="flex rounded-full bg-muted p-0.5 text-xs">
                        {(["amount", "percent"] as const).map((mode) => (
                          <button
                            key={mode}
                            type="button"
                            onClick={() => setEventAmountMode(mode)}
                            className={`px-2 py-0.5 rounded-full font-medium transition-colors ${
                              eventAmountMode === mode
                                ? "bg-primary text-primary-foreground"
                                : "text-muted-foreground"
                            }`}
                          >
                            {mode === "amount" ? "Tk" : "%"}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <select
                    className="flex h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
                    value={eventType}
                    onChange={(e) => {
                      setEventType(Number(e.target.value));
                      setEventAmountMode("amount");
                    }}
                  >
                    {Object.entries(INVESTMENT_EVENT_LABELS).map(([k, label]) => (
                      <option key={k} value={k}>{label}</option>
                    ))}
                  </select>
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      type="number"
                      placeholder={
                        eventType === INVESTMENT_EVENT_TYPE.PROFIT_DECLARED && eventAmountMode === "percent"
                          ? "e.g. 12 (% of invested)"
                          : "Amount BDT"
                      }
                      value={eventAmount}
                      onChange={(e) => setEventAmount(e.target.value)}
                    />
                    <Input type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} />
                  </div>
                  <Button size="sm" className="w-full" onClick={() => handleAddEvent(inv.id, m.investedPoisha)}>
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
