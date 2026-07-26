import { useCallback } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { getDb } from "@/infrastructure/db/dexie/database";
import { useAppStore } from "@/store/app-store";
import {
  formatMoney,
  formatCompact as formatCompactMoney,
  majorToMinorUnits,
  minorUnitsToMajor,
} from "@/lib/money";
import { DEFAULT_CURRENCY, DEFAULT_LOCALE } from "@/lib/constants";

const MASK = "••••";

export function useCurrencyFormatter() {
  const userId = useAppStore((s) => s.userId);
  const hideAmounts = useAppStore((s) => s.hideAmounts);
  const profile = useLiveQuery(
    () =>
      userId
        ? getDb().userProfiles.where("userId").equals(userId).first()
        : undefined,
    [userId]
  );

  const currencyCode = profile?.currencyCode ?? DEFAULT_CURRENCY;
  const locale = profile?.locale ?? DEFAULT_LOCALE;

  const format = useCallback(
    (minorUnits: number) =>
      hideAmounts ? MASK : formatMoney(minorUnits, currencyCode, locale),
    [currencyCode, locale, hideAmounts]
  );
  const formatCompact = useCallback(
    (minorUnits: number) =>
      hideAmounts ? MASK : formatCompactMoney(minorUnits, currencyCode, locale),
    [currencyCode, locale, hideAmounts]
  );
  const toMinor = useCallback(
    (amount: number) => majorToMinorUnits(amount, currencyCode),
    [currencyCode]
  );
  const toMajor = useCallback(
    (minorUnits: number) => minorUnitsToMajor(minorUnits, currencyCode),
    [currencyCode]
  );

  return { currencyCode, locale, format, formatCompact, toMinor, toMajor, hideAmounts };
}
