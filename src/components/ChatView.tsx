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

const REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

const AUDIO_MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
];

function mediaLabel(m: ChatMessage): string {
  if (m.image?.media?.kind === "audio") return "🎤 Voice message";
  if (m.image) return "📷 Photo";
  return "message";
}

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
    sendAudio,
    deleteMessages,
    react,
    setTyping,
    setPersist,
    setDisappear,
    clearHistory,
  } = useChat(conversationId, peer.userId, selfUserId);

  const [draft, setDraft] = useState("");
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [recSecs, setRecSecs] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const recTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recStartRef = useRef(0);
  const sendOnStopRef = useRef(true);
  const replyToRef = useRef<ChatMessage | null>(null);

  const byId = new Map(messages.map((m) => [m.id, m]));

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, peerTyping]);

  useEffect(() => {
    replyToRef.current = replyTo;
  }, [replyTo]);

  // Stop recording + release the mic if the chat unmounts.
  useEffect(() => {
    return () => {
      if (recTimerRef.current) clearInterval(recTimerRef.current);
      try {
        recorderRef.current?.stop();
      } catch {
        /* ignore */
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  async function startRecording() {
    if (recording) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime =
        AUDIO_MIME_CANDIDATES.find((t) =>
          typeof MediaRecorder !== "undefined" &&
          MediaRecorder.isTypeSupported?.(t),
        ) ?? "";
      const rec = mime
        ? new MediaRecorder(stream, { mimeType: mime })
        : new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        const actualMime = rec.mimeType || mime || "audio/webm";
        const blob = new Blob(chunksRef.current, { type: actualMime });
        const duration = Math.max(
          1,
          Math.round((Date.now() - recStartRef.current) / 1000),
        );
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        if (recTimerRef.current) {
          clearInterval(recTimerRef.current);
          recTimerRef.current = null;
        }
        setRecording(false);
        setRecSecs(0);
        recorderRef.current = null;
        if (sendOnStopRef.current && blob.size > 0) {
          void sendAudio(blob, actualMime, duration, replyToRef.current?.id);
          setReplyTo(null);
        }
      };
      recorderRef.current = rec;
      recStartRef.current = Date.now();
      rec.start();
      setRecording(true);
      setRecSecs(0);
      recTimerRef.current = setInterval(() => setRecSecs((s) => s + 1), 1000);
    } catch {
      setError("Microphone access was denied.");
    }
  }

  function stopRecording(send: boolean) {
    sendOnStopRef.current = send;
    try {
      recorderRef.current?.stop();
    } catch {
      setRecording(false);
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.trim()) return;
    void sendText(draft, replyTo?.id);
    setDraft("");
    setReplyTo(null);
    setTyping(false);
  }

  function onPickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    const rid = replyTo?.id;
    let used = false;
    for (const f of files) {
      if (!f.type.startsWith("image/")) continue;
      if (f.size > MAX_IMAGE_BYTES) {
        setError("Image is too large (max 25 MB).");
        continue;
      }
      void sendImage(f, used ? undefined : rid);
      used = true;
    }
    if (used) setReplyTo(null);
  }

  function quotedFor(m: ChatMessage): { mine: boolean; text: string } | null {
    if (!m.replyTo) return null;
    const q = byId.get(m.replyTo);
    if (!q) return { mine: false, text: "original message" };
    return { mine: q.mine, text: q.text || mediaLabel(q) };
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
    <div className="fixed inset-0 z-40 flex flex-col overflow-hidden bg-bg sm:relative sm:inset-auto sm:z-auto sm:h-[calc(100dvh-9rem)] sm:min-h-[24rem] sm:rounded-2xl sm:border sm:border-border-soft sm:bg-surface sm:backdrop-blur">
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
        className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-4"
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
            selfUserId={selfUserId}
            quoted={quotedFor(m)}
            onReply={() => setReplyTo(m)}
            onReact={(emoji) => react(m.id, emoji)}
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

      {/* Reply context */}
      {replyTo && (
        <div className="flex items-center gap-2 border-t border-border-soft bg-surface-strong px-4 py-2">
          <span className="h-8 w-0.5 shrink-0 rounded bg-accent" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-[0.65rem] text-accent">
              Replying to {replyTo.mine ? "yourself" : `@${peer.username}`}
            </p>
            <p className="truncate text-xs text-faint">
              {replyTo.text || mediaLabel(replyTo)}
            </p>
          </div>
          <button
            onClick={() => setReplyTo(null)}
            aria-label="Cancel reply"
            className="btn-ghost grid h-7 w-7 place-items-center rounded-lg text-xs"
          >
            ✕
          </button>
        </div>
      )}

      {/* Composer */}
      {recording ? (
        <div className="flex items-center gap-3 border-t border-border-soft px-3 py-3">
          <button
            type="button"
            onClick={() => stopRecording(false)}
            aria-label="Cancel recording"
            className="btn-ghost grid h-10 w-10 shrink-0 place-items-center rounded-[0.625rem] text-sm"
          >
            ✕
          </button>
          <span className="flex flex-1 items-center gap-2 text-sm text-danger">
            <span className="dot-live inline-block h-2.5 w-2.5 rounded-full bg-danger" />
            Recording… {fmtDuration(recSecs)}
          </span>
          <button
            type="button"
            onClick={() => stopRecording(true)}
            aria-label="Send voice message"
            className="btn-accent rounded-[0.625rem] px-4 py-2.5 text-sm font-semibold"
          >
            Send
          </button>
        </div>
      ) : (
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
            className="field min-w-0 flex-1 px-3 py-2.5 text-base text-foreground sm:text-sm"
            autoComplete="off"
          />
          {draft.trim() ? (
            <button
              type="submit"
              disabled={!keyReady}
              className="btn-accent shrink-0 rounded-[0.625rem] px-4 py-2.5 text-sm font-semibold"
            >
              Send
            </button>
          ) : (
            <button
              type="button"
              onClick={startRecording}
              disabled={!keyReady}
              aria-label="Record voice message"
              className="btn-ghost grid h-10 w-10 shrink-0 place-items-center rounded-[0.625rem] text-base disabled:opacity-50"
            >
              🎤
            </button>
          )}
        </form>
      )}
    </div>
  );
}

