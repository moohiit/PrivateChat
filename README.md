# PrivateChat

End-to-end encrypted private chat. Find people by unique username, connect via an
accept-the-request handshake, and choose per conversation whether messages persist.
The server is **zero-knowledge** — it never holds private keys or plaintext.

See [ROADMAP.md](ROADMAP.md) for the full architecture and phased plan.

## Stack
- **Next.js** (App Router, TypeScript, Tailwind) on **Vercel** — UI + auth/key API routes
- **PartyKit** (Cloudflare Durable Objects) — realtime relay, presence, ciphertext persistence
- **Turso** (libSQL) — identity registry only (username → public key)
- **Web Crypto** (ECDH P-256 + AES-256-GCM) — all encryption happens in the browser

## Local development

### 1. Install
```bash
npm install
```

### 2. Configure env
A local `.env` is already created (file-based libSQL + a generated `JWT_SECRET`).
For production, copy `.env.example` and fill in a remote Turso URL/token. To generate a
fresh secret:
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

### 3. Migrate the database
```bash
npm run migrate   # creates the users table (idempotent)
```

### 4. Run (two processes)
```bash
npm run party:dev   # PartyKit realtime server on http://127.0.0.1:1999
npm run dev         # Next.js app on http://localhost:3000
```

## Production deploy (later phases)
- **Next.js → Vercel.** Set env vars: `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`,
  `JWT_SECRET`, `NEXT_PUBLIC_PARTYKIT_HOST` (your `*.partykit.dev` host).
- **PartyKit → Cloudflare:** `npm run party:deploy`. Set the matching secret:
  `npx partykit env add JWT_SECRET` (must equal Vercel's `JWT_SECRET`).
- **Turso:** `turso db create privatechat`, then wire the URL/token into Vercel.

## Design
Custom brand system in [src/app/globals.css](src/app/globals.css): an "encrypted
terminal, modern glass" look — deep ink background, phosphor-lime accent, monospace
identifiers, glass cards, subtle grid + glow. Mobile-first and fully responsive.

## Status
**Phases 0–3 complete.**
- Phase 0: scaffold, deps, PartyKit skeleton, Turso client + migration, env.
- Phase 1: signup/login/logout/me + username lookup + PartyKit connect-token APIs;
  client-side ECDH keygen, passphrase-wrapped private key in IndexedDB; signup/login UI.
- Phase 2: PartyKit lobby with JWT-authenticated connections + live presence
  (snapshot / online / offline); responsive branded UI.
- Phase 3: chat-request handshake (send/accept/reject, offline delivery), stable
  HMAC conversation id, unified LobbyProvider + Dashboard UI.

Verify the realtime layer (with `npm run party:dev` running):
`npx tsx scripts/presence-check.ts` and `npx tsx scripts/handshake-check.ts`.

Next: **Phase 4 — E2E key exchange** (see ROADMAP.md).
