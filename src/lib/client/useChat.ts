"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createConversationSocket } from "./party";
import { getConversationKey } from "@/lib/crypto/keystore";
import { encryptMessage, decryptMessage } from "@/lib/crypto/conversation";
import type { ChatServerMessage, ReceiptState } from "@/lib/protocol";

export type MessageStatus = "sending" | "sent" | "delivered" | "read" | "failed";

export type ChatMessage = {
  id: string;
  mine: boolean;
  text: string;
  sentAt: number;
  status: MessageStatus;
};

export type ChatState = {
  messages: ChatMessage[];
  peerOnline: boolean;
  peerTyping: boolean;
  keyReady: boolean;
};

const RANK: Record<ReceiptState, number> = { delivered: 1, read: 2 };

function randomId(): string {
  return crypto.randomUUID();
}

/**
 * Drives a single conversation: opens the conversation room socket, encrypts on
 * send and decrypts on receive with the conversation key from the keystore, and
 * tracks delivery/read receipts, typing, and peer room-presence.
 */
export function useChat(conversationId: string, peerUserId: string) {
  const [state, setState] = useState<ChatState>({
    messages: [],
    peerOnline: false,
    peerTyping: false,
    keyReady: getConversationKey(conversationId) !== null,
  });
  const socketRef = useRef<ReturnType<typeof createConversationSocket> | null>(
    null,
  );
  const typingTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTypingSent = useRef(false);

  const key = getConversationKey(conversationId);

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
          if (!aesKey) return;
          let text: string;
          try {
            text = await decryptMessage(aesKey, {
              ciphertext: msg.ciphertext,
              iv: msg.iv,
            });
          } catch {
            text = "⚠️ could not decrypt message";
          }
          setState((s) => {
            if (s.messages.some((m) => m.id === msg.id)) return s;
            const incoming: ChatMessage = {
              id: msg.id,
              mine: false,
              text,
              sentAt: msg.sentAt,
              status: "read",
            };
            return {
              ...s,
              messages: [...s.messages, incoming].sort(
                (a, b) => a.sentAt - b.sentAt,
              ),
            };
          });
          // Chat is open => acknowledge delivered + read.
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
      }
    };

    socket.addEventListener("message", onMessage);
    return () => {
      socket.removeEventListener("message", onMessage);
      socket.close();
      socketRef.current = null;
    };
  }, [conversationId, peerUserId]);

  const sendText = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      const id = randomId();
      const sentAt = Date.now();

      const optimistic: ChatMessage = {
        id,
        mine: true,
        text: trimmed,
        sentAt,
        status: "sending",
      };
      setState((s) => ({ ...s, messages: [...s.messages, optimistic] }));

      try {
        if (!key) throw new Error("no key");
        const { ciphertext, iv } = await encryptMessage(key, trimmed);
        socketRef.current?.send(
          JSON.stringify({ type: "message:send", id, ciphertext, iv, sentAt }),
        );
        setState((s) => ({
          ...s,
          messages: s.messages.map((m) =>
            m.id === id ? { ...m, status: "sent" as const } : m,
          ),
        }));
      } catch {
        setState((s) => ({
          ...s,
          messages: s.messages.map((m) =>
            m.id === id ? { ...m, status: "failed" as const } : m,
          ),
        }));
      }
    },
    [key],
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

  return { ...state, keyReady: key !== null, sendText, setTyping };
}

function rankUp(current: MessageStatus, next: ReceiptState): boolean {
  const cur =
    current === "read" ? 2 : current === "delivered" ? 1 : 0;
  return RANK[next] > cur;
}
