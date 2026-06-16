"use client";

import { useEffect, useRef, useState } from "react";
import { useChat, type MessageStatus } from "@/lib/client/useChat";
import type { Conversation } from "@/lib/protocol";

export default function ChatView({
  conversation,
  onBack,
}: {
  conversation: Conversation;
  onBack: () => void;
}) {
  const { peer, conversationId } = conversation;
  const { messages, peerOnline, peerTyping, keyReady, sendText, setTyping } =
    useChat(conversationId, peer.userId);

  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, peerTyping]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.trim()) return;
    void sendText(draft);
    setDraft("");
    setTyping(false);
  }

  return (
    <div className="surface flex h-[calc(100dvh-7.5rem)] min-h-[24rem] flex-col overflow-hidden p-0 sm:h-[calc(100dvh-9rem)]">
      {/* Header */}
      <header className="flex items-center gap-3 border-b border-border-soft px-4 py-3">
        <button
          onClick={onBack}
          aria-label="Back"
          className="btn-ghost grid h-8 w-8 place-items-center rounded-lg text-sm"
        >
          ←
        </button>
        <div className="min-w-0 flex-1">
          <p className="identifier truncate text-sm font-medium">
            @{peer.username}
          </p>
          <p className="text-xs text-faint">
            {peerTyping ? (
              <span className="text-accent">typing…</span>
            ) : peerOnline ? (
              "online"
            ) : (
              "offline"
            )}
          </p>
        </div>
        <span className="identifier hidden text-[0.65rem] text-faint sm:block">
          {conversationId.slice(0, 8)}…
        </span>
      </header>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto px-4 py-4">
        {!keyReady && (
          <Banner>
            Encryption key isn&apos;t loaded on this device. Re-establish the
            conversation to chat. (Durable history arrives in Phase 6.)
          </Banner>
        )}
        {keyReady && messages.length === 0 && (
          <Banner>
            This is the start of your encrypted conversation with @
            {peer.username}. Messages are end-to-end encrypted.
          </Banner>
        )}
        {messages.map((m) => (
          <Bubble
            key={m.id}
            mine={m.mine}
            text={m.text}
            sentAt={m.sentAt}
            status={m.status}
          />
        ))}
        {peerTyping && (
          <div className="flex justify-start">
            <span className="rounded-2xl rounded-bl-sm bg-surface-strong px-3 py-2 text-sm text-faint">
              …
            </span>
          </div>
        )}
      </div>

      {/* Composer */}
      <form
        onSubmit={submit}
        className="flex items-end gap-2 border-t border-border-soft px-3 py-3"
      >
        <input
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setTyping(e.target.value.length > 0);
          }}
          onBlur={() => setTyping(false)}
          placeholder={keyReady ? "Write a message…" : "Encryption unavailable"}
          disabled={!keyReady}
          className="field flex-1 px-3 py-2.5 text-base text-foreground sm:text-sm"
          autoComplete="off"
        />
        <button
          type="submit"
          disabled={!keyReady || !draft.trim()}
          className="btn-accent rounded-[0.625rem] px-4 py-2.5 text-sm font-semibold"
        >
          Send
        </button>
      </form>
    </div>
  );
}

function Bubble({
  mine,
  text,
  sentAt,
  status,
}: {
  mine: boolean;
  text: string;
  sentAt: number;
  status: MessageStatus;
}) {
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[82%] rounded-2xl px-3 py-2 text-sm leading-relaxed sm:max-w-[70%] ${
          mine
            ? "rounded-br-sm bg-accent text-accent-ink"
            : "rounded-bl-sm bg-surface-strong text-foreground"
        }`}
      >
        <p className="whitespace-pre-wrap break-words">{text}</p>
        <span
          className={`mt-1 flex items-center justify-end gap-1 text-[0.65rem] ${
            mine ? "text-accent-ink/70" : "text-faint"
          }`}
        >
          {formatTime(sentAt)}
          {mine && <StatusTick status={status} />}
        </span>
      </div>
    </div>
  );
}

function StatusTick({ status }: { status: MessageStatus }) {
  const map: Record<MessageStatus, string> = {
    sending: "·",
    sent: "✓",
    delivered: "✓✓",
    read: "✓✓",
    failed: "✕",
  };
  return (
    <span className={status === "read" ? "font-semibold" : ""}>
      {map[status]}
    </span>
  );
}

function Banner({ children }: { children: React.ReactNode }) {
  return (
    <p className="mx-auto max-w-sm rounded-lg border border-dashed border-border-soft px-3 py-3 text-center text-xs text-faint">
      {children}
    </p>
  );
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
