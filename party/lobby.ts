import type * as Party from "partykit/server";
import { verifyConnectToken } from "./auth";

/**
 * Presence lobby (the "lobby" party). A single shared room that tracks who is
 * online and routes chat requests (send / accept / reject). All state here is
 * in-memory and ephemeral — nothing is persisted.
 *
 * Phase 0: connection auth skeleton only. Presence (Phase 2) and the
 * request handshake (Phase 3) are implemented in later phases.
 */

type ConnState = { userId: string; username: string };

export default class LobbyServer implements Party.Server {
  // userId -> set of connection ids currently online (Phase 2)
  private readonly online = new Map<string, Set<string>>();

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
    conn.setState({ userId, username });

    // TODO(Phase 2): mark online + broadcast presence.
    const set = this.online.get(userId) ?? new Set<string>();
    set.add(conn.id);
    this.online.set(userId, set);
  }

  async onMessage(_raw: string, _sender: Party.Connection<ConnState>) {
    // TODO(Phase 3): route chat requests (send / incoming / accept / reject).
  }

  async onClose(conn: Party.Connection<ConnState>) {
    // TODO(Phase 2): presence cleanup + broadcast offline.
    const userId = conn.state?.userId;
    if (!userId) return;
    const set = this.online.get(userId);
    set?.delete(conn.id);
    if (set && set.size === 0) this.online.delete(userId);
  }
}
