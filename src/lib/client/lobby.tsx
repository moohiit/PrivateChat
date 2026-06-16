"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { createLobbySocket } from "./party";
import {
  importPeerPublicKey,
  deriveConversationKey,
  computeSafetyNumber,
} from "@/lib/crypto/conversation";
import { putConversationKey } from "@/lib/crypto/keystore";
import { getUnlockedKey } from "@/lib/crypto/session-key";
import { loadConversations, saveConversation } from "@/lib/crypto/idb";
import type {
  Conversation,
  LobbyClientMessage,
  LobbyServerMessage,
  PresenceUser,
} from "@/lib/protocol";

export type ConnStatus = "connecting" | "connected" | "disconnected";

export type CryptoStatus = "deriving" | "ready" | "locked" | "error";

export type ConversationCrypto = {
  status: CryptoStatus;
  safetyNumber?: string;
};

type LobbyState = {
  status: ConnStatus;
  online: PresenceUser[];
  incoming: PresenceUser[];
  sentTo: string[];
  conversations: Conversation[];
  visible: boolean;
  error: string | null;
};

type LobbyContextValue = LobbyState & {
  selfUserId: string;
  convoCrypto: Record<string, ConversationCrypto>;
  sendRequest: (toUserId: string) => void;
  requestByUsername: (
    username: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  accept: (fromUserId: string) => void;
  reject: (fromUserId: string) => void;
  setVisibility: (on: boolean) => void;
  clearError: () => void;
};

const LobbyContext = createContext<LobbyContextValue | null>(null);

const INITIAL: LobbyState = {
  status: "connecting",
  online: [],
  incoming: [],
  sentTo: [],
  conversations: [],
  visible: false,
  error: null,
};

function reduce(state: LobbyState, msg: LobbyServerMessage): LobbyState {
  switch (msg.type) {
    case "presence:snapshot":
      return { ...state, online: msg.users };
    case "presence:online":
      return state.online.some((u) => u.userId === msg.user.userId)
        ? state
        : { ...state, online: [...state.online, msg.user] };
    case "presence:offline":
      return {
        ...state,
        online: state.online.filter((u) => u.userId !== msg.userId),
      };
    case "requests:snapshot":
      return { ...state, incoming: msg.incoming };
    case "conversations:snapshot": {
      const known = new Set(state.conversations.map((c) => c.conversationId));
      const added = msg.conversations.filter(
        (c) => !known.has(c.conversationId),
      );
      return added.length
        ? { ...state, conversations: [...state.conversations, ...added] }
        : state;
    }
    case "request:incoming":
      return state.incoming.some((u) => u.userId === msg.from.userId)
        ? state
        : { ...state, incoming: [...state.incoming, msg.from] };
    case "request:sent":
      return state.sentTo.includes(msg.toUserId)
        ? state
        : { ...state, sentTo: [...state.sentTo, msg.toUserId] };
    case "request:accepted": {
      const exists = state.conversations.some(
        (c) => c.conversationId === msg.conversationId,
      );
      return {
        ...state,
        // Clear it from incoming/sent now that it's a conversation.
        incoming: state.incoming.filter((u) => u.userId !== msg.with.userId),
        sentTo: state.sentTo.filter((id) => id !== msg.with.userId),
        conversations: exists
          ? state.conversations
          : [
              ...state.conversations,
              { conversationId: msg.conversationId, peer: msg.with },
            ],
      };
    }
    case "request:rejected":
      return {
        ...state,
        sentTo: state.sentTo.filter((id) => id !== msg.byUserId),
        error: "Your chat request was declined.",
      };
    case "visibility:state":
      return { ...state, visible: msg.on };
    case "error":
      return { ...state, error: msg.message };
    default:
      return state;
  }
}

export function LobbyProvider({
  selfUserId,
  children,
}: {
  selfUserId: string;
  children: React.ReactNode;
}) {
  const [state, setState] = useState<LobbyState>(INITIAL);
  const [convoCrypto, setConvoCrypto] = useState<
    Record<string, ConversationCrypto>
  >({});
  const socketRef = useRef<ReturnType<typeof createLobbySocket> | null>(null);
  const derivedRef = useRef<Set<string>>(new Set());
  const selfPubRef = useRef<string | null>(null);

  const setCrypto = useCallback(
    (conversationId: string, value: ConversationCrypto) =>
      setConvoCrypto((prev) => ({ ...prev, [conversationId]: value })),
    [],
  );

  // Restore the saved conversation list on load (reload-resilient), then keep
  // it persisted as conversations are added.
  useEffect(() => {
    let active = true;
    loadConversations(selfUserId).then((saved) => {
      if (!active || saved.length === 0) return;
      setState((s) => {
        const known = new Set(s.conversations.map((c) => c.conversationId));
        const restored = saved
          .filter((c) => !known.has(c.conversationId))
          .map((c) => ({
            conversationId: c.conversationId,
            peer: { userId: c.peerUserId, username: c.peerUsername },
          }));
        return restored.length
          ? { ...s, conversations: [...s.conversations, ...restored] }
          : s;
      });
    });
    return () => {
      active = false;
    };
  }, [selfUserId]);

  useEffect(() => {
    for (const c of state.conversations) {
      void saveConversation(selfUserId, {
        conversationId: c.conversationId,
        peerUserId: c.peer.userId,
        peerUsername: c.peer.username,
        updatedAt: Date.now(),
      });
    }
  }, [state.conversations, selfUserId]);

  // Derive a per-conversation AES key (ECDH -> HKDF) the moment a conversation
  // is established, and compute its safety number for out-of-band verification.
  useEffect(() => {
    async function ensureSelfPub(): Promise<string | null> {
      if (selfPubRef.current) return selfPubRef.current;
      const res = await fetch(`/api/users/key?userId=${selfUserId}`);
      if (!res.ok) return null;
      const { publicKey } = (await res.json()) as { publicKey: string };
      selfPubRef.current = publicKey;
      return publicKey;
    }

    async function derive(convo: Conversation) {
      setCrypto(convo.conversationId, { status: "deriving" });
      try {
        const myPrivateKey = getUnlockedKey();
        if (!myPrivateKey) {
          setCrypto(convo.conversationId, { status: "locked" });
          return;
        }
        const res = await fetch(`/api/users/key?userId=${convo.peer.userId}`);
        if (!res.ok) throw new Error("key fetch failed");
        const { publicKey } = (await res.json()) as { publicKey: string };

        const peerPublicKey = await importPeerPublicKey(publicKey);
        const key = await deriveConversationKey(
          myPrivateKey,
          peerPublicKey,
          convo.conversationId,
        );
        putConversationKey(convo.conversationId, key);

        const selfPub = await ensureSelfPub();
        const safetyNumber = selfPub
          ? await computeSafetyNumber(selfPub, publicKey)
          : undefined;
        setCrypto(convo.conversationId, { status: "ready", safetyNumber });
      } catch {
        setCrypto(convo.conversationId, { status: "error" });
      }
    }

    for (const convo of state.conversations) {
      if (!derivedRef.current.has(convo.conversationId)) {
        derivedRef.current.add(convo.conversationId);
        void derive(convo);
      }
    }
  }, [state.conversations, selfUserId, setCrypto]);

  useEffect(() => {
    const socket = createLobbySocket();
    socketRef.current = socket;

    const onOpen = () => setState((s) => ({ ...s, status: "connected" }));
    const onClose = () => setState((s) => ({ ...s, status: "disconnected" }));
    const onError = () => setState((s) => ({ ...s, status: "disconnected" }));
    const onMessage = (event: MessageEvent) => {
      let msg: LobbyServerMessage;
      try {
        msg = JSON.parse(event.data as string) as LobbyServerMessage;
      } catch {
        return;
      }
      setState((s) => reduce(s, msg));
    };

    socket.addEventListener("open", onOpen);
    socket.addEventListener("close", onClose);
    socket.addEventListener("error", onError);
    socket.addEventListener("message", onMessage);

    return () => {
      socket.removeEventListener("open", onOpen);
      socket.removeEventListener("close", onClose);
      socket.removeEventListener("error", onError);
      socket.removeEventListener("message", onMessage);
      socket.close();
      socketRef.current = null;
    };
  }, []);

  const send = useCallback((msg: LobbyClientMessage) => {
    socketRef.current?.send(JSON.stringify(msg));
  }, []);

  const sendRequest = useCallback(
    (toUserId: string) => send({ type: "request:send", toUserId }),
    [send],
  );

  const requestByUsername = useCallback(
    async (username: string) => {
      const handle = username.trim().replace(/^@/, "");
      if (!handle) return { ok: false, error: "Enter a username." };
      try {
        const res = await fetch(
          `/api/users/lookup?username=${encodeURIComponent(handle)}`,
        );
        if (res.status === 404) return { ok: false, error: "No such user." };
        if (!res.ok) return { ok: false, error: "Lookup failed." };
        const { user } = (await res.json()) as { user: PresenceUser };
        if (user.userId === selfUserId)
          return { ok: false, error: "You can't message yourself." };
        sendRequest(user.userId);
        return { ok: true };
      } catch {
        return { ok: false, error: "Network error." };
      }
    },
    [selfUserId, sendRequest],
  );

  const accept = useCallback(
    (fromUserId: string) => send({ type: "request:accept", fromUserId }),
    [send],
  );
  const reject = useCallback(
    (fromUserId: string) => send({ type: "request:reject", fromUserId }),
    [send],
  );
  const setVisibility = useCallback(
    (on: boolean) => {
      // Optimistic; server confirms via visibility:state.
      setState((s) => ({ ...s, visible: on }));
      send({ type: "visibility:set", on });
    },
    [send],
  );
  const clearError = useCallback(
    () => setState((s) => ({ ...s, error: null })),
    [],
  );

  return (
    <LobbyContext.Provider
      value={{
        ...state,
        selfUserId,
        convoCrypto,
        sendRequest,
        requestByUsername,
        accept,
        reject,
        setVisibility,
        clearError,
      }}
    >
      {children}
    </LobbyContext.Provider>
  );
}

export function useLobby(): LobbyContextValue {
  const ctx = useContext(LobbyContext);
  if (!ctx) throw new Error("useLobby must be used within a LobbyProvider");
  return ctx;
}
