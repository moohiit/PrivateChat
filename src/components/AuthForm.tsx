"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { signup, login } from "@/lib/client/auth";

type Mode = "signup" | "login";

export default function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const isSignup = mode === "signup";

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      if (isSignup) {
        await signup(username, password);
      } else {
        const res = await login(username, password);
        if (!res.hasLocalKey) {
          setNotice(
            "Signed in, but this device has no saved key — past encrypted history won't be readable here.",
          );
        }
      }
      router.push("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="w-full max-w-sm">
      <h1 className="mb-1 text-2xl font-semibold">
        {isSignup ? "Create your account" : "Welcome back"}
      </h1>
      <p className="mb-6 text-sm text-black/60 dark:text-white/60">
        {isSignup
          ? "Your encryption keys are generated in your browser and never leave it."
          : "Sign in to unlock your private keys on this device."}
      </p>

      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm">
          Username
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            className="rounded-md border border-black/15 bg-transparent px-3 py-2 outline-none focus:border-black/40 dark:border-white/20 dark:focus:border-white/50"
            placeholder="your_handle"
            required
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Passphrase
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={isSignup ? "new-password" : "current-password"}
            className="rounded-md border border-black/15 bg-transparent px-3 py-2 outline-none focus:border-black/40 dark:border-white/20 dark:focus:border-white/50"
            placeholder="at least 8 characters"
            required
          />
        </label>

        {error && (
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        )}
        {notice && (
          <p className="text-sm text-amber-600 dark:text-amber-400">{notice}</p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-foreground px-4 py-2 font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {busy
            ? "Working…"
            : isSignup
              ? "Create account"
              : "Sign in"}
        </button>
      </form>

      <p className="mt-6 text-sm text-black/60 dark:text-white/60">
        {isSignup ? (
          <>
            Already have an account?{" "}
            <Link href="/login" className="underline">
              Sign in
            </Link>
          </>
        ) : (
          <>
            Need an account?{" "}
            <Link href="/signup" className="underline">
              Create one
            </Link>
          </>
        )}
      </p>

      {isSignup && (
        <p className="mt-4 text-xs text-black/50 dark:text-white/50">
          Heads up: your passphrase encrypts your private key locally. If you lose
          it, encrypted history can&apos;t be recovered.
        </p>
      )}
    </div>
  );
}
