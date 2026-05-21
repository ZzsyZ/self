import { NextResponse } from "next/server";
import { upsertDailyRecord } from "@/lib/db";
import { normalizeDailyRecord } from "@/lib/habits";
import { getSessionAccountId } from "@/lib/session";
import type { DailyRecord } from "@/lib/types";

type RouteContext = {
  params: Promise<{
    dateKey: string;
  }>;
};

export async function PUT(request: Request, context: RouteContext) {
  const accountId = await getSessionAccountId();

  if (!accountId) {
    return NextResponse.json({ error: "尚未登录" }, { status: 401 });
  }

  const { dateKey } = await context.params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    return NextResponse.json({ error: "日期格式不正确" }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as Partial<DailyRecord> | null;
  const nextRecord = normalizeDailyRecord(body ?? undefined);

  try {
    await upsertDailyRecord(accountId, dateKey, nextRecord.habits, nextRecord.rawLogs);
    return NextResponse.json({ record: nextRecord });
  } catch (error) {
    console.error("Failed to save daily record", error);
    return NextResponse.json({ error: "保存到 Supabase Postgres 失败，请检查配置或网络。" }, { status: 500 });
  }
}
