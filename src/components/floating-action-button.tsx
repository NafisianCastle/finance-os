"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Plus } from "lucide-react";

export function FloatingActionButton() {
  const pathname = usePathname();
  if (pathname.startsWith("/transactions/new")) return null;

  return (
    <Link
      href="/transactions/new"
      aria-label="Add transaction"
      className="fixed bottom-[calc(5.5rem+env(safe-area-inset-bottom))] right-4 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform active:scale-95"
    >
      <Plus className="h-6 w-6" />
    </Link>
  );
}
