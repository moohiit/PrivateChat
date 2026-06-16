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
  | { type: "conversations:snapshot"; conversations: Conversation[] }
  | { type: "request:incoming"; from: PresenceUser }
  | { type: "request:sent"; toUserId: string }
  | { type: "request:accepted"; with: PresenceUser; conversationId: string }
  | { type: "request:rejected"; byUserId: string }
  | { type: "error"; message: string };

/* --------------------------- Conversation ------------------------------ */

export type ReceiptState = "delivered" | "read";

/** A persisted message blob (ciphertext only) stored in DO storage. */
export type StoredMessage = {
  id: string;
  from: string;
  ciphertext: string;
  iv: string;
  sentAt: number;
};

/** Conversation room: messages the browser sends. Bodies are ciphertext only. */
export type ChatClientMessage =
  | {
      type: "message:send";
      id: string;
      ciphertext: string;
      iv: string;
      sentAt: number;
    }
  | { type: "receipt"; id: string; state: ReceiptState }
  | { type: "typing"; on: boolean }
  | { type: "persist:set"; on: boolean }
  | { type: "history:clear" };

/** Conversation room: messages the server pushes. */
export type ChatServerMessage =
  | {
      type: "message:relay";
      id: string;
      from: string;
      ciphertext: string;
      iv: string;
      sentAt: number;
    }
  | { type: "receipt"; id: string; state: ReceiptState }
  | { type: "peer:typing"; on: boolean }
  | { type: "peer:presence"; online: boolean }
  | { type: "persist:state"; mine: boolean; effective: boolean }
  | { type: "history"; messages: StoredMessage[] }
  | { type: "history:cleared" };
