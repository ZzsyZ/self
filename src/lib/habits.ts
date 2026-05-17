import type { DailyRecord, Habit, HabitType, HabitView, RawLog } from "@/lib/types";

export const emptyDailyRecord: DailyRecord = {
  habits: [],
  rawLogs: [],
};

export function normalizeDailyRecord(input: Partial<DailyRecord> | undefined): DailyRecord {
  return {
    habits: normalizeHabits(input?.habits),
    rawLogs: normalizeRawLogs(input?.rawLogs),
  };
}

export function normalizeHabits(input: unknown): Habit[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input.flatMap((item) => {
    if (!isRecord(item)) {
      return [];
    }

    const habit = typeof item.habit === "string" ? item.habit.trim() : "";
    const type = item.type;

    if (!habit || (type !== "good" && type !== "bad")) {
      return [];
    }

    return [
      {
        ...(typeof item.id === "string" && item.id ? { id: item.id } : {}),
        habit,
        type,
        ...(typeof item.createdAt === "string" ? { createdAt: item.createdAt } : {}),
      },
    ];
  });
}

export function normalizeRawLogs(input: unknown): RawLog[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input.flatMap((item) => {
    if (!isRecord(item)) {
      return [];
    }

    const text = typeof item.text === "string" ? item.text : "";
    const time = typeof item.time === "string" ? item.time : "";

    if (!text || !time) {
      return [];
    }

    return [
      {
        ...(typeof item.id === "string" && item.id ? { id: item.id } : {}),
        time,
        text,
        ...(typeof item.createdAt === "string" ? { createdAt: item.createdAt } : {}),
      },
    ];
  });
}

export function toHabitViews(habits: Habit[]): Record<HabitType, HabitView[]> {
  return habits.reduce<Record<HabitType, HabitView[]>>(
    (acc, habit, originalIndex) => {
      const stableKey = habit.id ?? `legacy-${originalIndex}-${habit.type}-${habit.habit}`;
      acc[habit.type].push({ ...habit, originalIndex, stableKey });
      return acc;
    },
    { good: [], bad: [] },
  );
}

export function findHabitIndex(habits: Habit[], target: HabitView) {
  if (target.id) {
    const idMatch = habits.findIndex((habit) => habit.id === target.id);
    if (idMatch >= 0) {
      return idMatch;
    }
  }

  const byOriginalIndex = habits[target.originalIndex];
  if (byOriginalIndex?.habit === target.habit && byOriginalIndex.type === target.type) {
    return target.originalIndex;
  }

  return habits.findIndex(
    (habit) => habit.habit === target.habit && habit.type === target.type,
  );
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return Boolean(input) && typeof input === "object" && !Array.isArray(input);
}
