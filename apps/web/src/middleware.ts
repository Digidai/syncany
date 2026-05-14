import { NextRequest, NextResponse } from "next/server";

// Routes that DON'T require a session cookie. They handle their own auth
// (return 401 JSON instead of being middleware-redirected to /login).
const PUBLIC_PATHS = [
  "/login", "/signup", "/forgot-password", "/reset-password", "/verify-email",
  "/invite",
  "/api/auth",   // better-auth handler
  "/api/me",     // api-token endpoint must return 401 not redirect (web client parses JSON)
];

// `/` is the public marketing landing — rendered for everyone.
function isPublicPath(pathname: string): boolean {
  return pathname === "/" || PUBLIC_PATHS.some((p) => pathname.startsWith(p));
}
// better-auth cookie names are like "better-auth.session_token" in plain
// HTTP and "__Secure-better-auth.session_token" / "__Host-..." over HTTPS.
// Match any of those forms.
function isSessionCookie(name: string): boolean {
  return /(^|__Secure-|__Host-)better-auth\.session_token$/.test(name);
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (isPublicPath(pathname)) return NextResponse.next();
  if (pathname.startsWith("/_next") || pathname === "/favicon.ico") return NextResponse.next();

  const cookies = req.cookies.getAll();
  const hasSession = cookies.some((c) => isSessionCookie(c.name));
  if (!hasSession) {
    return NextResponse.redirect(new URL("/login", req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
