import { useLiveQuery } from "dexie-react-hooks";
import { getDb } from "@/infrastructure/db/dexie/database";
import { useAppStore } from "@/store/app-store";
import {
  formatMoney,
  formatCompact,
  majorToMinorUnits,
  minorUnitsToMajor,
} from "@/lib/money";
import { DEFAULT_CURRENCY, DEFAULT_LOCALE } from "@/lib/constants";

export function useCurrencyFormatter() {
  const userId = useAppStore((s) => s.userId);
  const profile = useLiveQuery(
    () =>
      userId
        ? getDb().userProfiles.where("userId").equals(userId).first()
        : undefined,
    [userId]
  );

  const currencyCode = profile?.currencyCode ?? DEFAULT_CURRENCY;
  const locale = profile?.locale ?? DEFAULT_LOCALE;

  return {
    currencyCode,
    locale,
    format: (minorUnits: number) => formatMoney(minorUnits, currencyCode, locale),
    formatCompact: (minorUnits: number) =>
      formatCompact(minorUnits, currencyCode, locale),
    toMinor: (amount: number) => majorToMinorUnits(amount, currencyCode),
    toMajor: (minorUnits: number) => minorUnitsToMajor(minorUnits, currencyCode),
  };
}
