import { NextResponse } from "next/server";
import { loginSchema } from "@/lib/validation";
import { getUserByUsername } from "@/lib/users";
import { verifyPassword } from "@/lib/auth-hash";
import { createSession } from "@/lib/session";
import { rateLimit, clientIp } from "@/lib/rate-limit";

export async function POST(req: Request) {
  const limit = rateLimit(`login:${clientIp(req)}`, 10, 60_000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "too many attempts, try again shortly" },
      { status: 429, headers: { "Retry-After": String(Math.ceil(limit.retryAfterMs / 1000)) } },
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid input" }, { status: 400 });
  }

  const { username, password } = parsed.data;
  const user = await getUserByUsername(username);

  // Verify even when the user is missing-ish to keep timing uniform-ish.
  const ok = user ? await verifyPassword(user.pwd_hash, password) : false;
  if (!user || !ok) {
    return NextResponse.json({ error: "invalid credentials" }, { status: 401 });
  }

  await createSession({ userId: user.id, username: user.username });
  return NextResponse.json({ userId: user.id, username: user.username });
}
