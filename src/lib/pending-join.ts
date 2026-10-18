/**
 * Preserves a group invite code (`/join?code=X`) across the logged-out /
 * not-yet-onboarded redirect, so the user lands back on /join afterwards.
 */
const KEY = "finance-os:pendingJoinCode";

export function stashPendingJoinCode(code: string | null | undefined) {
  if (!code) return;
  try {
    sessionStorage.setItem(KEY, code);
  } catch {
    // storage unavailable (private mode etc.) — invite link just won't resume
  }
}

/** Returns the path to continue to after auth/onboarding, consuming the stash. */
export function consumePostAuthPath(fallback = "/dashboard"): string {
  try {
    const code = sessionStorage.getItem(KEY);
    if (code) {
      sessionStorage.removeItem(KEY);
      return `/join?code=${encodeURIComponent(code)}`;
    }
  } catch {
    // ignore
  }
  return fallback;
}
