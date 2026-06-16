import { NextResponse } from "next/server";
import { getSession, mintConnectToken } from "@/lib/session";
import { env } from "@/lib/env";

/**
 * Mints the short-lived token the browser passes to PartyKit on connect.
 * Requires an authenticated session.
 */
export async function POST() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const token = await mintConnectToken(session);
  return NextResponse.json({
    token,
    host: env.NEXT_PUBLIC_PARTYKIT_HOST,
  });
}
