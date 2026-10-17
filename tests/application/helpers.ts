import { getDb } from "@/infrastructure/db/dexie/database";
import type { Account } from "@/infrastructure/db/dexie/schema";

export const ME = "user-1";
export const TEAMMATE = "user-2";
export const GROUP = "group-1";
export const OTHER_GROUP = "group-2";

export function makeAccount(overrides: Partial<Account> = {}): Account {
  const now = new Date().toISOString();
  return {
    id: "acc-1",
    userId: ME,
    type: 1,
    name: "Cash",
    balancePoisha: 100_000,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/** All queued sync entries for a record, oldest first. */
export async function queued(table: string, recordId: string) {
  const items = await getDb()
    .syncQueue.filter((i) => i.table === table && i.recordId === recordId)
    .toArray();
  return items.sort((a, b) => Number(a.id) - Number(b.id));
}

/** The payload of the most recent queued upsert for a record. */
export async function lastUpsert(table: string, recordId: string) {
  const items = (await queued(table, recordId)).filter((i) => i.operation === "upsert");
  return items[items.length - 1]?.payload;
}

export async function balance(accountId: string) {
  return (await getDb().accounts.get(accountId))?.balancePoisha;
}
