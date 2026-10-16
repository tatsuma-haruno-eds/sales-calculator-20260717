import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE_NAME, verifySessionToken } from "./lib/auth";

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isLoginPage = pathname === "/login";
  const isLoginApi = pathname === "/api/auth/login";

  if (isLoginApi) return NextResponse.next();

  const isAuthenticated = verifySessionToken(request.cookies.get(SESSION_COOKIE_NAME)?.value);
  if (isAuthenticated) {
    return isLoginPage ? NextResponse.redirect(new URL("/", request.url)) : NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "ログインしてください。" } },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  return isLoginPage ? NextResponse.next() : NextResponse.redirect(new URL("/login", request.url));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
