import { NextResponse, type NextRequest } from "next/server";

/**
 * CSRF defense-in-depth: reject state-changing API requests whose Origin does
 * not match the host. Combined with httpOnly + SameSite=Lax cookies and the
 * JSON content-type (which forces a CORS preflight cross-origin), this blocks
 * cross-site forgery of our POST endpoints.
 *
 * (Next 16 "proxy" convention — replaces the deprecated "middleware".)
 */
export function proxy(req: NextRequest) {
  if (req.method === "POST" && req.nextUrl.pathname.startsWith("/api/")) {
    const origin = req.headers.get("origin");
    if (origin) {
      const host = req.headers.get("host");
      try {
        if (new URL(origin).host !== host) {
          return new NextResponse("Forbidden", { status: 403 });
        }
      } catch {
        return new NextResponse("Forbidden", { status: 403 });
      }
    }
  }
  return NextResponse.next();
}

export const config = {
  matcher: "/api/:path*",
};
