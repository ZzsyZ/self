import { Pool, type QueryResultRow } from "pg";

type DailyRecordRow = {
  date_key: string;
  habits: unknown;
  raw_logs: unknown;
};

declare global {
  var habitMirrorPool: Pool | undefined;
}

export function getDatabasePool() {
  if (globalThis.habitMirrorPool) {
    return globalThis.habitMirrorPool;
  }

  const connectionString = process.env.SUPABASE_DATABASE_URL || process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("Missing SUPABASE_DATABASE_URL. Use the Supabase Postgres session pooler URL.");
  }

  globalThis.habitMirrorPool = new Pool({
    connectionString,
    max: Number(process.env.POSTGRES_POOL_MAX ?? 5),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    ssl: shouldUseSsl(connectionString) ? { rejectUnauthorized: false } : undefined,
  });

  return globalThis.habitMirrorPool;
}

export async function queryRows<T extends QueryResultRow>(sql: string, values: unknown[] = []) {
  return getDatabasePool().query<T>(sql, values);
}

export async function getDailyRecordRows(accountId: string) {
  const result = await queryRows<DailyRecordRow>(
    `
      select date_key::text as date_key, habits, raw_logs
      from public.daily_records
      where account_id = $1
      order by date_key asc
    `,
    [accountId],
  );

  return result.rows;
}

export async function upsertDailyRecord(accountId: string, dateKey: string, habits: unknown, rawLogs: unknown) {
  await queryRows(
    `
      insert into public.daily_records (account_id, date_key, habits, raw_logs, updated_at)
      values ($1, $2::date, $3::jsonb, $4::jsonb, now())
      on conflict (account_id, date_key)
      do update set
        habits = excluded.habits,
        raw_logs = excluded.raw_logs,
        updated_at = now()
    `,
    [accountId, dateKey, JSON.stringify(habits), JSON.stringify(rawLogs)],
  );
}

function shouldUseSsl(connectionString: string) {
  if (process.env.SUPABASE_DATABASE_SSL === "false") {
    return false;
  }

  return !/localhost|127\.0\.0\.1|\[::1\]/.test(connectionString);
}
