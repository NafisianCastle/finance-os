"use client";

import { Button } from "@/components/ui/button";
import { useTranslations } from "next-intl";
import { useEffect } from "react";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("Errors");
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-xl font-semibold">{t("title")}</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        {t("description")}
      </p>
      <div className="flex gap-2">
        <Button onClick={() => reset()}>{t("tryAgain")}</Button>
        <Button variant="outline" onClick={() => window.location.assign("/")}>
          {t("reload")}
        </Button>
      </div>
    </div>
  );
}