function fmtDuration(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function Bubble({
  m,
  selecting,
  selected,
  onToggle,
  peerUsername,
  selfUserId,
  quoted,
  onReply,
  onReact,
}: {
  m: ChatMessage;
  selecting: boolean;
  selected: boolean;
  onToggle: () => void;
  peerUsername: string;
  selfUserId: string;
  quoted: { mine: boolean; text: string } | null;
  onReply: () => void;
  onReact: (emoji: string) => void;
}) {
  const [menu, setMenu] = useState(false);

  function download() {
    if (!m.image?.url) return;
    const mime = m.image.media?.mime ?? "image/webp";
    const ext = (mime.split("/")[1] ?? "bin").split(";")[0];
    const a = document.createElement("a");
    a.href = m.image.url;
    a.download = `privatechat-${m.id.slice(0, 8)}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  const counts: Record<string, number> = {};
  for (const e of Object.values(m.reactions)) counts[e] = (counts[e] ?? 0) + 1;
  const myReaction = m.reactions[selfUserId];

  const bubbleCol = (
    <div
      className={`flex max-w-[80%] flex-col gap-1 sm:max-w-[68%] ${
        m.mine ? "items-end" : "items-start"
      }`}
    >
      <div
        className={`w-fit min-w-0 overflow-hidden rounded-2xl text-sm leading-relaxed ${
          m.mine
            ? "rounded-br-sm bg-accent text-accent-ink"
            : "rounded-bl-sm bg-surface-strong text-foreground"
        } ${selected ? "ring-2 ring-accent" : ""}`}
      >
        {quoted && (
          <div className="border-l-2 border-current/40 bg-black/15 px-3 py-1.5">
            <p className="text-[0.65rem] font-medium opacity-90">
              {quoted.mine ? "You" : `@${peerUsername}`}
            </p>
            <p className="truncate text-xs opacity-70">{quoted.text}</p>
          </div>
        )}
        {m.image && (
          <MediaBlock
            media={m.image}
            mine={m.mine}
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

      {Object.keys(counts).length > 0 && (
        <div className="flex flex-wrap gap-1">
          {Object.entries(counts).map(([emoji, count]) => (
            <button
              key={emoji}
              onClick={() => onReact(emoji)}
              className={`flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-xs ${
                myReaction === emoji
                  ? "border-accent bg-accent/15 text-accent"
                  : "border-border-soft bg-surface-strong text-muted"
              }`}
            >
              <span>{emoji}</span>
              <span>{count}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );

  const trigger = !selecting && (
    <div className="relative mb-1 shrink-0">
      <button
        onClick={() => setMenu((v) => !v)}
        aria-label="React or reply"
        className="grid h-7 w-7 place-items-center rounded-full text-faint hover:text-foreground"
      >
        ⋯
      </button>
      {menu && (
        <div
          className={`absolute bottom-full z-20 mb-1 flex items-center gap-1 rounded-full border border-border-strong bg-bg-elevated px-2 py-1 shadow-lg ${
            m.mine ? "right-0" : "left-0"
          }`}
        >
          {REACTIONS.map((e) => (
            <button
              key={e}
              onClick={() => {
                onReact(e);
                setMenu(false);
              }}
              className="text-base transition-transform hover:scale-125"
            >
              {e}
            </button>
          ))}
          <span className="mx-0.5 h-4 w-px bg-border-strong" />
          <button
            onClick={() => {
              onReply();
              setMenu(false);
            }}
            aria-label="Reply"
            className="px-1 text-sm text-muted hover:text-foreground"
          >
            ↩
          </button>
        </div>
      )}
    </div>
  );

  return (
    <div
      className={`flex items-end gap-1.5 ${
        m.mine ? "justify-end" : "justify-start"
      } ${selecting ? "cursor-pointer" : ""}`}
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
      {m.mine ? (
        <>
          {trigger}
          {bubbleCol}
        </>
      ) : (
        <>
          {bubbleCol}
          {trigger}
        </>
      )}
    </div>
  );
}

function AudioPlayer({
  url,
  duration,
  mine,
  onDownload,
}: {
  url: string;
  duration?: number;
  mine: boolean;
  onDownload: () => void;
}) {
  const ref = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [cur, setCur] = useState(0);
  const [total, setTotal] = useState(duration ?? 0);

  useEffect(() => {
    const a = ref.current;
    if (!a) return;
    let hacked = false;
    const onMeta = () => {
      // MediaRecorder WebM has no duration -> force the browser to compute it.
      if (a.duration === Infinity) {
        hacked = true;
        a.currentTime = 1e101;
      } else if (isFinite(a.duration) && a.duration > 0) {
        setTotal(a.duration);
      }
    };
    const onDur = () => {
      if (isFinite(a.duration) && a.duration > 0) {
        setTotal(a.duration);
        if (hacked) {
          a.currentTime = 0;
          hacked = false;
        }
      }
    };
    const onTime = () => setCur(a.currentTime);
    const onEnd = () => {
      setPlaying(false);
      setCur(0);
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    a.addEventListener("loadedmetadata", onMeta);
    a.addEventListener("durationchange", onDur);
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("ended", onEnd);
    a.addEventListener("play", onPlay);
    a.addEventListener("pause", onPause);
    return () => {
      a.removeEventListener("loadedmetadata", onMeta);
      a.removeEventListener("durationchange", onDur);
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("ended", onEnd);
      a.removeEventListener("play", onPlay);
      a.removeEventListener("pause", onPause);
    };
  }, [url]);

  function toggle(e: React.MouseEvent) {
    e.stopPropagation();
    const a = ref.current;
    if (!a) return;
    if (a.paused) void a.play().catch(() => {});
    else a.pause();
  }
  function seek(e: React.MouseEvent) {
    e.stopPropagation();
    const a = ref.current;
    if (!a || !total) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    a.currentTime = ratio * total;
    setCur(a.currentTime);
  }

  const pct = total ? Math.min(100, (cur / total) * 100) : 0;
  const sub = mine ? "text-accent-ink/70" : "text-faint";

  return (
    <div
      className="flex items-center gap-2 px-3 py-2.5"
      onClick={(e) => e.stopPropagation()}
    >
      <audio ref={ref} src={url} preload="metadata" className="hidden" />
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? "Pause" : "Play"}
        className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm ${
          mine ? "bg-accent-ink/15 text-accent-ink" : "bg-foreground/10 text-foreground"
        }`}
      >
        {playing ? "⏸" : "▶"}
      </button>
      <div
        onClick={seek}
        className={`h-1.5 w-24 shrink-0 cursor-pointer rounded-full sm:w-32 ${
          mine ? "bg-accent-ink/20" : "bg-foreground/15"
        }`}
      >
        <div
          className={`h-full rounded-full ${mine ? "bg-accent-ink" : "bg-accent"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={`shrink-0 text-[0.65rem] tabular-nums ${sub}`}>
        {fmtDuration(Math.round(cur))}/{fmtDuration(Math.round(total))}
      </span>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onDownload();
        }}
        aria-label="Download voice message"
        className={`shrink-0 text-sm ${sub}`}
      >
        ↓
      </button>
    </div>
  );
}

function MediaBlock({
  media,
  mine,
  alt,
  onDownload,
}: {
  media: NonNullable<ChatMessage["image"]>;
  mine: boolean;
  alt: string;
  onDownload: () => void;
}) {
  const isAudio = media.media?.kind === "audio";

  if (media.status === "loading" && !media.url) {
    return (
      <div
        className={`grid place-items-center bg-black/30 text-xs text-faint ${
          isAudio ? "h-12 w-48" : "h-40 w-56"
        }`}
      >
        decrypting…
      </div>
    );
  }
  if (media.status === "error") {
    return (
      <div
        className={`grid place-items-center bg-black/30 text-xs text-danger ${
          isAudio ? "h-12 w-48" : "h-40 w-56"
        }`}
      >
        couldn&apos;t load {isAudio ? "audio" : "image"}
      </div>
    );
  }

  if (isAudio) {
    return (
      <AudioPlayer
        url={media.url ?? ""}
        duration={media.media?.duration}
        mine={mine}
        onDownload={onDownload}
      />
    );
  }

  return (
    <div className="relative">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={media.url ?? ""}
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
