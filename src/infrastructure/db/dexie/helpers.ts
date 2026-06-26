import type { Table } from "dexie";
import { getDb } from "./database";

/** Workaround for Dexie 4's InsertType requiring [key: string]: unknown */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function dbPut<T>(table: Table<T, string>, record: T): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return table.put(record as any) as Promise<string>;
}

export async function getBudgetsForMonth(userId: string, ym: string) {
  return getDb()
    .budgets.filter((b) => b.userId === userId && b.ym === ym && !b.deletedAt)
    .toArray();
}
