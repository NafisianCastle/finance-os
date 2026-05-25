"use client";

import { seedUserData } from "@/application/seed";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isSupabaseConfigured } from "@/infrastructure/supabase/client";
import { LOCAL_USER_ID, useAppStore } from "@/store/app-store";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export default function OnboardingPage() {
  const router = useRouter();
  const setUserId = useAppStore((s) => s.setUserId);
  const userId = useAppStore((s) => s.userId);
  const [income, setIncome] = useState("20000");
  const [loading, setLoading] = useState(false);
  const authConfigured = isSupabaseConfigured();

  useEffect(() => {
    if (authConfigured && (!userId || userId === LOCAL_USER_ID)) {
      router.replace("/login");
    }
  }, [authConfigured, router, userId]);

  async function handleStart() {
    if (authConfigured && (!userId || userId === LOCAL_USER_ID)) return;

    setLoading(true);
    const currentUserId = userId ?? LOCAL_USER_ID;
    setUserId(currentUserId);
    await seedUserData(currentUserId, parseFloat(income) || 20000);
    setLoading(false);
    router.push("/dashboard");
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Welcome to Finance OS</CardTitle>
          <p className="text-sm text-muted-foreground">
            Your personal financial intelligence assistant. Default currency:
            BDT (৳).
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="income">Monthly income (BDT)</Label>
            <Input
              id="income"
              type="number"
              value={income}
              onChange={(e) => setIncome(e.target.value)}
              placeholder="20000"
            />
          </div>
          <Button
            className="w-full"
            size="lg"
            onClick={handleStart}
            disabled={loading}
          >
            {loading ? "Setting up…" : "Get started"}
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            Works offline. Connect Supabase in Settings for cloud sync.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
