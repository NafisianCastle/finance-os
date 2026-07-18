"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useAppStore } from "@/store/app-store";
import { useCurrencyFormatter } from "@/hooks/use-currency-formatter";
import {
  INVESTMENT_TYPE,
  INVESTMENT_STATUS,
  INVESTMENT_EVENT_TYPE,
} from "@/lib/investment-constants";
import {
  loadInvestmentsWithEvents,
  createInvestment,
  addInvestmentEvent,
} from "@/application/investments";
import dynamic from "next/dynamic";
import { startOfMonth, endOfMonth, subMonths, parseISO, isWithinInterval } from "date-fns";

const AllocationPieChart = dynamic(
  () => import("@/components/charts/investments-charts").then((m) => m.AllocationPieChart),
  { ssr: false }
);
const PassiveTrendChart = dynamic(
  () => import("@/components/charts/investments-charts").then((m) => m.PassiveTrendChart),
  { ssr: false }
);

// Kept in sync with PIE_COLORS in components/charts/investments-charts.tsx —
// duplicated (not imported) so this legend list doesn't pull recharts into
// the page's eager bundle.
const PIE_COLORS = [
  "#10b981", "#3b82f6", "#f59e0b", "#ef4444",
  "#8b5cf6", "#ec4899", "#06b6d4", "#84cc16",
];

const UNIT_TYPES = new Set<number>([INVESTMENT_TYPE.STOCKS, INVESTMENT_TYPE.MUTUAL_FUND]);
const RATE_TYPES = new Set<number>([INVESTMENT_TYPE.DPS, INVESTMENT_TYPE.FDR]);
const GOLD_TYPES = new Set<number>([INVESTMENT_TYPE.GOLD]);
const PURITY_OPTIONS = ["18k", "21k", "22k", "24k"];

type AnalyticsTab = "allocation" | "performers" | "income";

