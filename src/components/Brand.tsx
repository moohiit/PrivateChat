/**
 * PrivateChat wordmark: a phosphor-lime lock-shield glyph + a cypherpunk
 * "private://chat" lockup. Used across auth and app shells for brand identity.
 */
export default function Brand({
  size = "md",
}: {
  size?: "sm" | "md" | "lg";
}) {
  const glyph =
    size === "lg" ? "h-9 w-9" : size === "sm" ? "h-6 w-6" : "h-7 w-7";
  const text =
    size === "lg"
      ? "text-2xl sm:text-3xl"
      : size === "sm"
        ? "text-base"
        : "text-lg sm:text-xl";

  return (
    <span className="inline-flex items-center gap-2.5 select-none">
      <span
        className={`${glyph} grid place-items-center rounded-[0.5rem] bg-accent text-accent-ink shadow-[0_0_24px_-6px_var(--accent-glow)]`}
        aria-hidden
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          className="h-[62%] w-[62%]"
          stroke="currentColor"
          strokeWidth={2.2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 2 4 5v6c0 5 3.5 8.5 8 11 4.5-2.5 8-6 8-11V5l-8-3Z" />
          <circle cx="12" cy="11" r="1.6" fill="currentColor" stroke="none" />
          <path d="M12 12.6V15" />
        </svg>
      </span>
      <span className={`${text} font-semibold tracking-tight`}>
        <span className="identifier text-accent">private</span>
        <span className="identifier text-faint">://</span>
        <span className="text-foreground">chat</span>
      </span>
    </span>
  );
}
