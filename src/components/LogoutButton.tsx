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
      className="btn-ghost rounded-[0.625rem] px-3 py-2 text-sm disabled:opacity-50"
    >
      {busy ? "Signing out…" : "Sign out"}
    </button>
  );
}
