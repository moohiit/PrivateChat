import { NextResponse } from "next/server";
import { getSession, mintConversationTicket } from "@/lib/session";
import { conversationId } from "@/lib/conversation-id";
import { getUserById } from "@/lib/users";
import { env } from "@/lib/env";

/**
 * Mints a conversation ticket for the session user to join a specific
 * conversation room on PartyKit. Membership is enforced here by recomputing the
 * conversation id from (me, peer): the room only accepts a ticket whose `cid`
 * equals the room id, so a user can only get a valid ticket for a conversation
 * they are actually part of.
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as {
    peerUserId?: string;
  } | null;
  const peerUserId = body?.peerUserId;
  if (!peerUserId || peerUserId === session.userId) {
    return NextResponse.json({ error: "invalid peer" }, { status: 400 });
  }

  // Peer must be a real user.
  if (!(await getUserById(peerUserId))) {
    return NextResponse.json({ error: "peer not found" }, { status: 404 });
  }

  const cid = conversationId(env.JWT_SECRET, session.userId, peerUserId);
  const token = await mintConversationTicket(session, cid, peerUserId);

  return NextResponse.json({
    token,
    conversationId: cid,
    host: env.NEXT_PUBLIC_PARTYKIT_HOST,
  });
}
