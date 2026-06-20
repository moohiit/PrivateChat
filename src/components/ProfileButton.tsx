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
        className="flex items-center gap-2 rounded-full border border-border-soft p-0.5 pr-2.5 transition-colors hover:border-border-strong"
      >
        <Avatar
          name={profile?.displayName || username}
          avatar={profile?.avatar}
          size={28}
        />
        <span className="hidden text-sm text-muted sm:inline">
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
