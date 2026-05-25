/** BDT amounts stored as integer poisha (1 BDT = 100 poisha) */
export const POISHA_PER_BDT = 100;

export function bdtToPoisha(bdt: number): number {
  return Math.round(bdt * POISHA_PER_BDT);
}

export function poishaToBdt(poisha: number): number {
  return poisha / POISHA_PER_BDT;
}

export function formatMoney(
  poisha: number,
  currency = "BDT",
  locale = "bn-BD"
): string {
  const amount = poishaToBdt(poisha);
  if (currency === "BDT") {
    return `৳${amount.toLocaleString(locale, { maximumFractionDigits: 0 })}`;
  }
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatCompact(poisha: number): string {
  const bdt = poishaToBdt(poisha);
  if (bdt >= 1_000_000) return `৳${(bdt / 1_000_000).toFixed(1)}M`;
  if (bdt >= 1_000) return `৳${(bdt / 1_000).toFixed(1)}k`;
  return formatMoney(poisha);
}
