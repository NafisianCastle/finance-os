"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip,
  Cell,
  LabelList,
} from "recharts";

const CATEGORY_COLORS = [
  "oklch(var(--chart-1))",
  "oklch(var(--chart-2))",
  "oklch(var(--chart-3))",
  "oklch(var(--chart-4))",
  "oklch(var(--chart-5))",
];

export function IncomeExpenseTrendChart({
  data,
  format,
  formatCompact,
}: {
  data: { month: string; income: number; expense: number }[];
  format: (minorUnits: number) => string;
  formatCompact: (minorUnits: number) => string;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data}>
        <XAxis dataKey="month" tick={{ fontSize: 10 }} />
        <YAxis tickFormatter={(v) => formatCompact(v as number)} tick={{ fontSize: 10 }} />
        <Tooltip formatter={(v: number) => format(v)} />
        <Bar dataKey="income" fill="hsl(160 84% 32%)" radius={[4, 4, 0, 0]} />
        <Bar dataKey="expense" fill="hsl(0 72% 51%)" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function SpendBreakdownChart({
  data,
  format,
  otherLabel,
}: {
  data: { name: string; value: number }[];
  format: (minorUnits: number) => string;
  otherLabel: string;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 40, bottom: 0, left: 0 }}>
        <XAxis type="number" hide />
        <YAxis
          type="category"
          dataKey="name"
          width={90}
          tick={{ fontSize: 11 }}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip formatter={(v: number) => format(v)} />
        <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={16}>
          {data.map((entry, i) => (
            <Cell
              key={entry.name}
              fill={
                entry.name === otherLabel
                  ? "oklch(var(--muted-foreground))"
                  : CATEGORY_COLORS[i % CATEGORY_COLORS.length]
              }
            />
          ))}
          <LabelList
            dataKey="value"
            position="right"
            formatter={(v: number) => format(v)}
            style={{ fontSize: 11, fill: "oklch(var(--foreground))" }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function MaturityBreakdownChart({
  data,
  colorFor,
}: {
  data: { name: string; value: number }[];
  colorFor: (score: number) => string;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 32, bottom: 0, left: 0 }}>
        <XAxis type="number" domain={[0, 100]} hide />
        <YAxis
          type="category"
          dataKey="name"
          width={90}
          tick={{ fontSize: 11 }}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip formatter={(v: number) => `${v} / 100`} />
        <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={14}>
          {data.map((entry) => (
            <Cell key={entry.name} fill={colorFor(entry.value)} />
          ))}
          <LabelList
            dataKey="value"
            position="right"
            formatter={(v: number) => `${v}`}
            style={{ fontSize: 11, fill: "oklch(var(--foreground))" }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
