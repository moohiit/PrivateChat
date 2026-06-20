"use client";

import { useState } from "react";
import {
  LobbyProvider,
  useLobby,
  type ConnStatus,
  type ConvActivity,
} from "@/lib/client/lobby";
import ChatView from "@/components/ChatView";
import type { Conversation } from "@/lib/protocol";

export default function Dashboard({ selfUserId }: { selfUserId: string }) {
  return (
    <LobbyProvider selfUserId={selfUserId}>
      <DashboardInner />
    </LobbyProvider>
  );
}

function DashboardInner() {
  const { status, error, clearError, conversations, selfUserId } = useLobby();
  const [openId, setOpenId] = useState<string | null>(null);

  const active = conversations.find((c) => c.conversationId === openId) ?? null;
  if (active) {
    return (
      <ChatView
        conversation={active}
        selfUserId={selfUserId}
        onBack={() => setOpenId(null)}
      />
    );
  }

  return (
    <div className="flex w-full flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
          Your channels
        </h1>
        <StatusBadge status={status} />
      </div>

      {error && (
        <button
          onClick={clearError}
          className="flex items-center justify-between gap-3 rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-left text-sm text-warn"
        >
          <span>{error}</span>
          <span className="text-xs text-faint">dismiss</span>
        </button>
      )}

      <VisibilityCard />
      <NewChatCard />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <RequestsCard />
        <OnlineCard onOpen={(c) => setOpenId(c.conversationId)} />
      </div>
      <ConversationsCard onOpen={(c) => setOpenId(c.conversationId)} />
    </div>
  );
}

const STATUS_LABEL: Record<ConnStatus, string> = {
  connecting: "connecting",
  connected: "secure channel live",
  disconnected: "reconnecting",
};
const STATUS_COLOR: Record<ConnStatus, string> = {
  connecting: "var(--warn)",
  connected: "var(--accent)",
  disconnected: "var(--danger)",
};

function StatusBadge({ status }: { status: ConnStatus }) {
  return (
    <span className="inline-flex items-center gap-2 text-xs">
      <span
        className={`dot h-2 w-2 rounded-full ${status === "connected" ? "dot-live" : ""}`}
        style={{ background: STATUS_COLOR[status] }}
      />
      <span className="identifier text-faint">{STATUS_LABEL[status]}</span>
    </span>
  );
}

function Card({
  title,
  count,
  badge,
  children,
}: {
  title: string;
  count?: number;
  badge?: number;
  children: React.ReactNode;
}) {
  return (
    <section className="surface flex flex-col p-5 sm:p-6">
      <header className="mb-4 flex items-center justify-between">
        <span className="flex items-center gap-2">
          <h2 className="text-sm font-medium tracking-tight text-muted">
            {title}
          </h2>
          {badge !== undefined && (
            <span className="grid h-5 min-w-5 place-items-center rounded-full bg-accent px-1.5 text-[0.65rem] font-semibold text-accent-ink">
              {badge}
            </span>
          )}
        </span>
        {count !== undefined && (
          <span className="identifier rounded-full bg-surface-strong px-2 py-0.5 text-xs text-faint">
            {count}
          </span>
        )}
      </header>
      {children}
    </section>
  );
}

