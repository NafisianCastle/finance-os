"use client";

import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import {
  CreditCard,
  HandCoins,
  Landmark,
  LineChart,
  Settings,
  FileText,
  Wallet,
} from "lucide-react";

const links = [
  { href: "/debt", label: "Debt manager", icon: CreditCard },
  { href: "/loans-given", label: "Loans given", icon: HandCoins },
  { href: "/liabilities", label: "Held money", icon: Wallet },
  { href: "/investments", label: "Investments", icon: LineChart },
  { href: "/reports", label: "Reports", icon: FileText },
  { href: "/settings", label: "Settings", icon: Settings },
];

export default function MorePage() {
  return (
    <AppShell title="More">
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
