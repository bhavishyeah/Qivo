/** Where a logged-in visitor of a guest-only page (landing, login, signup) should go. */
export function guestRedirectPath(hasToken: boolean, search: string): string | null {
  if (!hasToken) return null;
  const invite = new URLSearchParams(search).get("invite");
  return invite ? `/accept-invite?token=${encodeURIComponent(invite)}` : "/dashboard";
}