/**
 * Best-effort in-memory rate limiter (fixed window). Useful against bursts on a
 * warm instance. NOTE: on serverless (Vercel) each instance has its own memory,
 * so this is not a global limit — for production-grade limiting back it with
 * Upstash Redis (see SECURITY.md). Argon2's cost also throttles auth brute-force.
 */

type Bucket = { count: number; reset: number };

const buckets = new Map<string, Bucket>();

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): { ok: boolean; retryAfterMs: number } {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || now > bucket.reset) {
    buckets.set(key, { count: 1, reset: now + windowMs });
    return { ok: true, retryAfterMs: 0 };
  }
  if (bucket.count >= limit) {
    return { ok: false, retryAfterMs: bucket.reset - now };
  }
  bucket.count += 1;
  return { ok: true, retryAfterMs: 0 };
}

/** Derive a client key from the forwarded IP (best-effort). */
export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}
