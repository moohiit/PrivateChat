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
import type {
  Conversation,
  LobbyClientMessage,
  LobbyServerMessage,
  PresenceUser,
} from "@/lib/protocol";

export type ConnStatus = "connecting" | "connected" | "disconnected";

type LobbyState = {
  status: ConnStatus;
  online: PresenceUser[];
  incoming: PresenceUser[];
  sentTo: string[];
  conversations: Conversation[];
  error: string | null;
};

type LobbyContextValue = LobbyState & {
  selfUserId: string;
  sendRequest: (toUserId: string) => void;
  requestByUsername: (
    username: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  accept: (fromUserId: string) => void;
  reject: (fromUserId: string) => void;
  clearError: () => void;
};

const LobbyContext = createContext<LobbyContextValue | null>(null);

const INITIAL: LobbyState = {
  status: "connecting",
  online: [],
  incoming: [],
  sentTo: [],
  conversations: [],
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
  const socketRef = useRef<ReturnType<typeof createLobbySocket> | null>(null);

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
  const clearError = useCallback(
    () => setState((s) => ({ ...s, error: null })),
    [],
  );

  return (
    <LobbyContext.Provider
      value={{
        ...state,
        selfUserId,
        sendRequest,
        requestByUsername,
        accept,
        reject,
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
