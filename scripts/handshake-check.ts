/**
 * Phase 3 verification: drive the lobby's chat-request handshake with real
 * authenticated WebSocket clients. Requires `partykit dev` on the configured host.
 * Run: npx tsx scripts/handshake-check.ts
 */
import "dotenv/config";
import { SignJWT } from "jose";

const HOST = process.env.NEXT_PUBLIC_PARTYKIT_HOST ?? "127.0.0.1:1999";
const SECRET = process.env.JWT_SECRET;
if (!SECRET) throw new Error("JWT_SECRET missing");
const key = new TextEncoder().encode(SECRET);

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
  const cMsgs: Msg[] = [];

  const alice = await open(await token("u-alice", "alice"), aMsgs);
  const bob = await open(await token("u-bob", "bob"), bMsgs);
  await wait(300);

  // 1) alice -> bob request; bob sees incoming, alice sees sent.
  send(alice, { type: "request:send", toUserId: "u-bob" });
  await wait(400);
  check(
    "bob receives request:incoming from alice",
    bMsgs.some(
      (m) =>
        m.type === "request:incoming" &&
        (m.from as { userId?: string })?.userId === "u-alice",
    ),
  );
  check(
    "alice receives request:sent ack",
    aMsgs.some((m) => m.type === "request:sent" && m.toUserId === "u-bob"),
  );

  // 2) bob accepts; both get request:accepted with the SAME conversationId.
  send(bob, { type: "request:accept", fromUserId: "u-alice" });
  await wait(400);
  const aAcc = aMsgs.find((m) => m.type === "request:accepted");
  const bAcc = bMsgs.find((m) => m.type === "request:accepted");
  check("alice receives request:accepted", !!aAcc);
  check("bob receives request:accepted", !!bAcc);
  check(
    "both sides share one conversationId",
    !!aAcc &&
      !!bAcc &&
      typeof aAcc.conversationId === "string" &&
      aAcc.conversationId === bAcc.conversationId,
  );
  check(
    "accepted peers are correct",
    (aAcc?.with as { userId?: string })?.userId === "u-bob" &&
      (bAcc?.with as { userId?: string })?.userId === "u-alice",
  );

  // 3) offline delivery: alice requests carol (offline); carol connects later
  //    and should see it in requests:snapshot.
  send(alice, { type: "request:send", toUserId: "u-carol" });
  await wait(300);
  const carol = await open(await token("u-carol", "carol"), cMsgs);
  await wait(400);
  const snap = cMsgs.find((m) => m.type === "requests:snapshot");
  check(
    "carol (was offline) gets pending request in snapshot",
    !!snap &&
      (snap.incoming as Array<{ userId: string }>).some(
        (u) => u.userId === "u-alice",
      ),
  );

  // 4) reject path: carol rejects alice; alice gets request:rejected.
  send(carol, { type: "request:reject", fromUserId: "u-alice" });
  await wait(400);
  check(
    "alice receives request:rejected from carol",
    aMsgs.some((m) => m.type === "request:rejected" && m.byUserId === "u-carol"),
  );

  alice.close();
  bob.close();
  carol.close();
  await wait(200);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

void main();
