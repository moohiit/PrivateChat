/**
 * Verifies disappearing messages: TTL negotiation, expiresAt stamping, and the
 * server-side DO alarm sweep. Requires `wrangler dev`.
 * Run: npx tsx scripts/disappear-check.ts
 */
import "dotenv/config";
import { SignJWT } from "jose";
import { conversationId } from "../src/lib/conversation-id";

const HOST = process.env.NEXT_PUBLIC_PARTYKIT_HOST ?? "127.0.0.1:8787";
const SECRET = process.env.JWT_SECRET;
if (!SECRET) throw new Error("JWT_SECRET missing");
const key = new TextEncoder().encode(SECRET);

const RUN = String(Date.now());
const A = `u-alice-${RUN}`;
const B = `u-bob-${RUN}`;

type Msg = { type: string; [k: string]: unknown };

async function ticket(userId: string, username: string, cid: string, peer: string) {
  return new SignJWT({ username, cid, peer })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(key);
}

function room(cid: string, tok: string, sink: Msg[]): Promise<WebSocket> {
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
  const check = (n: string, ok: boolean) => {
    console.log(`${ok ? "✓" : "✗"} ${n}`);
    ok ? pass++ : fail++;
  };

  const cid = conversationId(SECRET as string, A, B);
  const aMsgs: Msg[] = [];
  const bMsgs: Msg[] = [];
  const aWs = await room(cid, await ticket(A, "alice", cid, B), aMsgs);
  const bWs = await room(cid, await ticket(B, "bob", cid, A), bMsgs);
  await wait(300);

  // 1) Set a 1.5s disappearing timer → both members get disappear:state.
  send(aWs, { type: "disappear:set", ttl: 1500 });
  await wait(300);
  check(
    "both members get disappear:state ttl=1500",
    aMsgs.some((m) => m.type === "disappear:state" && m.ttl === 1500) &&
      bMsgs.some((m) => m.type === "disappear:state" && m.ttl === 1500),
  );

  // 2) A sends a message → relay carries an expiresAt ~now+ttl.
  send(aWs, { type: "message:send", id: "d1", ciphertext: "X", iv: "Y", sentAt: Date.now() });
  await wait(300);
  const relay = bMsgs.find((m) => m.type === "message:relay" && m.id === "d1");
  const exp = relay?.expiresAt as number | undefined;
  check("relay carries expiresAt", typeof exp === "number");
  check(
    "expiresAt is ~now + 1.5s",
    !!exp && exp > Date.now() && exp < Date.now() + 5000,
  );

  // 3) After the timer, the DO alarm sweeps it → messages:deleted broadcast.
  await wait(2500);
  check(
    "alarm deleted the message for everyone",
    bMsgs.some(
      (m) => m.type === "messages:deleted" && (m.ids as string[])?.includes("d1"),
    ),
  );

  // 4) Turning it off → new messages have no expiresAt.
  send(aWs, { type: "disappear:set", ttl: 0 });
  await wait(300);
  send(aWs, { type: "message:send", id: "d2", ciphertext: "X", iv: "Y", sentAt: Date.now() });
  await wait(300);
  const relay2 = bMsgs.find((m) => m.type === "message:relay" && m.id === "d2");
  check(
    "with timer off, message has no expiresAt",
    !!relay2 && relay2.expiresAt === undefined,
  );

  aWs.close();
  bWs.close();
  await wait(200);
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

void main();
