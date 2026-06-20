import {
  Server,
  type Connection,
  type ConnectionContext,
  type WSMessage,
} from "partyserver";
import { verifyConnectToken } from "./auth";
import type { Env } from "./env";
import type {
  ConversationSummary,
  LobbyClientMessage,
  LobbyServerMessage,
  PresenceUser,
} from "../src/lib/protocol";

/**
 * Presence lobby (bound as "Lobby" → /parties/lobby/main). A single shared room
 * that tracks who is online, routes chat requests, persists contacts, and (on
 * accept) derives a stable, unguessable conversation id. Presence is tailored
 * per recipient: you see a user if they are publicly visible OR your contact.
 */

type ConnState = { userId: string; username: string };

type OnlineEntry = { username: string; conns: Set<string>; visible: boolean };

type Contact = {
  conversationId: string;
  peerUserId: string;
  peerUsername: string;
};

/** Last-message preview stored per conversation (ciphertext only). */
type Preview = {
  hasMedia: boolean;
  ciphertext?: string;
  iv?: string;
  sentAt: number;
};

export class LobbyServer extends Server<Env> {
  /** userId -> online connections */
  private readonly online = new Map<string, OnlineEntry>();
  /** targetUserId -> (fromUserId -> requester) : pending incoming requests */
  private readonly pending = new Map<string, Map<string, PresenceUser>>();
  /** userId -> queued messages to deliver on next connect (offline delivery) */
  private readonly outbox = new Map<string, LobbyServerMessage[]>();
  /** userId -> established conversations (durable, server-authoritative) */
  private readonly contacts = new Map<string, Contact[]>();
  private readonly contactsLoaded = new Set<string>();
  /** userId -> { conversationId -> unread count } (durable) */
  private readonly unread = new Map<string, Record<string, number>>();
  private readonly unreadLoaded = new Set<string>();
  /** conversationId -> last-message preview (durable) */
  private readonly previews = new Map<string, Preview>();

  private async loadContacts(userId: string): Promise<Contact[]> {
    if (!this.contactsLoaded.has(userId)) {
      const stored =
        (await this.ctx.storage.get<Contact[]>(`contacts:${userId}`)) ?? [];
      this.contacts.set(userId, stored);
      this.contactsLoaded.add(userId);
    }
    return this.contacts.get(userId) ?? [];
  }

  private async loadUnread(userId: string): Promise<Record<string, number>> {
    if (!this.unreadLoaded.has(userId)) {
      this.unread.set(
        userId,
        (await this.ctx.storage.get<Record<string, number>>(`unread:${userId}`)) ?? {},
      );
      this.unreadLoaded.add(userId);
    }
    return this.unread.get(userId)!;
  }

  private async loadPreview(cid: string): Promise<Preview | undefined> {
    if (this.previews.has(cid)) return this.previews.get(cid);
    const p = await this.ctx.storage.get<Preview>(`preview:${cid}`);
    if (p) this.previews.set(cid, p);
    return p;
  }

  /**
   * RPC (called from the conversation room): record a new message's activity —
   * update the conversation preview, bump the recipient's unread, and push
   * `conversation:activity` to both members' lobby connections.
   */
  async recordActivity(
    senderId: string,
    recipientId: string,
    conversationId: string,
    preview: Preview,
    bumpRecipient: boolean,
  ): Promise<void> {
    this.previews.set(conversationId, preview);
    await this.ctx.storage.put(`preview:${conversationId}`, preview);

    if (bumpRecipient) {
      const u = await this.loadUnread(recipientId);
      u[conversationId] = (u[conversationId] ?? 0) + 1;
      await this.ctx.storage.put(`unread:${recipientId}`, u);
    }

    const pub = {
      hasMedia: preview.hasMedia,
      ciphertext: preview.ciphertext,
      iv: preview.iv,
    };
    for (const uid of [recipientId, senderId]) {
      this.sendToUser(uid, {
        type: "conversation:activity",
        conversationId,
        unread: (await this.loadUnread(uid))[conversationId] ?? 0,
        preview: pub,
        lastAt: preview.sentAt,
      });
    }
  }

  /** RPC (called when a user opens the conversation): zero their unread count. */
  async clearUnread(userId: string, conversationId: string): Promise<void> {
    const u = await this.loadUnread(userId);
    if (!u[conversationId]) return;
    u[conversationId] = 0;
    await this.ctx.storage.put(`unread:${userId}`, u);
    this.sendToUser(userId, {
      type: "conversation:activity",
      conversationId,
      unread: 0,
      lastAt: (await this.loadPreview(conversationId))?.sentAt ?? 0,
    });
  }

