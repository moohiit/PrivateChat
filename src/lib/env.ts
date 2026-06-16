/**
 * Centralized environment access. Throws early (at first use) if a required
 * server-side var is missing, so misconfiguration fails loud rather than at a
 * random request. Only read these on the server (API routes / scripts).
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export const env = {
  // Turso (libSQL) — identity registry only.
  get TURSO_DATABASE_URL() {
    return required("TURSO_DATABASE_URL");
  },
  get TURSO_AUTH_TOKEN() {
    // Optional for local file/dev DBs; required for remote Turso.
    return process.env.TURSO_AUTH_TOKEN ?? "";
  },
  // Shared secret used to sign/verify the short-lived PartyKit connect token.
  get JWT_SECRET() {
    return required("JWT_SECRET");
  },
  // Public PartyKit host the browser connects to (e.g. localhost:1999 in dev).
  get NEXT_PUBLIC_PARTYKIT_HOST() {
    return process.env.NEXT_PUBLIC_PARTYKIT_HOST ?? "127.0.0.1:1999";
  },
};
