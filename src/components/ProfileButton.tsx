"use client";

import { useEffect, useState } from "react";
import Avatar from "@/components/Avatar";
import ProfileEditor from "@/components/ProfileEditor";
import { loadOwnProfile, useProfile } from "@/lib/client/profile";

/**
 * Home-header button showing the signed-in user's own avatar; opens the profile
 * editor. Reads from the shared profile cache so it updates after a save.
 */
export default function ProfileButton({
  userId,
  username,
}: {
  userId: string;
  username: string;
}) {
  const [open, setOpen] = useState(false);
  const profile = useProfile(userId);

  useEffect(() => {
    void loadOwnProfile();
  }, []);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="Edit your profile"
        title="Edit your profile"
        className="flex items-center gap-2 rounded-full ring-1 ring-border-soft transition hover:ring-border-strong sm:bg-surface-strong sm:py-1 sm:pl-1 sm:pr-3.5"
      >
        <Avatar
          name={profile?.displayName || username}
          avatar={profile?.avatar}
          size={34}
        />
        <span className="hidden max-w-[10rem] truncate text-sm text-muted sm:inline">
          {profile?.displayName ? (
            profile.displayName
          ) : (
            <span className="identifier text-foreground">@{username}</span>
          )}
        </span>
      </button>
      {open && (
        <ProfileEditor
          userId={userId}
          username={username}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
