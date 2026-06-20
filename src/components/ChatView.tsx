"use client";

import { useEffect, useRef, useState } from "react";
import {
  useChat,
  type ChatMessage,
  type MessageStatus,
} from "@/lib/client/useChat";
import { MAX_IMAGE_BYTES, MAX_FILE_BYTES } from "@/lib/client/media";
import { startWavRecording, type WavRecorder } from "@/lib/client/recorder";
import { useProfile } from "@/lib/client/profile";
import Avatar from "@/components/Avatar";
import type { Conversation } from "@/lib/protocol";

const DISAPPEAR_OPTIONS = [
  { ttl: 0, label: "Off" },
  { ttl: 3_600_000, label: "1h" },
  { ttl: 86_400_000, label: "24h" },
  { ttl: 604_800_000, label: "7d" },
];

const REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

function mediaLabel(m: ChatMessage): string {
  const k = m.image?.media?.kind;
  if (k === "audio") return "🎤 Voice message";
  if (k === "file") return `📎 ${m.image?.media?.name ?? "File"}`;
  if (m.image) return "📷 Photo";
  return "message";
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/* --- Inline icons (stroke = currentColor so they inherit button color) --- */

function IconImage() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="3" y="3" width="18" height="18" rx="2.5" />
      <circle cx="8.5" cy="8.5" r="1.6" />
      <path d="M21 15l-5-5L5 21" />
    </svg>
  );
}

function IconPaperclip() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M21.44 11.05l-9.19 9.19a5 5 0 0 1-7.07-7.07l9.19-9.19a3.5 3.5 0 0 1 4.95 4.95l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}

