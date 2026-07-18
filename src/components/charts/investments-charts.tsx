"use client";

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, BarChart, Bar, XAxis, YAxis } from "recharts";

const PIE_COLORS = [
  "#10b981", "#3b82f6", "#f59e0b", "#ef4444",
  "#8b5cf6", "#ec4899", "#06b6d4", "#84cc16",
];

export function AllocationPieChart({
  data,
  format,
}: {
  data: { name: string; value: number }[];
  format: (minorUnits: number) => string;
}) {
  return (
    <ResponsiveContainer width="100%" height={180}>
      <PieChart>
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          cx="50%"
          cy="50%"
          outerRadius={70}
          label={({ name, percent }) => (percent > 0.05 ? `${name} ${(percent * 100).toFixed(0)}%` : "")}
          labelLine={false}
        >
          {data.map((_, i) => (
            <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
          ))}
        </Pie>
        <Tooltip formatter={(v: number) => format(v)} />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function PassiveTrendChart({
  data,
  format,
  formatCompact,
  profitLabel,
}: {
  data: { month: string; profit: number }[];
  format: (minorUnits: number) => string;
  formatCompact: (minorUnits: number) => string;
  profitLabel: string;
}) {
  return (
    <ResponsiveContainer width="100%" height={140}>
      <BarChart data={data} barSize={20}>
        <XAxis dataKey="month" tick={{ fontSize: 10 }} />
        <YAxis tickFormatter={(v) => formatCompact(v as number)} tick={{ fontSize: 10 }} width={40} />
        <Tooltip formatter={(v: number) => format(v)} />
        <Bar dataKey="profit" fill="#10b981" radius={[4, 4, 0, 0]} name={profitLabel} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export { PIE_COLORS };
