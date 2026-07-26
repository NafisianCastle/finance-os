"use client";

import { useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { useAppStore } from "@/store/app-store";
import { joinGroupByCode } from "@/application/groups";

export default function JoinGroupPage() {
  const t = useTranslations("Groups");
  const router = useRouter();
  const searchParams = useSearchParams();
  const userId = useAppStore((s) => s.userId);
  const { toast } = useToast();

  const [code, setCode] = useState((searchParams.get("code") ?? "").toUpperCase());
  const [busy, setBusy] = useState(false);

  async function handleJoin() {
    if (!userId || !code.trim()) return;
    setBusy(true);
    try {
      await joinGroupByCode(userId, code.trim());
      toast(t("groupJoined"), "success");
      router.replace("/settings");
    } catch (e) {
      toast(e instanceof Error ? e.message : t("groupActionFailed"), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell title={t("joinGroup")}>
      <Card>
        <CardContent className="pt-4 space-y-3">
          <p className="text-sm text-muted-foreground">{t("description")}</p>
          <div className="space-y-2">
            <Label htmlFor="join-code">{t("inviteCode")}</Label>
            <Input
              id="join-code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder={t("inviteCodePlaceholder")}
            />
          </div>
          <Button onClick={handleJoin} loading={busy} disabled={!code.trim()} className="w-full">
            {t("join")}
          </Button>
        </CardContent>
      </Card>
    </AppShell>
  );
}
