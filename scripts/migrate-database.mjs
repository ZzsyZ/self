import fs from "node:fs";
import path from "node:path";
import pg from "pg";

loadDotEnv(path.resolve(".env.local"));

const migrationPath = path.resolve(
  "supabase",
  "migrations",
  "20260520160000_create_daily_records.sql",
);
const sql = fs.readFileSync(migrationPath, "utf8");
const connectionString = env("SUPABASE_DATABASE_URL");
const pool = new pg.Pool({
  connectionString,
  max: 1,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  ssl: shouldUseSsl(connectionString) ? { rejectUnauthorized: false } : undefined,
});

try {
  await pool.query(sql);
  const result = await pool.query(`
    select
      c.relname as table_name,
      c.relrowsecurity as rls_enabled,
      coalesce(array_agg(a.attname order by a.attnum) filter (where a.attname is not null), '{}') as columns
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    left join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    where n.nspname = 'public' and c.relname = 'daily_records'
    group by c.relname, c.relrowsecurity
  `);

  console.log("Migration applied.");
  console.log(JSON.stringify(result.rows[0] ?? null, null, 2));
} finally {
  await pool.end();
}

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const contents = fs.readFileSync(filePath, "utf8");

  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separator = trimmed.indexOf("=");
    if (separator < 0) {
      continue;
    }

    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    process.env[key] ||= value;
  }
}

function env(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function shouldUseSsl(connectionString) {
  if (process.env.SUPABASE_DATABASE_SSL === "false") {
    return false;
  }

  return !/localhost|127\.0\.0\.1|\[::1\]/.test(connectionString);
}