  private async addContact(userId: string, contact: Contact): Promise<void> {
    const list = await this.loadContacts(userId);
    if (list.some((c) => c.conversationId === contact.conversationId)) return;
    list.push(contact);
    this.contacts.set(userId, list);
    await this.ctx.storage.put(`contacts:${userId}`, list);
  }

  async onConnect(connection: Connection, ctx: ConnectionContext) {
    // Token was already validated pre-upgrade (onBeforeConnect); re-read claims.
    let userId: string;
    let username: string;
    try {
      const token = new URL(ctx.request.url).searchParams.get("token") ?? "";
      const claims = await verifyConnectToken(token, this.env.JWT_SECRET);
      userId = claims.userId;
      username = claims.username;
    } catch {
      connection.close(1008, "unauthorized");
      return;
    }
    connection.setState({ userId, username } satisfies ConnState);

    const wasOffline = !this.online.has(userId);
    // Visibility is an opt-in, persisted preference (default: private/hidden).
    const visible =
      this.online.get(userId)?.visible ??
      ((await this.ctx.storage.get<boolean>(`visible:${userId}`)) ?? false);
    const entry = this.online.get(userId) ?? {
      username,
      conns: new Set<string>(),
      visible,
    };
    entry.conns.add(connection.id);
    this.online.set(userId, entry);

    const contacts = await this.loadContacts(userId);
    const contactIds = new Set(contacts.map((c) => c.peerUserId));

    // Presence snapshot: users who are publicly visible OR already a contact.
    this.send(connection, {
      type: "presence:snapshot",
      users: this.visibleTo(userId, contactIds),
    });
    this.send(connection, { type: "visibility:state", on: entry.visible });
    this.send(connection, {
      type: "requests:snapshot",
      incoming: [...(this.pending.get(userId)?.values() ?? [])],
    });
    const unread = await this.loadUnread(userId);
    const summaries: ConversationSummary[] = [];
    for (const c of contacts) {
      const p = await this.loadPreview(c.conversationId);
      summaries.push({
        conversationId: c.conversationId,
        peer: { userId: c.peerUserId, username: c.peerUsername },
        unread: unread[c.conversationId] ?? 0,
        preview: p
          ? { hasMedia: p.hasMedia, ciphertext: p.ciphertext, iv: p.iv }
          : undefined,
        lastAt: p?.sentAt ?? 0,
      });
    }
    this.send(connection, {
      type: "conversations:snapshot",
      conversations: summaries,
    });

    const queued = this.outbox.get(userId);
    if (queued?.length) {
      for (const msg of queued) this.send(connection, msg);
      this.outbox.delete(userId);
    }

    if (wasOffline) {
      this.announcePresenceToWatchers(userId, contactIds, entry.visible, {
        type: "presence:online",
        user: { userId, username },
      });
    }
  }

  async onClose(connection: Connection) {
    await this.handleLeave(connection);
  }

  async onError(connection: Connection) {
    await this.handleLeave(connection);
  }

  async onMessage(connection: Connection, message: WSMessage) {
    const me = connection.state as ConnState | null;
    if (!me?.userId) return;

    const raw =
      typeof message === "string"
        ? message
        : new TextDecoder().decode(message as ArrayBuffer);

    let msg: LobbyClientMessage;
    try {
      msg = JSON.parse(raw) as LobbyClientMessage;
    } catch {
      return;
    }

    switch (msg.type) {
      case "request:send":
        return this.handleSend(me, msg.toUserId);
      case "request:accept":
        return this.handleAccept(me, msg.fromUserId);
      case "request:reject":
        return this.handleReject(me, msg.fromUserId);
      case "visibility:set":
        return this.handleVisibility(me, msg.on);
    }
  }

  private async handleVisibility(me: ConnState, on: boolean) {
    const entry = this.online.get(me.userId);
    await this.ctx.storage.put(`visible:${me.userId}`, on);
    if (!entry) return;

    const was = entry.visible;
    entry.visible = on;

    if (on !== was) {
      // Only NON-contacts are affected by the public toggle — contacts always
      // see each other online regardless of visibility.
      const contactIds = new Set(
        (await this.loadContacts(me.userId)).map((c) => c.peerUserId),
      );
      const msg: LobbyServerMessage = on
        ? {
            type: "presence:online",
            user: { userId: me.userId, username: me.username },
          }
        : { type: "presence:offline", userId: me.userId };
      for (const [otherId] of this.online) {
        if (otherId !== me.userId && !contactIds.has(otherId)) {
          this.sendToUser(otherId, msg);
        }
      }
    }
    this.sendToUser(me.userId, { type: "visibility:state", on });
  }

  /* --------------------------- request handlers -------------------------- */

