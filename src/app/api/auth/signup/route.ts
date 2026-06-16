import { NextResponse } from "next/server";
import { signupSchema } from "@/lib/validation";
import { createUser, getUserByUsername } from "@/lib/users";
import { hashPassword } from "@/lib/auth-hash";
import { createSession } from "@/lib/session";
import { newId } from "@/lib/ids";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = signupSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "invalid input" },
      { status: 400 },
    );
  }

  const { username, password, publicKey } = parsed.data;

  if (await getUserByUsername(username)) {
    return NextResponse.json({ error: "username taken" }, { status: 409 });
  }

  const id = newId();
  const pwdHash = await hashPassword(password);

  try {
    await createUser({ id, username, publicKey, pwdHash, createdAt: Date.now() });
  } catch {
    // Unique-index race: someone took the name between the check and insert.
    return NextResponse.json({ error: "username taken" }, { status: 409 });
  }

  await createSession({ userId: id, username });
  return NextResponse.json({ userId: id, username });
}
