"use client";

import { usePresence, type ConnStatus } from "@/lib/client/usePresence";

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

export default function PresencePanel({ selfUserId }: { selfUserId: string }) {
  const { status, online } = usePresence();
  const others = online.filter((u) => u.userId !== selfUserId);

  return (
    <section className="surface w-full max-w-md p-5 sm:p-6">
      <header className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium tracking-tight text-muted">
          Network
        </h2>
        <span className="inline-flex items-center gap-2 text-xs">
          <span
            className={`dot h-2 w-2 rounded-full ${status === "connected" ? "dot-live" : ""}`}
            style={{ background: STATUS_COLOR[status] }}
          />
          <span className="identifier text-faint">{STATUS_LABEL[status]}</span>
        </span>
      </header>

      <div className="mt-4 flex items-baseline gap-2">
        <span className="text-3xl font-semibold tabular-nums">
          {others.length}
        </span>
        <span className="text-sm text-muted">
          {others.length === 1 ? "other person online" : "others online"}
        </span>
      </div>

      <ul className="mt-4 flex flex-col gap-1.5">
        {others.length === 0 && (
          <li className="rounded-lg border border-dashed border-border-soft px-3 py-3 text-sm text-faint">
            No one else is online yet. Open the app in another browser to see
            presence update live.
          </li>
        )}
        {others.map((u) => (
          <li
            key={u.userId}
            className="flex items-center gap-3 rounded-lg bg-surface-strong px-3 py-2.5"
          >
            <span className="dot dot-live h-2 w-2 shrink-0 rounded-full bg-accent" />
            <span className="identifier truncate text-sm">@{u.username}</span>
          </li>
        ))}
      </ul>

      <p className="mt-4 text-xs leading-relaxed text-faint">
        Presence is in-memory only — never stored. Chat requests arrive in the
        next phase.
      </p>
    </section>
  );
}
