import Link from "next/link";
import { getSession } from "@/lib/session";
import LogoutButton from "@/components/LogoutButton";

export default async function Home() {
  const session = await getSession();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 p-6">
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-3xl font-semibold">PrivateChat</h1>
        <p className="max-w-md text-sm text-black/60 dark:text-white/60">
          End-to-end encrypted chat. Find people by username, connect by accepting
          a request, and choose whether messages persist.
        </p>
      </div>

      {session ? (
        <div className="flex flex-col items-center gap-4">
          <p className="text-sm">
            Signed in as{" "}
            <span className="font-medium">@{session.username}</span>
          </p>
          <p className="text-xs text-black/50 dark:text-white/50">
            Chat starts in Phase 2 (presence) and Phase 3 (requests).
          </p>
          <LogoutButton />
        </div>
      ) : (
        <div className="flex gap-3">
          <Link
            href="/signup"
            className="rounded-md bg-foreground px-4 py-2 font-medium text-background transition-opacity hover:opacity-90"
          >
            Create account
          </Link>
          <Link
            href="/login"
            className="rounded-md border border-black/15 px-4 py-2 font-medium transition-colors hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
          >
            Sign in
          </Link>
        </div>
      )}
    </main>
  );
}
