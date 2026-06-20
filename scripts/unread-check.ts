/**
 * Verifies unread counts + last-message preview via the lobby<-room DO RPC.
 * Requires `wrangler dev`. Run: npx tsx scripts/unread-check.ts
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

async function connectToken(userId: string, username: string) {
  return new SignJWT({ username })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(key);
}
async function ticket(userId: string, username: string, cid: string, peer: string) {
  return new SignJWT({ username, cid, peer })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(key);
}

function open(url: string, sink: Msg[]): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
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
const lobby = (tok: string, sink: Msg[]) =>
  open(`ws://${HOST}/parties/lobby/main?token=${encodeURIComponent(tok)}`, sink);
const room = (cid: string, tok: string, sink: Msg[]) =>
  open(`ws://${HOST}/parties/main/${cid}?token=${encodeURIComponent(tok)}`, sink);

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const send = (ws: WebSocket, m: object) => ws.send(JSON.stringify(m));
const lastActivity = (msgs: Msg[], cid: string) =>
  [...msgs].reverse().find(
    (m) => m.type === "conversation:activity" && m.conversationId === cid,
  );

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

  const aLobby = await lobby(await connectToken(A, "alice"), aMsgs);
  const bLobby = await lobby(await connectToken(B, "bob"), bMsgs);
  await wait(300);

  // Handshake → become contacts (creates the conversation in the lobby).
  send(aLobby, { type: "request:send", toUserId: B });
  await wait(300);
  send(bLobby, { type: "request:accept", fromUserId: A });
  await wait(400);
  check(
    "handshake established the conversation",
    aMsgs.some((m) => m.type === "request:accepted" && m.conversationId === cid),
  );

  // Alice opens the room and sends a message while Bob is NOT in the room.
  const aRoom = await room(cid, await ticket(A, "alice", cid, B), []);
  await wait(300);
  send(aRoom, {
    type: "message:send",
    id: "m1",
    ciphertext: "ENC1",
    iv: "IV1",
    sentAt: Date.now(),
  });
  await wait(500);

  const act1 = lastActivity(bMsgs, cid);
  check("bob's lobby gets conversation:activity", !!act1);
  check("bob unread incremented to 1", act1?.unread === 1);
  check(
    "preview carries ciphertext (E2E)",
    (act1?.preview as { ciphertext?: string })?.ciphertext === "ENC1",
  );
  check(
    "alice's own unread stays 0 (she sent it)",
    (lastActivity(aMsgs, cid)?.unread ?? 0) === 0,
  );

  // Bob opens the room → his unread clears.
  const bRoom = await room(cid, await ticket(B, "bob", cid, A), []);
  await wait(500);
  check("bob unread cleared to 0 on open", lastActivity(bMsgs, cid)?.unread === 0);

  // Bob is now in the room; a new message must NOT bump his unread.
  const before = bMsgs.length;
  send(aRoom, {
    type: "message:send",
    id: "m2",
    ciphertext: "ENC2",
    iv: "IV2",
    sentAt: Date.now(),
  });
  await wait(500);
  const bumpedWhileViewing = bMsgs
    .slice(before)
    .some((m) => m.type === "conversation:activity" && (m.unread as number) > 0);
  check("no unread bump while bob is viewing the chat", !bumpedWhileViewing);

  aRoom.close();
  bRoom.close();
  aLobby.close();
  bLobby.close();
  await wait(200);
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

void main();
