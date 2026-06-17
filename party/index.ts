import { routePartykitRequest } from "partyserver";
import { verifyConnectToken, verifyConversationTicket } from "./auth";
import type { Env } from "./env";

// Durable Object classes must be exported from the Worker entry so Wrangler can
// bind them. Binding "Lobby" → /parties/lobby/*, "Main" → /parties/main/*.
export { LobbyServer } from "./lobby";
export { ConversationServer } from "./server";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const response = await routePartykitRequest(request, env as never, {
      // Reject bad tokens BEFORE the WebSocket upgrade. On success we return
      // nothing (let the upgrade proceed); the DO re-verifies the token in
      // onConnect to read identity. This avoids reconstructing the upgrade
      // request (which breaks the upgrade in workerd).
      onBeforeConnect: async (req, lobby) => {
        const token = new URL(req.url).searchParams.get("token") ?? "";
        try {
          // lobby.className is the DO BINDING name (see wrangler.jsonc).
          if (lobby.className === "Lobby") {
            await verifyConnectToken(token, env.JWT_SECRET);
          } else if (lobby.className === "Main") {
            const c = await verifyConversationTicket(token, env.JWT_SECRET);
            if (c.conversationId !== lobby.name) {
              return new Response("Forbidden", { status: 403 });
            }
          }
        } catch {
          return new Response("Unauthorized", { status: 401 });
        }
      },
    });
    return response ?? new Response("Not found", { status: 404 });
  },
};
