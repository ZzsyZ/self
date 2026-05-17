# 习惯之镜

Next.js 版本的习惯记录与 AI 审计工具。数据同步使用 Firebase anonymous auth + Firestore，AI 分析通过服务端 OpenRouter 完成。

## 本地配置

复制 `.env.example` 为 `.env.local`，填入 Firebase Web App 配置和 OpenRouter API key：

```bash
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=

OPENROUTER_API_KEY=
OPENROUTER_MODEL=openrouter/free
OPENROUTER_SITE_URL=http://127.0.0.1:3000
OPENROUTER_APP_TITLE=Habit Mirror
```

默认模型使用 `openrouter/free`，由 OpenRouter 自动选择免费模型。如果结构化 JSON 输出不稳定，可以把 `OPENROUTER_MODEL` 换成明确模型，例如 `google/gemini-2.5-flash-lite` 或 `google/gemini-2.5-flash`。

Firestore 兼容旧路径：

```text
artifacts/habit_mirror_v5_pro/users/{activeUid}/dailyRecords/{yyyy-mm-dd}
```

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

备份 Markdown 可以用脚本导入到 Firestore：

```bash
node scripts/import-backup.mjs "C:\Users\Administrator\Downloads\习惯之镜_备份_2026-05-17.md"
```

脚本会优先使用备份文件里的同步 ID。也可以手动指定：

```bash
node scripts/import-backup.mjs "C:\Users\Administrator\Downloads\习惯之镜_备份_2026-05-17.md" --uid=15775256486018359302
```

先预览不写入：

```bash
node scripts/import-backup.mjs "C:\Users\Administrator\Downloads\习惯之镜_备份_2026-05-17.md" --dry-run
```
