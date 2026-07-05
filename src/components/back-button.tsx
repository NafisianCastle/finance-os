"use client";

import { ArrowLeft } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";

const ROOT_PATHS = ["/dashboard", "/transactions", "/budgets", "/goals", "/more"];

export function BackButton() {
  const router = useRouter();
  const pathname = usePathname();

  if (ROOT_PATHS.includes(pathname)) return null;

  return (
    <button
      type="button"
      onClick={() => router.back()}
      aria-label="Go back"
      className="fixed left-3 top-3 z-50 flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card/95 text-foreground shadow-sm backdrop-blur supports-[backdrop-filter]:bg-card/80"
    >
      <ArrowLeft className="h-5 w-5" />
    </button>
  );
}
