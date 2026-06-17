import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";
const partykitHost = process.env.NEXT_PUBLIC_PARTYKIT_HOST || "127.0.0.1:1999";

// Allow the browser to reach the PartyKit host over ws/wss/https, plus any
// deployed *.partykit.dev room. Everything else is locked to same-origin.
const connectSrc = [
  "'self'",
  `https://${partykitHost}`,
  `wss://${partykitHost}`,
  `ws://${partykitHost}`,
  "https://*.partykit.dev",
  "wss://*.partykit.dev",
].join(" ");

// Next injects inline hydration scripts; without a nonce setup we permit
// 'unsafe-inline' (and 'unsafe-eval' in dev for HMR). Nonce-based CSP is the
// future hardening step (see SECURITY.md).
const scriptSrc = isDev
  ? "'self' 'unsafe-inline' 'unsafe-eval'"
  : "'self' 'unsafe-inline'";

const csp = [
  "default-src 'self'",
  `script-src ${scriptSrc}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src ${connectSrc}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
  ...(isDev
    ? []
    : [
        {
          key: "Strict-Transport-Security",
          value: "max-age=63072000; includeSubDomains; preload",
        },
      ]),
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
