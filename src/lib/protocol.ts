/**
 * Wire protocol shared between the browser and the PartyKit servers.
 * Imported by both `src/**` (client) and `party/**` (server, via relative path).
 * All payloads are JSON; messages carry only public identity + (later) ciphertext.
 */

export type PresenceUser = {
  userId: string;
  username: string;
};

/** Lobby: messages the server pushes to clients. */
export type LobbyServerMessage =
  | { type: "presence:snapshot"; users: PresenceUser[] }
  | { type: "presence:online"; user: PresenceUser }
  | { type: "presence:offline"; userId: string };

// Client -> lobby messages (chat requests) arrive in Phase 3.
