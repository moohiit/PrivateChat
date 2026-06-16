import type * as Party from "partykit/server";
import { verifyConversationTicket } from "./auth";
import type {
  ChatClientMessage,
  ChatServerMessage,
  StoredMessage,
} from "../src/lib/protocol";

/**
 * Conversation room (the default "main" party). One instance per conversation,
 * named by the conversation id. Only the two members may join (enforced by the
 * signed conversation ticket whose `cid` must equal this room's id). It relays
 * ciphertext + receipts + typing between members and reports peer presence.
 *
 * Persistence (Phase 6): each member sets a persist preference. History is
 * stored ONLY while both agree (effective = AND of both prefs). Stored blobs are
 * ciphertext-only — the server can never read them. History replays on join.
 *
 * Zero-knowledge: it only ever sees ciphertext, never keys or plaintext.
 */

type ConnState = { userId: string; username: string; peerId: string };

const PREFS_KEY = "meta:prefs";
const MEMBERS_KEY = "meta:members";
const MSG_PREFIX = "msg:";
const MAX_HISTORY = 500;

export default class ConversationServer implements Party.Server {
  /** userId -> connection ids (one user may have multiple tabs/devices) */
  private readonly members = new Map<string, Set<string>>();

  /** persist preference per userId (durable, mirrored from storage) */
  private prefs: Record<string, boolean> = {};
  /** the two member userIds (durable) */
  private pair: string[] = [];
  private loaded = false;

  constructor(readonly room: Party.Room) {}

  static async onBeforeConnect(request: Party.Request, lobby: Party.Lobby) {
    try {
      const token = new URL(request.url).searchParams.get("token") ?? "";
      const claims = await verifyConversationTicket(
        token,
        lobby.env.JWT_SECRET as string,
      );
      if (claims.conversationId !== lobby.id) {
        return new Response("Forbidden", { status: 403 });
      }
      request.headers.set("X-User-Id", claims.userId);
      request.headers.set("X-Username", claims.username);
      request.headers.set("X-Peer-Id", claims.peerId);
      return request;
    } catch {
      return new Response("Unauthorized", { status: 401 });
    }
  }

  private async ensureLoaded() {
    if (this.loaded) return;
    this.prefs =
      (await this.room.storage.get<Record<string, boolean>>(PREFS_KEY)) ?? {};
    this.pair = (await this.room.storage.get<string[]>(MEMBERS_KEY)) ?? [];
    this.loaded = true;
  }

  async onConnect(conn: Party.Connection<ConnState>, ctx: Party.ConnectionContext) {
    const userId = ctx.request.headers.get("X-User-Id") ?? "";
    const username = ctx.request.headers.get("X-Username") ?? "";
    const peerId = ctx.request.headers.get("X-Peer-Id") ?? "";
    if (!userId) {
      conn.close(1008, "unauthorized");
      return;
    }
    conn.setState({ userId, username, peerId });
    await this.ensureLoaded();

    // Record the conversation's two members the first time we see them.
    if (this.pair.length < 2 && peerId) {
      this.pair = [userId, peerId].sort();
      await this.room.storage.put(MEMBERS_KEY, this.pair);
    }

    const firstConnForUser = (this.members.get(userId)?.size ?? 0) === 0;
    const conns = this.members.get(userId) ?? new Set<string>();
    conns.add(conn.id);
    this.members.set(userId, conns);

    // Peer room-presence.
    this.send(conn, { type: "peer:presence", online: this.peerOnline(userId) });
    if (firstConnForUser) {
      this.toPeer(userId, { type: "peer:presence", online: true });
    }

    // Persistence state for this user + any stored history.
    this.send(conn, {
      type: "persist:state",
      mine: this.prefs[userId] === true,
      effective: this.effectivePersist(),
    });
    const history = await this.loadHistory();
    this.send(conn, { type: "history", messages: history });
  }

  async onMessage(raw: string, sender: Party.Connection<ConnState>) {
    const me = sender.state;
    if (!me?.userId) return;
    await this.ensureLoaded();

    let msg: ChatClientMessage;
    try {
      msg = JSON.parse(raw) as ChatClientMessage;
    } catch {
      return;
    }

    switch (msg.type) {
      case "message:send": {
        this.broadcastExcept(sender.id, {
          type: "message:relay",
          id: msg.id,
          from: me.userId,
          ciphertext: msg.ciphertext,
          iv: msg.iv,
          sentAt: msg.sentAt,
        });
        // Persist ciphertext only while both members agree.
        if (this.effectivePersist()) {
          const stored: StoredMessage = {
            id: msg.id,
            from: me.userId,
            ciphertext: msg.ciphertext,
            iv: msg.iv,
            sentAt: msg.sentAt,
          };
          await this.room.storage.put(this.msgKey(stored), stored);
        }
        return;
      }
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
      case "persist:set":
        this.prefs[me.userId] = msg.on === true;
        await this.room.storage.put(PREFS_KEY, this.prefs);
        this.broadcastPersistState();
        return;
      case "history:clear":
        await this.clearHistory();
        this.broadcast({ type: "history:cleared" });
        return;
    }
  }

  async onClose(conn: Party.Connection<ConnState>) {
    this.handleLeave(conn);
  }

  async onError(conn: Party.Connection<ConnState>) {
    this.handleLeave(conn);
  }

  /* ----------------------------- persistence ----------------------------- */

  private effectivePersist(): boolean {
    return (
      this.pair.length === 2 && this.pair.every((id) => this.prefs[id] === true)
    );
  }

  private msgKey(m: StoredMessage): string {
    return `${MSG_PREFIX}${String(m.sentAt).padStart(16, "0")}:${m.id}`;
  }

  private async loadHistory(): Promise<StoredMessage[]> {
    const map = await this.room.storage.list<StoredMessage>({
      prefix: MSG_PREFIX,
    });
    const all = [...map.values()].sort((a, b) => a.sentAt - b.sentAt);
    return all.slice(-MAX_HISTORY);
  }

  private async clearHistory(): Promise<void> {
    const map = await this.room.storage.list({ prefix: MSG_PREFIX });
    await Promise.all([...map.keys()].map((k) => this.room.storage.delete(k)));
  }

  private broadcastPersistState() {
    const effective = this.effectivePersist();
    for (const [userId, conns] of this.members) {
      const mine = this.prefs[userId] === true;
      const data = JSON.stringify({
        type: "persist:state",
        mine,
        effective,
      } satisfies ChatServerMessage);
      for (const connId of conns) this.room.getConnection(connId)?.send(data);
    }
  }

  /* ------------------------------ presence ------------------------------- */

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

  /* ------------------------------- helpers ------------------------------- */

  private send(conn: Party.Connection<ConnState>, msg: ChatServerMessage) {
    conn.send(JSON.stringify(msg));
  }

  private broadcast(msg: ChatServerMessage) {
    this.room.broadcast(JSON.stringify(msg));
  }

  private broadcastExcept(connId: string, msg: ChatServerMessage) {
    this.room.broadcast(JSON.stringify(msg), [connId]);
  }

  private toPeer(selfUserId: string, msg: ChatServerMessage) {
    const exclude = [...(this.members.get(selfUserId) ?? [])];
    this.room.broadcast(JSON.stringify(msg), exclude);
  }
}
