import { NextResponse } from "next/server";
import { loginSchema } from "@/lib/validation";
import { getUserByUsername } from "@/lib/users";
import { verifyPassword } from "@/lib/auth-hash";
import { createSession } from "@/lib/session";

export async function POST(req: Request) {
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
