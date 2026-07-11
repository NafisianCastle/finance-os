"use client";

import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { getDb, resetLocalDatabase } from "@/infrastructure/db/dexie/database";
import {
  createClient,
  isSupabaseConfigured,
} from "@/infrastructure/supabase/client";
import {
  enqueueSync,
  exportUserDataAsJson,
  forceFullResync,
  mergeDuplicateAccounts,
  mergeDuplicateGoals,
  processSyncQueue,
  repairAccountSync,
  repairLocalBudgets,
} from "@/infrastructure/sync/sync-queue";
import { bdtToPoisha, poishaToBdt } from "@/lib/money";
import { useAppStore } from "@/store/app-store";
import type { Account } from "@/infrastructure/db/dexie/schema";
import { ACCOUNT_TYPES } from "@/lib/constants";
import { Loader2, Moon, Sun, Plus, Trash2 } from "lucide-react";
import { useTheme } from "next-themes";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { v4 as uuid } from "uuid";

const ACCOUNT_TYPE_OPTIONS = [
  { v: ACCOUNT_TYPES.CASH, l: "Cash" },
  { v: ACCOUNT_TYPES.BANK, l: "Bank" },
  { v: ACCOUNT_TYPES.WALLET, l: "Mobile wallet" },
  { v: ACCOUNT_TYPES.CREDIT_CARD, l: "Credit card" },
];

