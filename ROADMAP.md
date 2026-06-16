# PrivateChat — Roadmap

A web-based, end-to-end encrypted private chat platform. Users find each other by a
unique username/ID, connect via an accept-the-request handshake, and choose per
conversation whether messages are persisted. The server is **zero-knowledge**: it never
holds private keys or plaintext. Deploys on **Vercel serverless** with realtime offloaded
to **PartyKit** (Cloudflare edge).

---

## 1. Core Decisions (locked)

| Area | Decision | Rationale |
|------|----------|-----------|
| Hosting | **Vercel serverless** for the Next.js app (UI + API routes), fully stateless | No long-running server to manage; scales to zero. |
| Realtime | **PartyKit** (Cloudflare Durable Objects) — one room per conversation + a presence lobby | Real WebSockets on the edge, closest match to a Socket.IO design. Holds in-memory presence/requests per room; can persist ciphertext in DO storage. |
| Encryption | **ECDH P-256 + AES-256-GCM** via the browser **Web Crypto API** | Native, no heavy deps, easy to audit. Forward secrecy (Double Ratchet) is a stretch goal, not MVP. |
| Persistence | **Ciphertext-only blobs** in the conversation's **DO storage** when ON; **in-memory relay** when OFF | Server/relay is zero-knowledge either way. Persisting stores only `{ciphertext, iv}` it cannot read. |
| Database | **Turso** (libSQL — serverless SQLite) for the **identity registry only** | "Minimal DB": the only queryable store is username→public-key. Vercel's filesystem is ephemeral, so file-based SQLite is not an option. |
| Auth | Username + passphrase (Argon2); passphrase also unlocks the local private key. JWT issued by Vercel, verified by PartyKit on connect. | Keeps identity minimal; private key never leaves the device. |

### Trust boundary note (E2E preserved)
PartyKit and Turso only ever see **ciphertext + metadata** — never plaintext, private
keys, or shared secrets. Moving realtime off your own server shifts the *metadata* trust
boundary (who talks to whom, when) to include Cloudflare/PartyKit. Message **content**
remains end-to-end encrypted and unreadable by any server.

### What is stored where
- **Turso (libSQL):** `users(id, username, public_key, pwd_hash, created_at)`. Nothing else.
- **PartyKit DO storage (per conversation, only when persist is ON):** `{id, sender_id, ciphertext, iv, created_at}` blobs.
- **PartyKit DO memory (ephemeral):** presence, pending chat requests, socket↔user map.
- **Client IndexedDB:** wrapped (passphrase-encrypted) private key + optional local plaintext history cache.
- **Never stored anywhere server-side:** private keys, plaintext, shared secrets.

---

## 2. Architecture

```
┌─────────────────────────────────────────────┐
│  Browser (client)                            │
│  • Next.js UI (App Router, React)            │
│  • Web Crypto: keygen, ECDH, AES-GCM         │
│  • IndexedDB: wrapped private key + (opt)    │
│    local plaintext history cache             │
│  • partysocket client                        │
└───────┬───────────────────────────┬──────────┘
        │ HTTPS (auth, key lookup)   │ WebSocket (ciphertext only)
┌───────▼─────────────────┐  ┌───────▼──────────────────────────┐
│  Vercel (Next.js)       │  │  PartyKit (Cloudflare DO)        │
│  • API routes:          │  │  • room per conversation:        │
│    signup / login       │  │    - presence + pending requests │
│    upload/fetch pubkey  │  │      (in-memory)                 │
│    username lookup      │  │    - relays ciphertext           │
│    issue connect JWT    │  │    - persists blob if ON (DO     │
│  • Stateless            │  │      storage)                    │
└───────┬─────────────────┘  │  • presence lobby room           │
        │                    └──────────────────────────────────┘
┌───────▼─────────────────┐
│  Turso (libSQL)         │
│  identity registry only │
└─────────────────────────┘
```

### Crypto flow (per conversation)
1. **Signup:** client generates ECDH P-256 keypair. Private key is wrapped with an
   AES-GCM key derived from the passphrase (PBKDF2, high iteration count) and stored in
   IndexedDB. Public key (SPKI) uploaded to a Vercel API route → Turso.
2. **Connect:** after login, Vercel issues a short-lived JWT. Client opens a PartyKit
   connection passing the JWT; PartyKit verifies it (shared secret) before joining rooms.
3. **Request:** A searches B by username (Vercel lookup) → sends chat request via the
   presence lobby room. B accepts → a conversation room is opened for both.
4. **Key agreement:** each side fetches the other's public key (Vercel), runs
   ECDH → HKDF → per-conversation AES-256-GCM key. (Stretch: ratchet per message.)
5. **Message:** encrypt plaintext with AES-GCM + fresh 96-bit IV → send `{ciphertext, iv}`
   to the conversation room. PartyKit relays to the other member; if persistence ON, it
   also writes the blob to DO storage. Recipient decrypts client-side.
