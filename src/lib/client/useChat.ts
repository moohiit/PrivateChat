"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createConversationSocket } from "./party";
import { uploadImage, uploadAudio, uploadFile, downloadMedia } from "./media";
import { getConversationKey } from "@/lib/crypto/keystore";
import { encryptMessage, decryptMessage } from "@/lib/crypto/conversation";
import type {
  ChatServerMessage,
  DeleteItem,
  MediaRef,
  ReceiptState,
} from "@/lib/protocol";

export type MessageStatus = "sending" | "sent" | "delivered" | "read" | "failed";

export type ChatImage = {
  media?: MediaRef;
  url: string | null; // object URL once decrypted (or local preview)
  status: "loading" | "ready" | "error";
};

export type ChatMessage = {
  id: string;
  mine: boolean;
  text: string;
  sentAt: number;
  status: MessageStatus;
  image?: ChatImage;
  expiresAt?: number;
  replyTo?: string;
  reactions: Record<string, string>; // userId -> emoji
};

export type ChatState = {
  messages: ChatMessage[];
  peerOnline: boolean;
  peerTyping: boolean;
  keyReady: boolean;
  persistMine: boolean;
  persistEffective: boolean;
  disappearTtl: number;
};

const RANK: Record<ReceiptState, number> = { delivered: 1, read: 2 };

function randomId(): string {
  return crypto.randomUUID();
}

function mergeById(existing: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const byId = new Map(existing.map((m) => [m.id, m]));
  for (const m of incoming) if (!byId.has(m.id)) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => a.sentAt - b.sentAt);
}

