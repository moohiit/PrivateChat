import {
  Server,
  type Connection,
  type ConnectionContext,
  type WSMessage,
} from "partyserver";
import { verifyConversationTicket } from "./auth";
import type { Env } from "./env";
import type {
  ChatClientMessage,
  ChatServerMessage,
  StoredMessage,
} from "../src/lib/protocol";

/**
 * Conversation room (bound as "Main" → /parties/main/<conversationId>). One
 * instance per conversation, named by the conversation id (this.name). Only the
 * two members may join (the signed ticket's `cid` must equal this.name). It
 * relays ciphertext + receipts + typing and reports peer room-presence.
 *
 * Persistence: each member sets a persist preference; history is stored only
 * while both agree (effective = AND). Stored blobs are ciphertext-only.
 * Zero-knowledge: it only ever sees ciphertext, never keys or plaintext.
 */

type ConnState = { userId: string; username: string; peerId: string };

// Max base64 ciphertext length (~96 KB). Guards against oversized frames.
const MAX_CIPHERTEXT = 131_072;

const PREFS_KEY = "meta:prefs";
const MEMBERS_KEY = "meta:members";
const MSG_PREFIX = "msg:";
const MAX_HISTORY = 500;

export class ConversationServer extends Server<Env> {
  /** userId -> connection ids (one user may have multiple tabs/devices) */
  private readonly members = new Map<string, Set<string>>();

  /** persist preference per userId (durable, mirrored from storage) */
  private prefs: Record<string, boolean> = {};
  /** the two member userIds (durable) */
  private pair: string[] = [];
  private loaded = false;

  private async ensureLoaded() {
    if (this.loaded) return;
    this.prefs =
      (await this.ctx.storage.get<Record<string, boolean>>(PREFS_KEY)) ?? {};
    this.pair = (await this.ctx.storage.get<string[]>(MEMBERS_KEY)) ?? [];
    this.loaded = true;
  }

  async onConnect(connection: Connection, ctx: ConnectionContext) {
    // Ticket + membership were validated pre-upgrade; re-read claims here.
    let userId: string;
    let username: string;
    let peerId: string;
    try {
      const token = new URL(ctx.request.url).searchParams.get("token") ?? "";
      const claims = await verifyConversationTicket(token, this.env.JWT_SECRET);
      if (claims.conversationId !== this.name) {
        connection.close(1008, "forbidden");
        return;
      }
      userId = claims.userId;
      username = claims.username;
      peerId = claims.peerId;
    } catch {
      connection.close(1008, "unauthorized");
      return;
    }
    connection.setState({ userId, username, peerId } satisfies ConnState);
    await this.ensureLoaded();

    if (this.pair.length < 2 && peerId) {
      this.pair = [userId, peerId].sort();
      await this.ctx.storage.put(MEMBERS_KEY, this.pair);
    }

    const firstConnForUser = (this.members.get(userId)?.size ?? 0) === 0;
    const conns = this.members.get(userId) ?? new Set<string>();
    conns.add(connection.id);
    this.members.set(userId, conns);

    this.send(connection, {
      type: "peer:presence",
      online: this.peerOnline(userId),
    });
    if (firstConnForUser) {
      this.toPeer(userId, { type: "peer:presence", online: true });
    }

    this.send(connection, {
      type: "persist:state",
      mine: this.prefs[userId] === true,
      effective: this.effectivePersist(),
    });
    const history = await this.loadHistory();
    this.send(connection, { type: "history", messages: history });
  }

  async onMessage(connection: Connection, message: WSMessage) {
    const me = connection.state as ConnState | null;
    if (!me?.userId) return;
    await this.ensureLoaded();

    const raw =
      typeof message === "string"
        ? message
        : new TextDecoder().decode(message as ArrayBuffer);

    let msg: ChatClientMessage;
    try {
      msg = JSON.parse(raw) as ChatClientMessage;
    } catch {
      return;
    }

    switch (msg.type) {
      case "message:send": {
        if (
          typeof msg.ciphertext !== "string" ||
          msg.ciphertext.length > MAX_CIPHERTEXT ||
          typeof msg.iv !== "string" ||
          msg.iv.length > 256
        ) {
          return;
        }
        this.broadcastExcept(connection.id, {
          type: "message:relay",
          id: msg.id,
          from: me.userId,
          ciphertext: msg.ciphertext,
          iv: msg.iv,
          sentAt: msg.sentAt,
        });
        if (this.effectivePersist()) {
          const stored: StoredMessage = {
            id: msg.id,
            from: me.userId,
            ciphertext: msg.ciphertext,
            iv: msg.iv,
            sentAt: msg.sentAt,
          };
          await this.ctx.storage.put(this.msgKey(stored), stored);
        }
        return;
      }
      case "receipt":
        this.broadcastExcept(connection.id, {
          type: "receipt",
          id: msg.id,
          state: msg.state,
        });
        return;
      case "typing":
        this.broadcastExcept(connection.id, {
          type: "peer:typing",
          on: msg.on,
        });
        return;
      case "persist:set":
        this.prefs[me.userId] = msg.on === true;
        await this.ctx.storage.put(PREFS_KEY, this.prefs);
        this.broadcastPersistState();
        return;
      case "history:clear":
        await this.clearHistory();
        this.broadcastAll({ type: "history:cleared" });
        return;
    }
  }

  async onClose(connection: Connection) {
    this.handleLeave(connection);
  }

  async onError(connection: Connection) {
    this.handleLeave(connection);
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
    const map = await this.ctx.storage.list<StoredMessage>({
      prefix: MSG_PREFIX,
    });
    const all = [...map.values()].sort((a, b) => a.sentAt - b.sentAt);
    return all.slice(-MAX_HISTORY);
  }

  private async clearHistory(): Promise<void> {
    const map = await this.ctx.storage.list({ prefix: MSG_PREFIX });
    await Promise.all([...map.keys()].map((k) => this.ctx.storage.delete(k)));
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
      for (const connId of conns) this.getConnection(connId)?.send(data);
    }
  }

  /* ------------------------------ presence ------------------------------- */

  private handleLeave(connection: Connection) {
    const userId = (connection.state as ConnState | null)?.userId;
    if (!userId) return;
    const conns = this.members.get(userId);
    if (!conns) return;
    conns.delete(connection.id);
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

  private send(connection: Connection, msg: ChatServerMessage) {
    connection.send(JSON.stringify(msg));
  }

  private broadcastAll(msg: ChatServerMessage) {
    this.broadcast(JSON.stringify(msg));
  }

  private broadcastExcept(connId: string, msg: ChatServerMessage) {
    this.broadcast(JSON.stringify(msg), [connId]);
  }

  private toPeer(selfUserId: string, msg: ChatServerMessage) {
    const exclude = [...(this.members.get(selfUserId) ?? [])];
    super.broadcast(JSON.stringify(msg), exclude);
  }
}
