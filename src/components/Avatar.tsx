"use client";

/**
 * Round avatar: shows the user's uploaded image, or a deterministic colored
 * monogram fallback derived from their name. Sizes are explicit px so it stays
 * crisp on mobile.
 */

function initials(name: string): string {
  const clean = name.replace(/^@/, "").trim();
  if (!clean) return "?";
  const parts = clean.split(/[\s._-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return clean.slice(0, 2).toUpperCase();
}

// Stable hue per name so each contact has a consistent color.
function hue(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}

export default function Avatar({
  name,
  avatar,
  size = 36,
}: {
  name: string;
  avatar?: string | null;
  size?: number;
}) {
  const px = `${size}px`;
  if (avatar) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={avatar}
        alt=""
        width={size}
        height={size}
        style={{ width: px, height: px }}
        className="shrink-0 rounded-full object-cover"
      />
    );
  }
  const h = hue(name);
  return (
    <span
      aria-hidden
      style={{
        width: px,
        height: px,
        background: `hsl(${h} 45% 22%)`,
        color: `hsl(${h} 85% 72%)`,
        fontSize: `${Math.round(size * 0.4)}px`,
      }}
      className="grid shrink-0 place-items-center rounded-full font-semibold"
    >
      {initials(name)}
    </span>
  );
}
