/**
 * Verifies message editing: relay of message:edited, persistence of the new
 * ciphertext + editedAt in history, and the author-only check on persistence
 * (a non-author edit must not mutate stored text). Requires `wrangler dev`.
 * Run: npx tsx scripts/edit-check.ts
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

  // Persist on both so edits persist in history.
  send(aWs, { type: "persist:set", on: true });
  send(bWs, { type: "persist:set", on: true });
  await wait(300);

  // Alice sends a message, then edits it.
  send(aWs, { type: "message:send", id: "m1", ciphertext: "ORIG", iv: "IV1", sentAt: 1 });
  await wait(200);
  send(aWs, { type: "message:edit", id: "m1", ciphertext: "EDITED", iv: "IV2" });
  await wait(300);

  const edited = bMsgs.find((m) => m.type === "message:edited" && m.id === "m1");
  check("bob receives message:edited", !!edited);
  check("edited carries new ciphertext", edited?.ciphertext === "EDITED");
  check("edited from = author (alice)", edited?.from === A);
  check("edited carries editedAt timestamp", typeof edited?.editedAt === "number");

  // Reconnect → history reflects the edited ciphertext + editedAt.
  const cMsgs: Msg[] = [];
  const cWs = await room(cid, await ticket(A, "alice", cid, B), cMsgs);
  await wait(400);
  const history = cMsgs.find((m) => m.type === "history") as
    | { messages: { id: string; ciphertext?: string; iv?: string; editedAt?: number }[] }
    | undefined;
  const m1 = history?.messages.find((x) => x.id === "m1");
  check("history shows edited ciphertext", m1?.ciphertext === "EDITED");
  check("history shows new iv", m1?.iv === "IV2");
  check("history records editedAt", typeof m1?.editedAt === "number");

  // Author check: Bob (not the author) attempts to edit m1.
  send(bWs, { type: "message:edit", id: "m1", ciphertext: "HIJACK", iv: "IVX" });
  await wait(300);
  const dMsgs: Msg[] = [];
  const dWs = await room(cid, await ticket(A, "alice", cid, B), dMsgs);
  await wait(400);
  const history2 = dMsgs.find((m) => m.type === "history") as
    | { messages: { id: string; ciphertext?: string }[] }
    | undefined;
  const m1b = history2?.messages.find((x) => x.id === "m1");
  check("non-author edit does NOT mutate stored text", m1b?.ciphertext === "EDITED");

  aWs.close();
  bWs.close();
  cWs.close();
  dWs.close();
  await wait(200);
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

void main();
