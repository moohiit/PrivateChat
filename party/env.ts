import type { LobbyServer } from "./lobby";
import type { ConversationServer } from "./server";

/** Cloudflare Worker bindings for the realtime server. */
export interface Env {
  /** Shared secret used to verify connect tokens + conversation tickets. */
  JWT_SECRET: string;
  /** Presence lobby DO (routed from /parties/lobby/...). */
  Lobby: DurableObjectNamespace<LobbyServer>;
  /** Conversation room DO (routed from /parties/main/...). */
  Main: DurableObjectNamespace<ConversationServer>;
}
