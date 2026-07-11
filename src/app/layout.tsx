import type { Metadata, Viewport } from "next";
import { SerwistProvider } from "@serwist/next/react";
import { ThemeProvider } from "@/components/theme-provider";
import { ToastProvider } from "@/components/ui/toast";
import { ConfirmDialogProvider } from "@/components/ui/confirm-dialog";
import { UpdateBanner } from "@/components/update-banner";
import "./globals.css";
import { Geist } from "next/font/google";
import { cn } from "@/lib/utils";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

export const metadata: Metadata = {
  title: "Finance OS",
  description: "Personal financial intelligence assistant",
  manifest: "/manifest.json",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Finance OS" },
};

export const viewport: Viewport = {
  themeColor: "#0d9488",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={cn("font-sans", geist.variable)}>
      <body>
        <SerwistProvider swUrl="/sw.js" disable={process.env.NODE_ENV === "development"}>
          <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
            <ToastProvider>
              <ConfirmDialogProvider>
                <UpdateBanner />
                {children}
              </ConfirmDialogProvider>
            </ToastProvider>
          </ThemeProvider>
        </SerwistProvider>
      </body>
    </html>
  );
}
