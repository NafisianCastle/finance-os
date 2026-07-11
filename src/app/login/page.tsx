"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createClient,
  isSupabaseConfigured,
} from "@/infrastructure/supabase/client";
import { LOCAL_USER_ID, useAppStore } from "@/store/app-store";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

export default function LoginPage() {
  const t = useTranslations("Auth");
  const router = useRouter();
  const setUserId = useAppStore((s) => s.setUserId);
  const userId = useAppStore((s) => s.userId);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isSupabaseConfigured()) return;

    if (userId === LOCAL_USER_ID) {
      setUserId(null);
      return;
    }

    async function restoreSession() {
      const supabase = createClient();
      if (!supabase) return;
      const { data } = await supabase.auth.getSession();
      if (data.session?.user?.id) {
        setUserId(data.session.user.id);
        router.replace("/dashboard");
      }
    }

    restoreSession();
  }, [userId, router, setUserId]);

  async function handleLogin() {
    setError("");
    if (!isSupabaseConfigured()) {
      setError(t("notConfigured"));
      return;
    }

    const supabase = createClient();
    if (!supabase) {
      setError(t("clientInitFailed"));
      return;
    }

    setLoading(true);
    const { data, error: signInError } = await supabase.auth.signInWithPassword(
      {
        email,
        password,
      },
    );

    if (signInError || !data.session?.user?.id) {
      setError(signInError?.message ?? t("loginFailed"));
      setLoading(false);
      return;
    }

    setUserId(data.session.user.id);
    router.push("/dashboard");
  }

  return (
    <div className="mx-auto min-h-screen max-w-md px-4 py-8">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">{t("login")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">{t("email")}</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">{t("password")}</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button
            className="w-full"
            onClick={handleLogin}
            disabled={loading || !email || !password}
          >
            {loading ? t("loggingIn") : t("login")}
          </Button>
          <p className="text-sm text-muted-foreground">
            {t("newHere")}{" "}
            <Link href="/signup" className="text-primary underline">
              {t("createAccount")}
            </Link>
            .
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
