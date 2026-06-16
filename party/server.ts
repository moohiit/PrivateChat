import type * as Party from "partykit/server";
import { verifyConversationTicket } from "./auth";
import type { ChatClientMessage, ChatServerMessage } from "../src/lib/protocol";

/**
 * Conversation room (the default "main" party). One instance per conversation,
 * named by the conversation id. Only the two members may join (enforced by the
 * signed conversation ticket whose `cid` must equal this room's id). It relays
 * ciphertext + receipts + typing between members and reports peer room-presence.
 *
 * Zero-knowledge: it only ever sees ciphertext, never keys or plaintext.
 * Phase 5 is relay-only; ciphertext persistence (opt-in) arrives in Phase 6.
 */

type ConnState = { userId: string; username: string };

export default class ConversationServer implements Party.Server {
  /** userId -> connection ids (one user may have multiple tabs/devices) */
  private readonly members = new Map<string, Set<string>>();

  constructor(readonly room: Party.Room) {}

  static async onBeforeConnect(request: Party.Request, lobby: Party.Lobby) {
    try {
      const token = new URL(request.url).searchParams.get("token") ?? "";
      const claims = await verifyConversationTicket(
        token,
        lobby.env.JWT_SECRET as string,
      );
      // The ticket must be for THIS conversation room.
      if (claims.conversationId !== lobby.id) {
        return new Response("Forbidden", { status: 403 });
      }
      request.headers.set("X-User-Id", claims.userId);
      request.headers.set("X-Username", claims.username);
      return request;
    } catch {
      return new Response("Unauthorized", { status: 401 });
    }
  }

  async onConnect(conn: Party.Connection<ConnState>, ctx: Party.ConnectionContext) {
    const userId = ctx.request.headers.get("X-User-Id") ?? "";
    const username = ctx.request.headers.get("X-Username") ?? "";
    if (!userId) {
      conn.close(1008, "unauthorized");
      return;
    }
    conn.setState({ userId, username });

    const firstConnForUser = (this.members.get(userId)?.size ?? 0) === 0;
    const conns = this.members.get(userId) ?? new Set<string>();
    conns.add(conn.id);
    this.members.set(userId, conns);

    // Tell the newcomer whether the peer is currently in the room.
    this.send(conn, { type: "peer:presence", online: this.peerOnline(userId) });

    // If this user just entered, let the peer know.
    if (firstConnForUser) {
      this.toPeer(userId, { type: "peer:presence", online: true });
    }
  }

  async onMessage(raw: string, sender: Party.Connection<ConnState>) {
    const me = sender.state;
    if (!me?.userId) return;

    let msg: ChatClientMessage;
    try {
      msg = JSON.parse(raw) as ChatClientMessage;
    } catch {
      return;
    }

    switch (msg.type) {
      case "message:send":
        // Relay ciphertext to the peer (and the sender's other tabs).
        this.broadcastExcept(sender.id, {
          type: "message:relay",
          id: msg.id,
          from: me.userId,
          ciphertext: msg.ciphertext,
          iv: msg.iv,
          sentAt: msg.sentAt,
        });
        return;
      case "receipt":
        this.broadcastExcept(sender.id, {
          type: "receipt",
          id: msg.id,
          state: msg.state,
        });
        return;
      case "typing":
        this.broadcastExcept(sender.id, { type: "peer:typing", on: msg.on });
        return;
    }
  }

  async onClose(conn: Party.Connection<ConnState>) {
    this.handleLeave(conn);
  }

  async onError(conn: Party.Connection<ConnState>) {
    this.handleLeave(conn);
  }

  private handleLeave(conn: Party.Connection<ConnState>) {
    const userId = conn.state?.userId;
    if (!userId) return;
    const conns = this.members.get(userId);
    if (!conns) return;
    conns.delete(conn.id);
    if (conns.size === 0) {
      this.members.delete(userId);
      this.toPeer(userId, { type: "peer:presence", online: false });
    }
  }

  private peerOnline(selfUserId: string): boolean {
    for (const [userId, conns] of this.members) {
      if (userId !== selfUserId && conns.size > 0) return true;
    }
    return false;
  }

  private send(conn: Party.Connection<ConnState>, msg: ChatServerMessage) {
    conn.send(JSON.stringify(msg));
  }

  /** Broadcast to everyone except the given connection id. */
  private broadcastExcept(connId: string, msg: ChatServerMessage) {
    this.room.broadcast(JSON.stringify(msg), [connId]);
  }

  /** Send to the other member only (exclude all of this user's connections). */
  private toPeer(selfUserId: string, msg: ChatServerMessage) {
    const exclude = [...(this.members.get(selfUserId) ?? [])];
    this.room.broadcast(JSON.stringify(msg), exclude);
  }
}
