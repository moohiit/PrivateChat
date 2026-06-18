/**
 * Phase 9 verification: encrypted image upload/download + delete-for-everyone.
 * Requires `wrangler dev` (simulates R2 locally). Run: npx tsx scripts/media-check.ts
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
  encryptBytes,
  decryptBytes,
} from "../src/lib/crypto/conversation";

const HOST = process.env.NEXT_PUBLIC_PARTYKIT_HOST ?? "127.0.0.1:8787";
const SECRET = process.env.JWT_SECRET;
if (!SECRET) throw new Error("JWT_SECRET missing");
const key = new TextEncoder().encode(SECRET);
const http = `http://${HOST}`;

type Msg = { type: string; [k: string]: unknown };

async function ticket(userId: string, username: string, cid: string, peer: string) {
  return new SignJWT({ username, cid, peer })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(key);
}

function openWs(cid: string, tok: string, sink: Msg[]): Promise<WebSocket> {
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

  const ak = await generateIdentityKeyPair();
  const bk = await generateIdentityKeyPair();
  const aKey = await deriveConversationKey(
    ak.privateKey,
    await importPeerPublicKey(await exportPublicKeyBase64(bk.publicKey)),
    cid,
  );
  const bKey = await deriveConversationKey(
    bk.privateKey,
    await importPeerPublicKey(await exportPublicKeyBase64(ak.publicKey)),
    cid,
  );

  const aTok = await ticket(A, "alice", cid, B);
  const bTok = await ticket(B, "bob", cid, A);

  // 1) Upload an encrypted blob as alice.
  const original = new Uint8Array(
    Array.from({ length: 64 }, (_, i) => (i * 37) % 256),
  );
  const { ciphertext, iv } = await encryptBytes(aKey, original);
  const up = await fetch(`${http}/media?token=${encodeURIComponent(aTok)}`, {
    method: "POST",
    body: new Uint8Array(ciphertext),
  });
  const { id } = (await up.json()) as { id: string };
  check("upload returns id", up.ok && typeof id === "string");

  // 2) A ticket for a different conversation can't read it.
  const wrongTok = await ticket(A, "alice", "wrong-cid", B);
  const wrong = await fetch(
    `${http}/media/${cid}/${id}?token=${encodeURIComponent(wrongTok)}`,
  );
  check("wrong-conversation ticket forbidden", wrong.status === 403);

  // 3) Bob downloads + decrypts to the original bytes.
  const dl = await fetch(
    `${http}/media/${cid}/${id}?token=${encodeURIComponent(bTok)}`,
  );
  const ct = new Uint8Array(await dl.arrayBuffer());
  const dec = await decryptBytes(bKey, ct, iv);
  check("download ciphertext != plaintext", !ct.every((b, i) => b === original[i]));
  check(
    "bob decrypts to original bytes",
    dl.ok && dec.length === original.length && dec.every((b, i) => b === original[i]),
  );

  // 4) Relay the image message + delete-for-everyone over WS.
  const aMsgs: Msg[] = [];
  const bMsgs: Msg[] = [];
  const aws = await openWs(cid, aTok, aMsgs);
  const bws = await openWs(cid, bTok, bMsgs);
  await wait(300);

  aws.send(
    JSON.stringify({
      type: "message:send",
      id: "img1",
      media: { id, iv, mime: "image/webp", width: 8, height: 8, size: original.length },
      sentAt: 1,
    }),
  );
  await wait(400);
  check(
    "bob receives the image relay",
    bMsgs.some(
      (m) => m.type === "message:relay" && (m.media as { id?: string })?.id === id,
    ),
  );

  aws.send(
    JSON.stringify({ type: "message:delete", items: [{ id: "img1", mediaId: id }] }),
  );
  await wait(500);
  check(
    "bob notified messages:deleted",
    bMsgs.some(
      (m) => m.type === "messages:deleted" && (m.ids as string[])?.includes("img1"),
    ),
  );

  // 5) The R2 blob is gone after delete.
  const after = await fetch(
    `${http}/media/${cid}/${id}?token=${encodeURIComponent(bTok)}`,
  );
  check("media blob deleted from storage (404)", after.status === 404);

  aws.close();
  bws.close();
  await wait(200);
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

void main();
