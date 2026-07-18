"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";

/** Upper bound for a single money amount (BDT). Keeps totals/displays from overflowing the UI. */
export const MAX_AMOUNT = 999_999_999_999.99;

function sanitizeAmount(raw: string, max: number): string {
  if (raw === "") return "";
  const num = Number(raw);
  if (Number.isNaN(num)) return "";
  if (num < 0) return "0";
  if (num > max) return String(max);
  return raw;
}

type AmountInputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "onChange" | "value"> & {
  value: string;
  onChange: (value: string) => void;
  max?: number;
};

export const AmountInput = React.forwardRef<HTMLInputElement, AmountInputProps>(
  ({ value, onChange, max = MAX_AMOUNT, ...props }, ref) => (
    <Input
      ref={ref}
      type="number"
      inputMode="decimal"
      min={0}
      max={max}
      step="0.01"
      value={value}
      onChange={(e) => onChange(sanitizeAmount(e.target.value, max))}
      {...props}
    />
  )
);
AmountInput.displayName = "AmountInput";
