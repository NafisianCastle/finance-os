"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { seedUserData } from "@/application/seed";
import { useAppStore, LOCAL_USER_ID } from "@/store/app-store";

export default function OnboardingPage() {
  const router = useRouter();
  const setUserId = useAppStore((s) => s.setUserId);
  const [income, setIncome] = useState("20000");
  const [loading, setLoading] = useState(false);

  async function handleStart() {
    setLoading(true);
    const userId = LOCAL_USER_ID;
    setUserId(userId);
    await seedUserData(userId, parseFloat(income) || 20000);
    setLoading(false);
    router.push("/dashboard");
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Welcome to Finance OS</CardTitle>
          <p className="text-sm text-muted-foreground">
            Your personal financial intelligence assistant. Default currency: BDT (৳).
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
          <Button className="w-full" size="lg" onClick={handleStart} disabled={loading}>
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
