import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getUserById, toProfile, updateProfile } from "@/lib/users";

/**
 * Public profile (display name + avatar). GET with ?userId= returns that user's
 * profile; without it returns your own. POST updates your own profile. These are
 * public identity fields (like username/public key) — never message content.
 */

const MAX_NAME = 40;
const MAX_AVATAR = 96 * 1024; // base64 data URL cap (~64 KB of image bytes)

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const userId = new URL(req.url).searchParams.get("userId") ?? session.userId;
  if (userId.length > 64) {
    return NextResponse.json({ error: "invalid userId" }, { status: 400 });
  }

  const user = await getUserById(userId);
  if (!user) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ profile: toProfile(user) });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { displayName?: unknown; avatar?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  // Normalize display name: trim, empty -> null.
  let displayName: string | null = null;
  if (typeof body.displayName === "string") {
    const t = body.displayName.trim();
    if (t.length > MAX_NAME) {
      return NextResponse.json({ error: "name too long" }, { status: 400 });
    }
    displayName = t.length > 0 ? t : null;
  }

  // Normalize avatar: must be a small image data URL, or null to clear.
  let avatar: string | null = null;
  if (typeof body.avatar === "string" && body.avatar.length > 0) {
    if (!body.avatar.startsWith("data:image/")) {
      return NextResponse.json({ error: "invalid avatar" }, { status: 400 });
    }
    if (body.avatar.length > MAX_AVATAR) {
      return NextResponse.json({ error: "avatar too large" }, { status: 400 });
    }
    avatar = body.avatar;
  }

  await updateProfile(session.userId, { displayName, avatar });
  return NextResponse.json({ ok: true, profile: { displayName, avatar } });
}
