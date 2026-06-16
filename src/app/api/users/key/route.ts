import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getUserById } from "@/lib/users";

/**
 * Fetch a user's ECDH public key by id. Used to derive the per-conversation
 * shared key. Requires a session. Returns public identity only.
 */
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const userId = new URL(req.url).searchParams.get("userId") ?? "";
  if (!userId || userId.length > 64) {
    return NextResponse.json({ error: "invalid userId" }, { status: 400 });
  }

  const user = await getUserById(userId);
  if (!user) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  return NextResponse.json({ userId: user.id, publicKey: user.public_key });
}
