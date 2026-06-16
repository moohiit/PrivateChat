import type * as Party from "partykit/server";
import { verifyConnectToken } from "./auth";
import type { LobbyServerMessage, PresenceUser } from "../src/lib/protocol";

/**
 * Presence lobby (the "lobby" party). A single shared room ("main") that tracks
 * who is online and (Phase 3) routes chat requests. All state is in-memory and
 * ephemeral — nothing is persisted.
 *
 * A user is "online" while they hold >= 1 connection (multiple tabs/devices).
 * Transitions (offline->online, online->offline) are broadcast to everyone else.
 */

type ConnState = { userId: string; username: string };

type OnlineEntry = { username: string; conns: Set<string> };

export default class LobbyServer implements Party.Server {
  private readonly online = new Map<string, OnlineEntry>();

  constructor(readonly room: Party.Room) {}

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
    const entry = this.online.get(userId) ?? { username, conns: new Set<string>() };
    entry.conns.add(conn.id);
    this.online.set(userId, entry);

    // Send the full snapshot to the newcomer.
    this.sendTo(conn, { type: "presence:snapshot", users: this.snapshot() });

    // Tell everyone else only on the offline->online transition.
    if (wasOffline) {
      this.broadcastExcept(conn.id, {
        type: "presence:online",
        user: { userId, username },
      });
    }
  }

  async onClose(conn: Party.Connection<ConnState>) {
    this.handleLeave(conn);
  }

  async onError(conn: Party.Connection<ConnState>) {
    this.handleLeave(conn);
  }

  async onMessage(_raw: string, _sender: Party.Connection<ConnState>) {
    // TODO(Phase 3): route chat requests (send / incoming / accept / reject).
  }

  private handleLeave(conn: Party.Connection<ConnState>) {
    const userId = conn.state?.userId;
    if (!userId) return;
    const entry = this.online.get(userId);
    if (!entry) return;
    entry.conns.delete(conn.id);
    if (entry.conns.size === 0) {
      this.online.delete(userId);
      this.broadcast({ type: "presence:offline", userId });
    }
  }

  private snapshot(): PresenceUser[] {
    return [...this.online.entries()].map(([userId, e]) => ({
      userId,
      username: e.username,
    }));
  }

  private sendTo(conn: Party.Connection<ConnState>, msg: LobbyServerMessage) {
    conn.send(JSON.stringify(msg));
  }

  private broadcast(msg: LobbyServerMessage) {
    this.room.broadcast(JSON.stringify(msg));
  }

  private broadcastExcept(connId: string, msg: LobbyServerMessage) {
    this.room.broadcast(JSON.stringify(msg), [connId]);
  }
}
