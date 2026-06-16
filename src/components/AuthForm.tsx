"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { signup, login } from "@/lib/client/auth";
import Brand from "@/components/Brand";

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
      <div className="mb-8 flex justify-center sm:justify-start">
        <Brand size="md" />
      </div>

      <div className="surface p-6 sm:p-7">
        <span className="identifier text-xs uppercase tracking-[0.2em] text-accent">
          {isSignup ? "new identity" : "unlock"}
        </span>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          {isSignup ? "Create your account" : "Welcome back"}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          {isSignup
            ? "Your encryption keys are generated in your browser and never leave it."
            : "Sign in to unlock your private keys on this device."}
        </p>

        <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4">
          <label className="flex flex-col gap-1.5 text-sm text-muted">
            Username
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              inputMode="text"
              className="field identifier px-3 py-2.5 text-base text-foreground sm:text-sm"
              placeholder="your_handle"
              required
            />
          </label>

          <label className="flex flex-col gap-1.5 text-sm text-muted">
            Passphrase
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={isSignup ? "new-password" : "current-password"}
              className="field px-3 py-2.5 text-base text-foreground sm:text-sm"
              placeholder="at least 8 characters"
              required
            />
          </label>

          {error && (
            <p className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}
          {notice && (
            <p className="rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-sm text-warn">
              {notice}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="btn-accent mt-1 rounded-[0.625rem] px-4 py-3 text-sm font-semibold sm:py-2.5"
          >
            {busy ? "Working…" : isSignup ? "Create account" : "Sign in"}
          </button>
        </form>
      </div>

      <p className="mt-5 text-center text-sm text-muted">
        {isSignup ? (
          <>
            Already have an account?{" "}
            <Link href="/login" className="text-accent hover:underline">
              Sign in
            </Link>
          </>
        ) : (
          <>
            Need an account?{" "}
            <Link href="/signup" className="text-accent hover:underline">
              Create one
            </Link>
          </>
        )}
      </p>

      {isSignup && (
        <p className="mt-4 text-center text-xs leading-relaxed text-faint">
          Your passphrase encrypts your private key locally. If you lose it,
          encrypted history can&apos;t be recovered.
        </p>
      )}
    </div>
  );
}
