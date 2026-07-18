"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createClient,
  isSupabaseConfigured,
} from "@/infrastructure/supabase/client";
import { useAppStore } from "@/store/app-store";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

export default function SignupPage() {
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
  }, [router, setUserId]);

  async function handleSignup() {
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
    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
    });

    if (signUpError) {
      setError(signUpError.message);
      setLoading(false);
      return;
    }

    if (data.user?.id) {
      setUserId(data.user.id);
      router.push("/onboarding");
      return;
    }

    setError(t("signupIncomplete"));
    setLoading(false);
  }

  return (
    <div className="mx-auto min-h-screen max-w-md px-4 py-8">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">{t("createAccount")}</CardTitle>
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
            onClick={handleSignup}
            disabled={!email || !password}
            loading={loading}
          >
            {loading ? t("creatingAccount") : t("signUp")}
          </Button>
          <p className="text-sm text-muted-foreground">
            {t("alreadyHaveAccount")}{" "}
            <Link href="/login" className="text-primary underline">
              {t("login")}
            </Link>
            .
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
