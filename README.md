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

## Status
**Phase 0 + Phase 1 complete.**
- Phase 0: scaffold, deps, PartyKit skeleton, Turso client + migration, env.
- Phase 1: signup/login/logout/me + username lookup + PartyKit connect-token APIs;
  client-side ECDH keygen, passphrase-wrapped private key in IndexedDB; signup/login UI.

Next: **Phase 2 — PartyKit transport & presence** (see ROADMAP.md).