export default function SettingsPage() {
  const router = useRouter();
  const userId = useAppStore((s) => s.userId);
  const setUserId = useAppStore((s) => s.setUserId);
  const { theme, setTheme } = useTheme();
  const { toast } = useToast();
  const confirm = useConfirm();

  const [income, setIncome] = useState("");
  const [savingIncome, setSavingIncome] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState("");
  const [email, setEmail] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [balanceInputs, setBalanceInputs] = useState<Record<string, string>>({});
  const [savingAccountId, setSavingAccountId] = useState<string | null>(null);
  const [resettingPassword, setResettingPassword] = useState(false);
  const [repairing, setRepairing] = useState(false);
  const [newAccountName, setNewAccountName] = useState("");
  const [newAccountType, setNewAccountType] = useState<number>(ACCOUNT_TYPES.WALLET);
  const [newAccountBalance, setNewAccountBalance] = useState("");
  const [creatingAccount, setCreatingAccount] = useState(false);
  const [deletingAccountId, setDeletingAccountId] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    getDb()
      .userProfiles.where("userId")
      .equals(userId)
      .first()
      .then((p) => {
        if (p) setIncome(String(p.monthlyIncomePoisha / 100));
      });
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    getDb()
      .accounts.where("userId")
      .equals(userId)
      .filter((a) => !a.deletedAt)
      .toArray()
      .then((accs) => {
        setAccounts(accs);
        setBalanceInputs(
          Object.fromEntries(accs.map((a) => [a.id, String(poishaToBdt(a.balancePoisha))])),
        );
      });
  }, [userId]);

  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    const supabase = createClient();
    if (!supabase) return;
    supabase.auth.getUser().then(({ data }) => {
      setEmail(data.user?.email ?? null);
    });
  }, [userId]);

  async function saveAccountBalance(acc: Account) {
    if (!userId) return;
    const bdt = parseFloat(balanceInputs[acc.id]);
    if (Number.isNaN(bdt) || bdt < 0) {
      toast("Enter a valid, non-negative amount.", "error");
      return;
    }
    setSavingAccountId(acc.id);
    const balancePoisha = bdtToPoisha(bdt);
    const now = new Date().toISOString();
    await getDb().accounts.update(acc.id, { balancePoisha, updatedAt: now });
    await enqueueSync("accounts", acc.id, "upsert", {
      id: acc.id,
      type_smallint: acc.type,
      name: acc.name,
      balance_poisha: balancePoisha,
    });
    setAccounts((prev) => prev?.map((a) => (a.id === acc.id ? { ...a, balancePoisha } : a)) ?? prev);
    setSavingAccountId(null);
    toast(`${acc.name} balance updated.`, "success");
  }

  async function handleCreateAccount() {
    if (!userId || !newAccountName.trim()) return;
    const bdt = parseFloat(newAccountBalance) || 0;
    if (bdt < 0) {
      toast("Enter a valid, non-negative amount.", "error");
      return;
    }
    setCreatingAccount(true);
    const now = new Date().toISOString();
    const acc: Account = {
      id: uuid(),
      userId,
      type: newAccountType,
      name: newAccountName.trim(),
      balancePoisha: bdtToPoisha(bdt),
      createdAt: now,
      updatedAt: now,
    };
    await getDb().accounts.put(acc as never);
    await enqueueSync("accounts", acc.id, "upsert", {
      id: acc.id,
      type_smallint: acc.type,
      name: acc.name,
      balance_poisha: acc.balancePoisha,
    });
    setAccounts((prev) => [...(prev ?? []), acc]);
    setBalanceInputs((prev) => ({ ...prev, [acc.id]: String(poishaToBdt(acc.balancePoisha)) }));
    setNewAccountName("");
    setNewAccountBalance("");
    setCreatingAccount(false);
    toast(`${acc.name} added.`, "success");
  }

  async function handleDeleteAccount(acc: Account) {
    if (!userId) return;
    const ok = await confirm({
      title: `Remove ${acc.name}?`,
      description: "Past transactions on this account are kept, but it won't be selectable anymore.",
      confirmLabel: "Remove",
      variant: "destructive",
    });
    if (!ok) return;
    setDeletingAccountId(acc.id);
    const now = new Date().toISOString();
    await getDb().accounts.update(acc.id, { deletedAt: now, updatedAt: now });
    await enqueueSync("accounts", acc.id, "delete", { id: acc.id });
    setAccounts((prev) => prev?.filter((a) => a.id !== acc.id) ?? prev);
    setDeletingAccountId(null);
    toast(`${acc.name} removed.`, "success");
  }

  async function saveProfile() {
    if (!userId) return;
    const bdt = parseFloat(income);
    if (Number.isNaN(bdt) || bdt < 0) {
      toast("Enter a valid, non-negative income.", "error");
      return;
    }
    setSavingIncome(true);
    const profile = await getDb()
      .userProfiles.where("userId")
      .equals(userId)
      .first();
    if (!profile) {
      setSavingIncome(false);
      return;
    }
    const now = new Date().toISOString();
    await getDb().userProfiles.update(profile.id, {
      monthlyIncomePoisha: bdtToPoisha(bdt),
      updatedAt: now,
    });
    setSavingIncome(false);
    toast("Monthly income saved.", "success");
  }

  async function handleSync() {
    if (!userId) return;
    setSyncing(true);
    await repairAccountSync(userId);
    const { pushed, errors, lastError } = await processSyncQueue(userId);
    const msg = `Synced ${pushed} items${errors ? `, ${errors} errors${lastError ? `: ${lastError}` : ""}` : ""}`;
    setSyncMsg(msg);
    setSyncing(false);
    toast(msg, errors ? "error" : "success");
  }

  async function handleFixDuplicates() {
    if (!userId) return;
    const ok = await confirm({
      title: "Fix duplicates?",
      description:
        "Merges accounts and goals with the same name (summing their balances/saved amounts) and refreshes budgets from the server. This changes remote data immediately and can't be undone.",
      confirmLabel: "Fix",
      variant: "destructive",
    });
    if (!ok) return;
    setSyncing(true);
    const [{ merged: mergedAccounts, groups: accountGroups }, { merged: mergedGoals, groups: goalGroups }] =
      await Promise.all([mergeDuplicateAccounts(userId), mergeDuplicateGoals(userId)]);
    await repairLocalBudgets(userId);
    setSyncing(false);
    const parts: string[] = [];
    if (accountGroups > 0) parts.push(`${mergedAccounts} account(s)`);
    if (goalGroups > 0) parts.push(`${mergedGoals} goal(s)`);
    toast(
      parts.length > 0
        ? `Fixed duplicates: merged ${parts.join(", ")}, budgets refreshed.`
        : "No duplicates found. Budgets refreshed.",
      "success"
    );
  }

  async function handleForceResync() {
    if (!userId) return;
    setSyncing(true);
    const { pushed, errors, pulled } = await forceFullResync(userId);
    setSyncing(false);
    toast(
      `Re-synced: pushed ${pushed}, pulled ${pulled}${errors ? `, ${errors} errors` : ""}.`,
      errors ? "error" : "success"
    );
  }

  async function handleExportData() {
    if (!userId) return;
    const data = await exportUserDataAsJson(userId);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `finance-os-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast("Backup downloaded.", "success");
  }

  async function handleChangePassword() {
    if (!email) return;
    setResettingPassword(true);
    const supabase = createClient();
    if (!supabase) {
      setResettingPassword(false);
      return;
    }
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    setResettingPassword(false);
    toast(
      error ? `Failed to send reset email: ${error.message}` : "Password reset email sent.",
      error ? "error" : "success",
    );
  }

  async function handleRepairDatabase() {
    const ok = await confirm({
      title: "Fix database errors?",
      description: "This clears all local Finance OS data and returns you to onboarding. This can't be undone.",
      confirmLabel: "Clear data",
      variant: "destructive",
    });
    if (!ok) return;
    setRepairing(true);
    await resetLocalDatabase();
    setUserId(null);
    router.push("/onboarding");
  }

  async function handleLogout() {
    const ok = await confirm({
      title: "Log out?",
      description: isSupabaseConfigured()
        ? "You'll need to sign in again to sync your data."
        : "This clears your local session.",
      confirmLabel: "Log out",
      variant: "destructive",
    });
    if (!ok) return;

    if (isSupabaseConfigured()) {
      const supabase = createClient();
      if (supabase) {
        await supabase.auth.signOut();
      }
      setUserId(null);
      router.push("/login");
      return;
    }

    setUserId(null);
    router.push("/onboarding");
  }

  return (
    <AppShell title="Settings">
      <div className="space-y-4">
        <Card>
          <CardContent className="pt-4 space-y-3">
            <div className="space-y-2">
              <Label htmlFor="income">Monthly income (BDT)</Label>
              <Input
                id="income"
                type="number"
                min={0}
                value={income}
                onChange={(e) => setIncome(e.target.value)}
              />
            </div>
            <Button
              onClick={saveProfile}
              variant="secondary"
              className="w-full"
              disabled={savingIncome}
            >
              {savingIncome && <Loader2 className="h-4 w-4 animate-spin" />}
              Save income
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4 space-y-3">
            <p className="text-sm font-medium">Account balances</p>
            <p className="text-sm text-muted-foreground">
              Set these to what you actually have — they start at ৳0 and
              aren&apos;t filled in from your income automatically.
            </p>
            {accounts === null ? (
              <div className="space-y-2">
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
              </div>
            ) : (
              accounts.map((acc) => (
                <div key={acc.id} className="flex items-end gap-2">
                  <div className="flex-1 space-y-1">
                    <Label htmlFor={`bal-${acc.id}`}>{acc.name}</Label>
                    <Input
                      id={`bal-${acc.id}`}
                      type="number"
                      min={0}
                      value={balanceInputs[acc.id] ?? ""}
                      onChange={(e) =>
                        setBalanceInputs((prev) => ({ ...prev, [acc.id]: e.target.value }))
                      }
                    />
                  </div>
                  <Button
                    variant="secondary"
                    onClick={() => saveAccountBalance(acc)}
                    disabled={savingAccountId === acc.id}
                  >
                    {savingAccountId === acc.id && <Loader2 className="h-4 w-4 animate-spin" />}
                    Save
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label={`Remove ${acc.name}`}
                    onClick={() => handleDeleteAccount(acc)}
                    disabled={deletingAccountId === acc.id}
                  >
                    {deletingAccountId === acc.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4 text-destructive" />
                    )}
                  </Button>
                </div>
              ))
            )}

            <div className="border-t border-border pt-3 space-y-2">
              <Label>Add account</Label>
              <div className="flex gap-2">
                <Input
                  placeholder="e.g. bKash, City Bank"
                  value={newAccountName}
                  onChange={(e) => setNewAccountName(e.target.value)}
                  className="flex-1"
                />
                <select
                  className="flex h-10 rounded-lg border border-input bg-background px-2 text-sm"
                  value={newAccountType}
                  onChange={(e) => setNewAccountType(Number(e.target.value))}
                >
                  {ACCOUNT_TYPE_OPTIONS.map((t) => (
                    <option key={t.v} value={t.v}>{t.l}</option>
                  ))}
                </select>
              </div>
              <div className="flex gap-2">
                <Input
                  type="number"
                  min={0}
                  placeholder="Starting balance (BDT)"
                  value={newAccountBalance}
                  onChange={(e) => setNewAccountBalance(e.target.value)}
                  className="flex-1"
                />
                <Button
                  variant="secondary"
                  className="gap-1.5 shrink-0"
                  onClick={handleCreateAccount}
                  disabled={creatingAccount || !newAccountName.trim()}
                >
                  {creatingAccount ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  Add
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4 space-y-3">
            <p className="text-sm font-medium">Currency</p>
            <p className="text-sm text-muted-foreground">
              BDT (৳) — default for Bangladesh
            </p>
            <p className="text-sm font-medium mt-2">Cloud sync</p>
            <p className="text-sm text-muted-foreground">
              {isSupabaseConfigured()
                ? "Supabase configured — tap sync to push pending changes."
                : "Offline mode — add NEXT_PUBLIC_SUPABASE_URL and ANON_KEY to .env.local"}
            </p>
            {isSupabaseConfigured() && (
              <Button
                onClick={handleSync}
                disabled={syncing}
                className="w-full"
              >
                {syncing && <Loader2 className="h-4 w-4 animate-spin" />}
                {syncing ? "Syncing…" : "Sync now"}
              </Button>
            )}
            {syncMsg && (
              <p className="text-xs text-muted-foreground">{syncMsg}</p>
            )}
            {isSupabaseConfigured() && (
              <>
                <p className="text-sm font-medium mt-2">Duplicates</p>
                <p className="text-sm text-muted-foreground">
                  If accounts, budgets, or goals show up twice after using
                  multiple browsers, fix them all in one go.
                </p>
                <Button
                  onClick={handleFixDuplicates}
                  disabled={syncing}
                  variant="outline"
                  className="w-full"
                >
                  Fix duplicates
                </Button>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4 space-y-3">
            <p className="text-sm font-medium">Diagnostics</p>
            <p className="text-sm text-muted-foreground">
              Your data is never trapped even if sync breaks. Download a full
              backup any time, or force a full re-sync against the server.
            </p>
            <Button onClick={handleExportData} variant="outline" className="w-full">
              Export data as JSON
            </Button>
            {isSupabaseConfigured() && (
              <Button
                onClick={handleForceResync}
                disabled={syncing}
                variant="outline"
                className="w-full"
              >
                Force full re-sync
              </Button>
            )}
          </CardContent>
        </Card>

        {isSupabaseConfigured() && (
          <Card>
            <CardContent className="pt-4 space-y-3">
              <p className="text-sm font-medium">Manage account</p>
              <p className="text-sm text-muted-foreground">
                {email ?? "Not signed in"}
              </p>
              <Button
                variant="outline"
                className="w-full"
                onClick={handleChangePassword}
                disabled={!email || resettingPassword}
              >
                {resettingPassword && <Loader2 className="h-4 w-4 animate-spin" />}
                Change password
              </Button>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent className="pt-4 flex items-center justify-between">
            <span className="font-medium">Theme</span>
            <Button
              variant="outline"
              size="icon"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              aria-label="Toggle theme"
            >
              {theme === "dark" ? (
                <Sun className="h-4 w-4" />
              ) : (
                <Moon className="h-4 w-4" />
              )}
            </Button>
          </CardContent>
        </Card>

        <Button
          variant="outline"
          className="w-full"
          onClick={handleRepairDatabase}
          disabled={repairing}
        >
          {repairing && <Loader2 className="h-4 w-4 animate-spin" />}
          Repair local database
        </Button>

        <Button variant="destructive" className="w-full" onClick={handleLogout}>
          Log out
        </Button>
      </div>
    </AppShell>
  );
}
