/**
 * Verifies the zero-knowledge key-backup round-trip: wrap a private key on
 * "device A", serialize it as the server would store it, then on a fresh
 * "device B" (no local state) restore from that blob and unwrap with the
 * passphrase — proving multi-device works and a wrong passphrase fails.
 * Run: npx tsx scripts/keybackup-check.ts
 */
import { generateIdentityKeyPair, wrapPrivateKey, unwrapPrivateKey } from "../src/lib/crypto/keys";
import { bytesToBase64, base64ToBytes } from "../src/lib/crypto/encoding";
import {
  deriveConversationKey,
  importPeerPublicKey,
  encryptMessage,
  decryptMessage,
} from "../src/lib/crypto/conversation";
import { exportPublicKeyBase64 } from "../src/lib/crypto/keys";

async function main() {
  let pass = 0;
  let fail = 0;
  const check = (name: string, ok: boolean) => {
    console.log(`${ok ? "✓" : "✗"} ${name}`);
    if (ok) pass++;
    else fail++;
  };

  const passphrase = "correct horse battery staple";

  // Device A: generate + wrap, then serialize as the server stores it (base64).
  const kp = await generateIdentityKeyPair();
  const wrapped = await wrapPrivateKey(kp.privateKey, passphrase);
  const serverBlob = {
    wrapped: bytesToBase64(wrapped.wrapped),
    salt: bytesToBase64(wrapped.salt),
    iv: bytesToBase64(wrapped.iv),
  };
  check(
    "server blob is opaque base64 (no key material visible)",
    serverBlob.wrapped.length > 0 && /^[A-Za-z0-9+/=]+$/.test(serverBlob.wrapped),
  );

  // Device B: rebuild the wrapped struct from the server blob, unwrap.
  const rebuilt = {
    wrapped: base64ToBytes(serverBlob.wrapped),
    salt: base64ToBytes(serverBlob.salt),
    iv: base64ToBytes(serverBlob.iv),
  };
  const restored = await unwrapPrivateKey(rebuilt, passphrase);
  check("device B restores the private key with the passphrase", !!restored);

  // Prove the restored key is the SAME identity: derive a conversation key with
  // a peer using both the original and restored keys; ciphertext must interop.
  const peer = await generateIdentityKeyPair();
  const peerPubB64 = await exportPublicKeyBase64(peer.publicKey);
  const cid = "conv-xyz";
  const keyFromOriginal = await deriveConversationKey(
    kp.privateKey,
    await importPeerPublicKey(peerPubB64),
    cid,
  );
  const keyFromRestored = await deriveConversationKey(
    restored,
    await importPeerPublicKey(peerPubB64),
    cid,
  );
  const ct = await encryptMessage(keyFromOriginal, "same identity proof");
  const pt = await decryptMessage(keyFromRestored, ct);
  check("restored key is the same identity (cross-decrypts)", pt === "same identity proof");

  // Wrong passphrase must fail.
  let wrongFailed = false;
  try {
    await unwrapPrivateKey(rebuilt, "wrong passphrase");
  } catch {
    wrongFailed = true;
  }
  check("wrong passphrase cannot restore the key", wrongFailed);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

void main();
