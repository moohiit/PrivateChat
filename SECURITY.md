# PrivateChat — Security & Threat Model

PrivateChat is end-to-end encrypted: message content is encrypted in the browser
and the servers only ever relay/store ciphertext. This document states what is
protected, what is not, and the residual risks.

## Cryptography
- **Identity keys:** ECDH P-256 keypair generated in the browser (Web Crypto).
- **Key agreement:** ECDH → HKDF-SHA256 (salted by the conversation id) → a
  per-conversation **AES-256-GCM** key. Both parties derive the same key; it is
  never transmitted.
- **Messages:** AES-256-GCM with a fresh 96-bit IV per message.
- **Private key at rest:** wrapped with PBKDF2(passphrase, 310k iters) → AES-GCM,
  stored in IndexedDB. The unwrapped key is non-extractable.
- **Auth:** passphrase hashed server-side with **Argon2id**.

## What the servers can and cannot see
| | Vercel (Next API) | PartyKit (relay) | Turso (DB) |
|---|---|---|---|
| Message plaintext | ❌ never | ❌ never | ❌ never |
| Private keys | ❌ never | ❌ never | ❌ never |
| Message ciphertext | — | ✅ relays; stores if persist ON | ❌ |
| Public keys, usernames | ✅ | ✅ (ids) | ✅ |
| Encrypted key backup | ✅ (ciphertext) | — | ✅ (ciphertext) |
| Metadata (who/when) | ✅ | ✅ | partial |

## Protections in place
- **Transport auth:** short-lived HS256 JWTs. A `connect` token (5 min) authorizes
  the lobby; a `conversation` ticket (10 min) authorizes a specific room and is
  membership-bound — the room only accepts a ticket whose `cid` equals the room id.
- **Unguessable room ids:** `HMAC-SHA256(JWT_SECRET, sorted(userIdA,userIdB))`.
- **MITM on key exchange:** mitigated by the per-conversation **safety number**
  (compare out-of-band). Without it, a malicious server could swap public keys.
- **Cookies:** `httpOnly`, `Secure` (prod), `SameSite=Lax`.
- **CSRF:** SameSite cookies + JSON content-type (forces CORS preflight) + an
  Origin-check middleware on `/api` POST.
- **Security headers:** CSP (locks connections to self + the PartyKit host),
  `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`,
  and HSTS in production.
- **Rate limiting:** best-effort in-memory limits on signup/login; Argon2 cost
  further throttles brute-force.
- **Payload caps:** conversation room drops oversized ciphertext frames.
- **Persistence:** opt-in per conversation; stored blobs are ciphertext only and
  can be cleared.

## Residual risks / known limitations
- **Metadata is visible** to Vercel + PartyKit (who talks to whom, and when),
  even though content is not. Minimize logging.
- **Encrypted key backup is server-held**, so it is subject to *offline*
  passphrase brute-force. Use a strong passphrase. (Enables multi-device.)
- **No forward secrecy** yet — a compromised long-term key can decrypt past
  captured ciphertext. A Double Ratchet would fix this (stretch goal).
- **Safety number not auto-enforced** — users must choose to verify.
- **Rate limiting is per-instance** on serverless; for production use a shared
  store (e.g. Upstash Redis).
- **CSP allows `'unsafe-inline'` scripts** (no nonce yet) — nonce-based CSP is the
  next hardening step.
- **Trust-on-first-use** for public keys; no key transparency/rotation log.

## Reporting
This is a learning/portfolio project. For real-world use, commission an
independent cryptographic review before trusting it with sensitive data.
