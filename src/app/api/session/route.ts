import { NextResponse } from "next/server";
import {
  clearSessionCookie,
  getConfiguredAccountId,
  getSessionAccountId,
  setSessionCookie,
  verifyCredentials,
} from "@/lib/session";

export async function GET() {
  const accountId = await getSessionAccountId();

  return NextResponse.json({
    isAuthenticated: Boolean(accountId),
    accountId: accountId ?? getConfiguredAccountId(),
  });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | { accountId?: unknown; password?: unknown }
    | null;
  const accountId = typeof body?.accountId === "string" ? body.accountId.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";

  try {
    if (!verifyCredentials(accountId, password)) {
      return NextResponse.json({ error: "账号或密码不正确" }, { status: 401 });
    }
  } catch (error) {
    console.error("Session configuration error", error);
    return NextResponse.json({ error: "同步服务登录配置未完成。" }, { status: 503 });
  }

  try {
    await setSessionCookie(accountId);

    return NextResponse.json({
      isAuthenticated: true,
      accountId,
    });
  } catch (error) {
    console.error("Session cookie error", error);
    return NextResponse.json({ error: "同步服务会话配置未完成。" }, { status: 503 });
  }
}

export async function DELETE() {
  await clearSessionCookie();

  return NextResponse.json({
    isAuthenticated: false,
    accountId: getConfiguredAccountId(),
  });
}
