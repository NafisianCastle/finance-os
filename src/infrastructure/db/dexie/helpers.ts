import { getDb } from "./database";

export async function getBudgetsForMonth(userId: string, ym: string) {
  return getDb()
    .budgets.filter((b) => b.userId === userId && b.ym === ym && !b.deletedAt)
    .toArray();
}
