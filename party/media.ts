import { verifyConversationTicket } from "./auth";
import type { Env } from "./env";

/**
 * Encrypted-media endpoints on the Worker (R2-backed). The browser uploads an
 * image that was COMPRESSED and ENCRYPTED client-side with the conversation key,
 * so R2 only ever holds ciphertext. Access is authorized by the conversation
 * ticket (same token as the WebSocket), scoped to the ticket's conversation id.
 *
 *   POST   /media           (body = ciphertext)        -> { id }
 *   GET    /media/<cid>/<id>                            -> ciphertext bytes
 *   DELETE /media/<cid>/<id>                            -> { ok }
 */

const MAX_UPLOAD = 8 * 1024 * 1024; // 8 MB ciphertext cap

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Max-Age": "86400",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...CORS },
  });
}

/**
 * The id's first char encodes the storage scope: "p" = persisted (kept), "e" =
 * ephemeral (auto-expired by the R2 lifecycle rule on the "e/" prefix). The R2
 * key is `<scope>/<cid>/<id>`.
 */
function newId(persist: boolean): string {
  return (persist ? "p" : "e") + crypto.randomUUID().replace(/-/g, "");
}

function mediaKey(cid: string, id: string): string {
  const scope = id[0] === "p" ? "p" : "e";
  return `${scope}/${cid}/${id}`;
}

export async function handleMedia(
  request: Request,
  env: Env,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/media" && !url.pathname.startsWith("/media/")) {
    return null;
  }

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  const token = url.searchParams.get("token") ?? "";
  let claims;
  try {
    claims = await verifyConversationTicket(token, env.JWT_SECRET);
  } catch {
    return json({ error: "unauthorized" }, 401);
  }

  // Upload.
  if (request.method === "POST" && url.pathname === "/media") {
    const declared = Number(request.headers.get("content-length") ?? "0");
    if (declared > MAX_UPLOAD) return json({ error: "too large" }, 413);
    const body = await request.arrayBuffer();
    if (body.byteLength > MAX_UPLOAD) return json({ error: "too large" }, 413);
    const persist = url.searchParams.get("persist") === "1";
    const id = newId(persist);
    await env.MEDIA.put(mediaKey(claims.conversationId, id), body);
    return json({ id });
  }

  // Download / delete by /media/<cid>/<id>.
  const parts = url.pathname.split("/").filter(Boolean); // ["media", cid, id]
  if (parts.length === 3) {
    const cid = parts[1];
    const id = parts[2];
    if (cid !== claims.conversationId) return json({ error: "forbidden" }, 403);
    const key = mediaKey(cid, id);

    if (request.method === "GET") {
      const obj = await env.MEDIA.get(key);
      if (!obj) return json({ error: "not found" }, 404);
      return new Response(obj.body, {
        headers: {
          "content-type": "application/octet-stream",
          "cache-control": "private, max-age=31536000, immutable",
          ...CORS,
        },
      });
    }
    if (request.method === "DELETE") {
      await env.MEDIA.delete(key);
      return json({ ok: true });
    }
  }

  return json({ error: "method not allowed" }, 405);
}
