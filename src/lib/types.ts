export const APP_ID = "habit_mirror_v5_pro";

export type HabitType = "good" | "bad";

export type Habit = {
  id?: string;
  habit: string;
  type: HabitType;
  createdAt?: string;
};

export type RawLog = {
  id?: string;
  time: string;
  text: string;
  createdAt?: string;
};

export type DailyRecord = {
  habits: Habit[];
  rawLogs: RawLog[];
};

export type HabitView = Habit & {
  originalIndex: number;
  stableKey: string;
};

export type StatusMessage = {
  type: "info" | "success" | "error";
  text: string;
};
