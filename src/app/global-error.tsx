"use client";

import { useEffect } from "react";

// global-error replaces the root layout, so it renders outside
// NextIntlClientProvider (and the provider itself may be what failed).
// Messages are therefore static and bilingual (en + bn) rather than looked up.
const TEXT = {
  title: { en: "Finance OS hit a critical error", bn: "Finance OS-এ একটি গুরুতর ত্রুটি হয়েছে" },
  body: {
    en: "Your local data is safe on this device. Reload to continue.",
    bn: "আপনার লোকাল ডেটা এই ডিভাইসে নিরাপদ আছে। চালিয়ে যেতে রিলোড করুন।",
  },
  tryAgain: { en: "Try again", bn: "আবার চেষ্টা করুন" },
};

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <div
          style={{
            display: "flex",
            minHeight: "100vh",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "1rem",
            padding: "1.5rem",
            textAlign: "center",
            fontFamily: "system-ui, sans-serif",
          }}
        >
          <h1 style={{ fontSize: "1.25rem", fontWeight: 600 }}>
            {TEXT.title.en}
            <br />
            <span lang="bn">{TEXT.title.bn}</span>
          </h1>
          <p style={{ maxWidth: "24rem", fontSize: "0.875rem", color: "#666" }}>
            {TEXT.body.en}
            <br />
            <span lang="bn">{TEXT.body.bn}</span>
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              padding: "0.5rem 1rem",
              borderRadius: "0.375rem",
              background: "#0d9488",
              color: "white",
              border: "none",
              cursor: "pointer",
            }}
          >
            {TEXT.tryAgain.en} / <span lang="bn">{TEXT.tryAgain.bn}</span>
          </button>
        </div>
      </body>
    </html>
  );
}
