"use client";

import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";

/**
 * sw.ts is configured with skipWaiting + clientsClaim, so an updated service
 * worker takes control immediately rather than waiting for tabs to close.
 * That means the already-loaded page is now running old JS against a
 * worker/cache that may no longer have those old chunk files precached —
 * lazy-loaded chunks can 404. Prompt a reload instead of forcing one, so an
 * in-progress transaction entry isn't interrupted.
 */
export function UpdateBanner() {
  const [updateAvailable, setUpdateAvailable] = useState(false);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    const onControllerChange = () => setUpdateAvailable(true);
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    return () => navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
  }, []);

  if (!updateAvailable) return null;

  return (
    <div className="sticky top-0 z-50 flex items-center justify-between gap-2 bg-primary px-4 py-2 text-sm text-primary-foreground">
      <span>A new version is available.</span>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => window.location.reload()}
      >
        <RefreshCw className="h-3.5 w-3.5" />
        Refresh
      </Button>
    </div>
  );
}
