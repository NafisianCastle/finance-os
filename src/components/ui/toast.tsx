"use client";

import { cn } from "@/lib/utils";
import { CheckCircle2, XCircle, Info, X } from "lucide-react";
import { createContext, useCallback, useContext, useRef, useState } from "react";

type ToastVariant = "success" | "error" | "info";

interface ToastItem {
  id: number;
  message: string;
  variant: ToastVariant;
}

interface ToastContextValue {
  toast: (message: string, variant?: ToastVariant) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const ICONS: Record<ToastVariant, React.ElementType> = {
  success: CheckCircle2,
  error: XCircle,
  info: Info,
};

const STYLES: Record<ToastVariant, string> = {
  success: "border-primary/30 text-foreground [&_svg]:text-primary",
  error: "border-destructive/40 text-foreground [&_svg]:text-destructive",
  info: "border-border text-foreground [&_svg]:text-muted-foreground",
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const idRef = useRef(0);

  const toast = useCallback((message: string, variant: ToastVariant = "info") => {
    const id = ++idRef.current;
    setItems((prev) => [...prev, { id, message, variant }]);
    window.setTimeout(() => {
      setItems((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const dismiss = (id: number) => setItems((prev) => prev.filter((t) => t.id !== id));

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-20 z-[100] mx-auto flex w-full max-w-md flex-col gap-2 px-4">
        {items.map((item) => {
          const Icon = ICONS[item.variant];
          return (
            <div
              key={item.id}
              className={cn(
                "pointer-events-auto flex items-start gap-2 rounded-lg border bg-card px-3 py-2.5 text-sm shadow-lg animate-in fade-in slide-in-from-bottom-2",
                STYLES[item.variant],
              )}
            >
              <Icon className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="flex-1">{item.message}</span>
              <button
                onClick={() => dismiss(item.id)}
                aria-label="Dismiss"
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
