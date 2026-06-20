"use client";

import { useEffect, useState } from "react";

/**
 * Public profile (display name + avatar) fetching/updating. Avatars are small
 * square WebP data URLs. A tiny module-level cache + subscriber set keeps every
 * Avatar/header in sync after an edit without prop-drilling.
 */

export type Profile = {
  userId: string;
  username: string;
  displayName: string | null;
  avatar: string | null;
};

const cache = new Map<string, Profile>();
const pending = new Map<string, Promise<Profile | null>>();
const subscribers = new Set<() => void>();

function notify() {
  for (const fn of subscribers) fn();
}

async function fetchProfile(userId: string): Promise<Profile | null> {
  if (cache.has(userId)) return cache.get(userId)!;
  if (pending.has(userId)) return pending.get(userId)!;
  const p = (async () => {
    try {
      const res = await fetch(
        `/api/users/profile?userId=${encodeURIComponent(userId)}`,
      );
      if (!res.ok) return null;
      const { profile } = (await res.json()) as { profile: Profile };
      cache.set(userId, profile);
      notify();
      return profile;
    } catch {
      return null;
    } finally {
      pending.delete(userId);
    }
  })();
  pending.set(userId, p);
  return p;
}

/** Subscribe a component to a peer's profile (fetches once, updates on change). */
export function useProfile(userId: string | null): Profile | null {
  const [, force] = useState(0);
  useEffect(() => {
    const rerender = () => force((n) => n + 1);
    subscribers.add(rerender);
    if (userId) void fetchProfile(userId);
    return () => {
      subscribers.delete(rerender);
    };
  }, [userId]);
  return userId ? cache.get(userId) ?? null : null;
}

/** Load (and cache) the signed-in user's own profile. */
export async function loadOwnProfile(): Promise<Profile | null> {
  try {
    const res = await fetch("/api/users/profile");
    if (!res.ok) return null;
    const { profile } = (await res.json()) as { profile: Profile };
    cache.set(profile.userId, profile);
    notify();
    return profile;
  } catch {
    return null;
  }
}

/** Save the signed-in user's profile and update the local cache. */
export async function saveOwnProfile(input: {
  userId: string;
  username: string;
  displayName: string | null;
  avatar: string | null;
}): Promise<boolean> {
  const res = await fetch("/api/users/profile", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      displayName: input.displayName,
      avatar: input.avatar,
    }),
  });
  if (!res.ok) return false;
  cache.set(input.userId, {
    userId: input.userId,
    username: input.username,
    displayName: input.displayName,
    avatar: input.avatar,
  });
  notify();
  return true;
}

/** Compress an image File into a small square WebP data URL for an avatar. */
export async function compressAvatar(file: File, dim = 128): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const sx = (bitmap.width - side) / 2;
  const sy = (bitmap.height - side) / 2;
  const canvas = document.createElement("canvas");
  canvas.width = dim;
  canvas.height = dim;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas unsupported");
  ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, dim, dim);
  bitmap.close?.();
  return canvas.toDataURL("image/webp", 0.8);
}
