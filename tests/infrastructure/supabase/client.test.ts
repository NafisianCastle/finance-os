import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ORIGINAL_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

afterEach(() => {
  vi.resetModules();
  if (ORIGINAL_URL === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else process.env.NEXT_PUBLIC_SUPABASE_URL = ORIGINAL_URL;
  if (ORIGINAL_KEY === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = ORIGINAL_KEY;
});

describe("isSupabaseConfigured", () => {
  it("is false when the env vars are missing", async () => {
    vi.resetModules();
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const { isSupabaseConfigured } = await import("@/infrastructure/supabase/client");
    expect(isSupabaseConfigured()).toBe(false);
  });

  it("is false for the placeholder project URL", async () => {
    vi.resetModules();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://your-project.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
    const { isSupabaseConfigured } = await import("@/infrastructure/supabase/client");
    expect(isSupabaseConfigured()).toBe(false);
  });

  it("is true with a real-looking URL and key", async () => {
    vi.resetModules();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://abcxyz.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
    const { isSupabaseConfigured } = await import("@/infrastructure/supabase/client");
    expect(isSupabaseConfigured()).toBe(true);
  });
});

describe("createClient", () => {
  it("returns null when unconfigured", async () => {
    vi.resetModules();
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const { createClient } = await import("@/infrastructure/supabase/client");
    expect(createClient()).toBeNull();
  });
});
