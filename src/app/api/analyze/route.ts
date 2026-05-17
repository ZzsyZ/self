import { NextResponse } from "next/server";

type HabitDraft = {
  habit?: unknown;
  type?: unknown;
};

type HabitAuditPayload = {
  habits?: HabitDraft[];
};

type OpenRouterContent = string | Array<{ type?: string; text?: string }>;

type OpenRouterResponse = {
  choices?: Array<{
    message?: {
      content?: OpenRouterContent;
    };
    finish_reason?: string;
  }>;
  error?: {
    message?: string;
    code?: number | string;
  };
};

const habitAuditSchema = {
  type: "object",
  properties: {
    habits: {
      type: "array",
      maxItems: 20,
      items: {
        type: "object",
        properties: {
          habit: {
            type: "string",
            description: "Short habit description in the user's language.",
          },
          type: {
            type: "string",
            enum: ["good", "bad"],
            description: "good means worth keeping; bad means worth reducing or avoiding.",
          },
        },
        required: ["habit", "type"],
        additionalProperties: false,
      },
    },
  },
  required: ["habits"],
  additionalProperties: false,
};

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { text?: unknown } | null;
  const text = typeof body?.text === "string" ? body.text.trim() : "";

  if (!text) {
    return NextResponse.json({ error: "请输入要分析的记录。" }, { status: 400 });
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "服务端未配置 OPENROUTER_API_KEY。" },
      { status: 503 },
    );
  }

  try {
    const model = process.env.OPENROUTER_MODEL?.trim() || "openrouter/free";
    const requestBody: Record<string, unknown> = {
      model,
      messages: [
        {
          role: "system",
          content:
            '你是一个习惯审计专家。从用户记录中提取具体习惯，并分类为 good 或 bad。只提取真实发生或明确表达的行为，不要编造。只输出 JSON，不要输出 Markdown 或解释。JSON 必须符合这个结构：{"habits":[{"habit":"描述","type":"good"}]}，type 只能是 good 或 bad。',
        },
        {
          role: "user",
          content: text,
        },
      ],
      temperature: 0.2,
      max_tokens: 800,
    };

    if (shouldUseStructuredOutputs(model)) {
      requestBody.provider = {
        require_parameters: true,
      };
      requestBody.response_format = {
        type: "json_schema",
        json_schema: {
          name: "habit_audit",
          strict: true,
          schema: habitAuditSchema,
        },
      };
    }

    const response = await fetch(getOpenRouterUrl(), {
      method: "POST",
      headers: getOpenRouterHeaders(apiKey),
      body: JSON.stringify(requestBody),
    });

    const payload = (await response.json().catch(() => null)) as OpenRouterResponse | null;

    if (!response.ok) {
      console.error("OpenRouter analysis failed", payload);
      return NextResponse.json(
        { error: getOpenRouterErrorMessage(response.status, payload) },
        { status: response.status },
      );
    }

    const content = payload?.choices?.[0]?.message?.content;
    const contentText = extractMessageText(content);

    if (!contentText) {
      throw new Error("OpenRouter returned an empty response.");
    }

    const parsed = parseHabitJson(contentText);
    const habits = normalizeHabits(parsed.habits);

    return NextResponse.json({ habits });
  } catch (error) {
    console.error("Habit analysis failed", error);
    const isConnectionError = isUpstreamConnectionError(error);

    return NextResponse.json(
      {
        error: isConnectionError
          ? "OpenRouter 连接失败，请检查网络或代理后重试。"
          : "AI 分析失败，请稍后重试。",
      },
      { status: isConnectionError ? 503 : 500 },
    );
  }
}

function getOpenRouterUrl() {
  const baseUrl =
    process.env.OPENROUTER_API_BASE_URL?.trim() || "https://openrouter.ai/api/v1";

  return `${baseUrl.replace(/\/$/, "")}/chat/completions`;
}

function getOpenRouterHeaders(apiKey: string) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };

  const siteUrl = process.env.OPENROUTER_SITE_URL?.trim();
  if (siteUrl) {
    headers["HTTP-Referer"] = siteUrl;
  }

  headers["X-Title"] = process.env.OPENROUTER_APP_TITLE?.trim() || "Habit Mirror";

  return headers;
}

function shouldUseStructuredOutputs(model: string) {
  return model !== "openrouter/free" && process.env.OPENROUTER_STRICT_JSON !== "false";
}

function extractMessageText(content: OpenRouterContent | undefined) {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => (part.type === "text" || !part.type ? part.text : ""))
      .filter(Boolean)
      .join("");
  }

  return "";
}

function parseHabitJson(content: string): HabitAuditPayload {
  try {
    return JSON.parse(content) as HabitAuditPayload;
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error("OpenRouter response was not valid JSON.");
    }

    return JSON.parse(match[0]) as HabitAuditPayload;
  }
}

function normalizeHabits(input: HabitAuditPayload["habits"]) {
  if (!Array.isArray(input)) {
    return [];
  }

  return input.flatMap((item) => {
    const habit = typeof item.habit === "string" ? item.habit.trim() : "";
    const type = item.type;

    if (!habit || (type !== "good" && type !== "bad")) {
      return [];
    }

    return [{ habit, type }];
  });
}

function getOpenRouterErrorMessage(status: number, payload: OpenRouterResponse | null) {
  const detail = payload?.error?.message;

  if (status === 401) {
    return "OpenRouter API Key 无效，请检查 OPENROUTER_API_KEY。";
  }

  if (status === 402) {
    return "OpenRouter 余额不足，或当前模型需要付费额度。";
  }

  if (status === 429) {
    return "OpenRouter 请求过于频繁，请稍后重试。";
  }

  return detail
    ? `OpenRouter 分析失败：${detail}`
    : "OpenRouter 分析失败，请检查 API Key、模型或网络配置。";
}

function isUpstreamConnectionError(error: unknown) {
  const text = stringifyError(error);
  return (
    text.includes("fetch failed") ||
    text.includes("Connect Timeout") ||
    text.includes("UND_ERR_CONNECT_TIMEOUT") ||
    text.includes("ECONNREFUSED") ||
    text.includes("ENOTFOUND")
  );
}

function stringifyError(error: unknown): string {
  if (error instanceof Error) {
    const cause = "cause" in error ? stringifyError(error.cause) : "";
    return `${error.name}: ${error.message} ${cause}`;
  }

  return typeof error === "string" ? error : "";
}