6. **Persistence toggle:** per conversation; default OFF. OFF = relay and forget.
   Stretch: TTL auto-expiry on stored blobs.

---

## 3. Phased Plan

### Phase 0 — Scaffold ✅
- [x] `create-next-app` (TypeScript, App Router, Tailwind), deploy skeleton to Vercel.
- [x] Init PartyKit project (`partykit`/`partyserver`); local dev wiring.
- [x] Add deps: `partysocket`, `@libsql/client` (Turso), `@node-rs/argon2`, `jose` (JWT), `zod`.
- [x] Provision Turso DB; migration for `users` table. (local file DB in dev; remote Turso for prod)

### Phase 1 — Identity & auth ✅
- [x] Signup/login API routes (Zod-validated). Hash passphrase with Argon2.
- [x] Client-side keypair generation on signup; upload public key to Turso.
- [x] Wrap & store private key in IndexedDB; unlock on login with passphrase.
- [x] Session cookie (httpOnly) + short-lived **connect JWT** endpoint for PartyKit.
- [x] Username uniqueness + lookup endpoint.

### Phase 2 — PartyKit transport & presence ✅
- [x] PartyKit server verifies connect JWT on `onBeforeConnect` (lobby party).
- [x] Presence lobby room: in-memory `userId → connections`; online/offline broadcast + snapshot.
- [x] Disconnect cleanup; reconnect handling (partysocket auto-reconnect, fresh token per connect).
- [x] Dev port pinned to 1999 (`partykit dev --port 1999`); verified via `scripts/presence-check.ts`.
- [x] Distinctive brand theme + mobile-first responsive UI (globals.css design system).

### Phase 3 — Chat requests (the handshake) ✅
- [x] `request:send` / `request:incoming` / `request:accept` / `request:reject` via lobby.
- [x] Pending requests held in DO memory; delivered via snapshot/outbox when recipient connects.
- [x] On accept, derive a stable conversation id = HMAC-SHA256(JWT_SECRET, sorted user-id pair).
- [x] Unified `LobbyProvider` context + Dashboard UI (new-chat, requests, online, conversations).
- [x] Verified via `scripts/handshake-check.ts` (send/accept/reject, offline delivery, shared id).

### Phase 4 — E2E key exchange
- [ ] Public-key fetch endpoint (Vercel → Turso).
- [ ] ECDH → HKDF → AES-GCM key derivation utility (shared client lib).
- [ ] Verify-fingerprint UI (safety-number style) to defend against MITM.

### Phase 5 — Messaging
- [ ] Conversation room: `message:send` (ciphertext+iv) → relay to the other member.
- [ ] Client encrypt/decrypt pipeline; render decrypted messages.
- [ ] Delivery/read receipts (metadata-light); optimistic UI + ordering.

### Phase 6 — Persistence toggle
- [ ] Per-conversation persist flag (negotiated; both must agree).
- [ ] When ON: write `{ciphertext, iv}` to DO storage; replay history on room join.
- [ ] When OFF: relay only; optional local-only IndexedDB cache.
- [ ] "Delete history" wipes the room's stored blobs.

### Phase 7 — UX polish
- [ ] Conversation list, unread badges, typing indicators.
- [ ] Key-loss / new-device messaging (old history unreadable by design).
- [ ] Responsive + accessible UI.

### Phase 8 — Hardening & deploy
- [ ] Rate-limit auth + requests; validate all input (Zod).
- [ ] Security headers, CSRF on API routes, secure cookies, JWT short TTL + rotation.
- [ ] Threat-model review (MITM, replay, metadata leakage, room-id guessing).
- [ ] Deploy: Next.js → Vercel, PartyKit → Cloudflare, Turso DB; env/secrets wired.

---

## 4. Stretch Goals
- Double Ratchet (Signal-style) for forward secrecy + post-compromise security.
- Group chats (sender-key model) — natural fit for a multi-member DO room.
- Disappearing messages (TTL) and ephemeral screenshot-resistant mode.
- Multi-device key sync via an encrypted key backup.
- Encrypted file/media attachments.

## 5. Key Risks & Notes
- **Two deploy targets:** Next.js on Vercel + PartyKit on Cloudflare. Wire the PartyKit
  host URL + a shared JWT secret as env vars on both.
- **Metadata** (who talks to whom, when) is visible to Vercel + PartyKit even though
  content is not. Document this; minimize what is logged.
- **Lose passphrase ⇒ lose private key ⇒ lose persisted history.** By design; surface
  clearly in the UI. Consider optional encrypted key backup later.
- **Conversation room ids** must be unguessable (hash a salted, sorted user-id pair) so
  outsiders can't join a room; PartyKit `onConnect` must also authorize membership.
- **DO storage limits:** fine for text ciphertext; for media, offload to object storage
  (R2/S3) and store only references.

---

*See the project memory file for the durable constraints that must survive across sessions.*
