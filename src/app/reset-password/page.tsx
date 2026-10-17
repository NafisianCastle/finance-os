"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient, isSupabaseConfigured } from "@/infrastructure/supabase/client";
import { consumePostAuthPath } from "@/lib/pending-join";
import { useAppStore } from "@/store/app-store";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

const MIN_PASSWORD_LENGTH = 6;

/**
 * Landing page for the password-recovery email link
 * (resetPasswordForEmail(..., { redirectTo: `${origin}/reset-password` })).
 * The Supabase browser client picks the recovery session up from the URL
 * (PKCE `?code=` or implicit `#access_token`) on init; once a session exists
 * the user can set a new password via auth.updateUser.
 */
export default function ResetPasswordPage() {
  const t = useTranslations("Auth");
  const router = useRouter();
  const setUserId = useAppStore((s) => s.setUserId);
  const [status, setStatus] = useState<"checking" | "ready" | "invalid">(() =>
    isSupabaseConfigured() ? "checking" : "invalid",
  );
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(() => (isSupabaseConfigured() ? "" : t("notConfigured")));

  useEffect(() => {
    const supabase = createClient();
    if (!supabase) return;

    // Supabase reports link problems (expired/used) as error_description in
    // the query string or hash.
    const linkError =
      new URLSearchParams(window.location.hash.slice(1)).get("error_description") ??
      new URLSearchParams(window.location.search).get("error_description");

    let settled = false;
    const markReady = () => {
      settled = true;
      setStatus("ready");
    };

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (session && (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN" || event === "INITIAL_SESSION")) {
        markReady();
      }
    });

    // getSession waits for the client's URL session detection to finish.
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        markReady();
      } else if (!settled) {
        setStatus("invalid");
        if (linkError) setError(linkError);
      }
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(t("passwordTooShort", { min: MIN_PASSWORD_LENGTH }));
      return;
    }
    if (password !== confirm) {
      setError(t("passwordsDontMatch"));
      return;
    }
    const supabase = createClient();
    if (!supabase) {
      setError(t("clientInitFailed"));
      return;
    }

    setLoading(true);
    try {
      const { data, error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        setError(updateError.message);
        return;
      }
      if (data.user?.id) setUserId(data.user.id);
      router.replace(consumePostAuthPath());
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto min-h-screen max-w-md px-4 py-8">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">{t("resetPasswordTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          {status === "checking" && (
            <p className="text-sm text-muted-foreground">{t("verifyingResetLink")}</p>
          )}
          {status === "invalid" && (
            <div className="space-y-4">
              <p className="text-sm text-destructive">{error || t("resetLinkInvalid")}</p>
              <Link href="/login" className="text-sm text-primary underline">
                {t("backToLogin")}
              </Link>
            </div>
          )}
          {status === "ready" && (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="new-password">{t("newPassword")}</Label>
                <Input
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm-password">{t("confirmPassword")}</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" className="w-full" disabled={!password || !confirm} loading={loading}>
                {loading ? t("updatingPassword") : t("updatePassword")}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
