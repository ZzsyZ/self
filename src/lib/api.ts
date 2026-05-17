import type { Habit } from "@/lib/types";

export async function analyzeHabitText(text: string): Promise<Habit[]> {
  const response = await fetch("/api/analyze", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text }),
  });

  const payload = (await response.json().catch(() => null)) as
    | { habits?: Habit[]; error?: string }
    | null;

  if (!response.ok) {
    throw new Error(payload?.error ?? "分析失败，请稍后重试");
  }

  return payload?.habits ?? [];
}