export default function InvestmentsPage() {
  const userId = useAppStore((s) => s.userId);
  const t = useTranslations("Investments");
  const { format, formatCompact, toMinor, currencyCode } = useCurrencyFormatter();

  const TYPES = [
    { v: INVESTMENT_TYPE.DPS, l: t("typeDps") },
    { v: INVESTMENT_TYPE.FDR, l: t("typeFdr") },
    { v: INVESTMENT_TYPE.STOCKS, l: t("typeStocks") },
    { v: INVESTMENT_TYPE.MUTUAL_FUND, l: t("typeMutualFund") },
    { v: INVESTMENT_TYPE.BUSINESS, l: t("typeBusiness") },
    { v: INVESTMENT_TYPE.GOLD, l: t("typeGold") },
    { v: INVESTMENT_TYPE.OTHER, l: t("typeOther") },
  ];

  const TYPE_LABELS: Record<number, string> = {
    [INVESTMENT_TYPE.DPS]: t("typeDps"),
    [INVESTMENT_TYPE.FDR]: t("typeFdr"),
    [INVESTMENT_TYPE.STOCKS]: t("typeStocks"),
    [INVESTMENT_TYPE.MUTUAL_FUND]: t("typeMutualFund"),
    [INVESTMENT_TYPE.GOLD]: t("typeGold"),
    [INVESTMENT_TYPE.BUSINESS]: t("typeBusinessShort"),
    [INVESTMENT_TYPE.OTHER]: t("typeOther"),
  };

  const UNIT_LABEL: Record<number, string> = {
    [INVESTMENT_TYPE.STOCKS]: t("unitShares"),
    [INVESTMENT_TYPE.MUTUAL_FUND]: t("unitUnits"),
  };

  const STATUS_LABEL: Record<number, string> = {
    [INVESTMENT_STATUS.ACTIVE]: t("statusActive"),
    [INVESTMENT_STATUS.COMPLETED]: t("statusCompleted"),
    [INVESTMENT_STATUS.LOSS]: t("statusLoss"),
  };

  const INVESTMENT_EVENT_LABELS: Record<number, string> = {
    [INVESTMENT_EVENT_TYPE.PROFIT_DECLARED]: t("eventDeclaredProfit"),
    [INVESTMENT_EVENT_TYPE.PROFIT_RECEIVED]: t("eventProfitReceived"),
    [INVESTMENT_EVENT_TYPE.CAPITAL_RETURN]: t("eventCapitalReturn"),
    [INVESTMENT_EVENT_TYPE.LOSS]: t("eventLoss"),
  };
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
    const pricePerUnitPoisha = pricePerUnit ? toMinor(parseFloat(pricePerUnit)) : undefined;
    const investedPoisha =
      isUnitType && quantityNum && pricePerUnitPoisha
        ? Math.round(quantityNum * pricePerUnitPoisha)
        : toMinor(parseFloat(invested) || 0);
    const declaredProfitPoisha = declaredProfit
      ? declaredProfitMode === "percent"
        ? Math.round(investedPoisha * (parseFloat(declaredProfit) / 100))
        : toMinor(parseFloat(declaredProfit))
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
        : toMinor(parseFloat(eventAmount) || 0);
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
    const label = TYPE_LABELS[inv.type] ?? t("typeOther");
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
    <AppShell title={t("title")}>
      <div className="space-y-4">
        {/* Summary */}
        <Card>
          <CardContent className="py-4 grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs text-muted-foreground">{t("portfolioValue")}</p>
              <p className="text-xl font-bold">{format(portfolioTotal)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{t("totalReturn")}</p>
              <p className={`text-xl font-bold ${totalReturn >= 0 ? "text-primary" : "text-destructive"}`}>
                {totalReturn >= 0 ? "+" : ""}{format(totalReturn)}
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Portfolio analytics */}
        {rows.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{t("portfolioAnalytics")}</CardTitle>
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
                    {tab === "allocation" ? t("tabAllocation") : tab === "performers" ? t("tabPerformers") : t("tabIncome")}
                  </button>
                ))}
              </div>
            </CardHeader>
            <CardContent>
              {analyticsTab === "allocation" && (
                <div>
                  {allocationData.length > 0 ? (
                    <>
                      <AllocationPieChart data={allocationData} format={format} />
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
                            <span className="text-muted-foreground">{format(d.value)}</span>
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground py-4 text-center">{t("noAllocationData")}</p>
                  )}
                </div>
              )}

              {analyticsTab === "performers" && (
                <div className="space-y-4">
                  {best.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-primary mb-2">{t("bestPerformers")}</p>
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
                            <p className="text-xs text-muted-foreground">{format(m.totalReturnPoisha)}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {worst.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-destructive mb-2">{t("worstPerformers")}</p>
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
                            <p className="text-xs text-muted-foreground">{format(m.totalReturnPoisha)}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {ranked.length === 0 && (
                    <p className="text-sm text-muted-foreground py-4 text-center">{t("noPerformanceData")}</p>
                  )}
                </div>
              )}

              {analyticsTab === "income" && (
                <div>
                  <div className="flex justify-between items-baseline mb-3">
                    <p className="text-xs text-muted-foreground">{t("last6Months")}</p>
                    <p className="text-sm font-semibold text-primary">{format(totalPassive6m)}</p>
                  </div>
                  <PassiveTrendChart
                    data={passiveTrend}
                    format={format}
                    formatCompact={formatCompact}
                    profitLabel={t("profitReceived")}
                  />
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* New investment form */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("newInvestment")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <Label>{t("projectAssetName")}</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("projectNamePlaceholder")} />
            </div>
            <div className="space-y-2">
              <Label>{t("investorNameLabel")}</Label>
              <Input value={investor} onChange={(e) => setInvestor(e.target.value)} placeholder={t("investorNamePlaceholder")} />
            </div>
            <div className="space-y-2">
              <Label>{t("typeLabel")}</Label>
              <select
                className="flex h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
                value={type}
                onChange={(e) => setType(Number(e.target.value))}
              >
                {TYPES.map((opt) => <option key={opt.v} value={opt.v}>{opt.l}</option>)}
              </select>
            </div>
            {UNIT_TYPES.has(type) && (
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-2">
                  <Label>{UNIT_LABEL[type]}</Label>
                  <Input type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder={t("quantityPlaceholder")} />
                </div>
                <div className="space-y-2">
                  <Label>{t("pricePerUnitLabel", { currency: currencyCode })}</Label>
                  <Input type="number" value={pricePerUnit} onChange={(e) => setPricePerUnit(e.target.value)} />
                </div>
              </div>
            )}

            {GOLD_TYPES.has(type) && (
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-2">
                  <Label>{t("weightGramsLabel")}</Label>
                  <Input type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder={t("weightPlaceholder")} />
                </div>
                <div className="space-y-2">
                  <Label>{t("purityLabel")}</Label>
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
                <Label>{t("interestRateLabel")}</Label>
                <Input type="number" value={interestRatePct} onChange={(e) => setInterestRatePct(e.target.value)} placeholder={t("interestRatePlaceholder")} />
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-2">
                <Label>{t("capitalInvestedLabel", { currency: currencyCode })}</Label>
                {UNIT_TYPES.has(type) ? (
                  <Input
                    type="number"
                    value={
                      quantity && pricePerUnit
                        ? (parseFloat(quantity) * parseFloat(pricePerUnit)).toFixed(2)
                        : ""
                    }
                    disabled
                    placeholder={t("autoFromQtyPrice")}
                  />
                ) : (
                  <Input type="number" value={invested} onChange={(e) => setInvested(e.target.value)} />
                )}
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>{t("declaredProfitLabel")}</Label>
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
                        {mode === "amount" ? currencyCode : "%"}
                      </button>
                    ))}
                  </div>
                </div>
                <Input
                  type="number"
                  value={declaredProfit}
                  onChange={(e) => setDeclaredProfit(e.target.value)}
                  placeholder={declaredProfitMode === "percent" ? t("percentOfInvestedPlaceholder") : t("optionalPlaceholder")}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-2">
                <Label>{t("projectStartLabel")}</Label>
                <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>{t("projectEndLabel")}</Label>
                <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </div>
            </div>
            <Button onClick={handleCreate} className="w-full">{t("addInvestment")}</Button>
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
                        {inv.quantity && `${inv.quantity} ${UNIT_LABEL[inv.type] ?? t("gramsUnit")}`}
                        {inv.purity && ` · ${inv.purity}`}
                        {inv.interestRatePct && ` · ${t("ratePerYear", { rate: inv.interestRatePct })}`}
                      </p>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <Badge variant={m.isLoss ? "destructive" : "secondary"}>
                      {STATUS_LABEL[inv.status] ?? t("statusActive")}
                    </Badge>
                    <p className="font-semibold mt-1">{format(m.effectiveValuePoisha)}</p>
                  </div>
                </div>
              </button>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-md bg-muted p-2">
                  <p className="text-muted-foreground">{t("invested")}</p>
                  <p className="font-medium">{format(m.investedPoisha)}</p>
                </div>
                <div className="rounded-md bg-muted p-2">
                  <p className="text-muted-foreground">{t("declaredProfit")}</p>
                  <p className="font-medium">{format(m.declaredProfitPoisha)}</p>
                </div>
                <div className="rounded-md bg-muted p-2">
                  <p className="text-muted-foreground">{t("capitalReturned")}</p>
                  <p className="font-medium">{format(m.capitalReturnedPoisha)}</p>
                </div>
                <div className="rounded-md bg-muted p-2">
                  <p className="text-muted-foreground">{t("profitReceived")}</p>
                  <p className="font-medium">{format(m.profitReceivedPoisha)}</p>
                </div>
                <div className="rounded-md bg-muted p-2">
                  <p className="text-muted-foreground">{t("remainingCapital")}</p>
                  <p className="font-medium">{format(m.remainingCapitalPoisha)}</p>
                </div>
                <div className="rounded-md bg-muted p-2">
                  <p className="text-muted-foreground">{t("loss")}</p>
                  <p className="font-medium text-destructive">{format(m.lossPoisha)}</p>
                </div>
              </div>

              <div className="flex justify-between text-sm border-t border-border pt-2">
                <span>
                  {t("totalReturnColon")}{" "}
                  <strong className={m.totalReturnPoisha >= 0 ? "text-primary" : "text-destructive"}>
                    {m.totalReturnPoisha >= 0 ? "+" : ""}{format(m.totalReturnPoisha)}
                  </strong>
                </span>
                <span>{t("roi", { pct: m.roiPct.toFixed(1) })}</span>
              </div>
              {m.declaredVsActualPoisha !== null && (
                <p className="text-xs text-muted-foreground">
                  {t("vsDeclaredProfit", {
                    sign: m.declaredVsActualPoisha >= 0 ? "+" : "",
                    amount: format(m.declaredVsActualPoisha),
                    status:
                      m.profitReceivedPoisha >= m.declaredProfitPoisha
                        ? t("onTrack")
                        : t("belowDeclared"),
                  })}
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
                            <span>{format(e.amountPoisha)}</span>
                          </li>
                        ))}
                    </ul>
                  )}
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium">{t("recordCashflow")}</p>
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
                            {mode === "amount" ? currencyCode : "%"}
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
                          ? t("percentOfInvestedPlaceholder")
                          : t("amountCurrencyPlaceholder", { currency: currencyCode })
                      }
                      value={eventAmount}
                      onChange={(e) => setEventAmount(e.target.value)}
                    />
                    <Input type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} />
                  </div>
                  <Button size="sm" className="w-full" onClick={() => handleAddEvent(inv.id, m.investedPoisha)}>
                    {t("addEvent", { label: INVESTMENT_EVENT_LABELS[eventType] })}
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
