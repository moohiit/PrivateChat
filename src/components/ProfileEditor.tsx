"use client";

import { useEffect, useRef, useState } from "react";
import Avatar from "@/components/Avatar";
import {
  compressAvatar,
  loadOwnProfile,
  saveOwnProfile,
} from "@/lib/client/profile";

/**
 * Modal to edit the signed-in user's public profile: display name + avatar.
 * Avatars are compressed client-side to a small square WebP before upload.
 */
export default function ProfileEditor({
  userId,
  username,
  onClose,
}: {
  userId: string;
  username: string;
  onClose: () => void;
}) {
  const [displayName, setDisplayName] = useState("");
  const [avatar, setAvatar] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    void loadOwnProfile().then((p) => {
      if (!alive) return;
      setDisplayName(p?.displayName ?? "");
      setAvatar(p?.avatar ?? null);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, []);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Pick an image file.");
      return;
    }
    try {
      setAvatar(await compressAvatar(file));
      setError(null);
    } catch {
      setError("Couldn't process that image.");
    }
  }

  async function save() {
    setBusy(true);
    setError(null);
    const ok = await saveOwnProfile({
      userId,
      username,
      displayName: displayName.trim() || null,
      avatar,
    });
    setBusy(false);
    if (ok) onClose();
    else setError("Couldn't save. The avatar may be too large.");
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="surface w-full max-w-sm p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-base font-semibold">Edit profile</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="btn-ghost grid h-8 w-8 place-items-center rounded-lg text-sm"
          >
            ✕
          </button>
        </div>

        {loading ? (
          <p className="py-8 text-center text-sm text-faint">Loading…</p>
        ) : (
          <div className="flex flex-col gap-5">
            <div className="flex items-center gap-4">
              <Avatar
                name={displayName || username}
                avatar={avatar}
                size={64}
              />
              <div className="flex flex-col gap-2">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  onChange={onPick}
                  className="hidden"
                />
                <button
                  onClick={() => fileRef.current?.click()}
                  className="btn-ghost rounded-lg px-3 py-1.5 text-xs"
                >
                  {avatar ? "Change photo" : "Upload photo"}
                </button>
                {avatar && (
                  <button
                    onClick={() => setAvatar(null)}
                    className="text-left text-xs text-faint hover:text-danger"
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>

            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-muted">Display name</span>
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                maxLength={40}
                placeholder={username}
                className="field px-3 py-2.5 text-base text-foreground sm:text-sm"
              />
              <span className="text-[0.65rem] text-faint">
                Shown to people you chat with. Your @{username} handle never
                changes.
              </span>
            </label>

            {error && <p className="text-xs text-danger">{error}</p>}

            <div className="flex justify-end gap-2">
              <button
                onClick={onClose}
                className="btn-ghost rounded-[0.625rem] px-4 py-2 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={save}
                disabled={busy}
                className="btn-accent rounded-[0.625rem] px-4 py-2 text-sm font-semibold disabled:opacity-50"
              >
                {busy ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
