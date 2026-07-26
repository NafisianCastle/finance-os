"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useAppStore } from "@/store/app-store";
import { isSupabaseConfigured } from "@/infrastructure/supabase/client";
import type { Group, GroupMember } from "@/infrastructure/db/dexie/schema";
import {
  createGroup,
  getCachedGroup,
  getMyGroup,
  joinGroupByCode,
  leaveGroup,
  regenerateInviteCode,
  removeMember,
} from "@/application/groups";

export function GroupSettingsCard() {
  const t = useTranslations("Groups");
  const userId = useAppStore((s) => s.userId);
  const { toast } = useToast();
  const confirm = useConfirm();

  const [loaded, setLoaded] = useState(false);
  const [group, setGroup] = useState<Group | null>(null);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [groupName, setGroupName] = useState("");
  const [inviteCodeInput, setInviteCodeInput] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    getCachedGroup(userId).then((cached) => {
      if (!cancelled && cached) {
        setGroup(cached.group);
        setMembers(cached.members);
      }
      if (!cancelled) setLoaded(true);
    });
    getMyGroup(userId).then((fresh) => {
      if (cancelled) return;
      setGroup(fresh?.group ?? null);
      setMembers(fresh?.members ?? []);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (!isSupabaseConfigured() || !userId) return null;
  if (!loaded) return null;

  const isOwner = members.find((m) => m.userId === userId)?.role === "owner";
  const inviteLink =
    typeof window !== "undefined" && group
      ? `${window.location.origin}/join?code=${group.inviteCode}`
      : "";

  async function handleCreate() {
    if (!userId || !groupName.trim()) return;
    setBusy(true);
    try {
      const created = await createGroup(userId, groupName.trim());
      setGroup(created);
      setMembers([{ groupId: created.id, userId, role: "owner", joinedAt: new Date().toISOString() }]);
      setGroupName("");
      toast(t("groupCreated"), "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : t("groupActionFailed"), "error");
    } finally {
      setBusy(false);
    }
  }

  async function handleJoin() {
    if (!userId || !inviteCodeInput.trim()) return;
    setBusy(true);
    try {
      const joined = await joinGroupByCode(userId, inviteCodeInput.trim());
      const fresh = await getMyGroup(userId);
      setGroup(fresh?.group ?? joined);
      setMembers(fresh?.members ?? []);
      setInviteCodeInput("");
      toast(t("groupJoined"), "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : t("groupActionFailed"), "error");
    } finally {
      setBusy(false);
    }
  }

  async function handleRegenerate() {
    if (!group) return;
    setBusy(true);
    try {
      const code = await regenerateInviteCode(group.id);
      setGroup({ ...group, inviteCode: code });
      toast(t("inviteCodeRegenerated"), "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : t("groupActionFailed"), "error");
    } finally {
      setBusy(false);
    }
  }

  async function handleLeave() {
    if (!userId || !group) return;
    const ok = await confirm({
      title: t("leaveGroupTitle"),
      description: t("leaveGroupDescription"),
      confirmLabel: t("leave"),
      variant: "destructive",
    });
    if (!ok) return;
    setBusy(true);
    try {
      await leaveGroup(userId, group.id);
      setGroup(null);
      setMembers([]);
      toast(t("groupLeft"), "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : t("groupActionFailed"), "error");
    } finally {
      setBusy(false);
    }
  }

  async function handleRemoveMember(targetUserId: string) {
    if (!group) return;
    const ok = await confirm({
      title: t("removeMemberTitle"),
      confirmLabel: t("remove"),
      variant: "destructive",
    });
    if (!ok) return;
    setBusy(true);
    try {
      await removeMember(group.id, targetUserId);
      setMembers((prev) => prev.filter((m) => m.userId !== targetUserId));
      toast(t("memberRemoved"), "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : t("groupActionFailed"), "error");
    } finally {
      setBusy(false);
    }
  }

  if (!group) {
    return (
      <Card>
        <CardContent className="pt-4 space-y-4">
          <p className="text-sm font-medium">{t("title")}</p>
          <p className="text-sm text-muted-foreground">{t("description")}</p>

          <div className="space-y-2">
            <Label htmlFor="group-name">{t("createGroup")}</Label>
            <div className="flex gap-2">
              <Input
                id="group-name"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder={t("groupNamePlaceholder")}
              />
              <Button onClick={handleCreate} loading={busy} disabled={!groupName.trim()}>
                {t("create")}
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="invite-code">{t("joinGroup")}</Label>
            <div className="flex gap-2">
              <Input
                id="invite-code"
                value={inviteCodeInput}
                onChange={(e) => setInviteCodeInput(e.target.value.toUpperCase())}
                placeholder={t("inviteCodePlaceholder")}
              />
              <Button onClick={handleJoin} loading={busy} disabled={!inviteCodeInput.trim()}>
                {t("join")}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="pt-4 space-y-3">
        <p className="text-sm font-medium">{group.name}</p>

        <div className="space-y-1">
          <Label>{t("inviteCode")}</Label>
          <div className="flex gap-2">
            <Input readOnly value={group.inviteCode} />
            <Button
              variant="outline"
              onClick={() => {
                navigator.clipboard.writeText(inviteLink);
                toast(t("linkCopied"), "success");
              }}
            >
              {t("copyLink")}
            </Button>
          </div>
          {isOwner && (
            <Button variant="ghost" size="sm" onClick={handleRegenerate} loading={busy}>
              {t("regenerateCode")}
            </Button>
          )}
        </div>

        <div className="space-y-1">
          <Label>{t("members", { count: members.length })}</Label>
          {members.map((m) => (
            <div key={m.userId} className="flex items-center justify-between text-sm">
              <span className="truncate">
                {m.userId === userId ? t("you") : m.userId.slice(0, 8)}
                {m.role === "owner" ? ` · ${t("owner")}` : ""}
              </span>
              {isOwner && m.userId !== userId && (
                <Button variant="ghost" size="sm" onClick={() => handleRemoveMember(m.userId)}>
                  {t("remove")}
                </Button>
              )}
            </div>
          ))}
        </div>

        <Button variant="destructive" className="w-full" onClick={handleLeave} loading={busy}>
          {t("leaveGroup")}
        </Button>
      </CardContent>
    </Card>
  );
}