export function useChat(
  conversationId: string,
  peerUserId: string,
  selfUserId: string,
) {
  const [state, setState] = useState<ChatState>({
    messages: [],
    peerOnline: false,
    peerTyping: false,
    keyReady: getConversationKey(conversationId) !== null,
    persistMine: false,
    persistEffective: false,
    disappearTtl: 0,
  });
  const socketRef = useRef<ReturnType<typeof createConversationSocket> | null>(
    null,
  );
  const typingTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTypingSent = useRef(false);
  const objectUrls = useRef<Set<string>>(new Set());
  const messagesRef = useRef<ChatMessage[]>([]);
  const persistRef = useRef(false);
  const disappearRef = useRef(0);
  const expiryTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );

  const key = getConversationKey(conversationId);

  // Keep a ref of messages for delete lookups (mediaId per message).
  useEffect(() => {
    messagesRef.current = state.messages;
  }, [state.messages]);

  // Track effective persistence so uploads pick the right storage scope.
  useEffect(() => {
    persistRef.current = state.persistEffective;
  }, [state.persistEffective]);

  const trackUrl = useCallback((url: string) => {
    objectUrls.current.add(url);
    return url;
  }, []);

  const revokeFor = useCallback((msgs: ChatMessage[]) => {
    for (const m of msgs) {
      if (m.image?.url) {
        URL.revokeObjectURL(m.image.url);
        objectUrls.current.delete(m.image.url);
      }
    }
  }, []);

  // Remove messages locally (revoke image URLs + clear any expiry timers).
  const removeMessages = useCallback(
    (ids: Iterable<string>) => {
      const idSet = new Set(ids);
      for (const id of idSet) {
        const t = expiryTimers.current.get(id);
        if (t) {
          clearTimeout(t);
          expiryTimers.current.delete(id);
        }
      }
      setState((s) => {
        revokeFor(s.messages.filter((m) => idSet.has(m.id)));
        return { ...s, messages: s.messages.filter((m) => !idSet.has(m.id)) };
      });
    },
    [revokeFor],
  );

  // Disappearing messages: locally remove a message when its timer elapses.
  const scheduleLocalExpiry = useCallback(
    (id: string, expiresAt?: number) => {
      if (!expiresAt || expiryTimers.current.has(id)) return;
      const delay = expiresAt - Date.now();
      if (delay <= 0) {
        removeMessages([id]);
        return;
      }
      expiryTimers.current.set(
        id,
        setTimeout(() => removeMessages([id]), delay),
      );
    },
    [removeMessages],
  );

  // Download + decrypt an image and attach its object URL to the message.
  const hydrateImage = useCallback(
    async (messageId: string, media: MediaRef) => {
      try {
        const url = trackUrl(
          await downloadMedia(conversationId, peerUserId, media),
        );
        setState((s) => ({
          ...s,
          messages: s.messages.map((m) =>
            m.id === messageId && m.image
              ? { ...m, image: { ...m.image, url, status: "ready" } }
              : m,
          ),
        }));
      } catch {
        setState((s) => ({
          ...s,
          messages: s.messages.map((m) =>
            m.id === messageId && m.image
              ? { ...m, image: { ...m.image, status: "error" } }
              : m,
          ),
        }));
      }
    },
    [conversationId, peerUserId, trackUrl],
  );

  useEffect(() => {
    const socket = createConversationSocket(conversationId, peerUserId);
    socketRef.current = socket;
    const aesKey = getConversationKey(conversationId);

    const send = (obj: unknown) => socket.send(JSON.stringify(obj));

    const onMessage = async (event: MessageEvent) => {
      let msg: ChatServerMessage;
      try {
        msg = JSON.parse(event.data as string) as ChatServerMessage;
      } catch {
        return;
      }

      switch (msg.type) {
        case "message:relay": {
          let text = "";
          if (aesKey && msg.ciphertext && msg.iv) {
            try {
              text = await decryptMessage(aesKey, {
                ciphertext: msg.ciphertext,
                iv: msg.iv,
              });
            } catch {
              text = "⚠️ could not decrypt message";
            }
          }
          setState((s) => {
            if (s.messages.some((m) => m.id === msg.id)) return s;
            const incoming: ChatMessage = {
              id: msg.id,
              mine: false,
              text,
              sentAt: msg.sentAt,
              status: "read",
              expiresAt: msg.expiresAt,
              replyTo: msg.replyTo,
              reactions: {},
              image: msg.media
                ? { media: msg.media, url: null, status: "loading" }
                : undefined,
            };
            return {
              ...s,
              messages: [...s.messages, incoming].sort(
                (a, b) => a.sentAt - b.sentAt,
              ),
            };
          });
          if (msg.media) void hydrateImage(msg.id, msg.media);
          scheduleLocalExpiry(msg.id, msg.expiresAt);
          send({ type: "receipt", id: msg.id, state: "delivered" });
          send({ type: "receipt", id: msg.id, state: "read" });
          return;
        }
        case "receipt": {
          setState((s) => ({
            ...s,
            messages: s.messages.map((m) =>
              m.id === msg.id && m.mine && rankUp(m.status, msg.state)
                ? { ...m, status: msg.state }
                : m,
            ),
          }));
          return;
        }
        case "peer:typing":
          setState((s) => ({ ...s, peerTyping: msg.on }));
          return;
        case "peer:presence":
          setState((s) => ({ ...s, peerOnline: msg.online }));
          return;
        case "persist:state":
          setState((s) => ({
            ...s,
            persistMine: msg.mine,
            persistEffective: msg.effective,
          }));
          return;
        case "disappear:state":
          disappearRef.current = msg.ttl;
          setState((s) => ({ ...s, disappearTtl: msg.ttl }));
          return;
        case "reaction":
          setState((s) => ({
            ...s,
            messages: s.messages.map((m) => {
              if (m.id !== msg.id) return m;
              const reactions = { ...m.reactions };
              if (msg.op === "remove") delete reactions[msg.from];
              else reactions[msg.from] = msg.emoji;
              return { ...m, reactions };
            }),
          }));
          return;
        case "messages:deleted":
          removeMessages(msg.ids);
          return;
        case "history": {
          const decrypted: ChatMessage[] = [];
          for (const m of msg.messages) {
            let text = "";
            if (aesKey && m.ciphertext && m.iv) {
              try {
                text = await decryptMessage(aesKey, {
                  ciphertext: m.ciphertext,
                  iv: m.iv,
                });
              } catch {
                text = "⚠️ could not decrypt message";
              }
            }
            decrypted.push({
              id: m.id,
              mine: m.from === selfUserId,
              text,
              sentAt: m.sentAt,
              status: "read",
              expiresAt: m.expiresAt,
              replyTo: m.replyTo,
              reactions: m.reactions ?? {},
              image: m.media
                ? { media: m.media, url: null, status: "loading" }
                : undefined,
            });
          }
          setState((s) => ({ ...s, messages: mergeById(s.messages, decrypted) }));
          for (const m of msg.messages) {
            if (m.media) void hydrateImage(m.id, m.media);
            scheduleLocalExpiry(m.id, m.expiresAt);
          }
          return;
        }
        case "history:cleared":
          setState((s) => {
            revokeFor(s.messages);
            return { ...s, messages: [] };
          });
          return;
      }
    };

    socket.addEventListener("message", onMessage);
    const urls = objectUrls.current;
    const timers = expiryTimers.current;
    return () => {
      socket.removeEventListener("message", onMessage);
      socket.close();
      socketRef.current = null;
      for (const url of urls) URL.revokeObjectURL(url);
      urls.clear();
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, peerUserId]);

  const sendText = useCallback(
    async (text: string, replyTo?: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      const id = randomId();
      const sentAt = Date.now();
      const expiresAt =
        disappearRef.current > 0 ? sentAt + disappearRef.current : undefined;
      const optimistic: ChatMessage = {
        id,
        mine: true,
        text: trimmed,
        sentAt,
        status: "sending",
        expiresAt,
        replyTo,
        reactions: {},
      };
      setState((s) => ({ ...s, messages: [...s.messages, optimistic] }));
      scheduleLocalExpiry(id, expiresAt);

      try {
        if (!key) throw new Error("no key");
        const { ciphertext, iv } = await encryptMessage(key, trimmed);
        socketRef.current?.send(
          JSON.stringify({
            type: "message:send",
            id,
            ciphertext,
            iv,
            sentAt,
            replyTo,
          }),
        );
        markStatus(setState, id, "sent");
      } catch {
        markStatus(setState, id, "failed");
      }
    },
    [key],
  );

  const sendImage = useCallback(
    async (file: File, replyTo?: string) => {
      const id = randomId();
      const sentAt = Date.now();
      const expiresAt =
        disappearRef.current > 0 ? sentAt + disappearRef.current : undefined;
      const localUrl = trackUrl(URL.createObjectURL(file));
      const optimistic: ChatMessage = {
        id,
        mine: true,
        text: "",
        sentAt,
        status: "sending",
        expiresAt,
        replyTo,
        reactions: {},
        image: { url: localUrl, status: "ready" },
      };
      setState((s) => ({ ...s, messages: [...s.messages, optimistic] }));
      scheduleLocalExpiry(id, expiresAt);

      try {
        const media = await uploadImage(
          conversationId,
          peerUserId,
          file,
          persistRef.current,
        );
        socketRef.current?.send(
          JSON.stringify({ type: "message:send", id, media, sentAt, replyTo }),
        );
        setState((s) => ({
          ...s,
          messages: s.messages.map((m) =>
            m.id === id
              ? {
                  ...m,
                  status: "sent",
                  image: m.image ? { ...m.image, media } : m.image,
                }
              : m,
          ),
        }));
      } catch {
        markStatus(setState, id, "failed");
      }
    },
    [conversationId, peerUserId, trackUrl],
  );

  const sendAudio = useCallback(
    async (blob: Blob, mime: string, duration: number, replyTo?: string) => {
      const id = randomId();
      const sentAt = Date.now();
      const expiresAt =
        disappearRef.current > 0 ? sentAt + disappearRef.current : undefined;
      const localUrl = trackUrl(URL.createObjectURL(blob));
      const optimistic: ChatMessage = {
        id,
        mine: true,
        text: "",
        sentAt,
        status: "sending",
        expiresAt,
        replyTo,
        reactions: {},
        // placeholder so it renders as an audio player immediately
        image: {
          url: localUrl,
          status: "ready",
          media: { id: "", iv: "", mime, size: 0, kind: "audio", duration },
        },
      };
      setState((s) => ({ ...s, messages: [...s.messages, optimistic] }));
      scheduleLocalExpiry(id, expiresAt);

      try {
        const media = await uploadAudio(
          conversationId,
          peerUserId,
          blob,
          mime,
          duration,
          persistRef.current,
        );
        socketRef.current?.send(
          JSON.stringify({ type: "message:send", id, media, sentAt, replyTo }),
        );
        setState((s) => ({
          ...s,
          messages: s.messages.map((m) =>
            m.id === id
              ? {
                  ...m,
                  status: "sent",
                  image: m.image ? { ...m.image, media } : m.image,
                }
              : m,
          ),
        }));
      } catch {
        markStatus(setState, id, "failed");
      }
    },
    [conversationId, peerUserId, trackUrl],
  );

  const sendFile = useCallback(
    async (file: File, replyTo?: string) => {
      const id = randomId();
      const sentAt = Date.now();
      const expiresAt =
        disappearRef.current > 0 ? sentAt + disappearRef.current : undefined;
      const localUrl = trackUrl(URL.createObjectURL(file));
      const optimistic: ChatMessage = {
        id,
        mine: true,
        text: "",
        sentAt,
        status: "sending",
        expiresAt,
        replyTo,
        reactions: {},
        image: {
          url: localUrl,
          status: "ready",
          media: {
            id: "",
            iv: "",
            mime: file.type || "application/octet-stream",
            size: file.size,
            kind: "file",
            name: file.name,
          },
        },
      };
      setState((s) => ({ ...s, messages: [...s.messages, optimistic] }));
      scheduleLocalExpiry(id, expiresAt);

      try {
        const media = await uploadFile(
          conversationId,
          peerUserId,
          file,
          persistRef.current,
        );
        socketRef.current?.send(
          JSON.stringify({ type: "message:send", id, media, sentAt, replyTo }),
        );
        setState((s) => ({
          ...s,
          messages: s.messages.map((m) =>
            m.id === id
              ? {
                  ...m,
                  status: "sent",
                  image: m.image ? { ...m.image, media } : m.image,
                }
              : m,
          ),
        }));
      } catch {
        markStatus(setState, id, "failed");
      }
    },
    [conversationId, peerUserId, trackUrl],
  );

  const deleteMessages = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return;
      const items: DeleteItem[] = ids.map((id) => {
        const m = messagesRef.current.find((x) => x.id === id);
        return { id, mediaId: m?.image?.media?.id };
      });
      socketRef.current?.send(JSON.stringify({ type: "message:delete", items }));
      // Optimistic local removal (server also broadcasts messages:deleted).
      removeMessages(ids);
    },
    [removeMessages],
  );

  const setTyping = useCallback((on: boolean) => {
    const socket = socketRef.current;
    if (!socket) return;
    if (on !== lastTypingSent.current) {
      lastTypingSent.current = on;
      socket.send(JSON.stringify({ type: "typing", on }));
    }
    if (on) {
      if (typingTimeout.current) clearTimeout(typingTimeout.current);
      typingTimeout.current = setTimeout(() => {
        lastTypingSent.current = false;
        socket.send(JSON.stringify({ type: "typing", on: false }));
      }, 2500);
    }
  }, []);

  const setPersist = useCallback((on: boolean) => {
    socketRef.current?.send(JSON.stringify({ type: "persist:set", on }));
  }, []);

  const clearHistory = useCallback(() => {
    socketRef.current?.send(JSON.stringify({ type: "history:clear" }));
  }, []);

  const setDisappear = useCallback((ttl: number) => {
    socketRef.current?.send(JSON.stringify({ type: "disappear:set", ttl }));
  }, []);

  // Toggle my reaction on a message (same emoji again removes it).
  const react = useCallback(
    (messageId: string, emoji: string) => {
      const m = messagesRef.current.find((x) => x.id === messageId);
      const op = m?.reactions[selfUserId] === emoji ? "remove" : "add";
      socketRef.current?.send(
        JSON.stringify({ type: "reaction", id: messageId, emoji, op }),
      );
      setState((s) => ({
        ...s,
        messages: s.messages.map((x) => {
          if (x.id !== messageId) return x;
          const reactions = { ...x.reactions };
          if (op === "remove") delete reactions[selfUserId];
          else reactions[selfUserId] = emoji;
          return { ...x, reactions };
        }),
      }));
    },
    [selfUserId],
  );

  return {
    ...state,
    selfUserId,
    keyReady: key !== null,
    sendText,
    sendImage,
    sendAudio,
    sendFile,
    deleteMessages,
    react,
    setTyping,
    setPersist,
    setDisappear,
    clearHistory,
  };
}

function markStatus(
  setState: React.Dispatch<React.SetStateAction<ChatState>>,
  id: string,
  status: MessageStatus,
) {
  setState((s) => ({
    ...s,
    messages: s.messages.map((m) => (m.id === id ? { ...m, status } : m)),
  }));
}

function rankUp(current: MessageStatus, next: ReceiptState): boolean {
  const cur = current === "read" ? 2 : current === "delivered" ? 1 : 0;
  return RANK[next] > cur;
}
