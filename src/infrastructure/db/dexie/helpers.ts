import type { Table } from "dexie";
import { getDb } from "./database";

/** Workaround for Dexie 4's InsertType requiring [key: string]: unknown */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function dbPut<T>(table: Table<T, string>, record: T): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return table.put(record as any) as Promise<string>;
}

export async function getBudgetsForMonth(userId: string, ym: string, groupId: string | null = null) {
  return scoped(getDb().budgets, userId, groupId)
    .and((b) => b.ym === ym)
    .toArray();
}

type Scopable = { userId: string; groupId?: string | null; deletedAt?: string | null };

/**
 * Mixed group model: a user sees their own personal rows (groupId null) plus
 * every row shared with their current group, whoever authored it.
 */
export function isVisible(row: Scopable, userId: string, groupId: string | null = null): boolean {
  if (row.deletedAt) return false;
  if (row.groupId) return !!groupId && row.groupId === groupId;
  return row.userId === userId;
}

/** Non-deleted rows visible to `userId` in `groupId` (see isVisible). */
export function scoped<T extends Scopable, TInsert = T>(
  table: Table<T, string, TInsert>,
  userId: string,
  groupId: string | null = null,
) {
  const base = groupId
    ? table.where("userId").equals(userId).or("groupId").equals(groupId)
    : table.where("userId").equals(userId);
  return base.and((r) => isVisible(r, userId, groupId));
}
