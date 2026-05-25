import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function ymKey(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `${y}${m}`;
}

export function parseYm(ym: string): { year: number; month: number } {
  return { year: parseInt(ym.slice(0, 4), 10), month: parseInt(ym.slice(4, 6), 10) };
}
