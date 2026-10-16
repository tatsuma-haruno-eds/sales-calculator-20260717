import { NextResponse } from "next/server";
import { createSessionToken, SESSION_COOKIE_NAME, verifyPasscode } from "@/lib/auth";

export async function POST(request: Request) {
  if (!process.env.APP_ACCESS_PASSCODE) {
    return NextResponse.json(
      { error: { code: "AUTH_NOT_CONFIGURED", message: "パスワードが設定されていません。管理者にお問い合わせください。" } },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: "INVALID_REQUEST", message: "リクエストを読み取れませんでした。" } },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const passcode = body && typeof body === "object" && "password" in body
    ? body.password
    : undefined;
  if (typeof passcode !== "string" || passcode.length > 1024) {
    return NextResponse.json(
      { error: { code: "INVALID_REQUEST", message: "パスワードを入力してください。" } },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (!verifyPasscode(passcode)) {
    return NextResponse.json(
      { error: { code: "INVALID_PASSWORD", message: "パスワードが正しくありません。" } },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  const response = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  response.cookies.set(SESSION_COOKIE_NAME, createSessionToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  });
  return response;
}
