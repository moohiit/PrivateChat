"use client";

import { useEffect, useRef, useState } from "react";
import {
  useChat,
  type ChatMessage,
  type MessageStatus,
} from "@/lib/client/useChat";
import { MAX_IMAGE_BYTES } from "@/lib/client/media";
import type { Conversation } from "@/lib/protocol";

const DISAPPEAR_OPTIONS = [
  { ttl: 0, label: "Off" },
  { ttl: 3_600_000, label: "1h" },
  { ttl: 86_400_000, label: "24h" },
  { ttl: 604_800_000, label: "7d" },
];

export default function ChatView({
  conversation,
  selfUserId,
  onBack,
}: {
  conversation: Conversation;
  selfUserId: string;
  onBack: () => void;
}) {
  const { peer, conversationId } = conversation;
  const {
    messages,
    peerOnline,
    peerTyping,
    keyReady,
    persistMine,
    persistEffective,
    disappearTtl,
    sendText,
    sendImage,
    deleteMessages,
    setTyping,
    setPersist,
    setDisappear,
    clearHistory,
  } = useChat(conversationId, peer.userId, selfUserId);

  const [draft, setDraft] = useState("");
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

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

  function onPickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    for (const f of files) {
      if (!f.type.startsWith("image/")) continue;
      if (f.size > MAX_IMAGE_BYTES) {
        setError("Image is too large (max 25 MB).");
        continue;
      }
      void sendImage(f);
    }
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function exitSelect() {
    setSelecting(false);
    setSelected(new Set());
  }

  function confirmDelete() {
    if (selected.size === 0) return exitSelect();
    if (confirm(`Delete ${selected.size} message(s) for everyone?`)) {
      deleteMessages([...selected]);
      exitSelect();
    }
  }

  return (
    <div className="surface flex h-[calc(100dvh-7.5rem)] min-h-[24rem] flex-col overflow-hidden p-0 sm:h-[calc(100dvh-9rem)]">
      {/* Header */}
      <header className="flex items-center gap-3 border-b border-border-soft px-4 py-3">
        {selecting ? (
          <>
            <button
              onClick={exitSelect}
              className="btn-ghost rounded-lg px-3 py-1.5 text-xs"
            >
              Cancel
            </button>
            <span className="flex-1 text-sm text-muted">
              {selected.size} selected
            </span>
            <button
              onClick={confirmDelete}
              disabled={selected.size === 0}
              className="rounded-lg bg-danger/15 px-3 py-1.5 text-xs font-semibold text-danger disabled:opacity-40"
            >
              Delete
            </button>
          </>
        ) : (
          <>
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
            <button
              onClick={() => setSelecting(true)}
              disabled={messages.length === 0}
              className="btn-ghost rounded-lg px-3 py-1.5 text-xs disabled:opacity-40"
            >
              Select
            </button>
          </>
        )}
      </header>

      {/* Persistence controls */}
      <div className="flex items-center justify-between gap-2 border-b border-border-soft px-4 py-2">
        <button
          onClick={() => setPersist(!persistMine)}
          disabled={!keyReady}
          className="flex items-center gap-2 text-xs disabled:opacity-50"
          title="Both people must enable saving for history (and photos) to persist"
        >
          <span
            className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${
              persistMine ? "bg-accent" : "bg-surface-strong"
            }`}
          >
            <span
              className={`inline-block h-3 w-3 transform rounded-full bg-bg transition-transform ${
                persistMine ? "translate-x-3.5" : "translate-x-0.5"
              }`}
            />
          </span>
          <span className="text-muted">
            {persistEffective ? (
              <span className="text-accent">saving history</span>
            ) : persistMine ? (
              "waiting for peer to enable"
            ) : (
              "save history"
            )}
          </span>
        </button>
        <button
          onClick={() => {
            if (confirm("Delete the stored history for this conversation?")) {
              clearHistory();
            }
          }}
          className="text-xs text-faint hover:text-danger"
        >
          Clear history
        </button>
      </div>

      {/* Disappearing messages */}
      <div className="flex items-center justify-between gap-2 border-b border-border-soft px-4 py-2">
        <span className="flex items-center gap-1.5 text-xs text-muted">
          <span aria-hidden>⏱</span>
          <span>Disappearing</span>
        </span>
        <div className="flex items-center gap-1">
          {DISAPPEAR_OPTIONS.map((opt) => (
            <button
              key={opt.ttl}
              onClick={() => setDisappear(opt.ttl)}
              disabled={!keyReady}
              aria-pressed={disappearTtl === opt.ttl}
              className={`rounded-md px-2 py-1 text-xs disabled:opacity-40 ${
                disappearTtl === opt.ttl
                  ? "bg-accent font-semibold text-accent-ink"
                  : "btn-ghost"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <button
          onClick={() => setError(null)}
          className="border-b border-warn/30 bg-warn/10 px-4 py-1.5 text-left text-xs text-warn"
        >
          {error} — dismiss
        </button>
      )}

      {/* Messages */}
      <div
        ref={scrollRef}
        role="log"
        aria-live="polite"
        aria-label={`Conversation with ${peer.username}`}
        className="flex-1 space-y-2 overflow-y-auto px-4 py-4"
      >
        {!keyReady && (
          <Banner>
            Encryption key isn&apos;t loaded yet. If this persists, unlock your
            keys on the home screen.
          </Banner>
        )}
        {keyReady && messages.length === 0 && (
          <Banner>
            This is the start of your encrypted conversation with @
            {peer.username}. Messages and photos are end-to-end encrypted.
          </Banner>
        )}
        {messages.map((m) => (
          <Bubble
            key={m.id}
            m={m}
            selecting={selecting}
            selected={selected.has(m.id)}
            onToggle={() => toggleSelect(m.id)}
            peerUsername={peer.username}
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
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          onChange={onPickFiles}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={!keyReady}
          aria-label="Attach photo"
          className="btn-ghost grid h-10 w-10 shrink-0 place-items-center rounded-[0.625rem] text-base disabled:opacity-50"
        >
          🖼
        </button>
        <input
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setTyping(e.target.value.length > 0);
          }}
          onBlur={() => setTyping(false)}
          placeholder={keyReady ? "Write a message…" : "Encryption unavailable"}
          disabled={!keyReady}
          aria-label={`Message to ${peer.username}`}
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
  m,
  selecting,
  selected,
  onToggle,
  peerUsername,
}: {
  m: ChatMessage;
  selecting: boolean;
  selected: boolean;
  onToggle: () => void;
  peerUsername: string;
}) {
  function download() {
    if (!m.image?.url) return;
    const ext = (m.image.media?.mime ?? "image/webp").split("/")[1] ?? "webp";
    const a = document.createElement("a");
    a.href = m.image.url;
    a.download = `privatechat-${m.id.slice(0, 8)}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  return (
    <div
      className={`flex items-end gap-2 ${m.mine ? "justify-end" : "justify-start"} ${
        selecting ? "cursor-pointer" : ""
      }`}
      onClick={selecting ? onToggle : undefined}
    >
      {selecting && (
        <span
          aria-hidden
          className={`mb-2 grid h-4 w-4 shrink-0 place-items-center rounded-full border text-[0.6rem] ${
            selected
              ? "border-accent bg-accent text-accent-ink"
              : "border-border-strong"
          }`}
        >
          {selected ? "✓" : ""}
        </span>
      )}
      <div
        className={`w-fit max-w-[80%] min-w-0 overflow-hidden rounded-2xl text-sm leading-relaxed sm:max-w-[68%] ${
          m.mine
            ? "rounded-br-sm bg-accent text-accent-ink"
            : "rounded-bl-sm bg-surface-strong text-foreground"
        } ${selected ? "ring-2 ring-accent" : ""}`}
      >
        {m.image && (
          <ImageBlock
            image={m.image}
            alt={`Photo from @${peerUsername}`}
            onDownload={download}
          />
        )}
        <div className={`px-3 ${m.image && !m.text ? "py-1.5" : "py-2"}`}>
          {m.text && (
            <p className="whitespace-pre-wrap break-words">{m.text}</p>
          )}
          <span
            className={`mt-0.5 flex items-center justify-end gap-1 text-[0.65rem] ${
              m.mine ? "text-accent-ink/70" : "text-faint"
            }`}
          >
            {m.expiresAt && (
              <span aria-label="disappearing message" title="disappearing">
                ⏱
              </span>
            )}
            {formatTime(m.sentAt)}
            {m.mine && <StatusTick status={m.status} />}
          </span>
        </div>
      </div>
    </div>
  );
}

function ImageBlock({
  image,
  alt,
  onDownload,
}: {
  image: NonNullable<ChatMessage["image"]>;
  alt: string;
  onDownload: () => void;
}) {
  if (image.status === "loading" && !image.url) {
    return (
      <div className="grid h-40 w-56 place-items-center bg-black/30 text-xs text-faint">
        decrypting…
      </div>
    );
  }
  if (image.status === "error") {
    return (
      <div className="grid h-40 w-56 place-items-center bg-black/30 text-xs text-danger">
        couldn&apos;t load image
      </div>
    );
  }
  return (
    <div className="relative">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={image.url ?? ""}
        alt={alt}
        className="block max-h-72 w-full object-cover"
      />
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onDownload();
        }}
        aria-label="Download photo"
        className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full bg-black/55 text-xs text-white backdrop-blur hover:bg-black/75"
      >
        ↓
      </button>
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
    <span
      className={status === "read" ? "font-semibold" : ""}
      aria-label={status}
      title={status}
    >
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
