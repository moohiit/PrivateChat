"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { logout } from "@/lib/client/auth";

export default function LogoutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function onClick() {
    setBusy(true);
    await logout();
    router.push("/login");
    router.refresh();
  }

  return (
    <button
      onClick={onClick}
      disabled={busy}
      className="rounded-md border border-black/15 px-3 py-1.5 text-sm transition-colors hover:bg-black/5 disabled:opacity-50 dark:border-white/20 dark:hover:bg-white/10"
    >
      {busy ? "Signing out…" : "Sign out"}
    </button>
  );
}
