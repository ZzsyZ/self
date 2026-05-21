import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const args = process.argv.slice(2);
const backupPath = args.find((arg) => !arg.startsWith("--"));
const dryRun = args.includes("--dry-run");
const targetUidArg = args.find((arg) => arg.startsWith("--uid="));
const merge = !args.includes("--replace");

if (!backupPath) {
  console.error("Usage: node scripts/import-backup.mjs <backup.md> [--dry-run] [--uid=SYNC_ID] [--replace]");
  process.exit(1);
}

loadDotEnv(path.resolve(".env.local"));

const text = fs.readFileSync(backupPath, "utf8");
const parsed = parseBackup(text);
const targetUid = targetUidArg?.slice("--uid=".length) || parsed.uid || env("HABIT_MIRROR_ACCOUNT_ID", "lin");

console.log(`Target UID: ${targetUid}`);
console.log(`Records: ${parsed.records.length}`);
console.log(
  `Habits: ${parsed.records.reduce((sum, record) => sum + record.habits.length, 0)}`,
);
console.log(
  `Raw logs: ${parsed.records.reduce((sum, record) => sum + record.rawLogs.length, 0)}`,
);
console.log(`Mode: ${merge ? "merge fields" : "replace row"}`);

for (const record of parsed.records) {
  console.log(
    `${record.dateKey}: ${record.habits.length} habits, ${record.rawLogs.length} raw logs`,
  );
}

if (dryRun) {
  console.log("Dry run only. Nothing was written.");
  process.exit(0);
}

const pool = new pg.Pool({
  connectionString: env("SUPABASE_DATABASE_URL"),
  max: 3,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  ssl: shouldUseSsl(env("SUPABASE_DATABASE_URL")) ? { rejectUnauthorized: false } : undefined,
});

try {
  for (const record of parsed.records) {
    await pool.query(
      `
        insert into public.daily_records (account_id, date_key, habits, raw_logs, updated_at)
        values ($1, $2::date, $3::jsonb, $4::jsonb, now())
        on conflict (account_id, date_key)
        do update set
          habits = excluded.habits,
          raw_logs = excluded.raw_logs,
          updated_at = now()
      `,
      [
        targetUid,
        record.dateKey,
        JSON.stringify(record.habits),
        JSON.stringify(record.rawLogs),
      ],
    );
  }
} finally {
  await pool.end();
}

console.log(`Imported ${parsed.records.length} daily records.`);

function parseBackup(markdown) {
  const uid = markdown.match(/同步 ID \(UID\)：?(\S+)/)?.[1]?.trim() ?? "";
  const headingPattern = /^##\s+.*?(\d{4}-\d{2}-\d{2}).*$/gm;
  const headings = [...markdown.matchAll(headingPattern)];

  const records = headings.map((heading, index) => {
    const dateKey = heading[1];
    const start = heading.index ?? 0;
    const end = headings[index + 1]?.index ?? markdown.length;
    const section = markdown.slice(start, end);

    return {
      dateKey,
      habits: parseHabits(section, dateKey),
      rawLogs: parseRawLogs(section, dateKey),
    };
  });

  return { uid, records };
}

function parseHabits(section, dateKey) {
  const habitsSection = section.match(/###\s+💡[\s\S]*?(?=###\s+📝|---|$)/)?.[0] ?? "";
  const habits = [];
  const habitPattern = /^-\s+(?:🟢|🔴)\s+\[(正向|消耗)\]\s+(.+)$/gm;

  for (const match of habitsSection.matchAll(habitPattern)) {
    const label = match[1];
    const habit = cleanText(match[2]);

    if (!habit) {
      continue;
    }

    habits.push({
      id: `backup-${dateKey}-habit-${habits.length + 1}`,
      habit,
      type: label === "正向" ? "good" : "bad",
      createdAt: `${dateKey}T00:00:00.000+08:00`,
    });
  }

  return habits;
}

function parseRawLogs(section, dateKey) {
  const rawSection = section.match(/###\s+📝[\s\S]*?(?=\n---|\n##\s+|$)/)?.[0] ?? "";
  const logs = [];
  const logPattern = /^-\s+\*\*\[(\d{2}:\d{2})\]\*\*\s+([\s\S]*?)(?=\n-\s+\*\*\[\d{2}:\d{2}\]\*\*|\n---|\n##\s+|$)/gm;

  for (const match of rawSection.matchAll(logPattern)) {
    const time = match[1];
    const text = cleanText(match[2]);

    if (!text) {
      continue;
    }

    logs.push({
      id: `backup-${dateKey}-log-${logs.length + 1}`,
      time,
      text,
      createdAt: `${dateKey}T${time}:00.000+08:00`,
    });
  }

  return logs;
}

function cleanText(input) {
  return input
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[“”]/g, '"')
    .trim();
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

function env(name, fallback) {
  const value = process.env[name] || fallback;
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
