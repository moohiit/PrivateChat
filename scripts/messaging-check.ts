/**
 * Phase 5 verification: drive the conversation room with two authenticated,
 * encrypting clients. Requires `partykit dev` on the configured host.
 * Run: npx tsx scripts/messaging-check.ts
 */
import "dotenv/config";
import { SignJWT } from "jose";
import { conversationId } from "../src/lib/conversation-id";
import {
  generateIdentityKeyPair,
  exportPublicKeyBase64,
} from "../src/lib/crypto/keys";
import {
  importPeerPublicKey,
  deriveConversationKey,
  encryptMessage,
  decryptMessage,
} from "../src/lib/crypto/conversation";

const HOST = process.env.NEXT_PUBLIC_PARTYKIT_HOST ?? "127.0.0.1:1999";
const SECRET = process.env.JWT_SECRET;
if (!SECRET) throw new Error("JWT_SECRET missing");
const key = new TextEncoder().encode(SECRET);

type Msg = { type: string; [k: string]: unknown };

async function ticket(
  userId: string,
  username: string,
  cid: string,
  peer: string,
) {
  return new SignJWT({ username, cid, peer })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(key);
}

function open(cid: string, tok: string, sink: Msg[]): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(
      `ws://${HOST}/parties/main/${cid}?token=${encodeURIComponent(tok)}`,
    );
    ws.addEventListener("open", () => resolve(ws));
    ws.addEventListener("error", () => reject(new Error("ws error")));
    ws.addEventListener("message", (e) => {
      try {
        sink.push(JSON.parse(String(e.data)) as Msg);
      } catch {
        /* ignore */
      }
    });
  });
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const send = (ws: WebSocket, m: object) => ws.send(JSON.stringify(m));

async function main() {
  let pass = 0;
  let fail = 0;
  const check = (name: string, ok: boolean) => {
    console.log(`${ok ? "✓" : "✗"} ${name}`);
    ok ? pass++ : fail++;
  };

  const A = "u-alice";
  const B = "u-bob";
  const cid = conversationId(SECRET as string, A, B);

  // Derive the shared conversation key from real ECDH keypairs.
  const aliceKp = await generateIdentityKeyPair();
  const bobKp = await generateIdentityKeyPair();
  const alicePub = await exportPublicKeyBase64(aliceKp.publicKey);
  const bobPub = await exportPublicKeyBase64(bobKp.publicKey);
  const aliceKey = await deriveConversationKey(
    aliceKp.privateKey,
    await importPeerPublicKey(bobPub),
    cid,
  );
  const bobKey = await deriveConversationKey(
    bobKp.privateKey,
    await importPeerPublicKey(alicePub),
    cid,
  );

  const aMsgs: Msg[] = [];
  const bMsgs: Msg[] = [];

  // 0) membership: ticket for the wrong conversation is rejected.
  let wrongRejected = false;
  await new Promise<void>((resolve) => {
    ticket(A, "alice", "wrong-cid", B).then((badTok) => {
      const ws = new WebSocket(
        `ws://${HOST}/parties/main/${cid}?token=${encodeURIComponent(badTok)}`,
      );
      ws.addEventListener("close", () => {
        wrongRejected = true;
        resolve();
      });
      ws.addEventListener("error", () => {
        wrongRejected = true;
        resolve();
      });
      ws.addEventListener("open", () => {
        ws.close();
        resolve();
      });
      setTimeout(resolve, 3000);
    });
  });
  check("ticket for a different conversation is rejected", wrongRejected);

  // 1) alice joins; bob joins -> alice sees peer:presence online.
  const alice = await open(cid, await ticket(A, "alice", cid, B), aMsgs);
  await wait(250);
  const bob = await open(cid, await ticket(B, "bob", cid, A), bMsgs);
  await wait(400);
  check(
    "alice notified peer online when bob joins",
    aMsgs.some((m) => m.type === "peer:presence" && m.online === true),
  );

  // 2) alice sends an encrypted message; bob receives + decrypts it.
  const text = "meet at the safehouse 🛰️";
  const payload = await encryptMessage(aliceKey, text);
  send(alice, { type: "message:send", id: "m1", ...payload, sentAt: 1 });
  await wait(400);
  const relay = bMsgs.find((m) => m.type === "message:relay" && m.id === "m1");
  check("bob receives message:relay", !!relay);
  let decrypted = "";
  if (relay) {
    decrypted = await decryptMessage(bobKey, {
      ciphertext: relay.ciphertext as string,
      iv: relay.iv as string,
    });
  }
  check("bob decrypts to the original plaintext", decrypted === text);
  check(
    "relayed body is ciphertext (server never sees plaintext)",
    !!relay && !(relay.ciphertext as string).includes("safehouse"),
  );

  // 3) bob sends a read receipt -> alice receives it.
  send(bob, { type: "receipt", id: "m1", state: "read" });
  await wait(300);
  check(
    "alice receives read receipt",
    aMsgs.some(
      (m) => m.type === "receipt" && m.id === "m1" && m.state === "read",
    ),
  );

  // 4) typing relay.
  send(bob, { type: "typing", on: true });
  await wait(300);
  check(
    "alice receives peer:typing",
    aMsgs.some((m) => m.type === "peer:typing" && m.on === true),
  );

  // 5) bob leaves -> alice sees peer offline.
  bob.close();
  await wait(500);
  check(
    "alice notified peer offline when bob leaves",
    aMsgs.some((m) => m.type === "peer:presence" && m.online === false),
  );

  alice.close();
  await wait(200);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

void main();