  private handleSend(me: ConnState, toUserId: string) {
    if (!toUserId || toUserId === me.userId) {
      return this.sendToUser(me.userId, {
        type: "error",
        message: "Invalid request target.",
      });
    }
    const from: PresenceUser = { userId: me.userId, username: me.username };

    const forTarget =
      this.pending.get(toUserId) ?? new Map<string, PresenceUser>();
    forTarget.set(me.userId, from);
    this.pending.set(toUserId, forTarget);

    if (this.online.has(toUserId)) {
      this.sendToUser(toUserId, { type: "request:incoming", from });
    }
    this.sendToUser(me.userId, { type: "request:sent", toUserId });
  }

  private async handleAccept(me: ConnState, fromUserId: string) {
    const requester = this.pending.get(me.userId)?.get(fromUserId);
    if (!requester) {
      return this.sendToUser(me.userId, {
        type: "error",
        message: "That request is no longer available.",
      });
    }
    this.removePending(me.userId, fromUserId);

    const conversationId = await deriveConversationId(
      this.env.JWT_SECRET,
      me.userId,
      fromUserId,
    );
    const meUser: PresenceUser = { userId: me.userId, username: me.username };

    await this.addContact(me.userId, {
      conversationId,
      peerUserId: requester.userId,
      peerUsername: requester.username,
    });
    await this.addContact(fromUserId, {
      conversationId,
      peerUserId: meUser.userId,
      peerUsername: meUser.username,
    });

    this.sendToUser(me.userId, {
      type: "request:accepted",
      with: requester,
      conversationId,
    });
    this.deliverOrQueue(fromUserId, {
      type: "request:accepted",
      with: meUser,
      conversationId,
    });

    // They're now contacts: surface each other's online status immediately.
    this.sendToUser(fromUserId, { type: "presence:online", user: meUser });
    if (this.online.has(fromUserId)) {
      this.sendToUser(me.userId, { type: "presence:online", user: requester });
    }
  }

  private handleReject(me: ConnState, fromUserId: string) {
    if (!this.pending.get(me.userId)?.has(fromUserId)) return;
    this.removePending(me.userId, fromUserId);
    this.deliverOrQueue(fromUserId, {
      type: "request:rejected",
      byUserId: me.userId,
    });
  }

  /* ------------------------------ presence ------------------------------- */

  private async handleLeave(connection: Connection) {
    const userId = (connection.state as ConnState | null)?.userId;
    if (!userId) return;
    const entry = this.online.get(userId);
    if (!entry) return;
    entry.conns.delete(connection.id);
    if (entry.conns.size === 0) {
      const wasVisible = entry.visible;
      this.online.delete(userId);
      const contactIds = new Set(
        (await this.loadContacts(userId)).map((c) => c.peerUserId),
      );
      this.announcePresenceToWatchers(userId, contactIds, wasVisible, {
        type: "presence:offline",
        userId,
      });
    }
  }

  /** Online users visible to `userId`: publicly visible OR already a contact. */
  private visibleTo(userId: string, contactIds: Set<string>): PresenceUser[] {
    return [...this.online.entries()]
      .filter(([id, e]) => id !== userId && (e.visible || contactIds.has(id)))
      .map(([id, e]) => ({ userId: id, username: e.username }));
  }

  private announcePresenceToWatchers(
    userId: string,
    contactIds: Set<string>,
    visible: boolean,
    msg: LobbyServerMessage,
  ) {
    for (const [otherId] of this.online) {
      if (otherId === userId) continue;
      if (visible || contactIds.has(otherId)) this.sendToUser(otherId, msg);
    }
  }

  /* ------------------------------- helpers ------------------------------- */

  private removePending(targetUserId: string, fromUserId: string) {
    const map = this.pending.get(targetUserId);
    map?.delete(fromUserId);
    if (map && map.size === 0) this.pending.delete(targetUserId);
  }

  private send(connection: Connection, msg: LobbyServerMessage) {
    connection.send(JSON.stringify(msg));
  }

  private sendToUser(userId: string, msg: LobbyServerMessage) {
    const entry = this.online.get(userId);
    if (!entry) return;
    const data = JSON.stringify(msg);
    for (const connId of entry.conns) {
      this.getConnection(connId)?.send(data);
    }
  }

  private deliverOrQueue(userId: string, msg: LobbyServerMessage) {
    if (this.online.has(userId)) {
      this.sendToUser(userId, msg);
    } else {
      const q = this.outbox.get(userId) ?? [];
      q.push(msg);
      this.outbox.set(userId, q);
    }
  }
}

/**
 * Stable, unguessable conversation id: HMAC-SHA256(secret, sorted(a,b)),
 * truncated. Must match src/lib/conversation-id.ts (asserted in crypto-check).
 */
async function deriveConversationId(
  secret: string,
  a: string,
  b: string,
): Promise<string> {
  const pair = [a, b].sort().join(":");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(pair),
  );
  return [...new Uint8Array(sig)]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}
