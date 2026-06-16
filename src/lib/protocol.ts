/**
 * Wire protocol shared between the browser and the PartyKit servers.
 * Imported by both `src/**` (client) and `party/**` (server, via relative path).
 * All payloads are JSON; messages carry only public identity + (later) ciphertext.
 */

export type PresenceUser = {
  userId: string;
  username: string;
};

/** An established conversation between the local user and a peer. */
export type Conversation = {
  conversationId: string;
  peer: PresenceUser;
};

/* ------------------------------- Lobby ---------------------------------- */

/** Lobby: messages the browser sends to the server. */
export type LobbyClientMessage =
  | { type: "request:send"; toUserId: string }
  | { type: "request:accept"; fromUserId: string }
  | { type: "request:reject"; fromUserId: string };

/** Lobby: messages the server pushes to the browser. */
export type LobbyServerMessage =
  | { type: "presence:snapshot"; users: PresenceUser[] }
  | { type: "presence:online"; user: PresenceUser }
  | { type: "presence:offline"; userId: string }
  | { type: "requests:snapshot"; incoming: PresenceUser[] }
  | { type: "request:incoming"; from: PresenceUser }
  | { type: "request:sent"; toUserId: string }
  | { type: "request:accepted"; with: PresenceUser; conversationId: string }
  | { type: "request:rejected"; byUserId: string }
  | { type: "error"; message: string };