function IconMic() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0" />
      <path d="M12 17v4" />
    </svg>
  );
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
  const peerProfile = useProfile(peer.userId);
  const peerName = peerProfile?.displayName || peer.username;
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
    sendFile,
    deleteMessages,
    react,
    editMessage,
    setTyping,
    setPersist,
    setDisappear,
    clearHistory,
  } = useChat(conversationId, peer.userId, selfUserId);

  const [draft, setDraft] = useState("");
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [editing, setEditing] = useState<ChatMessage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [recSecs, setRecSecs] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const docRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<WavRecorder | null>(null);
  const recTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const replyToRef = useRef<ChatMessage | null>(null);

  const byId = new Map(messages.map((m) => [m.id, m]));

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, peerTyping]);

  useEffect(() => {
    replyToRef.current = replyTo;
  }, [replyTo]);

  // Cancel recording + release the mic if the chat unmounts.
  useEffect(() => {
    return () => {
      if (recTimerRef.current) clearInterval(recTimerRef.current);
      recorderRef.current?.cancel();
      recorderRef.current = null;
    };
  }, []);

  async function startRecording() {
    if (recording) return;
    try {
      recorderRef.current = await startWavRecording();
      setRecording(true);
      setRecSecs(0);
      recTimerRef.current = setInterval(() => setRecSecs((s) => s + 1), 1000);
    } catch {
      setError("Microphone access was denied.");
    }
  }

  async function finishRecording(send: boolean) {
    const rec = recorderRef.current;
    recorderRef.current = null;
    if (recTimerRef.current) {
      clearInterval(recTimerRef.current);
      recTimerRef.current = null;
    }
    setRecording(false);
    setRecSecs(0);
    if (!rec) return;
    if (!send) {
      rec.cancel();
      return;
    }
    try {
      const { blob, mime, duration } = await rec.stop();
      if (blob.size > 0 && duration >= 0.3) {
        void sendAudio(
          blob,
          mime,
          Math.max(1, Math.round(duration)),
          replyToRef.current?.id,
        );
        setReplyTo(null);
      }
    } catch {
      setError("Couldn't process the recording.");
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.trim()) return;
    if (editing) {
      void editMessage(editing.id, draft);
      setEditing(null);
    } else {
      void sendText(draft, replyTo?.id);
      setReplyTo(null);
    }
    setDraft("");
    setTyping(false);
  }

  function startEdit(m: ChatMessage) {
    setReplyTo(null);
    setEditing(m);
    setDraft(m.text);
  }

  function cancelEdit() {
    setEditing(null);
    setDraft("");
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

  function onPickDocs(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    const rid = replyTo?.id;
    let used = false;
    for (const f of files) {
      if (f.size > MAX_FILE_BYTES) {
        setError("File is too large (max 7 MB).");
        continue;
      }
      void sendFile(f, used ? undefined : rid);
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
            <Avatar
              name={peerName}
              avatar={peerProfile?.avatar}
              size={36}
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{peerName}</p>
              <p className="text-xs text-faint">
                {peerTyping ? (
                  <span className="text-accent">typing…</span>
                ) : peerOnline ? (
                  "online"
                ) : (
                  <span className="identifier">@{peer.username}</span>
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
            onEdit={() => startEdit(m)}
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

      {/* Editing context */}
      {editing && (
        <div className="flex items-center gap-2 border-t border-border-soft bg-surface-strong px-4 py-2">
          <span className="h-8 w-0.5 shrink-0 rounded bg-warn" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-[0.65rem] text-warn">Editing message</p>
            <p className="truncate text-xs text-faint">{editing.text}</p>
          </div>
          <button
            onClick={cancelEdit}
            aria-label="Cancel edit"
            className="btn-ghost grid h-7 w-7 place-items-center rounded-lg text-xs"
          >
            ✕
          </button>
        </div>
      )}

      {/* Reply context */}
      {!editing && replyTo && (
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
            onClick={() => void finishRecording(false)}
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
            onClick={() => void finishRecording(true)}
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
          <input
            ref={docRef}
            type="file"
            multiple
            onChange={onPickDocs}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={!keyReady}
            aria-label="Attach photo"
            className="btn-ghost grid h-10 w-10 shrink-0 place-items-center rounded-[0.625rem] disabled:opacity-50"
          >
            <IconImage />
          </button>
          <button
            type="button"
            onClick={() => docRef.current?.click()}
            disabled={!keyReady}
            aria-label="Attach file"
            className="btn-ghost grid h-10 w-10 shrink-0 place-items-center rounded-[0.625rem] disabled:opacity-50"
          >
            <IconPaperclip />
          </button>
          <input
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setTyping(e.target.value.length > 0);
            }}
            onBlur={() => setTyping(false)}
            placeholder={
              !keyReady
                ? "Encryption unavailable"
                : editing
                  ? "Edit message…"
                  : "Write a message…"
            }
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
              {editing ? "Save" : "Send"}
            </button>
          ) : (
            <button
              type="button"
              onClick={startRecording}
              disabled={!keyReady}
              aria-label="Record voice message"
              className="btn-ghost grid h-10 w-10 shrink-0 place-items-center rounded-[0.625rem] disabled:opacity-50"
            >
              <IconMic />
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
  onEdit,
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
  onEdit: () => void;
}) {
  const [menu, setMenu] = useState(false);

  function download() {
    if (!m.image?.url) return;
    const md = m.image.media;
    let filename: string;
    if (md?.kind === "file" && md.name) {
      filename = md.name;
    } else {
      const mime = md?.mime ?? "image/webp";
      const ext = (mime.split("/")[1] ?? "bin").split(";")[0];
      filename = `privatechat-${m.id.slice(0, 8)}.${ext}`;
    }
    const a = document.createElement("a");
    a.href = m.image.url;
    a.download = filename;
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
            {m.editedAt && <span title="edited">edited</span>}
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
          {m.mine && m.text && !m.image && (
            <button
              onClick={() => {
                onEdit();
                setMenu(false);
              }}
              aria-label="Edit"
              className="px-1 text-sm text-muted hover:text-foreground"
            >
              ✎
            </button>
          )}
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

// Shared AudioContext for decoding + playback (created lazily on first use, so
// it's tied to a user gesture and never blocked by autoplay policy).
let sharedAudioCtx: AudioContext | null = null;
function getAudioCtx(): AudioContext {
  if (!sharedAudioCtx) {
    const AC: typeof AudioContext =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    sharedAudioCtx = new AC();
  }
  return sharedAudioCtx;
}

/**
 * Voice-note player built on the Web Audio API rather than a hidden <audio>
 * element. decodeAudioData reliably plays WAV on every browser (including
 * mobile browsers that block off-screen/opacity-0 <audio>), and gives an exact
 * duration. Genuinely unsupported clips (e.g. legacy Opus on a device without
 * the codec) fail decode and are clearly marked as unplayable.
 */
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
  const bufferRef = useRef<AudioBuffer | null>(null);
  const srcRef = useRef<AudioBufferSourceNode | null>(null);
  const startedAtRef = useRef(0); // ctx.currentTime when the current play began
  const offsetRef = useRef(0); // seconds into the clip the current play started
  const rafRef = useRef<number | null>(null);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [cur, setCur] = useState(0);
  const [total, setTotal] = useState(duration ?? 0);
  const [error, setError] = useState(false);

  const stopSource = useCallbackRef(() => {
    if (srcRef.current) {
      srcRef.current.onended = null;
      try {
        srcRef.current.stop();
      } catch {
        /* already stopped */
      }
      srcRef.current.disconnect();
      srcRef.current = null;
    }
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  });

  // Decode the clip whenever the (decrypted) blob URL changes.
  useEffect(() => {
    let alive = true;
    setReady(false);
    setError(false);
    setPlaying(false);
    setCur(0);
    offsetRef.current = 0;
    if (!url) return;
    (async () => {
      try {
        const res = await fetch(url);
        const bytes = await res.arrayBuffer();
        const decoded = await getAudioCtx().decodeAudioData(bytes);
        if (!alive) return;
        bufferRef.current = decoded;
        setTotal(decoded.duration);
        setReady(true);
      } catch {
        if (alive) setError(true);
      }
    })();
    return () => {
      alive = false;
      stopSource();
    };
  }, [url, stopSource]);

  function frame() {
    const ctx = getAudioCtx();
    const elapsed = offsetRef.current + (ctx.currentTime - startedAtRef.current);
    setCur(Math.min(elapsed, total));
    rafRef.current = requestAnimationFrame(frame);
  }

  async function play() {
    const ctx = getAudioCtx();
    if (ctx.state === "suspended") await ctx.resume();
    const buffer = bufferRef.current;
    if (!buffer) return;
    const startOffset = offsetRef.current >= total ? 0 : offsetRef.current;
    offsetRef.current = startOffset;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    src.onended = () => {
      if (srcRef.current !== src) return; // superseded by pause/seek
      stopSource();
      offsetRef.current = 0;
      setCur(0);
      setPlaying(false);
    };
    startedAtRef.current = ctx.currentTime;
    src.start(0, startOffset);
    srcRef.current = src;
    setPlaying(true);
    rafRef.current = requestAnimationFrame(frame);
  }

  function pause() {
    const ctx = getAudioCtx();
    offsetRef.current += ctx.currentTime - startedAtRef.current;
    stopSource();
    setPlaying(false);
  }

  function toggle(e: React.MouseEvent) {
    e.stopPropagation();
    if (error || !ready) return;
    if (playing) pause();
    else void play();
  }

  function seek(e: React.MouseEvent) {
    e.stopPropagation();
    if (!total || !ready) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const t = ratio * total;
    const wasPlaying = playing;
    if (wasPlaying) stopSource();
    offsetRef.current = t;
    setCur(t);
    if (wasPlaying) void play();
  }

  const pct = total ? Math.min(100, (cur / total) * 100) : 0;
  const sub = mine ? "text-accent-ink/70" : "text-faint";

  return (
    <div
      className="flex items-center gap-2 px-3 py-2.5"
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        onClick={toggle}
        disabled={error || !ready}
        aria-label={error ? "Unplayable" : playing ? "Pause" : "Play"}
        className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm disabled:opacity-60 ${
          mine ? "bg-accent-ink/15 text-accent-ink" : "bg-foreground/10 text-foreground"
        }`}
      >
        {error ? "⚠" : !ready ? "…" : playing ? "⏸" : "▶"}
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
        {error
          ? "unplayable"
          : `${fmtDuration(Math.round(cur))}/${fmtDuration(Math.round(total))}`}
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

// Stable callback identity for cleanup deps (avoids re-running decode effect).
function useCallbackRef<T extends (...args: never[]) => unknown>(fn: T): T {
  const ref = useRef(fn);
  ref.current = fn;
  return useRef(((...args: never[]) => ref.current(...args)) as T).current;
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
  if (media.media?.kind === "file") {
    const name = media.media.name ?? "file";
    const ready = media.status === "ready" && !!media.url;
    const sub = mine ? "text-accent-ink/70" : "text-faint";
    return (
      <div
        className="flex items-center gap-3 px-3 py-2.5"
        onClick={(e) => e.stopPropagation()}
      >
        <span
          className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg text-base ${
            mine ? "bg-accent-ink/15" : "bg-foreground/10"
          }`}
        >
          📄
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm">{name}</p>
          <p className={`truncate text-[0.65rem] ${sub}`}>
            {media.status === "error"
              ? "couldn't load"
              : fmtBytes(media.media.size) + (ready ? "" : " · decrypting…")}
          </p>
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDownload();
          }}
          disabled={!ready}
          aria-label="Download file"
          className={`shrink-0 text-sm disabled:opacity-40 ${sub}`}
        >
          ↓
        </button>
      </div>
    );
  }

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
