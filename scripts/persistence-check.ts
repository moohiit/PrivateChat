/**
 * Phase 6 verification: persistence toggle + ciphertext-only history + clear.
 * Requires `partykit dev` on the configured host.
 * Run: npx tsx scripts/persistence-check.ts
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
const jwtKey = new TextEncoder().encode(SECRET);

type Msg = { type: string; [k: string]: unknown };

async function ticket(userId: string, username: string, cid: string, peer: string) {
  return new SignJWT({ username, cid, peer })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(jwtKey);
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
const lastHistory = (msgs: Msg[]) =>
  [...msgs].reverse().find((m) => m.type === "history") as
    | { messages: { id: string; ciphertext: string; iv: string }[] }
    | undefined;

async function main() {
  let pass = 0;
  let fail = 0;
  const check = (name: string, ok: boolean) => {
    console.log(`${ok ? "✓" : "✗"} ${name}`);
    ok ? pass++ : fail++;
  };

  // Unique members per run so the room's DO storage starts clean.
  const run = String(Date.now());
  const A = `u-alice-${run}`;
  const B = `u-bob-${run}`;
  const cid = conversationId(SECRET as string, A, B);

  const aliceKp = await generateIdentityKeyPair();
  const bobKp = await generateIdentityKeyPair();
  const aliceKey = await deriveConversationKey(
    aliceKp.privateKey,
    await importPeerPublicKey(await exportPublicKeyBase64(bobKp.publicKey)),
    cid,
  );

  const aMsgs: Msg[] = [];
  const bMsgs: Msg[] = [];
  const alice = await open(cid, await ticket(A, "alice", cid, B), aMsgs);
  const bob = await open(cid, await ticket(B, "bob", cid, A), bMsgs);
  await wait(400);

  // 1) only alice opts in -> effective stays false.
  send(alice, { type: "persist:set", on: true });
  await wait(300);
  const aEff1 = [...aMsgs]
    .reverse()
    .find((m) => m.type === "persist:state") as { effective?: boolean } | undefined;
  check("effective persistence false until both opt in", aEff1?.effective === false);

  // message while NOT persisting -> must not be stored.
  const m1 = await encryptMessage(aliceKey, "ephemeral one");
  send(alice, { type: "message:send", id: "m1", ...m1, sentAt: 1 });
  await wait(300);

  // 2) bob opts in -> effective true.
  send(bob, { type: "persist:set", on: true });
  await wait(300);
  const bEff = [...bMsgs]
    .reverse()
    .find((m) => m.type === "persist:state") as { effective?: boolean } | undefined;
  check("effective persistence true once both opt in", bEff?.effective === true);

  // message while persisting -> stored.
  const m2 = await encryptMessage(aliceKey, "remembered two");
  send(alice, { type: "message:send", id: "m2", ...m2, sentAt: 2 });
  await wait(400);

  // 3) a fresh connection replays history: m2 only (m1 was ephemeral).
  const cMsgs: Msg[] = [];
  const alice2 = await open(cid, await ticket(A, "alice", cid, B), cMsgs);
  await wait(400);
  const hist = lastHistory(cMsgs);
  const ids = (hist?.messages ?? []).map((m) => m.id);
  check("history replays the persisted message", ids.includes("m2"));
  check("ephemeral message was NOT stored", !ids.includes("m1"));

  // stored body is ciphertext and decrypts to the original.
  const stored = hist?.messages.find((m) => m.id === "m2");
  let decrypted = "";
  if (stored) {
    decrypted = await decryptMessage(aliceKey, {
      ciphertext: stored.ciphertext,
      iv: stored.iv,
    });
  }
  check("stored history decrypts to original plaintext", decrypted === "remembered two");
  check(
    "stored body is ciphertext (server stored no plaintext)",
    !!stored && !stored.ciphertext.includes("remembered"),
  );

  // 4) clear history -> fresh connection sees empty history.
  send(alice2, { type: "history:clear" });
  await wait(400);
  check(
    "all members notified history:cleared",
    aMsgs.concat(bMsgs).some((m) => m.type === "history:cleared"),
  );
  const dMsgs: Msg[] = [];
  const alice3 = await open(cid, await ticket(A, "alice", cid, B), dMsgs);
  await wait(400);
  const hist2 = lastHistory(dMsgs);
  check("history is empty after clear", (hist2?.messages ?? []).length === 0);

  alice.close();
  bob.close();
  alice2.close();
  alice3.close();
  await wait(200);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

void main();
