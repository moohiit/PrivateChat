import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { createKeyBackup, getKeyBackup, getUserById } from "@/lib/users";
import { wrappedKeySchema } from "@/lib/validation";

/**
 * Returns the session user's zero-knowledge encrypted key backup (ciphertext
 * only) plus their public key, so a new device can restore the private key by
 * unwrapping it with the passphrase. The server cannot read the private key.
 */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const backup = await getKeyBackup(session.userId);
  if (!backup) {
    return NextResponse.json({ backup: null });
  }

  const user = await getUserById(session.userId);
  return NextResponse.json({
    backup: {
      ...backup,
      publicKey: user?.public_key ?? "",
    },
  });
}

/**
 * Upsert the session user's encrypted key backup. Used to backfill backups for
 * accounts created before backup existed (called from the device that holds the
 * key). Idempotent.
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const parsed = wrappedKeySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid backup" }, { status: 400 });
  }

  await createKeyBackup(session.userId, parsed.data);
  return NextResponse.json({ ok: true });
}
