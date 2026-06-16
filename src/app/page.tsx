import Link from "next/link";
import { getSession } from "@/lib/session";
import Brand from "@/components/Brand";
import LogoutButton from "@/components/LogoutButton";
import Dashboard from "@/components/Dashboard";

const FEATURES = [
  { k: "e2e", label: "End-to-end encrypted", note: "ECDH + AES-GCM in your browser" },
  { k: "zk", label: "Zero-knowledge relay", note: "servers only ever see ciphertext" },
  { k: "consent", label: "Connect by consent", note: "chat only after a request is accepted" },
  { k: "ephemeral", label: "Persist or vanish", note: "choose per conversation" },
];

export default async function Home() {
  const session = await getSession();

  if (session) {
    return (
      <div className="flex min-h-[100dvh] flex-col">
        <header className="sticky top-0 z-10 border-b border-border-soft bg-bg/70 backdrop-blur">
          <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
            <Brand size="sm" />
            <div className="flex items-center gap-3">
              <span className="hidden text-sm text-muted sm:inline">
                signed in as{" "}
                <span className="identifier text-foreground">
                  @{session.username}
                </span>
              </span>
              <LogoutButton />
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6 sm:px-6 sm:py-10">
          <Dashboard selfUserId={session.userId} />
        </main>
      </div>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col items-center justify-center gap-10 px-5 py-12 sm:py-20">
      <div className="flex flex-col items-center gap-6 text-center">
        <Brand size="lg" />

        <span className="identifier inline-flex items-center gap-2 rounded-full border border-border-soft bg-surface px-3 py-1 text-xs text-muted">
          <span className="dot dot-live h-1.5 w-1.5 rounded-full bg-accent" />
          private by architecture, not by promise
        </span>

        <h1 className="max-w-2xl text-4xl font-semibold leading-[1.1] tracking-tight sm:text-6xl">
          Talk freely.
          <br />
          <span className="text-accent">Encrypted end to end.</span>
        </h1>

        <p className="max-w-md text-base leading-relaxed text-muted sm:text-lg">
          Find people by username, connect only after they accept your request,
          and decide whether each conversation is remembered — or disappears.
        </p>

        <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
          <Link
            href="/signup"
            className="btn-accent rounded-[0.7rem] px-6 py-3 text-center text-sm font-semibold"
          >
            Create your account
          </Link>
          <Link
            href="/login"
            className="btn-ghost rounded-[0.7rem] px-6 py-3 text-center text-sm font-semibold"
          >
            Sign in
          </Link>
        </div>
      </div>

      <ul className="grid w-full max-w-2xl grid-cols-1 gap-3 sm:grid-cols-2">
        {FEATURES.map((f) => (
          <li key={f.k} className="surface flex flex-col gap-1 p-4">
            <span className="text-sm font-medium">{f.label}</span>
            <span className="text-xs text-faint">{f.note}</span>
          </li>
        ))}
      </ul>
    </main>
  );
}
