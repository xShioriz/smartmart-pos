import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/server/auth/session";

// ด่านแรกเท่านั้น (optimistic check) — การตรวจสิทธิ์จริงอยู่ใน requirePage/requireAction
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);
  const isLogin = pathname === "/login";

  if (!session && !isLogin) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
}

export const config = {
  // ยกเว้น asset, favicon และ webhook ของ Payment Provider (ไม่มี session)
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/webhooks).*)"],
};