function VisibilityCard() {
  const { visible, setVisibility } = useLobby();
  return (
    <section className="surface flex items-center justify-between gap-4 p-4 sm:p-5">
      <div className="min-w-0">
        <h2 className="text-sm font-medium tracking-tight">
          Discoverable in “Online now”
        </h2>
        <p className="mt-0.5 text-xs text-faint">
          {visible
            ? "You appear in others' online list — anyone can send you a request."
            : "You're hidden. Only people who know your exact username can reach you."}
        </p>
      </div>
      <button
        role="switch"
        aria-checked={visible}
        aria-label="Toggle public discoverability"
        onClick={() => setVisibility(!visible)}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
          visible ? "bg-accent" : "bg-surface-strong"
        }`}
      >
        <span
          className={`inline-block h-5 w-5 transform rounded-full bg-bg transition-transform ${
            visible ? "translate-x-5" : "translate-x-0.5"
          }`}
        />
      </button>
    </section>
  );
}

function NewChatCard() {
  const { requestByUsername } = useLobby();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const res = await requestByUsername(value);
    setBusy(false);
    if (res.ok) {
      setMsg({ ok: true, text: `Request sent to @${value.replace(/^@/, "")}.` });
      setValue("");
    } else {
      setMsg({ ok: false, text: res.error ?? "Could not send request." });
    }
  }

  return (
    <Card title="Start a private chat">
      <form onSubmit={submit} className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <span className="identifier pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint">
            @
          </span>
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="username"
            autoCapitalize="none"
            spellCheck={false}
            className="field identifier w-full py-2.5 pl-7 pr-3 text-base text-foreground sm:text-sm"
          />
        </div>
        <button
          type="submit"
          disabled={busy || !value.trim()}
          className="btn-accent rounded-[0.625rem] px-4 py-2.5 text-sm font-semibold"
        >
          {busy ? "Sending…" : "Send request"}
        </button>
      </form>
      {msg && (
        <p
          className={`mt-3 text-sm ${msg.ok ? "text-accent" : "text-danger"}`}
        >
          {msg.text}
        </p>
      )}
      <p className="mt-3 text-xs text-faint">
        They&apos;ll get a request to accept before any messages can be exchanged.
      </p>
    </Card>
  );
}

function RequestsCard() {
  const { incoming, accept, reject } = useLobby();
  return (
    <Card title="Incoming requests" count={incoming.length}>
      {incoming.length === 0 ? (
        <Empty>No pending requests.</Empty>
      ) : (
        <ul className="flex flex-col gap-2">
          {incoming.map((u) => (
            <li
              key={u.userId}
              className="flex items-center justify-between gap-2 rounded-lg bg-surface-strong px-3 py-2.5"
            >
              <span className="identifier truncate text-sm">@{u.username}</span>
              <span className="flex shrink-0 gap-2">
                <button
                  onClick={() => accept(u.userId)}
                  className="btn-accent rounded-md px-3 py-1.5 text-xs font-semibold"
                >
                  Accept
                </button>
                <button
                  onClick={() => reject(u.userId)}
                  className="btn-ghost rounded-md px-3 py-1.5 text-xs"
                >
                  Decline
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function OnlineCard({ onOpen }: { onOpen: (c: Conversation) => void }) {
  const { online, selfUserId, sentTo, sendRequest, conversations, convoCrypto } =
    useLobby();
  const others = online.filter((u) => u.userId !== selfUserId);
  const convoFor = (id: string) =>
    conversations.find((c) => c.peer.userId === id) ?? null;

  return (
    <Card title="Online now" count={others.length}>
      {others.length === 0 ? (
        <Empty>
          No discoverable users online. Only people who turned on visibility
          appear here — or start a chat by username above.
        </Empty>
      ) : (
        <ul className="flex flex-col gap-2">
          {others.map((u) => {
            const convo = convoFor(u.userId);
            return (
              <li
                key={u.userId}
                className="flex items-center justify-between gap-2 rounded-lg bg-surface-strong px-3 py-2.5"
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <span className="dot dot-live h-2 w-2 shrink-0 rounded-full bg-accent" />
                  <span className="identifier truncate text-sm">
                    @{u.username}
                  </span>
                </span>
                {convo ? (
                  <button
                    onClick={() => onOpen(convo)}
                    disabled={
                      convoCrypto[convo.conversationId]?.status !== "ready"
                    }
                    className="btn-accent rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
                  >
                    {convoCrypto[convo.conversationId]?.status === "ready"
                      ? "Open"
                      : "…"}
                  </button>
                ) : sentTo.includes(u.userId) ? (
                  <span className="text-xs text-faint">requested</span>
                ) : (
                  <button
                    onClick={() => sendRequest(u.userId)}
                    className="btn-ghost rounded-md px-3 py-1.5 text-xs"
                  >
                    Request
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function ConversationsCard({ onOpen }: { onOpen: (c: Conversation) => void }) {
  const { conversations, convoCrypto, online, activity } = useLobby();
  const onlineIds = new Set(online.map((u) => u.userId));
  // Most recent activity first; conversations with no messages keep their order.
  const sorted = [...conversations].sort(
    (a, b) =>
      (activity[b.conversationId]?.lastAt ?? 0) -
      (activity[a.conversationId]?.lastAt ?? 0),
  );
  const totalUnread = Object.values(activity).reduce(
    (n, a) => n + (a?.unread ?? 0),
    0,
  );
  return (
    <Card
      title="Conversations"
      count={conversations.length}
      badge={totalUnread > 0 ? totalUnread : undefined}
    >
      {conversations.length === 0 ? (
        <Empty>
          No conversations yet. Once a request is accepted, it appears here.
        </Empty>
      ) : (
        <ul className="flex flex-col gap-2">
          {sorted.map((c) => (
            <ConversationRow
              key={c.conversationId}
              username={c.peer.username}
              crypto={convoCrypto[c.conversationId]}
              online={onlineIds.has(c.peer.userId)}
              activity={activity[c.conversationId]}
              onOpen={() => onOpen(c)}
            />
          ))}
        </ul>
      )}
    </Card>
  );
}

const CRYPTO_LABEL: Record<string, { text: string; color: string }> = {
  deriving: { text: "deriving key…", color: "var(--warn)" },
  ready: { text: "encrypted", color: "var(--accent)" },
  locked: { text: "key locked", color: "var(--warn)" },
  error: { text: "key error", color: "var(--danger)" },
};

function ConversationRow({
  username,
  crypto,
  online,
  activity,
  onOpen,
}: {
  username: string;
  crypto?: { status: string; safetyNumber?: string };
  online: boolean;
  activity?: ConvActivity;
  onOpen: () => void;
}) {
  const [open, setOpen] = useState(false);
  const status = crypto?.status ?? "deriving";
  const badge = CRYPTO_LABEL[status] ?? CRYPTO_LABEL.deriving;
  const unread = activity?.unread ?? 0;

  let preview: string;
  let previewColor = unread > 0 ? "text-foreground" : "text-faint";
  if (activity?.previewText) preview = activity.previewText;
  else if (activity?.hasMedia) preview = "📷 Photo";
  else if (status !== "ready") {
    preview = badge.text;
    previewColor = "text-faint";
  } else preview = "No messages yet";

  return (
    <li className="rounded-lg bg-surface-strong px-3 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 flex-1 items-start gap-2.5">
          <ShieldGlyph color={badge.color} />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span
                className={`identifier truncate text-sm ${unread > 0 ? "font-semibold" : ""}`}
              >
                @{username}
              </span>
              {online && (
                <span
                  className="dot dot-live h-1.5 w-1.5 shrink-0 rounded-full bg-accent"
                  aria-label="online"
                />
              )}
            </span>
            <span className={`block truncate text-xs ${previewColor}`}>
              {preview}
            </span>
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {unread > 0 && (
            <span
              aria-label={`${unread} unread`}
              className="grid h-5 min-w-5 place-items-center rounded-full bg-accent px-1.5 text-[0.65rem] font-semibold text-accent-ink"
            >
              {unread > 99 ? "99+" : unread}
            </span>
          )}
          {status === "ready" && crypto?.safetyNumber && (
            <button
              onClick={() => setOpen((v) => !v)}
              className="btn-ghost rounded-md px-2 py-1 text-xs"
            >
              {open ? "Hide" : "Verify"}
            </button>
          )}
          <button
            onClick={onOpen}
            disabled={status !== "ready"}
            className="btn-accent rounded-md px-3 py-1 text-xs font-semibold disabled:opacity-50"
          >
            Open
          </button>
        </span>
      </div>

      {open && crypto?.safetyNumber && (
        <div className="mt-3 rounded-lg border border-border-soft bg-black/30 p-3">
          <p className="mb-2 text-xs text-faint">
            Compare this safety number with @{username} over another channel. If
            it matches, your connection has no eavesdropper.
          </p>
          <p className="identifier text-sm leading-relaxed tracking-wide text-accent">
            {crypto.safetyNumber}
          </p>
        </div>
      )}
    </li>
  );
}

function ShieldGlyph({ color }: { color: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4 shrink-0"
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 2 4 5v6c0 5 3.5 8.5 8 11 4.5-2.5 8-6 8-11V5l-8-3Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed border-border-soft px-3 py-4 text-sm text-faint">
      {children}
    </p>
  );
}
