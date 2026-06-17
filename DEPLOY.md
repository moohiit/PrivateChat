# Deploying PrivateChat

Two deploy targets that share one secret:
- **Next.js app → Vercel** (UI + auth/key API routes)
- **Realtime server → Cloudflare Workers** (Durable Objects via PartyServer + Wrangler)
- **Turso** (libSQL) for the identity registry + encrypted key backups

The `JWT_SECRET` must be **identical** on Vercel and PartyKit (Vercel signs the
connect/conversation tokens; PartyKit verifies them).

---

## 1. Turso (database)
```bash
# install CLI: https://docs.turso.tech/cli
turso db create privatechat
turso db show privatechat --url            # -> TURSO_DATABASE_URL  (libsql://...)
turso db tokens create privatechat         # -> TURSO_AUTH_TOKEN
```
Apply the schema to the remote DB:
```bash
# point your local .env at the remote DB, then:
TURSO_DATABASE_URL=libsql://... TURSO_AUTH_TOKEN=... npm run migrate
```

## 2. Realtime server → Cloudflare Workers (PartyServer + Wrangler)
```bash
npx wrangler login                         # Cloudflare account (browser OAuth)
npx wrangler secret put JWT_SECRET         # paste the SHARED secret
npm run party:deploy                       # wrangler deploy (Durable Objects)
```
Note the deployed host from the output, e.g.
`privatechat-party.<your-subdomain>.workers.dev`.

Local dev uses `npm run party:dev` (wrangler dev on 127.0.0.1:8787).

## 3. Next.js → Vercel
Import the repo in Vercel and set **Environment Variables**:

| Variable | Value |
|---|---|
| `TURSO_DATABASE_URL` | from step 1 |
| `TURSO_AUTH_TOKEN` | from step 1 |
| `JWT_SECRET` | the shared secret (same as the Worker secret) |
| `NEXT_PUBLIC_PARTYKIT_HOST` | `privatechat-party.<subdomain>.workers.dev` (no scheme) |

Generate a strong secret once:
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```
Deploy. The app is a standard Next.js build — no custom server.

## 4. Verify
- Sign up two users in two browsers, send/accept a request, exchange messages.
- DevTools → Network → WS frames should show only ciphertext.
- Toggle persistence on both sides; reload and confirm history replays.

## Notes
- **CSP**: `connect-src` is built from `NEXT_PUBLIC_PARTYKIT_HOST` at build time,
  so set it before building. `*.partykit.dev` is also allowed.
- **Rotating `JWT_SECRET`** invalidates active sessions/tokens and (critically)
  changes every conversation id (HMAC), orphaning stored history. Rotate
  deliberately.
- **Rate limiting** is in-memory (per instance). For production, back it with
  Upstash Redis. See [SECURITY.md](SECURITY.md).
