"use client";

import { encryptBytes, decryptBytes } from "@/lib/crypto/conversation";
import { getConversationKey } from "@/lib/crypto/keystore";
import type { MediaRef } from "@/lib/protocol";

/**
 * Encrypted image sharing. Images are compressed and AES-GCM-encrypted in the
 * browser with the conversation key, then the ciphertext is uploaded to R2 via
 * the Worker. The server/R2 only ever hold ciphertext.
 */

const HOST = process.env.NEXT_PUBLIC_PARTYKIT_HOST ?? "127.0.0.1:8787";

function mediaBase(): string {
  const isLocal =
    HOST.startsWith("127.") || HOST.startsWith("localhost") || HOST.startsWith("0.0.0.0");
  return `${isLocal ? "http" : "https"}://${HOST}`;
}

async function conversationTicket(peerUserId: string): Promise<string> {
  const res = await fetch("/api/conversation-token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ peerUserId }),
  });
  if (!res.ok) throw new Error("failed to authorize media");
  const { token } = (await res.json()) as { token: string };
  return token;
}

export const MAX_IMAGE_BYTES = 25 * 1024 * 1024; // reject huge originals

/** Compress an image to a bounded size using a canvas (WebP, quality 0.82). */
export async function compressImage(
  file: File,
  maxDim = 1600,
  quality = 0.82,
): Promise<{ bytes: Uint8Array; mime: string; width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  let { width, height } = bitmap;
  const longest = Math.max(width, height);
  if (longest > maxDim) {
    const scale = maxDim / longest;
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas unsupported");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  const mime = "image/webp";
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("compression failed"))),
      mime,
      quality,
    ),
  );
  return { bytes: new Uint8Array(await blob.arrayBuffer()), mime, width, height };
}

/**
 * Compress → encrypt → upload. Returns the MediaRef to attach to a message.
 * `persist` decides the storage scope: persisted blobs are kept; ephemeral ones
 * are auto-expired by the R2 lifecycle rule.
 */
export async function uploadImage(
  conversationId: string,
  peerUserId: string,
  file: File,
  persist: boolean,
): Promise<MediaRef> {
  const key = getConversationKey(conversationId);
  if (!key) throw new Error("conversation key unavailable");
  if (file.size > MAX_IMAGE_BYTES) throw new Error("image too large");

  const { bytes, mime, width, height } = await compressImage(file);
  const { ciphertext, iv } = await encryptBytes(key, bytes);

  const token = await conversationTicket(peerUserId);
  const res = await fetch(
    `${mediaBase()}/media?token=${encodeURIComponent(token)}&persist=${persist ? 1 : 0}`,
    { method: "POST", body: ciphertext as BodyInit },
  );
  if (!res.ok) throw new Error("upload failed");
  const { id } = (await res.json()) as { id: string };

  return { id, iv, mime, width, height, size: bytes.length };
}

/** Download → decrypt → object URL for display/save. */
export async function downloadImage(
  conversationId: string,
  peerUserId: string,
  media: MediaRef,
): Promise<string> {
  const key = getConversationKey(conversationId);
  if (!key) throw new Error("conversation key unavailable");

  const token = await conversationTicket(peerUserId);
  const res = await fetch(
    `${mediaBase()}/media/${conversationId}/${media.id}?token=${encodeURIComponent(token)}`,
  );
  if (!res.ok) throw new Error("download failed");
  const ciphertext = new Uint8Array(await res.arrayBuffer());
  const bytes = await decryptBytes(key, ciphertext, media.iv);
  return URL.createObjectURL(new Blob([bytes as BlobPart], { type: media.mime }));
}
