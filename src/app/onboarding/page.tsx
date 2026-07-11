"use client";

import { seedUserData } from "@/application/seed";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { isSupabaseConfigured } from "@/infrastructure/supabase/client";
import { DEFAULT_CURRENCY, SUPPORTED_CURRENCIES, SUPPORTED_UI_LOCALES } from "@/lib/constants";
import { LOCAL_USER_ID, useAppStore } from "@/store/app-store";
import { useTranslations, useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export default function OnboardingPage() {
  const t = useTranslations("Onboarding");
  const currentLocale = useLocale();
  const router = useRouter();
  const setUserId = useAppStore((s) => s.setUserId);
  const userId = useAppStore((s) => s.userId);
  const [income, setIncome] = useState("20000");
  const [currency, setCurrency] = useState(DEFAULT_CURRENCY);
  const [uiLocale, setUiLocale] = useState(currentLocale);
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
    await seedUserData(currentUserId, parseFloat(income) || 20000, currency, uiLocale);
    document.cookie = `NEXT_LOCALE=${uiLocale}; path=/; max-age=31536000`;
    setLoading(false);
    router.push("/dashboard");
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">{t("welcome")}</CardTitle>
          <p className="text-sm text-muted-foreground">{t("intro")}</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>{t("currency")}</Label>
            <Select value={currency} onValueChange={setCurrency}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SUPPORTED_CURRENCIES.map((c) => (
                  <SelectItem key={c.code} value={c.code}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>{t("language")}</Label>
            <Select value={uiLocale} onValueChange={setUiLocale}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SUPPORTED_UI_LOCALES.map((l) => (
                  <SelectItem key={l.code} value={l.code}>
                    {l.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="income">{t("monthlyIncome", { currency })}</Label>
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
            {loading ? t("settingUp") : t("getStarted")}
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            {t("worksOffline")}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
