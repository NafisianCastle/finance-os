"use client";

import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import {
  Brain,
  CreditCard,
  HandCoins,
  Landmark,
  LineChart,
  Settings,
  FileText,
  Wallet,
} from "lucide-react";
import { useTranslations } from "next-intl";

export default function MorePage() {
  const t = useTranslations("More");

  const links = [
    { href: "/smart-buy", label: t("smartBuy"), icon: Brain },
    { href: "/debt", label: t("debtManager"), icon: CreditCard },
    { href: "/loans-given", label: t("loansGiven"), icon: HandCoins },
    { href: "/liabilities", label: t("heldMoney"), icon: Wallet },
    { href: "/investments", label: t("investments"), icon: LineChart },
    { href: "/reports", label: t("reports"), icon: FileText },
    { href: "/settings", label: t("settings"), icon: Settings },
  ];

  return (
    <AppShell title={t("title")}>
      <div className="space-y-2">
        {links.map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href}>
            <Card className="transition-colors hover:bg-accent/50">
              <CardContent className="flex items-center gap-3 py-4">
                <Icon className="h-5 w-5 text-primary" />
                <span className="font-medium">{label}</span>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </AppShell>
  );
}
