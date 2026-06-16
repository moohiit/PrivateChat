/**
 * Phase 3+7 verification: chat-request handshake + server-authoritative
 * conversation snapshot. Requires `partykit dev` on the configured host.
 * Run: npx tsx scripts/handshake-check.ts
 */
import "dotenv/config";
import { SignJWT } from "jose";

const HOST = process.env.NEXT_PUBLIC_PARTYKIT_HOST ?? "127.0.0.1:1999";
const SECRET = process.env.JWT_SECRET;
if (!SECRET) throw new Error("JWT_SECRET missing");
const key = new TextEncoder().encode(SECRET);

// Unique ids per run so the lobby's persisted contacts start clean.
const RUN = String(Date.now());
const A = `u-alice-${RUN}`;
const B = `u-bob-${RUN}`;
const C = `u-carol-${RUN}`;

type Msg = { type: string; [k: string]: unknown };

async function token(userId: string, username: string) {
  return new SignJWT({ username })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(key);
}

function open(tok: string, sink: Msg[]): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(
      `ws://${HOST}/parties/lobby/main?token=${encodeURIComponent(tok)}`,
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

  const aMsgs: Msg[] = [];
  const bMsgs: Msg[] = [];

  const alice = await open(await token(A, "alice"), aMsgs);
  const bob = await open(await token(B, "bob"), bMsgs);
  await wait(300);

  send(alice, { type: "request:send", toUserId: B });
  await wait(400);
  check(
    "bob receives request:incoming from alice",
    bMsgs.some(
      (m) =>
        m.type === "request:incoming" &&
        (m.from as { userId?: string })?.userId === A,
    ),
  );
  check(
    "alice receives request:sent ack",
    aMsgs.some((m) => m.type === "request:sent" && m.toUserId === B),
  );

  send(bob, { type: "request:accept", fromUserId: A });
  await wait(400);
  const aAcc = aMsgs.find((m) => m.type === "request:accepted");
  const bAcc = bMsgs.find((m) => m.type === "request:accepted");
  check("both sides receive request:accepted", !!aAcc && !!bAcc);
  check(
    "both sides share one conversationId",
    !!aAcc && !!bAcc && aAcc.conversationId === bAcc.conversationId,
  );

  // Contacts see each other online even though both are hidden (default).
  check(
    "contacts see each other online after accept (both hidden)",
    aMsgs.some(
      (m) =>
        m.type === "presence:online" &&
        (m.user as { userId?: string })?.userId === B,
    ),
  );

  // Server-authoritative: a fresh connection (e.g. after reload) gets the
  // conversation in its snapshot — for BOTH the accepter and the requester.
  const aReconnect: Msg[] = [];
  const alice2 = await open(await token(A, "alice"), aReconnect);
  await wait(400);
  const snap = aReconnect.find((m) => m.type === "conversations:snapshot") as
    | { conversations: { peer: { userId: string } }[] }
    | undefined;
  check(
    "requester gets the conversation in conversations:snapshot on reconnect",
    !!snap && snap.conversations.some((c) => c.peer.userId === B),
  );
  const presSnap = aReconnect.find((m) => m.type === "presence:snapshot") as
    | { users: { userId: string }[] }
    | undefined;
  check(
    "hidden contact appears in presence snapshot on reconnect",
    !!presSnap && presSnap.users.some((u) => u.userId === B),
  );

  // offline delivery of a pending request.
  send(alice, { type: "request:send", toUserId: C });
  await wait(300);
  const cMsgs: Msg[] = [];
  const carol = await open(await token(C, "carol"), cMsgs);
  await wait(400);
  const reqSnap = cMsgs.find((m) => m.type === "requests:snapshot") as
    | { incoming: { userId: string }[] }
    | undefined;
  check(
    "carol (was offline) gets pending request in snapshot",
    !!reqSnap && reqSnap.incoming.some((u) => u.userId === A),
  );

  send(carol, { type: "request:reject", fromUserId: A });
  await wait(400);
  check(
    "alice receives request:rejected from carol",
    aMsgs.some((m) => m.type === "request:rejected" && m.byUserId === C),
  );

  alice.close();
  bob.close();
  alice2.close();
  carol.close();
  await wait(200);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

void main();
