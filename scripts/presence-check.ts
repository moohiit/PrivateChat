/**
 * Phase 2 verification: drive the PartyKit lobby with real authenticated
 * WebSocket connections and assert presence behavior. Requires `partykit dev`
 * running on NEXT_PUBLIC_PARTYKIT_HOST (default 127.0.0.1:1999).
 * Run: npx tsx scripts/presence-check.ts
 */
import "dotenv/config";
import { SignJWT } from "jose";

const HOST = process.env.NEXT_PUBLIC_PARTYKIT_HOST ?? "127.0.0.1:1999";
const SECRET = process.env.JWT_SECRET;
if (!SECRET) throw new Error("JWT_SECRET missing");

const key = new TextEncoder().encode(SECRET);

async function mintToken(userId: string, username: string): Promise<string> {
  return new SignJWT({ username })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(key);
}

function url(token: string): string {
  return `ws://${HOST}/parties/lobby/main?token=${encodeURIComponent(token)}`;
}

type Msg = { type: string; [k: string]: unknown };

function connect(token: string, onMsg: (m: Msg) => void): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url(token));
    ws.addEventListener("open", () => resolve(ws));
    ws.addEventListener("error", () => reject(new Error("ws error")));
    ws.addEventListener("message", (e) => {
      try {
        onMsg(JSON.parse(String(e.data)) as Msg);
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
    if (ok) pass++;
    else fail++;
  };

  // 1) Bad token is rejected.
  let badRejected = false;
  await new Promise<void>((resolve) => {
    const ws = new WebSocket(url("not-a-real-token"));
    ws.addEventListener("close", () => {
      badRejected = true;
      resolve();
    });
    ws.addEventListener("error", () => {
      badRejected = true;
      resolve();
    });
    ws.addEventListener("open", () => {
      ws.close();
      resolve();
    });
    setTimeout(resolve, 3000);
  });
  check("bad token is rejected", badRejected);

  // 2) Alice connects, gets a snapshot.
  const aliceMsgs: Msg[] = [];
  const aliceToken = await mintToken("u-alice", "alice");
  const alice = await connect(aliceToken, (m) => aliceMsgs.push(m));
  await wait(400);
  check(
    "alice receives presence:snapshot",
    aliceMsgs.some((m) => m.type === "presence:snapshot"),
  );

  // 3) Bob connects -> alice is told bob is online.
  const bobToken = await mintToken("u-bob", "bob");
  const bob = await connect(bobToken, () => {});
  await wait(500);
  const sawBobOnline = aliceMsgs.some(
    (m) =>
      m.type === "presence:online" &&
      (m.user as { userId?: string })?.userId === "u-bob",
  );
  check("alice notified presence:online for bob", sawBobOnline);

  // 4) Bob disconnects -> alice is told bob is offline.
  bob.close();
  await wait(600);
  const sawBobOffline = aliceMsgs.some(
    (m) => m.type === "presence:offline" && m.userId === "u-bob",
  );
  check("alice notified presence:offline for bob", sawBobOffline);

  alice.close();
  await wait(200);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

void main();
