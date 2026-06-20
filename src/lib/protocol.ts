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

/**
 * Last-message preview for the conversation list. Text is ciphertext the client
 * decrypts with the conversation key; media-only messages just set hasMedia.
 */
export type ConversationPreview = {
  hasMedia: boolean;
  ciphertext?: string;
  iv?: string;
};

/** A conversation plus its unread count + last-activity preview. */
export type ConversationSummary = Conversation & {
  unread: number;
  preview?: ConversationPreview;
  lastAt: number;
};

/* ------------------------------- Lobby ---------------------------------- */

/** Lobby: messages the browser sends to the server. */
export type LobbyClientMessage =
  | { type: "request:send"; toUserId: string }
  | { type: "request:accept"; fromUserId: string }
  | { type: "request:reject"; fromUserId: string }
  | { type: "visibility:set"; on: boolean };

/** Lobby: messages the server pushes to the browser. */
export type LobbyServerMessage =
  | { type: "presence:snapshot"; users: PresenceUser[] }
  | { type: "presence:online"; user: PresenceUser }
  | { type: "presence:offline"; userId: string }
  | { type: "requests:snapshot"; incoming: PresenceUser[] }
  | { type: "conversations:snapshot"; conversations: ConversationSummary[] }
  | {
      type: "conversation:activity";
      conversationId: string;
      unread: number;
      preview?: ConversationPreview;
      lastAt: number;
    }
  | { type: "request:incoming"; from: PresenceUser }
  | { type: "request:sent"; toUserId: string }
  | { type: "request:accepted"; with: PresenceUser; conversationId: string }
  | { type: "request:rejected"; byUserId: string }
  | { type: "visibility:state"; on: boolean }
  | { type: "error"; message: string };

/* --------------------------- Conversation ------------------------------ */

export type ReceiptState = "delivered" | "read";

/**
 * Reference to an ENCRYPTED image stored in R2. The bytes are compressed +
 * AES-GCM-encrypted client-side; only this metadata travels through the server.
 */
export type MediaRef = {
  id: string; // R2 object id (within the conversation)
  iv: string; // AES-GCM iv (base64) for the image bytes
  mime: string; // e.g. "image/webp"
  width: number;
  height: number;
  size: number; // plaintext byte size (for display)
};

/** A persisted message (ciphertext only) stored in DO storage. */
export type StoredMessage = {
  id: string;
  from: string;
  ciphertext?: string; // optional text/caption
  iv?: string;
  media?: MediaRef; // optional image
  sentAt: number;
};

/** An item to delete: message id + its media id (so the blob can be removed). */
export type DeleteItem = { id: string; mediaId?: string };

/** Conversation room: messages the browser sends. Bodies are ciphertext only. */
export type ChatClientMessage =
  | {
      type: "message:send";
      id: string;
      ciphertext?: string;
      iv?: string;
      media?: MediaRef;
      sentAt: number;
    }
  | { type: "receipt"; id: string; state: ReceiptState }
  | { type: "typing"; on: boolean }
  | { type: "persist:set"; on: boolean }
  | { type: "message:delete"; items: DeleteItem[] }
  | { type: "history:clear" };

/** Conversation room: messages the server pushes. */
export type ChatServerMessage =
  | {
      type: "message:relay";
      id: string;
      from: string;
      ciphertext?: string;
      iv?: string;
      media?: MediaRef;
      sentAt: number;
    }
  | { type: "receipt"; id: string; state: ReceiptState }
  | { type: "peer:typing"; on: boolean }
  | { type: "peer:presence"; online: boolean }
  | { type: "persist:state"; mine: boolean; effective: boolean }
  | { type: "history"; messages: StoredMessage[] }
  | { type: "messages:deleted"; ids: string[] }
  | { type: "history:cleared" };
