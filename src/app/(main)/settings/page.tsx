"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { useAppStore } from "@/store/app-store";
import { getDb } from "@/infrastructure/db/dexie/database";
import { bdtToPoisha } from "@/lib/money";
import { isSupabaseConfigured } from "@/infrastructure/supabase/client";
import { processSyncQueue } from "@/infrastructure/sync/sync-queue";
import { Moon, Sun } from "lucide-react";

export default function SettingsPage() {
  const router = useRouter();
  const userId = useAppStore((s) => s.userId);
  const setUserId = useAppStore((s) => s.setUserId);
  const { theme, setTheme } = useTheme();
  const [income, setIncome] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState("");

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

  async function saveProfile() {
    if (!userId) return;
    const profile = await getDb().userProfiles.where("userId").equals(userId).first();
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
    const { pushed, errors } = await processSyncQueue(userId);
    setSyncMsg(`Synced ${pushed} items${errors ? `, ${errors} errors` : ""}`);
    setSyncing(false);
  }

  function handleLogout() {
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
              <Input type="number" value={income} onChange={(e) => setIncome(e.target.value)} />
            </div>
            <Button onClick={saveProfile} variant="secondary" className="w-full">
              Save income
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4 space-y-3">
            <p className="text-sm font-medium">Currency</p>
            <p className="text-sm text-muted-foreground">BDT (৳) — default for Bangladesh</p>
            <p className="text-sm font-medium mt-2">Cloud sync</p>
            <p className="text-sm text-muted-foreground">
              {isSupabaseConfigured()
                ? "Supabase configured — tap sync to push pending changes."
                : "Offline mode — add NEXT_PUBLIC_SUPABASE_URL and ANON_KEY to .env.local"}
            </p>
            {isSupabaseConfigured() && (
              <Button onClick={handleSync} disabled={syncing} className="w-full">
                {syncing ? "Syncing…" : "Sync now"}
              </Button>
            )}
            {syncMsg && <p className="text-xs text-muted-foreground">{syncMsg}</p>}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4 flex items-center justify-between">
            <span className="font-medium">Theme</span>
            <Button
              variant="outline"
              size="icon"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            >
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
          </CardContent>
        </Card>

        <Button variant="destructive" className="w-full" onClick={handleLogout}>
          Reset local session
        </Button>
      </div>
    </AppShell>
  );
}
