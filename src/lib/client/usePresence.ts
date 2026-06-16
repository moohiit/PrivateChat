"use client";

import { useEffect, useState } from "react";
import { createLobbySocket } from "./party";
import type { LobbyServerMessage, PresenceUser } from "@/lib/protocol";

export type ConnStatus = "connecting" | "connected" | "disconnected";

function applyMessage(
  prev: PresenceUser[],
  msg: LobbyServerMessage,
): PresenceUser[] {
  switch (msg.type) {
    case "presence:snapshot":
      return msg.users;
    case "presence:online":
      return prev.some((u) => u.userId === msg.user.userId)
        ? prev
        : [...prev, msg.user];
    case "presence:offline":
      return prev.filter((u) => u.userId !== msg.userId);
    default:
      return prev;
  }
}

/**
 * Connects to the presence lobby for the lifetime of the component and exposes
 * connection status + the list of currently-online users. partysocket handles
 * auto-reconnect; we refetch the snapshot on each reconnect.
 */
export function usePresence() {
  const [status, setStatus] = useState<ConnStatus>("connecting");
  const [online, setOnline] = useState<PresenceUser[]>([]);

  useEffect(() => {
    const socket = createLobbySocket();

    const onOpen = () => setStatus("connected");
    const onClose = () => setStatus("disconnected");
    const onError = () => setStatus("disconnected");
    const onMessage = (event: MessageEvent) => {
      let msg: LobbyServerMessage;
      try {
        msg = JSON.parse(event.data as string) as LobbyServerMessage;
      } catch {
        return;
      }
      setOnline((prev) => applyMessage(prev, msg));
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
    };
  }, []);

  return { status, online };
}
