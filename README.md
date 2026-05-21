# 习惯之镜

Next.js 版本的习惯记录与 AI 审计工具。数据同步使用 Supabase Postgres session pool，AI 分析通过服务端 OpenRouter 完成。

## 本地配置

复制 `.env.example` 为 `.env.local`，填入 Supabase Postgres、固定账号和 OpenRouter 配置：

```bash
SUPABASE_DATABASE_URL=postgresql://postgres.<project-ref>:<password>@<session-pooler-host>:5432/postgres?sslmode=require
POSTGRES_POOL_MAX=5
HABIT_MIRROR_ACCOUNT_ID=lin
HABIT_MIRROR_ACCOUNT_PASSWORD=123456
HABIT_MIRROR_SESSION_SECRET=replace-with-a-long-random-string

OPENROUTER_API_KEY=
OPENROUTER_MODEL=openrouter/free
OPENROUTER_SITE_URL=http://127.0.0.1:3000
OPENROUTER_APP_TITLE=Habit Mirror
```

`SUPABASE_DATABASE_URL` 使用 Supabase Dashboard 里的 Session pooler 连接串。不要把数据库连接串放到 `NEXT_PUBLIC_` 环境变量里。

## Supabase 数据表

执行迁移：

```bash
npm run migrate:db
```

迁移 SQL 位于 `supabase/migrations/20260520160000_create_daily_records.sql`。表名为 `public.daily_records`，主键是 `(account_id, date_key)`。表已启用 RLS，并撤销 `anon`/`authenticated` 的直接表权限；应用通过 Next.js 后端 API 使用 Postgres session pool 读写。

## 开发

```bash
npm install
npm run dev
```

打开 `http://127.0.0.1:3000`。

## 检查

```bash
npm run typecheck
npm run lint
npm run build
```

## 导入备份

备份 Markdown 可以用脚本导入到 Supabase Postgres：

```bash
node scripts/import-backup.mjs "C:\Users\Administrator\Downloads\习惯之镜_备份_2026-05-17.md"
```

脚本会优先使用备份文件里的同步 ID，也可以手动指定：

```bash
node scripts/import-backup.mjs "C:\Users\Administrator\Downloads\习惯之镜_备份_2026-05-17.md" --uid=lin
```

先预览不写入：

```bash
node scripts/import-backup.mjs "C:\Users\Administrator\Downloads\习惯之镜_备份_2026-05-17.md" --dry-run
```
