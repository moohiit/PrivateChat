import type * as Party from "partykit/server";
import { verifyConnectToken, type ConnectClaims } from "./auth";

/**
 * Conversation room (the default "main" party).
 * One instance per conversation. Relays ciphertext between the two members and
 * — when persistence is ON — stores ciphertext-only blobs in DO storage.
 * It is zero-knowledge: it never holds private keys, shared secrets, or plaintext.
 *
 * Phase 0: connection auth + relay skeleton only. Wiring for membership checks
 * (Phase 3), key-exchange relay (Phase 4), messaging (Phase 5), and persistence
 * (Phase 6) lands in later phases.
 */

type ConnState = { userId: string; username: string };

type StoredMessage = {
  id: string;
  senderId: string;
  ciphertext: string;
  iv: string;
  createdAt: number;
};

export default class ConversationServer implements Party.Server {
  constructor(readonly room: Party.Room) {}

  // Authenticate the connect token before the socket joins the room.
  // TODO(Phase 3): also verify this userId is one of the two conversation members.
  static async onBeforeConnect(request: Party.Request, lobby: Party.Lobby) {
    try {
      const token = new URL(request.url).searchParams.get("token") ?? "";
      const claims = await verifyConnectToken(
        token,
        lobby.env.JWT_SECRET as string,
      );
      request.headers.set("X-User-Id", claims.userId);
      request.headers.set("X-Username", claims.username);
      return request;
    } catch {
      return new Response("Unauthorized", { status: 401 });
    }
  }

  async onConnect(conn: Party.Connection<ConnState>, ctx: Party.ConnectionContext) {
    const claims: ConnectClaims = {
      userId: ctx.request.headers.get("X-User-Id") ?? "",
      username: ctx.request.headers.get("X-Username") ?? "",
    };
    conn.setState(claims);
    // TODO(Phase 6): if persistence is ON for this room, replay stored history.
  }

  async onMessage(raw: string, sender: Party.Connection<ConnState>) {
    // TODO(Phase 5): parse {type, ciphertext, iv}; relay to the other member.
    // TODO(Phase 6): if persistence ON, append a StoredMessage to storage.
    this.room.broadcast(raw, [sender.id]);
  }
}

// Silence "unused type" until Phase 6 wires persistence.
export type { StoredMessage };
