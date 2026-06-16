"use client";

import { useState } from "react";
import { LobbyProvider, useLobby, type ConnStatus } from "@/lib/client/lobby";

export default function Dashboard({ selfUserId }: { selfUserId: string }) {
  return (
    <LobbyProvider selfUserId={selfUserId}>
      <DashboardInner />
    </LobbyProvider>
  );
}

function DashboardInner() {
  const { status, error, clearError } = useLobby();

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

      <NewChatCard />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <RequestsCard />
        <OnlineCard />
      </div>
      <ConversationsCard />
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
  children,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section className="surface flex flex-col p-5 sm:p-6">
      <header className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-medium tracking-tight text-muted">{title}</h2>
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

function OnlineCard() {
  const { online, selfUserId, sentTo, sendRequest, conversations } = useLobby();
  const others = online.filter((u) => u.userId !== selfUserId);
  const hasConvo = (id: string) =>
    conversations.some((c) => c.peer.userId === id);

  return (
    <Card title="Online now" count={others.length}>
      {others.length === 0 ? (
        <Empty>No one else is online. Open the app elsewhere to test.</Empty>
      ) : (
        <ul className="flex flex-col gap-2">
          {others.map((u) => (
            <li
              key={u.userId}
              className="flex items-center justify-between gap-2 rounded-lg bg-surface-strong px-3 py-2.5"
            >
              <span className="flex min-w-0 items-center gap-2.5">
                <span className="dot dot-live h-2 w-2 shrink-0 rounded-full bg-accent" />
                <span className="identifier truncate text-sm">@{u.username}</span>
              </span>
              {hasConvo(u.userId) ? (
                <span className="text-xs text-accent">connected</span>
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
          ))}
        </ul>
      )}
    </Card>
  );
}

function ConversationsCard() {
  const { conversations } = useLobby();
  return (
    <Card title="Conversations" count={conversations.length}>
      {conversations.length === 0 ? (
        <Empty>
          No conversations yet. Once a request is accepted, it appears here.
        </Empty>
      ) : (
        <ul className="flex flex-col gap-2">
          {conversations.map((c) => (
            <li
              key={c.conversationId}
              className="flex items-center justify-between gap-3 rounded-lg bg-surface-strong px-3 py-2.5"
            >
              <span className="identifier truncate text-sm">
                @{c.peer.username}
              </span>
              <span className="identifier shrink-0 text-xs text-faint">
                {c.conversationId.slice(0, 8)}…
              </span>
            </li>
          ))}
        </ul>
      )}
      {conversations.length > 0 && (
        <p className="mt-3 text-xs text-faint">
          Secure messaging in these conversations arrives in the next phase.
        </p>
      )}
    </Card>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed border-border-soft px-3 py-4 text-sm text-faint">
      {children}
    </p>
  );
}
