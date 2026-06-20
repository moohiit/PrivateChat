/**
 * Verifies reactions + reply: relay of reactions, persistence in history, and
 * replyTo carried on relay + stored. Requires `wrangler dev`.
 * Run: npx tsx scripts/reactions-check.ts
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

  // Persist on both so reactions persist in history.
  send(aWs, { type: "persist:set", on: true });
  send(bWs, { type: "persist:set", on: true });
  await wait(300);

  // Alice sends a message; Bob replies to it.
  send(aWs, { type: "message:send", id: "m1", ciphertext: "HI", iv: "IV", sentAt: 1 });
  await wait(200);
  send(bWs, {
    type: "message:send",
    id: "m2",
    ciphertext: "RE",
    iv: "IV",
    sentAt: 2,
    replyTo: "m1",
  });
  await wait(300);
  const reply = aMsgs.find((m) => m.type === "message:relay" && m.id === "m2");
  check("reply relays replyTo = m1", reply?.replyTo === "m1");

  // Bob reacts to alice's message.
  send(bWs, { type: "reaction", id: "m1", emoji: "👍", op: "add" });
  await wait(300);
  check(
    "alice receives the reaction",
    aMsgs.some(
      (m) =>
        m.type === "reaction" &&
        m.id === "m1" &&
        m.emoji === "👍" &&
        m.from === B &&
        m.op === "add",
    ),
  );

  // Reconnect → history carries the reply + persisted reaction.
  const cMsgs: Msg[] = [];
  const cWs = await room(cid, await ticket(A, "alice", cid, B), cMsgs);
  await wait(400);
  const history = cMsgs.find((m) => m.type === "history") as
    | { messages: { id: string; replyTo?: string; reactions?: Record<string, string> }[] }
    | undefined;
  const m1 = history?.messages.find((x) => x.id === "m1");
  const m2 = history?.messages.find((x) => x.id === "m2");
  check("history reply persisted (m2.replyTo = m1)", m2?.replyTo === "m1");
  check("history reaction persisted (m1 has 👍 from bob)", m1?.reactions?.[B] === "👍");

  // Remove the reaction.
  send(bWs, { type: "reaction", id: "m1", emoji: "👍", op: "remove" });
  await wait(300);
  check(
    "alice receives reaction removal",
    aMsgs.some((m) => m.type === "reaction" && m.id === "m1" && m.op === "remove"),
  );

  aWs.close();
  bWs.close();
  cWs.close();
  await wait(200);
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

void main();
