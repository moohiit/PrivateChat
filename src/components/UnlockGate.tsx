"use client";

import { useEffect, useState } from "react";
import {
  ensureUnlockedKey,
  unlockIdentity,
  type UnlockStatus,
} from "@/lib/client/auth";

/**
 * Ensures the user's private key is unlocked before rendering the app. After a
 * reload the key is restored silently from the IndexedDB cache; if only the
 * wrapped key is present, we ask for the passphrase; if the device has no key
 * at all (new device), we explain that messaging needs the original device.
 */
export default function UnlockGate({
  userId,
  username,
  children,
}: {
  userId: string;
  username: string;
  children: React.ReactNode;
}) {
  const [status, setStatus] = useState<UnlockStatus | "checking">("checking");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    ensureUnlockedKey(userId, username).then((s) => {
      if (active) setStatus(s);
    });
    return () => {
      active = false;
    };
  }, [userId, username]);

  async function onUnlock(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await unlockIdentity(userId, password);
    setBusy(false);
    if (res.ok) {
      setPassword("");
      setStatus("ready");
    } else {
      setError(res.error ?? "Could not unlock.");
    }
  }

  if (status === "ready") return <>{children}</>;

  if (status === "checking") {
    return (
      <div className="flex items-center justify-center py-20 text-sm text-faint">
        Unlocking your keys…
      </div>
    );
  }

  if (status === "no-key") {
    return (
      <div className="surface mx-auto w-full max-w-sm p-6 text-center">
        <h2 className="text-lg font-semibold">No keys on this device</h2>
        <p className="mt-2 text-sm text-muted">
          Your private key was generated on another device and never leaves it.
          Sign in on the device where you created{" "}
          <span className="identifier text-foreground">@{username}</span> to
          read and send encrypted messages.
        </p>
        <p className="mt-3 text-xs text-faint">
          (Encrypted multi-device key sync is on the roadmap.)
        </p>
      </div>
    );
  }

  // needs-passphrase
  return (
    <form onSubmit={onUnlock} className="surface mx-auto w-full max-w-sm p-6">
      <h2 className="text-lg font-semibold">Unlock your keys</h2>
      <p className="mt-2 text-sm text-muted">
        Enter your passphrase to unlock the private key stored on this device.
      </p>
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete="current-password"
        placeholder="passphrase"
        className="field mt-4 w-full px-3 py-2.5 text-base text-foreground sm:text-sm"
        required
        autoFocus
      />
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
      <button
        type="submit"
        disabled={busy || !password}
        className="btn-accent mt-4 w-full rounded-[0.625rem] px-4 py-2.5 text-sm font-semibold"
      >
        {busy ? "Unlocking…" : "Unlock"}
      </button>
    </form>
  );
}
