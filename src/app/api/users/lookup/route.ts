import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getUserByUsername, toPublicUser } from "@/lib/users";
import { usernameSchema } from "@/lib/validation";

/**
 * Look up a user by username to start a chat. Returns public identity only
 * (id, username, public key). Requires a session so the registry isn't openly
 * enumerable by anonymous clients.
 */
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const raw = new URL(req.url).searchParams.get("username") ?? "";
  const parsed = usernameSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid username" }, { status: 400 });
  }

  const user = await getUserByUsername(parsed.data);
  if (!user) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  return NextResponse.json({ user: toPublicUser(user) });
}
