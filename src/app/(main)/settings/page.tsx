"use client";

import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { getDb, resetLocalDatabase } from "@/infrastructure/db/dexie/database";
import {
  createClient,
  isSupabaseConfigured,
} from "@/infrastructure/supabase/client";
import {
  enqueueSync,
  exportUserDataAsJson,
  forceFullResync,
  mergeDuplicateAccounts,
  mergeDuplicateGoals,
  processSyncQueue,
  repairAccountSync,
  repairLocalBudgets,
} from "@/infrastructure/sync/sync-queue";
import { useCurrencyFormatter } from "@/hooks/use-currency-formatter";
import { useAppStore } from "@/store/app-store";
import type { Account } from "@/infrastructure/db/dexie/schema";
import { ACCOUNT_TYPES, SUPPORTED_CURRENCIES, SUPPORTED_UI_LOCALES } from "@/lib/constants";
import { Loader2, Moon, Sun, Plus, Trash2 } from "lucide-react";
import { useTheme } from "next-themes";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { v4 as uuid } from "uuid";

export default function SettingsPage() {
  const t = useTranslations("Settings");
  const router = useRouter();
  const userId = useAppStore((s) => s.userId);
  const setUserId = useAppStore((s) => s.setUserId);
  const { theme, setTheme } = useTheme();
  const { toast } = useToast();
  const confirm = useConfirm();
  const { currencyCode, locale, toMinor, toMajor } = useCurrencyFormatter();

  const ACCOUNT_TYPE_OPTIONS = [
    { v: ACCOUNT_TYPES.CASH, l: t("accountTypeCash") },
    { v: ACCOUNT_TYPES.BANK, l: t("accountTypeBank") },
    { v: ACCOUNT_TYPES.WALLET, l: t("accountTypeWallet") },
    { v: ACCOUNT_TYPES.CREDIT_CARD, l: t("accountTypeCreditCard") },
  ];

  const [income, setIncome] = useState("");
  const [savingIncome, setSavingIncome] = useState(false);
  const [savingCurrency, setSavingCurrency] = useState(false);
  const [uiLocale, setUiLocale] = useState(locale.split("-")[0]);
  const [currency, setCurrency] = useState(currencyCode);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState("");
  const [email, setEmail] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [balanceInputs, setBalanceInputs] = useState<Record<string, string>>({});
  const [savingAccountId, setSavingAccountId] = useState<string | null>(null);
  const [resettingPassword, setResettingPassword] = useState(false);
  const [repairing, setRepairing] = useState(false);
  const [newAccountName, setNewAccountName] = useState("");
  const [newAccountType, setNewAccountType] = useState<number>(ACCOUNT_TYPES.WALLET);
  const [newAccountBalance, setNewAccountBalance] = useState("");
  const [creatingAccount, setCreatingAccount] = useState(false);
  const [deletingAccountId, setDeletingAccountId] = useState<string | null>(null);

  useEffect(() => {
    setCurrency(currencyCode);
    setUiLocale(locale.split("-")[0]);
  }, [currencyCode, locale]);

  useEffect(() => {
    if (!userId) return;
    getDb()
      .userProfiles.where("userId")
      .equals(userId)
      .first()
      .then((p) => {
        if (p) setIncome(String(toMajor(p.monthlyIncomePoisha)));
      });
  }, [userId, toMajor]);

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
          Object.fromEntries(accs.map((a) => [a.id, String(toMajor(a.balancePoisha))])),
        );
      });
  }, [userId, toMajor]);

  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    const supabase = createClient();
    if (!supabase) return;
    supabase.auth.getUser().then(({ data }) => {
      setEmail(data.user?.email ?? null);
    });
  }, [userId]);

  async function saveAccountBalance(acc: Account) {
    if (!userId) return;
    const amount = parseFloat(balanceInputs[acc.id]);
    if (Number.isNaN(amount) || amount < 0) {
      toast(t("invalidAmount"), "error");
      return;
    }
    setSavingAccountId(acc.id);
    const balancePoisha = toMinor(amount);
    const now = new Date().toISOString();
    await getDb().accounts.update(acc.id, { balancePoisha, updatedAt: now });
    await enqueueSync("accounts", acc.id, "upsert", {
      id: acc.id,
      type_smallint: acc.type,
      name: acc.name,
      balance_poisha: balancePoisha,
    });
    setAccounts((prev) => prev?.map((a) => (a.id === acc.id ? { ...a, balancePoisha } : a)) ?? prev);
    setSavingAccountId(null);
    toast(t("balanceUpdated", { name: acc.name }), "success");
  }

  async function handleCreateAccount() {
    if (!userId || !newAccountName.trim()) return;
    const amount = parseFloat(newAccountBalance) || 0;
    if (amount < 0) {
      toast(t("invalidAmount"), "error");
      return;
    }
    setCreatingAccount(true);
    const now = new Date().toISOString();
    const acc: Account = {
      id: uuid(),
      userId,
      type: newAccountType,
      name: newAccountName.trim(),
      balancePoisha: toMinor(amount),
      createdAt: now,
      updatedAt: now,
    };
    await getDb().accounts.put(acc as never);
    await enqueueSync("accounts", acc.id, "upsert", {
      id: acc.id,
      type_smallint: acc.type,
      name: acc.name,
      balance_poisha: acc.balancePoisha,
    });
    setAccounts((prev) => [...(prev ?? []), acc]);
    setBalanceInputs((prev) => ({ ...prev, [acc.id]: String(toMajor(acc.balancePoisha)) }));
    setNewAccountName("");
    setNewAccountBalance("");
    setCreatingAccount(false);
    toast(t("accountAdded", { name: acc.name }), "success");
  }

  async function handleDeleteAccount(acc: Account) {
    if (!userId) return;
    const ok = await confirm({
      title: t("removeAccountTitle", { name: acc.name }),
      description: t("removeAccountDescription"),
      confirmLabel: t("remove"),
      variant: "destructive",
    });
    if (!ok) return;
    setDeletingAccountId(acc.id);
    const now = new Date().toISOString();
    await getDb().accounts.update(acc.id, { deletedAt: now, updatedAt: now });
    await enqueueSync("accounts", acc.id, "delete", { id: acc.id });
    setAccounts((prev) => prev?.filter((a) => a.id !== acc.id) ?? prev);
    setDeletingAccountId(null);
    toast(t("accountRemoved", { name: acc.name }), "success");
  }

  async function saveProfile() {
    if (!userId) return;
    const amount = parseFloat(income);
    if (Number.isNaN(amount) || amount < 0) {
      toast(t("invalidIncome"), "error");
      return;
    }
    setSavingIncome(true);
    const profile = await getDb()
      .userProfiles.where("userId")
      .equals(userId)
      .first();
    if (!profile) {
      setSavingIncome(false);
      return;
    }
    const now = new Date().toISOString();
    await getDb().userProfiles.update(profile.id, {
      monthlyIncomePoisha: toMinor(amount),
      updatedAt: now,
    });
    setSavingIncome(false);
    toast(t("incomeSaved"), "success");
  }

  async function saveCurrencyAndLocale() {
    if (!userId) return;
    setSavingCurrency(true);
    const profile = await getDb()
      .userProfiles.where("userId")
      .equals(userId)
      .first();
    if (!profile) {
      setSavingCurrency(false);
      return;
    }
    const now = new Date().toISOString();
    await getDb().userProfiles.update(profile.id, {
      currencyCode: currency,
      locale: uiLocale,
      updatedAt: now,
    });
    await enqueueSync("user_profiles", profile.id, "upsert", {
      id: profile.id,
      currency_code: currency,
      locale: uiLocale,
    });
    document.cookie = `NEXT_LOCALE=${uiLocale}; path=/; max-age=31536000`;
    setSavingCurrency(false);
    toast(t("currencySaved"), "success");
    router.refresh();
  }

  async function handleSync() {
    if (!userId) return;
    setSyncing(true);
    await repairAccountSync(userId);
    const { pushed, errors, lastError } = await processSyncQueue(userId);
    const msg =
      errors > 0
        ? t("syncResultWithErrors", { pushed, errors, lastError: lastError ?? "" })
        : t("syncResultOk", { pushed });
    setSyncMsg(msg);
    setSyncing(false);
    toast(msg, errors ? "error" : "success");
  }

  async function handleFixDuplicates() {
    if (!userId) return;
    const ok = await confirm({
      title: t("fixDuplicatesTitle"),
      description: t("fixDuplicatesDescription"),
      confirmLabel: t("fix"),
      variant: "destructive",
    });
    if (!ok) return;
    setSyncing(true);
    const [{ merged: mergedAccounts, groups: accountGroups }, { merged: mergedGoals, groups: goalGroups }] =
      await Promise.all([mergeDuplicateAccounts(userId), mergeDuplicateGoals(userId)]);
    await repairLocalBudgets(userId);
    setSyncing(false);
    const parts: string[] = [];
    if (accountGroups > 0) parts.push(t("mergedAccountsCount", { count: mergedAccounts }));
    if (goalGroups > 0) parts.push(t("mergedGoalsCount", { count: mergedGoals }));
    toast(
      parts.length > 0
        ? t("fixedDuplicates", { parts: parts.join(", ") })
        : t("noDuplicatesFound"),
      "success"
    );
  }

  async function handleForceResync() {
    if (!userId) return;
    setSyncing(true);
    const { pushed, errors, pulled } = await forceFullResync(userId);
    setSyncing(false);
    toast(
      errors > 0
        ? t("resyncResultWithErrors", { pushed, pulled, errors })
        : t("resyncResultOk", { pushed, pulled }),
      errors ? "error" : "success"
    );
  }

  async function handleExportData() {
    if (!userId) return;
    const data = await exportUserDataAsJson(userId);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `finance-os-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast(t("backupDownloaded"), "success");
  }

  async function handleChangePassword() {
    if (!email) return;
    setResettingPassword(true);
    const supabase = createClient();
    if (!supabase) {
      setResettingPassword(false);
      return;
    }
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    setResettingPassword(false);
    toast(
      error ? t("resetEmailFailed", { message: error.message }) : t("resetEmailSent"),
      error ? "error" : "success",
    );
  }

  async function handleRepairDatabase() {
    const ok = await confirm({
      title: t("repairTitle"),
      description: t("repairDescription"),
      confirmLabel: t("clearData"),
      variant: "destructive",
    });
    if (!ok) return;
    setRepairing(true);
    await resetLocalDatabase();
    setUserId(null);
    router.push("/onboarding");
  }

  async function handleLogout() {
    const ok = await confirm({
      title: t("logoutTitle"),
      description: isSupabaseConfigured()
        ? t("logoutDescriptionCloud")
        : t("logoutDescriptionLocal"),
      confirmLabel: t("logout"),
      variant: "destructive",
    });
    if (!ok) return;

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
    <AppShell title={t("title")}>
      <div className="space-y-4">
        <Card>
          <CardContent className="pt-4 space-y-3">
            <div className="space-y-2">
              <Label htmlFor="income">{t("monthlyIncome", { currency: currencyCode })}</Label>
              <Input
                id="income"
                type="number"
                min={0}
                value={income}
                onChange={(e) => setIncome(e.target.value)}
              />
            </div>
            <Button
              onClick={saveProfile}
              variant="secondary"
              className="w-full"
              disabled={savingIncome}
            >
              {savingIncome && <Loader2 className="h-4 w-4 animate-spin" />}
              {t("saveIncome")}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4 space-y-3">
            <p className="text-sm font-medium">{t("accountBalances")}</p>
            <p className="text-sm text-muted-foreground">
              {t("accountBalancesDescription")}
            </p>
            {accounts === null ? (
              <div className="space-y-2">
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
              </div>
            ) : (
              accounts.map((acc) => (
                <div key={acc.id} className="flex items-end gap-2">
                  <div className="flex-1 space-y-1">
                    <Label htmlFor={`bal-${acc.id}`}>{acc.name}</Label>
                    <Input
                      id={`bal-${acc.id}`}
                      type="number"
                      min={0}
                      value={balanceInputs[acc.id] ?? ""}
                      onChange={(e) =>
                        setBalanceInputs((prev) => ({ ...prev, [acc.id]: e.target.value }))
                      }
                    />
                  </div>
                  <Button
                    variant="secondary"
                    onClick={() => saveAccountBalance(acc)}
                    disabled={savingAccountId === acc.id}
                  >
                    {savingAccountId === acc.id && <Loader2 className="h-4 w-4 animate-spin" />}
                    {t("save")}
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label={t("removeAria", { name: acc.name })}
                    onClick={() => handleDeleteAccount(acc)}
                    disabled={deletingAccountId === acc.id}
                  >
                    {deletingAccountId === acc.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4 text-destructive" />
                    )}
                  </Button>
                </div>
              ))
            )}

            <div className="border-t border-border pt-3 space-y-2">
              <Label>{t("addAccount")}</Label>
              <div className="flex gap-2">
                <Input
                  placeholder={t("addAccountPlaceholder")}
                  value={newAccountName}
                  onChange={(e) => setNewAccountName(e.target.value)}
                  className="flex-1"
                />
                <select
                  className="flex h-10 rounded-lg border border-input bg-background px-2 text-sm"
                  value={newAccountType}
                  onChange={(e) => setNewAccountType(Number(e.target.value))}
                >
                  {ACCOUNT_TYPE_OPTIONS.map((opt) => (
                    <option key={opt.v} value={opt.v}>{opt.l}</option>
                  ))}
                </select>
              </div>
              <div className="flex gap-2">
                <Input
                  type="number"
                  min={0}
                  placeholder={t("startingBalance", { currency: currencyCode })}
                  value={newAccountBalance}
                  onChange={(e) => setNewAccountBalance(e.target.value)}
                  className="flex-1"
                />
                <Button
                  variant="secondary"
                  className="gap-1.5 shrink-0"
                  onClick={handleCreateAccount}
                  disabled={creatingAccount || !newAccountName.trim()}
                >
                  {creatingAccount ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  {t("add")}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4 space-y-3">
            <p className="text-sm font-medium">{t("currency")}</p>
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

            <p className="text-sm font-medium mt-2">{t("language")}</p>
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

            <Button
              onClick={saveCurrencyAndLocale}
              variant="secondary"
              className="w-full"
              disabled={savingCurrency}
            >
              {savingCurrency && <Loader2 className="h-4 w-4 animate-spin" />}
              {t("saveCurrencyLanguage")}
            </Button>

            <p className="text-sm font-medium mt-2">{t("cloudSync")}</p>
            <p className="text-sm text-muted-foreground">
              {isSupabaseConfigured() ? t("cloudSyncConfigured") : t("cloudSyncOffline")}
            </p>
            {isSupabaseConfigured() && (
              <Button
                onClick={handleSync}
                disabled={syncing}
                className="w-full"
              >
                {syncing && <Loader2 className="h-4 w-4 animate-spin" />}
                {syncing ? t("syncing") : t("syncNow")}
              </Button>
            )}
            {syncMsg && (
              <p className="text-xs text-muted-foreground">{syncMsg}</p>
            )}
            {isSupabaseConfigured() && (
              <>
                <p className="text-sm font-medium mt-2">{t("duplicates")}</p>
                <p className="text-sm text-muted-foreground">
                  {t("duplicatesDescription")}
                </p>
                <Button
                  onClick={handleFixDuplicates}
                  disabled={syncing}
                  variant="outline"
                  className="w-full"
                >
                  {t("fixDuplicates")}
                </Button>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4 space-y-3">
            <p className="text-sm font-medium">{t("diagnostics")}</p>
            <p className="text-sm text-muted-foreground">
              {t("diagnosticsDescription")}
            </p>
            <Button onClick={handleExportData} variant="outline" className="w-full">
              {t("exportData")}
            </Button>
            {isSupabaseConfigured() && (
              <Button
                onClick={handleForceResync}
                disabled={syncing}
                variant="outline"
                className="w-full"
              >
                {t("forceResync")}
              </Button>
            )}
          </CardContent>
        </Card>

        {isSupabaseConfigured() && (
          <Card>
            <CardContent className="pt-4 space-y-3">
              <p className="text-sm font-medium">{t("manageAccount")}</p>
              <p className="text-sm text-muted-foreground">
                {email ?? t("notSignedIn")}
              </p>
              <Button
                variant="outline"
                className="w-full"
                onClick={handleChangePassword}
                disabled={!email || resettingPassword}
              >
                {resettingPassword && <Loader2 className="h-4 w-4 animate-spin" />}
                {t("changePassword")}
              </Button>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent className="pt-4 flex items-center justify-between">
            <span className="font-medium">{t("theme")}</span>
            <Button
              variant="outline"
              size="icon"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              aria-label={t("toggleTheme")}
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
          onClick={handleRepairDatabase}
          disabled={repairing}
        >
          {repairing && <Loader2 className="h-4 w-4 animate-spin" />}
          {t("repairDatabase")}
        </Button>

        <Button variant="destructive" className="w-full" onClick={handleLogout}>
          {t("logout")}
        </Button>
      </div>
    </AppShell>
  );
}
