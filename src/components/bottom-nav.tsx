"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Home, List, PieChart, Target, Menu } from "lucide-react";
import { cn } from "@/lib/utils";

const links = [
  { href: "/dashboard", key: "home", icon: Home },
  { href: "/transactions", key: "activity", icon: List },
  { href: "/budgets", key: "budgets", icon: PieChart },
  { href: "/goals", key: "goals", icon: Target },
  { href: "/more", key: "more", icon: Menu },
] as const;

export function BottomNav() {
  const pathname = usePathname();
  const t = useTranslations("Nav");
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80">
      <div className="mx-auto flex max-w-md items-center justify-around px-2 pb-safe pt-2">
        {links.map(({ href, key, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex flex-col items-center gap-0.5 rounded-lg px-3 py-1.5 text-xs transition-colors",
                active ? "text-primary" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className="h-5 w-5" />
              <span>{t(key)}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
