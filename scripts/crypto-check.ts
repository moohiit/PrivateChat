/**
 * Phase 4 verification: prove the ECDH -> HKDF -> AES-GCM key agreement.
 * Runs the actual browser crypto modules under Node's Web Crypto.
 * Run: npx tsx scripts/crypto-check.ts
 */
import {
  generateIdentityKeyPair,
  exportPublicKeyBase64,
} from "../src/lib/crypto/keys";
import {
  importPeerPublicKey,
  deriveConversationKey,
  computeSafetyNumber,
  encryptMessage,
  decryptMessage,
} from "../src/lib/crypto/conversation";

async function main() {
  let pass = 0;
  let fail = 0;
  const check = (name: string, ok: boolean) => {
    console.log(`${ok ? "✓" : "✗"} ${name}`);
    if (ok) pass++;
    else fail++;
  };

  const convId = "conv-abc123";

  const alice = await generateIdentityKeyPair();
  const bob = await generateIdentityKeyPair();
  const alicePubB64 = await exportPublicKeyBase64(alice.publicKey);
  const bobPubB64 = await exportPublicKeyBase64(bob.publicKey);

  // Each side derives the conversation key from its own private + peer's public.
  const aliceKey = await deriveConversationKey(
    alice.privateKey,
    await importPeerPublicKey(bobPubB64),
    convId,
  );
  const bobKey = await deriveConversationKey(
    bob.privateKey,
    await importPeerPublicKey(alicePubB64),
    convId,
  );

  // 1) alice encrypts, bob decrypts.
  const secret = "the eagle lands at midnight 🦅";
  const payload = await encryptMessage(aliceKey, secret);
  const decrypted = await decryptMessage(bobKey, payload);
  check("alice->bob message round-trips", decrypted === secret);

  // 2) ciphertext is not the plaintext.
  check(
    "payload is ciphertext (not plaintext)",
    !payload.ciphertext.includes("eagle") && payload.ciphertext.length > 0,
  );

  // 3) safety number is order-independent and identical for both.
  const snAB = await computeSafetyNumber(alicePubB64, bobPubB64);
  const snBA = await computeSafetyNumber(bobPubB64, alicePubB64);
  check("safety number is order-independent", snAB === snBA);
  check("safety number is 60 digits in 12 groups", /^(\d{5} ){11}\d{5}$/.test(snAB));

  // 4) a third party (mallory) derives a different key -> cannot decrypt.
  const mallory = await generateIdentityKeyPair();
  const malloryKey = await deriveConversationKey(
    mallory.privateKey,
    await importPeerPublicKey(alicePubB64),
    convId,
  );
  let malloryFailed = false;
  try {
    await decryptMessage(malloryKey, payload);
  } catch {
    malloryFailed = true;
  }
  check("eavesdropper key cannot decrypt", malloryFailed);

  // 5) different conversationId -> different key (no cross-conversation reuse).
  const aliceKeyOther = await deriveConversationKey(
    alice.privateKey,
    await importPeerPublicKey(bobPubB64),
    "different-conversation",
  );
  let wrongConvFailed = false;
  try {
    await decryptMessage(aliceKeyOther, payload);
  } catch {
    wrongConvFailed = true;
  }
  check("different conversationId yields a different key", wrongConvFailed);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

void main();
