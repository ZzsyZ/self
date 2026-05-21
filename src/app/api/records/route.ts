import { NextResponse } from "next/server";
import { getDailyRecordRows } from "@/lib/db";
import { normalizeDailyRecord } from "@/lib/habits";
import { getSessionAccountId } from "@/lib/session";

export async function GET() {
  const accountId = await getSessionAccountId();

  if (!accountId) {
    return NextResponse.json({ error: "尚未登录" }, { status: 401 });
  }

  try {
    const rows = await getDailyRecordRows(accountId);

    const records = Object.fromEntries(
      rows.map((row) => [
        row.date_key,
        normalizeDailyRecord({
          habits: row.habits,
          rawLogs: row.raw_logs,
        }),
      ]),
    );

    return NextResponse.json({ records });
  } catch (error) {
    console.error("Failed to read daily records", error);
    return NextResponse.json({ error: "读取同步数据失败，请检查 Supabase Postgres 配置。" }, { status: 500 });
  }
}
