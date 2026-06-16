import type * as Party from "partykit/server";
import { verifyConnectToken } from "./auth";
import type {
  LobbyClientMessage,
  LobbyServerMessage,
  PresenceUser,
} from "../src/lib/protocol";

/**
 * Presence lobby (the "lobby" party). A single shared room ("main") that:
 *  - tracks who is online (in-memory, multi-connection per user),
 *  - routes chat requests (send / accept / reject),
 *  - on accept, derives a stable, unguessable conversation id (HMAC of the
 *    sorted user-id pair under JWT_SECRET) and hands it to both parties.
 *
 * All state is in-memory and ephemeral — nothing is persisted.
 */

type ConnState = { userId: string; username: string };

type OnlineEntry = { username: string; conns: Set<string>; visible: boolean };

type Contact = {
  conversationId: string;
  peerUserId: string;
  peerUsername: string;
};

export default class LobbyServer implements Party.Server {
  /** userId -> online connections */
  private readonly online = new Map<string, OnlineEntry>();
  /** targetUserId -> (fromUserId -> requester) : pending incoming requests */
  private readonly pending = new Map<string, Map<string, PresenceUser>>();
  /** userId -> queued messages to deliver on next connect (offline delivery) */
  private readonly outbox = new Map<string, LobbyServerMessage[]>();
  /** userId -> established conversations (durable, server-authoritative) */
  private readonly contacts = new Map<string, Contact[]>();
  private readonly contactsLoaded = new Set<string>();

  constructor(readonly room: Party.Room) {}

  private async loadContacts(userId: string): Promise<Contact[]> {
    if (!this.contactsLoaded.has(userId)) {
      const stored =
        (await this.room.storage.get<Contact[]>(`contacts:${userId}`)) ?? [];
      this.contacts.set(userId, stored);
      this.contactsLoaded.add(userId);
    }
    return this.contacts.get(userId) ?? [];
  }

  private async addContact(userId: string, contact: Contact): Promise<void> {
    const list = await this.loadContacts(userId);
    if (list.some((c) => c.conversationId === contact.conversationId)) return;
    list.push(contact);
    this.contacts.set(userId, list);
    await this.room.storage.put(`contacts:${userId}`, list);
  }

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
    const userId = ctx.request.headers.get("X-User-Id") ?? "";
    const username = ctx.request.headers.get("X-Username") ?? "";
    if (!userId) {
      conn.close(1008, "unauthorized");
      return;
    }
    conn.setState({ userId, username });

    const wasOffline = !this.online.has(userId);
    // Visibility is an opt-in, persisted preference (default: private/hidden).
    const visible =
      this.online.get(userId)?.visible ??
      ((await this.room.storage.get<boolean>(`visible:${userId}`)) ?? false);
    const entry = this.online.get(userId) ?? {
      username,
      conns: new Set<string>(),
      visible,
    };
    entry.conns.add(conn.id);
    this.online.set(userId, entry);

    const contacts = await this.loadContacts(userId);
    const contactIds = new Set(contacts.map((c) => c.peerUserId));

    // Presence snapshot: users who are publicly visible OR already a contact.
    this.send(conn, {
      type: "presence:snapshot",
      users: this.visibleTo(userId, contactIds),
    });

    // The user's own visibility state.
    this.send(conn, { type: "visibility:state", on: entry.visible });

    // Pending incoming requests (survive reloads).
    this.send(conn, {
      type: "requests:snapshot",
      incoming: [...(this.pending.get(userId)?.values() ?? [])],
    });

    // Established conversations (server-authoritative; symmetric for both sides).
    this.send(conn, {
      type: "conversations:snapshot",
      conversations: contacts.map((c) => ({
        conversationId: c.conversationId,
        peer: { userId: c.peerUserId, username: c.peerUsername },
      })),
    });

    // Anything queued while offline (accepted/rejected notices).
    const queued = this.outbox.get(userId);
    if (queued?.length) {
      for (const msg of queued) this.send(conn, msg);
      this.outbox.delete(userId);
    }

    // Announce online to everyone who may see this user: the public (if visible)
    // plus this user's contacts (always — contacts see each other regardless).
    if (wasOffline) {
      this.announcePresenceToWatchers(userId, contactIds, entry.visible, {
        type: "presence:online",
        user: { userId, username },
      });
    }
  }

  async onClose(conn: Party.Connection<ConnState>) {
    await this.handleLeave(conn);
  }

  async onError(conn: Party.Connection<ConnState>) {
    await this.handleLeave(conn);
  }

  async onMessage(raw: string, sender: Party.Connection<ConnState>) {
    const me = sender.state;
    if (!me?.userId) return;

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

  /**
   * Set the user's public discoverability. When visible, they appear in others'
   * "Online now" list; when hidden, they don't (but remain reachable by anyone
   * who knows their username via search). Preference is persisted.
   */
  private async handleVisibility(me: ConnState, on: boolean) {
    const entry = this.online.get(me.userId);
    await this.room.storage.put(`visible:${me.userId}`, on);
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

    const forTarget = this.pending.get(toUserId) ?? new Map<string, PresenceUser>();
    forTarget.set(me.userId, from);
    this.pending.set(toUserId, forTarget);

    // Live delivery if online (also kept in `pending` for reload snapshots).
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
      this.room.env.JWT_SECRET as string,
      me.userId,
      fromUserId,
    );
    const meUser: PresenceUser = { userId: me.userId, username: me.username };

    // Persist the relationship for BOTH sides (server-authoritative).
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

    // Notify the accepter (online) and the requester (online or queued).
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
    this.deliverOrQueue(fromUserId, { type: "request:rejected", byUserId: me.userId });
  }

  /* ------------------------------ presence ------------------------------- */

  private async handleLeave(conn: Party.Connection<ConnState>) {
    const userId = conn.state?.userId;
    if (!userId) return;
    const entry = this.online.get(userId);
    if (!entry) return;
    entry.conns.delete(conn.id);
    if (entry.conns.size === 0) {
      const wasVisible = entry.visible;
      this.online.delete(userId);
      // Announce offline to everyone who could see them: public (if visible)
      // plus their contacts.
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

  /** Send a presence message to everyone who may see `userId`. */
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

  private send(conn: Party.Connection<ConnState>, msg: LobbyServerMessage) {
    conn.send(JSON.stringify(msg));
  }

  private sendToUser(userId: string, msg: LobbyServerMessage) {
    const entry = this.online.get(userId);
    if (!entry) return;
    const data = JSON.stringify(msg);
    for (const connId of entry.conns) {
      this.room.getConnection(connId)?.send(data);
    }
  }

  /** Deliver now if online, otherwise queue for the user's next connect. */
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
 * truncated. Deterministic so both parties get the same id; unguessable
 * without the server secret.
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
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(pair));
  return [...new Uint8Array(sig)]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}
