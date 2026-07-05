"use client";

import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getDb, resetLocalDatabase } from "@/infrastructure/db/dexie/database";
import {
  createClient,
  isSupabaseConfigured,
} from "@/infrastructure/supabase/client";
import { enqueueSync, processSyncQueue, repairAccountSync } from "@/infrastructure/sync/sync-queue";
import { bdtToPoisha, poishaToBdt } from "@/lib/money";
import { useAppStore } from "@/store/app-store";
import type { Account } from "@/infrastructure/db/dexie/schema";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export default function SettingsPage() {
  const router = useRouter();
  const userId = useAppStore((s) => s.userId);
  const setUserId = useAppStore((s) => s.setUserId);
  const { theme, setTheme } = useTheme();
  const [income, setIncome] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState("");
  const [email, setEmail] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [balanceInputs, setBalanceInputs] = useState<Record<string, string>>({});

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

  async function saveAccountBalance(acc: Account) {
    if (!userId) return;
    const bdt = parseFloat(balanceInputs[acc.id]);
    if (Number.isNaN(bdt)) return;
    const balancePoisha = bdtToPoisha(bdt);
    const now = new Date().toISOString();
    await getDb().accounts.update(acc.id, { balancePoisha, updatedAt: now });
    await enqueueSync("accounts", acc.id, "upsert", {
      id: acc.id,
      type_smallint: acc.type,
      name: acc.name,
      balance_poisha: balancePoisha,
    });
    setAccounts((prev) => prev.map((a) => (a.id === acc.id ? { ...a, balancePoisha } : a)));
  }

  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    const supabase = createClient();
    if (!supabase) return;
    supabase.auth.getUser().then(({ data }) => {
      setEmail(data.user?.email ?? null);
    });
  }, [userId]);

  async function saveProfile() {
    if (!userId) return;
    const profile = await getDb()
      .userProfiles.where("userId")
      .equals(userId)
      .first();
    if (!profile) return;
    const now = new Date().toISOString();
    await getDb().userProfiles.update(profile.id, {
      monthlyIncomePoisha: bdtToPoisha(parseFloat(income) || 0),
      updatedAt: now,
    });
  }

  async function handleSync() {
    if (!userId) return;
    setSyncing(true);
    await repairAccountSync(userId);
    const { pushed, errors, lastError } = await processSyncQueue(userId);
    setSyncMsg(
      `Synced ${pushed} items${errors ? `, ${errors} errors${lastError ? `: ${lastError}` : ""}` : ""}`,
    );
    setSyncing(false);
  }

  async function handleLogout() {
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
              <Label>Monthly income (BDT)</Label>
              <Input
                type="number"
                value={income}
                onChange={(e) => setIncome(e.target.value)}
              />
            </div>
            <Button
              onClick={saveProfile}
              variant="secondary"
              className="w-full"
            >
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
            {accounts.map((acc) => (
              <div key={acc.id} className="flex items-end gap-2">
                <div className="flex-1 space-y-1">
                  <Label>{acc.name}</Label>
                  <Input
                    type="number"
                    value={balanceInputs[acc.id] ?? ""}
                    onChange={(e) =>
                      setBalanceInputs((prev) => ({ ...prev, [acc.id]: e.target.value }))
                    }
                  />
                </div>
                <Button variant="secondary" onClick={() => saveAccountBalance(acc)}>
                  Save
                </Button>
              </div>
            ))}
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
                {syncing ? "Syncing…" : "Sync now"}
              </Button>
            )}
            {syncMsg && (
              <p className="text-xs text-muted-foreground">{syncMsg}</p>
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
                onClick={async () => {
                  if (!email) return;
                  const supabase = createClient();
                  if (!supabase) return;
                  const { error } = await supabase.auth.resetPasswordForEmail(email);
                  alert(
                    error
                      ? `Failed to send reset email: ${error.message}`
                      : "Password reset email sent.",
                  );
                }}
              >
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
          onClick={async () => {
            if (
              confirm(
                "Fix database errors? This clears all local Finance OS data and returns you to onboarding.",
              )
            ) {
              await resetLocalDatabase();
              setUserId(null);
              router.push("/onboarding");
            }
          }}
        >
          Repair local database
        </Button>

        <Button variant="destructive" className="w-full" onClick={handleLogout}>
          Log out
        </Button>
      </div>
    </AppShell>
  );
}
