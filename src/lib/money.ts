/** Number of minor-unit digits for a currency, e.g. 2 for USD/BDT, 0 for JPY, 3 for BHD */
export function getCurrencyDigits(currencyCode: string): number {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currencyCode,
    }).resolvedOptions().maximumFractionDigits;
  } catch {
    return 2;
  }
}

/** Convert a major-unit amount (e.g. dollars) to integer minor units (e.g. cents) */
export function majorToMinorUnits(amount: number, currencyCode: string): number {
  return Math.round(amount * 10 ** getCurrencyDigits(currencyCode));
}

/** Convert integer minor units back to a major-unit amount */
export function minorUnitsToMajor(minorUnits: number, currencyCode: string): number {
  return minorUnits / 10 ** getCurrencyDigits(currencyCode);
}

export function formatMoney(
  minorUnits: number,
  currencyCode: string,
  locale: string
): string {
  const amount = minorUnitsToMajor(minorUnits, currencyCode);
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: currencyCode,
  }).format(amount);
}

export function formatCompact(
  minorUnits: number,
  currencyCode: string,
  locale: string
): string {
  const amount = minorUnitsToMajor(minorUnits, currencyCode);
  const symbol =
    new Intl.NumberFormat(locale, { style: "currency", currency: currencyCode })
      .formatToParts(0)
      .find((p) => p.type === "currency")?.value ?? currencyCode;
  if (Math.abs(amount) >= 1_000_000) return `${symbol}${(amount / 1_000_000).toFixed(1)}M`;
  if (Math.abs(amount) >= 1_000) return `${symbol}${(amount / 1_000).toFixed(1)}k`;
  return formatMoney(minorUnits, currencyCode, locale);
}
