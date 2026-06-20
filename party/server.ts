import {
  Server,
  getServerByName,
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
const DISAPPEAR_KEY = "meta:disappear";
const MSG_PREFIX = "msg:";
const EXP_PREFIX = "exp:"; // exp:<paddedExpiresAt>:<id> -> ExpRecord
const MAX_HISTORY = 500;

/** A scheduled message expiry (disappearing messages). */
type ExpRecord = { id: string; mediaId?: string; msgKey?: string };

export class ConversationServer extends Server<Env> {
  /** userId -> connection ids (one user may have multiple tabs/devices) */
  private readonly members = new Map<string, Set<string>>();

  /** persist preference per userId (durable, mirrored from storage) */
  private prefs: Record<string, boolean> = {};
  /** the two member userIds (durable) */
  private pair: string[] = [];
  /** disappearing-messages TTL in ms (0 = off), shared by the conversation */
  private disappearTtl = 0;
  private loaded = false;

  private async ensureLoaded() {
    if (this.loaded) return;
    this.prefs =
      (await this.ctx.storage.get<Record<string, boolean>>(PREFS_KEY)) ?? {};
    this.pair = (await this.ctx.storage.get<string[]>(MEMBERS_KEY)) ?? [];
    this.disappearTtl =
      (await this.ctx.storage.get<number>(DISAPPEAR_KEY)) ?? 0;
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
    this.send(connection, { type: "disappear:state", ttl: this.disappearTtl });
    const history = await this.loadHistory();
    this.send(connection, { type: "history", messages: history });

    // Opening the conversation clears this user's unread badge in the lobby.
    await this.notifyLobbyClear(userId);
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
        // A message must carry text and/or an image; bound the text size.
        const hasText = typeof msg.ciphertext === "string" && msg.ciphertext.length > 0;
        const hasMedia = !!msg.media && typeof msg.media.id === "string";
        if (!hasText && !hasMedia) return;
        if (hasText && (msg.ciphertext!.length > MAX_CIPHERTEXT || typeof msg.iv !== "string")) {
          return;
        }
        const expiresAt =
          this.disappearTtl > 0 ? Date.now() + this.disappearTtl : undefined;

        this.broadcastExcept(connection.id, {
          type: "message:relay",
          id: msg.id,
          from: me.userId,
          ciphertext: msg.ciphertext,
          iv: msg.iv,
          media: msg.media,
          sentAt: msg.sentAt,
          expiresAt,
        });

        let msgKey: string | undefined;
        if (this.effectivePersist()) {
          const stored: StoredMessage = {
            id: msg.id,
            from: me.userId,
            ciphertext: msg.ciphertext,
            iv: msg.iv,
            media: msg.media,
            sentAt: msg.sentAt,
            expiresAt,
          };
          msgKey = this.msgKey(stored);
          await this.ctx.storage.put(msgKey, stored);
        }
        if (expiresAt) {
          await this.scheduleExpiry(expiresAt, {
            id: msg.id,
            mediaId: msg.media?.id,
            msgKey,
          });
        }
        // Update the conversation list (unread + preview) via the lobby.
        await this.notifyLobbyActivity(me, {
          hasMedia,
          ciphertext: hasText ? msg.ciphertext : undefined,
          iv: hasText ? msg.iv : undefined,
          sentAt: msg.sentAt,
        });
        return;
      }
      case "message:delete":
        await this.handleDelete(msg.items);
        return;
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
      case "disappear:set": {
        // Either member may set the conversation's disappearing timer.
        // Any positive ttl is accepted, capped at 7 days (UI offers presets).
        const MAX_TTL = 604_800_000;
        const ttl =
          typeof msg.ttl === "number" && msg.ttl > 0
            ? Math.min(Math.floor(msg.ttl), MAX_TTL)
            : 0;
        this.disappearTtl = ttl;
        await this.ctx.storage.put(DISAPPEAR_KEY, ttl);
        this.broadcastAll({ type: "disappear:state", ttl });
        return;
      }
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

  /* ------------------------ disappearing messages ------------------------ */

  private expKey(expiresAt: number, id: string): string {
    return `${EXP_PREFIX}${String(expiresAt).padStart(16, "0")}:${id}`;
  }

  private async scheduleExpiry(expiresAt: number, rec: ExpRecord): Promise<void> {
    await this.ctx.storage.put(this.expKey(expiresAt, rec.id), rec);
    const current = await this.ctx.storage.getAlarm();
    if (current === null || expiresAt < current) {
      await this.ctx.storage.setAlarm(expiresAt);
    }
  }

  /** DO alarm: delete messages whose timer elapsed (history + R2), notify, reschedule. */
  async onAlarm(): Promise<void> {
    await this.ensureLoaded();
    const now = Date.now();
    const entries = await this.ctx.storage.list<ExpRecord>({ prefix: EXP_PREFIX });
    const ids: string[] = [];
    const ops: Promise<unknown>[] = [];
    let nextAt: number | null = null;

    for (const [k, rec] of entries) {
      const expiresAt = Number(k.slice(EXP_PREFIX.length, EXP_PREFIX.length + 16));
      if (expiresAt <= now) {
        ids.push(rec.id);
        ops.push(this.ctx.storage.delete(k));
        if (rec.msgKey) ops.push(this.ctx.storage.delete(rec.msgKey));
        if (rec.mediaId) {
          ops.push(this.env.MEDIA.delete(this.mediaKey(rec.mediaId)));
        }
      } else {
        nextAt = nextAt === null ? expiresAt : Math.min(nextAt, expiresAt);
      }
    }

    await Promise.all(ops);
    if (ids.length) this.broadcastAll({ type: "messages:deleted", ids });
    if (nextAt !== null) await this.ctx.storage.setAlarm(nextAt);
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

  /** R2 key for a media id: `<scope>/<cid>/<id>` (scope from the id's first char). */
  private mediaKey(mediaId: string): string {
    const scope = mediaId[0] === "p" ? "p" : "e";
    return `${scope}/${this.name}/${mediaId}`;
  }

  private async clearHistory(): Promise<void> {
    // Delete stored messages AND their R2 media blobs.
    const map = await this.ctx.storage.list<StoredMessage>({ prefix: MSG_PREFIX });
    const ops: Promise<unknown>[] = [];
    for (const [k, m] of map) {
      ops.push(this.ctx.storage.delete(k));
      if (m.media?.id) ops.push(this.env.MEDIA.delete(this.mediaKey(m.media.id)));
    }
    await Promise.all(ops);
  }

  /**
   * Delete specific messages for everyone: remove R2 blobs (from the provided
   * media ids and from any stored copies) + stored history rows, then broadcast.
   */
  private async handleDelete(items: { id: string; mediaId?: string }[]) {
    if (!Array.isArray(items) || items.length === 0) return;
    const ids = new Set(items.map((i) => i.id));
    const mediaKeys = new Set<string>();
    for (const it of items) {
      if (it.mediaId) mediaKeys.add(this.mediaKey(it.mediaId));
    }

    const map = await this.ctx.storage.list<StoredMessage>({ prefix: MSG_PREFIX });
    const ops: Promise<unknown>[] = [];
    for (const [k, m] of map) {
      if (ids.has(m.id)) {
        ops.push(this.ctx.storage.delete(k));
        if (m.media?.id) mediaKeys.add(this.mediaKey(m.media.id));
      }
    }
    for (const key of mediaKeys) ops.push(this.env.MEDIA.delete(key));
    await Promise.all(ops);

    this.broadcastAll({ type: "messages:deleted", ids: [...ids] });
  }

  /* ----------------------- lobby (conversation list) --------------------- */

  /** Tell the lobby about a new message (updates unread + preview). */
  private async notifyLobbyActivity(
    sender: ConnState,
    preview: {
      hasMedia: boolean;
      ciphertext?: string;
      iv?: string;
      sentAt: number;
    },
  ): Promise<void> {
    const recipientId = sender.peerId;
    if (!recipientId) return;
    // Don't bump unread if the recipient is currently viewing this room.
    const bump = (this.members.get(recipientId)?.size ?? 0) === 0;
    try {
      const lobby = await getServerByName(this.env.Lobby, "main");
      await lobby.recordActivity(
        sender.userId,
        recipientId,
        this.name,
        preview,
        bump,
      );
    } catch {
      /* best-effort; conversations:snapshot re-syncs on next connect */
    }
  }

  /** Tell the lobby this user opened the conversation (clear their unread). */
  private async notifyLobbyClear(userId: string): Promise<void> {
    try {
      const lobby = await getServerByName(this.env.Lobby, "main");
      await lobby.clearUnread(userId, this.name);
    } catch {
      /* best-effort */
    }
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
