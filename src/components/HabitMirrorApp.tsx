"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Cloud,
  Copy,
  Edit3,
  FileText,
  History,
  LogOut,
  Loader2,
  Lock,
  Mic,
  MicOff,
  MoreVertical,
  Plus,
  RotateCcw,
  Save,
  Trash2,
  User,
  XCircle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { analyzeHabitText } from "@/lib/api";
import {
  emptyDailyRecord,
  findHabitIndex,
  normalizeDailyRecord,
  toHabitViews,
} from "@/lib/habits";
import { useAuthIdentity } from "@/lib/hooks/useAuthIdentity";
import { useDailyRecords } from "@/lib/hooks/useDailyRecords";
import {
  addDays,
  addMonths,
  formatLogTime,
  formatMonthTitle,
  formatMonthDay,
  formatWeekday,
  getDateKey,
  getMonthCalendarDays,
  isSameDay,
  isSameMonth,
} from "@/lib/date";
import type { Habit, HabitType, HabitView, StatusMessage } from "@/lib/types";

type CollapsedState = Record<HabitType, boolean>;

type ActiveHabit = {
  habit: HabitView;
  type: HabitType;
};

type BrowserSpeechRecognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onend: (() => void) | null;
  onerror: ((event: BrowserSpeechRecognitionErrorEvent) => void) | null;
  onresult: ((event: BrowserSpeechRecognitionEvent) => void) | null;
  onstart: (() => void) | null;
  start: () => void;
  stop: () => void;
};

type BrowserSpeechRecognitionConstructor = new () => BrowserSpeechRecognition;

type BrowserSpeechRecognitionEvent = {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: {
      isFinal: boolean;
      [index: number]: {
        transcript: string;
      };
    };
  };
};

type BrowserSpeechRecognitionErrorEvent = {
  error: string;
};

const statusClassName: Record<StatusMessage["type"], string> = {
  info: "bg-indigo-50 text-indigo-600",
  success: "bg-emerald-50 text-emerald-600",
  error: "bg-rose-50 text-rose-600",
};

function getSpeechRecognitionConstructor(): BrowserSpeechRecognitionConstructor | null {
  if (typeof window === "undefined") {
    return null;
  }

  const speechWindow = window as Window &
    typeof globalThis & {
      SpeechRecognition?: BrowserSpeechRecognitionConstructor;
      webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor;
    };

  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null;
}

function composeSpeechText(baseText: string, finalText: string, interimText: string) {
  const speechText = `${finalText}${interimText}`.trim();

  if (!speechText) {
    return baseText;
  }

  return baseText ? `${baseText}\n${speechText}` : speechText;
}

export function HabitMirrorApp() {
  const [currentDate, setCurrentDate] = useState(() => new Date());
  const [userInput, setUserInput] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [statusMsg, setStatusMsg] = useState<StatusMessage | null>(null);
  const [showRawLogs, setShowRawLogs] = useState(false);
  const [showAccountModal, setShowAccountModal] = useState(false);
  const [accountIdInput, setAccountIdInput] = useState("lin");
  const [passwordInput, setPasswordInput] = useState("");
  const [collapsed, setCollapsed] = useState<CollapsedState>({ good: false, bad: false });
  const [activeHabit, setActiveHabit] = useState<ActiveHabit | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [tempHabitName, setTempHabitName] = useState("");
  const [isListening, setIsListening] = useState(false);

  const longPressTimer = useRef<number | null>(null);
  const startPos = useRef({ x: 0, y: 0 });
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const speechBaseTextRef = useRef("");
  const committedSpeechRef = useRef("");

  const {
    activeUid,
    accountId,
    isAuthenticated,
    isLoading: isAuthLoading,
    error: authError,
    login,
    logout,
  } = useAuthIdentity();

  const {
    records,
    isLoading: isRecordsLoading,
    error: recordsError,
    saveDailyRecord,
  } = useDailyRecords(activeUid);

  const dateKey = useMemo(() => getDateKey(currentDate), [currentDate]);
  const isToday = isSameDay(currentDate, new Date());
  const monthDays = useMemo(() => getMonthCalendarDays(currentDate), [currentDate]);
  const recordDateKeys = useMemo(
    () =>
      new Set(
        Object.entries(records)
          .filter(([, record]) => record.habits.length > 0 || record.rawLogs.length > 0)
          .map(([recordDateKey]) => recordDateKey),
      ),
    [records],
  );

  const currentDayData = useMemo(
    () => normalizeDailyRecord(records[dateKey] ?? emptyDailyRecord),
    [dateKey, records],
  );

  const categorizedHabits = useMemo(
    () => toHabitViews(currentDayData.habits),
    [currentDayData.habits],
  );

  const appError = authError ?? recordsError;
  const isAppLoading = isAuthLoading || isRecordsLoading;

  const showStatus = (message: StatusMessage, autoClear = true) => {
    setStatusMsg(message);
    if (autoClear) {
      window.setTimeout(() => setStatusMsg(null), 2400);
    }
  };

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
    };
  }, []);

  const changeDay = (days: number) => {
    setCurrentDate((previous) => addDays(previous, days));
  };

  const changeMonth = (months: number) => {
    setCurrentDate((previous) => addMonths(previous, months));
  };

  const jumpToToday = () => {
    setCurrentDate(new Date());
  };

  const persistHabits = async (habits: Habit[]) => {
    await saveDailyRecord(dateKey, {
      ...currentDayData,
      habits,
    });
  };

  const analyzeHabits = async () => {
    const text = userInput.trim();

    if (!text || !activeUid) {
      return;
    }

    setIsAnalyzing(true);
    showStatus({ type: "info", text: "AI 审计中..." }, false);

    try {
      const parsedHabits = await analyzeHabitText(text);
      const now = new Date();
      const createdAt = now.toISOString();
      const newHabits: Habit[] = parsedHabits.map((habit) => ({
        id: crypto.randomUUID(),
        habit: habit.habit,
        type: habit.type,
        createdAt,
      }));

      await saveDailyRecord(dateKey, {
        habits: [...currentDayData.habits, ...newHabits],
        rawLogs: [
          ...currentDayData.rawLogs,
          {
            id: crypto.randomUUID(),
            time: formatLogTime(now),
            text,
            createdAt,
          },
        ],
      });

      setUserInput("");
      showStatus({
        type: "success",
        text: newHabits.length > 0 ? "审计已归档" : "已归档，未识别到明确习惯",
      });
    } catch (error) {
      showStatus({
        type: "error",
        text: error instanceof Error ? error.message : "分析失败，请稍后重试",
      });
    } finally {
      setIsAnalyzing(false);
    }
  };

  const toggleSpeechInput = () => {
    if (isListening) {
      recognitionRef.current?.stop();
      return;
    }

    const SpeechRecognitionConstructor = getSpeechRecognitionConstructor();

    if (!SpeechRecognitionConstructor) {
      showStatus({
        type: "error",
        text: "当前浏览器不支持语音输入，请使用 Chrome 或 Edge",
      });
      return;
    }

    const recognition = new SpeechRecognitionConstructor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "zh-CN";

    speechBaseTextRef.current = userInput.trimEnd();
    committedSpeechRef.current = "";

    recognition.onstart = () => {
      setIsListening(true);
      showStatus({ type: "info", text: "正在听你说话..." }, false);
    };

    recognition.onresult = (event) => {
      let interimText = "";

      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const transcript = result[0]?.transcript ?? "";

        if (result.isFinal) {
          committedSpeechRef.current = `${committedSpeechRef.current}${transcript}`;
        } else {
          interimText = `${interimText}${transcript}`;
        }
      }

      setUserInput(
        composeSpeechText(speechBaseTextRef.current, committedSpeechRef.current, interimText),
      );
    };

    recognition.onerror = (event) => {
      setIsListening(false);
      recognitionRef.current = null;
      showStatus({
        type: "error",
        text:
          event.error === "not-allowed" || event.error === "service-not-allowed"
            ? "麦克风权限被拒绝，请在浏览器里允许麦克风"
            : "语音输入失败，请再试一次",
      });
    };

    recognition.onend = () => {
      setIsListening(false);
      recognitionRef.current = null;
      showStatus({ type: "info", text: "语音输入已结束" });
    };

    recognitionRef.current = recognition;

    try {
      recognition.start();
    } catch {
      recognitionRef.current = null;
      setIsListening(false);
      showStatus({ type: "error", text: "语音输入启动失败，请再试一次" });
    }
  };

  const beginHabitAction = (habit: HabitView, type: HabitType) => {
    setActiveHabit({ habit, type });
    setTempHabitName(habit.habit);
  };

  const handlePointerDown = (event: React.PointerEvent, habit: HabitView, type: HabitType) => {
    startPos.current = { x: event.clientX, y: event.clientY };

    longPressTimer.current = window.setTimeout(() => {
      navigator.vibrate?.(40);
      beginHabitAction(habit, type);
      longPressTimer.current = null;
    }, 500);
  };

  const handlePointerMove = (event: React.PointerEvent) => {
    if (!longPressTimer.current) {
      return;
    }

    const moveX = Math.abs(event.clientX - startPos.current.x);
    const moveY = Math.abs(event.clientY - startPos.current.y);

    if (moveX > 10 || moveY > 10) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const cancelLongPress = () => {
    if (longPressTimer.current) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const confirmDelete = async () => {
    if (!activeHabit) {
      return;
    }

    const nextHabits = [...currentDayData.habits];
    const targetIndex = findHabitIndex(nextHabits, activeHabit.habit);

    if (targetIndex < 0) {
      showStatus({ type: "error", text: "没有找到要删除的习惯" });
      return;
    }

    nextHabits.splice(targetIndex, 1);
    await persistHabits(nextHabits);
    setShowDeleteConfirm(false);
    setActiveHabit(null);
    showStatus({ type: "success", text: "习惯已删除" });
  };

  const saveRename = async () => {
    if (!activeHabit) {
      return;
    }

    const name = tempHabitName.trim();
    if (!name) {
      return;
    }

    const targetIndex = findHabitIndex(currentDayData.habits, activeHabit.habit);

    if (targetIndex < 0) {
      showStatus({ type: "error", text: "没有找到要重命名的习惯" });
      return;
    }

    const nextHabits = currentDayData.habits.map((habit, index) =>
      index === targetIndex ? { ...habit, habit: name } : habit,
    );

    await persistHabits(nextHabits);
    setShowEditModal(false);
    setActiveHabit(null);
    showStatus({ type: "success", text: "习惯已更新" });
  };

  const copyActiveUid = async () => {
    if (!activeUid) {
      return;
    }

    try {
      await navigator.clipboard.writeText(activeUid);
      showStatus({ type: "info", text: "同步码已复制" });
    } catch {
      showStatus({ type: "error", text: "复制失败，请手动选择同步码" });
    }
  };

  const handleLogin = async () => {
    const isValid = await login(accountIdInput, passwordInput);

    if (!isValid) {
      showStatus({ type: "error", text: "账号或密码不正确" });
      return;
    }

    setPasswordInput("");
    setShowAccountModal(false);
    showStatus({ type: "success", text: "已进入 lin 的同步空间" });
  };

  const handleLogout = async () => {
    await logout();
    setPasswordInput("");
    setShowAccountModal(false);
    showStatus({ type: "info", text: "已退出账号" });
  };

  return (
    <div className="min-h-screen bg-slate-50 pb-28 text-slate-900">
      <nav className="sticky top-0 z-40 flex h-16 items-center justify-between border-b border-slate-100 bg-white/80 px-4 backdrop-blur-xl">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-lg shadow-indigo-200">
            <History size={18} />
          </div>
          <span className="hidden text-base font-black tracking-tight sm:block">习惯之镜</span>
        </div>

        <div className="flex items-center gap-2">
          {!isToday && (
            <button
              aria-label="回到今天"
              onClick={jumpToToday}
              className="rounded-xl bg-indigo-50 p-2 text-indigo-600"
            >
              <RotateCcw size={18} />
            </button>
          )}
          <button
            aria-label="账号与同步"
            onClick={() => {
              setAccountIdInput(accountId);
              setShowAccountModal(true);
            }}
            className="rounded-xl border border-slate-100 bg-white p-2 text-slate-600 shadow-sm"
          >
            <User size={18} />
          </button>
        </div>
      </nav>

      <main className="mx-auto max-w-lg space-y-7 px-4 py-6">
        {appError && (
          <div className="rounded-2xl border border-rose-100 bg-rose-50 p-4 text-sm font-semibold text-rose-700">
            {appError}
          </div>
        )}

        <MonthCalendar
          currentDate={currentDate}
          monthDays={monthDays}
          recordDateKeys={recordDateKeys}
          onSelectDate={setCurrentDate}
          onChangeDay={changeDay}
          onChangeMonth={changeMonth}
          onToday={jumpToToday}
        />

        {statusMsg && (
          <div
            className={`rounded-xl p-3 text-center text-[11px] font-black uppercase ${statusClassName[statusMsg.type]}`}
          >
            {statusMsg.text}
          </div>
        )}

        {!isAuthenticated ? (
          <section className="rounded-[1.75rem] border border-dashed border-slate-200 bg-white p-6 text-center shadow-sm">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-500">
              <Lock size={20} />
            </div>
            <h2 className="text-base font-black text-slate-800">进入个人同步空间</h2>
            <p className="mt-2 text-xs font-medium leading-relaxed text-slate-400">
              使用固定账号 lin 登录后，多端都会读取同一份记录。
            </p>
            <button
              onClick={() => {
                setAccountIdInput(accountId);
                setShowAccountModal(true);
              }}
              className="mt-5 min-h-11 rounded-xl bg-slate-900 px-6 text-xs font-black uppercase text-white shadow-lg shadow-slate-200"
            >
              登录
            </button>
          </section>
        ) : (
          <>
            <section className="rounded-[1.75rem] border border-slate-100 bg-white p-5 shadow-sm transition focus-within:ring-4 focus-within:ring-indigo-500/5">
              <textarea
                className="min-h-[116px] w-full resize-none border-none bg-transparent text-base font-medium leading-relaxed text-slate-700 outline-none placeholder:text-slate-300"
                placeholder="今天记录了什么？"
                value={userInput}
                onChange={(event) => setUserInput(event.target.value)}
              />
              <div className="mt-2 flex items-center justify-between border-t border-slate-50 pt-3">
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                    <Cloud size={12} className="text-emerald-400" />
                    {activeUid ? "lin 同步中" : "等待登录"}
                  </div>
                  <button
                    aria-label={isListening ? "停止语音输入" : "开始语音输入"}
                    title={isListening ? "停止语音输入" : "开始语音输入"}
                    onClick={toggleSpeechInput}
                    disabled={isAnalyzing}
                    className={`flex h-10 w-10 items-center justify-center rounded-xl transition ${
                      isListening
                        ? "bg-rose-50 text-rose-600 ring-4 ring-rose-500/10"
                        : "bg-indigo-50 text-indigo-600 hover:bg-indigo-100 disabled:bg-slate-50 disabled:text-slate-300"
                    }`}
                  >
                    {isListening ? <MicOff size={16} /> : <Mic size={16} />}
                  </button>
                </div>
                <button
                  onClick={analyzeHabits}
                  disabled={isAnalyzing || !userInput.trim() || !activeUid}
                  className="flex min-h-10 items-center gap-2 rounded-xl bg-slate-900 px-5 py-2 text-xs font-bold text-white shadow-xl shadow-slate-200 transition disabled:bg-slate-100 disabled:text-slate-300 disabled:shadow-none"
                >
                  {isAnalyzing ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                  分析审计
                </button>
              </div>
            </section>

            {isAppLoading ? (
              <div className="flex items-center justify-center gap-2 py-12 text-sm font-bold text-slate-400">
                <Loader2 size={18} className="animate-spin" />
                正在同步
              </div>
            ) : currentDayData.habits.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-slate-300">
                <Plus size={34} className="mb-2" />
                <p className="text-[11px] font-black uppercase tracking-widest">暂无习惯记录</p>
              </div>
            ) : (
              <div className="space-y-8">
                <HabitList
                  type="good"
                  title="好习惯"
                  icon={CheckCircle2}
                  colorClass="bg-emerald-400"
                  data={categorizedHabits.good}
                  collapsed={collapsed.good}
                  onToggle={() => setCollapsed((previous) => ({ ...previous, good: !previous.good }))}
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerEnd={cancelLongPress}
                  onAction={beginHabitAction}
                />
                <HabitList
                  type="bad"
                  title="待调整"
                  icon={XCircle}
                  colorClass="bg-rose-400"
                  data={categorizedHabits.bad}
                  collapsed={collapsed.bad}
                  onToggle={() => setCollapsed((previous) => ({ ...previous, bad: !previous.bad }))}
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerEnd={cancelLongPress}
                  onAction={beginHabitAction}
                />
              </div>
            )}

            {currentDayData.rawLogs.length > 0 && (
              <section className="space-y-2">
                <button
                  onClick={() => setShowRawLogs((previous) => !previous)}
                  className="flex w-full items-center justify-between rounded-2xl border border-slate-100 bg-white/70 px-4 py-3 text-slate-400 shadow-sm transition hover:bg-white hover:text-slate-600"
                >
                  <div className="flex items-center gap-2">
                    <FileText size={14} />
                    <span className="text-[11px] font-bold">原始记录 {currentDayData.rawLogs.length}</span>
                  </div>
                  {showRawLogs ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>
                {showRawLogs && (
                  <div className="space-y-3 rounded-2xl border border-slate-100 bg-white px-4 py-4">
                    {currentDayData.rawLogs.map((log, index) => (
                      <div
                        key={log.id ?? `${log.time}-${index}`}
                        className="border-l-2 border-slate-200 py-1 pl-3"
                      >
                        <div className="mb-1 font-mono text-[9px] font-bold uppercase text-slate-300">
                          {log.time}
                        </div>
                        <p className="text-xs leading-relaxed text-slate-500">{log.text}</p>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}
          </>
        )}
      </main>

      {activeHabit && !showEditModal && !showDeleteConfirm && (
        <ModalShell onClose={() => setActiveHabit(null)}>
          <div className="w-full max-w-xs space-y-3 rounded-[2rem] bg-white p-6 shadow-2xl">
            <div className="pb-2 text-center">
              <p className="mb-1 text-[10px] font-black uppercase tracking-widest text-slate-400">
                管理习惯
              </p>
              <p className="line-clamp-2 font-bold leading-tight text-slate-700">
                {activeHabit.habit.habit}
              </p>
            </div>
            <button
              onClick={() => setShowEditModal(true)}
              className="flex w-full items-center justify-center gap-3 rounded-2xl bg-slate-50 py-4 text-sm font-black text-slate-700 transition active:scale-95"
            >
              <Edit3 size={18} className="text-indigo-500" />
              重命名
            </button>
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="flex w-full items-center justify-center gap-3 rounded-2xl bg-rose-50 py-4 text-sm font-black text-rose-600 transition active:scale-95"
            >
              <Trash2 size={18} />
              删除习惯
            </button>
            <button
              onClick={() => setActiveHabit(null)}
              className="w-full py-3 text-xs font-bold text-slate-400"
            >
              取消
            </button>
          </div>
        </ModalShell>
      )}

      {showEditModal && (
        <ModalShell onClose={() => setShowEditModal(false)} layer="high">
          <div className="w-full max-w-sm space-y-6 rounded-[2rem] bg-white p-8 shadow-2xl">
            <h2 className="text-center text-lg font-black uppercase tracking-tight text-slate-900">
              重命名习惯
            </h2>
            <input
              autoFocus
              className="w-full rounded-2xl border-none bg-slate-50 p-4 text-base font-bold text-slate-700 outline-none focus:ring-4 focus:ring-indigo-500/10"
              value={tempHabitName}
              onChange={(event) => setTempHabitName(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && saveRename()}
            />
            <div className="flex gap-3">
              <button
                onClick={() => setShowEditModal(false)}
                className="min-h-12 flex-1 text-xs font-black uppercase text-slate-400"
              >
                取消
              </button>
              <button
                onClick={saveRename}
                className="min-h-12 flex-1 rounded-2xl bg-indigo-600 text-xs font-black uppercase text-white shadow-lg shadow-indigo-100"
              >
                保存
              </button>
            </div>
          </div>
        </ModalShell>
      )}

      {showDeleteConfirm && (
        <ModalShell onClose={() => setShowDeleteConfirm(false)} layer="high">
          <div className="w-full max-w-sm space-y-6 rounded-[2rem] bg-white p-8 text-center shadow-2xl">
            <div className="mx-auto mb-2 flex h-16 w-16 items-center justify-center rounded-full bg-rose-50 text-rose-500">
              <AlertCircle size={32} />
            </div>
            <div>
              <h2 className="text-lg font-black uppercase tracking-tight text-slate-900">
                确认删除？
              </h2>
              <p className="mt-1 text-xs font-medium text-slate-400">删除后无法恢复这条记录。</p>
            </div>
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="min-h-12 flex-1 text-xs font-black uppercase text-slate-400"
              >
                保留
              </button>
              <button
                onClick={confirmDelete}
                className="min-h-12 flex-1 rounded-2xl bg-rose-600 text-xs font-black uppercase text-white shadow-lg shadow-rose-100"
              >
                删除
              </button>
            </div>
          </div>
        </ModalShell>
      )}

      {showAccountModal && (
        <ModalShell onClose={() => setShowAccountModal(false)}>
          <div className="w-full max-w-sm space-y-5 rounded-[2rem] bg-white p-8 shadow-2xl">
            <h2 className="text-center text-lg font-black uppercase tracking-tight text-slate-900">
              {isAuthenticated ? "账号与同步" : "登录"}
            </h2>
            <div className="space-y-4">
              {isAuthenticated ? (
                <>
                  <div className="rounded-3xl bg-slate-50 p-5">
                    <label className="mb-2 block text-[10px] font-black uppercase tracking-widest text-slate-400">
                      当前账号
                    </label>
                    <div className="flex items-center gap-2">
                      <code className="min-w-0 flex-1 truncate rounded-xl border border-slate-100 bg-white p-3 font-mono text-[13px] font-black text-slate-700">
                        {activeUid ?? "未就绪"}
                      </code>
                      <button
                        aria-label="复制账号 ID"
                        onClick={copyActiveUid}
                        disabled={!activeUid}
                        className="rounded-xl bg-indigo-600 p-3 text-white disabled:bg-slate-200"
                      >
                        <Copy size={16} />
                      </button>
                    </div>
                  </div>

                  <button
                    onClick={handleLogout}
                    className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-rose-50 text-xs font-black uppercase text-rose-600"
                  >
                    <LogOut size={16} />
                    退出账号
                  </button>
                </>
              ) : (
                <div className="rounded-3xl bg-slate-50 p-5">
                  <label className="mb-2 block text-[10px] font-black uppercase tracking-widest text-slate-400">
                    账号 ID
                  </label>
                  <input
                    autoFocus
                    className="w-full rounded-xl border border-slate-100 bg-white p-3 text-sm font-semibold text-slate-700 outline-none focus:ring-4 focus:ring-indigo-500/10"
                    value={accountIdInput}
                    onChange={(event) => setAccountIdInput(event.target.value)}
                  />
                  <label className="mb-2 mt-4 block text-[10px] font-black uppercase tracking-widest text-slate-400">
                    密码
                  </label>
                  <input
                    type="password"
                    className="w-full rounded-xl border border-slate-100 bg-white p-3 text-sm font-semibold text-slate-700 outline-none focus:ring-4 focus:ring-indigo-500/10"
                    value={passwordInput}
                    onChange={(event) => setPasswordInput(event.target.value)}
                    onKeyDown={(event) => event.key === "Enter" && handleLogin()}
                  />
                  <button
                    onClick={handleLogin}
                    disabled={!accountIdInput.trim() || !passwordInput}
                    className="mt-4 min-h-11 w-full rounded-xl bg-slate-900 text-xs font-black uppercase text-white disabled:bg-slate-200"
                  >
                    进入同步空间
                  </button>
                </div>
              )}

              {isAuthenticated && (
                <p className="truncate text-center font-mono text-[10px] font-bold text-slate-300">
                  Supabase sync: {activeUid}
                </p>
              )}
            </div>
          </div>
        </ModalShell>
      )}

      <footer className="pointer-events-none fixed bottom-6 left-0 right-0 flex justify-center px-4">
        <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-slate-100 bg-white/85 px-5 py-2.5 shadow-xl backdrop-blur-md">
          <div className="h-1.5 w-1.5 rounded-full bg-indigo-500" />
          <span className="text-[9px] font-black uppercase tracking-[0.25em] text-slate-400">
            Habit Mirror Live
          </span>
        </div>
      </footer>
    </div>
  );
}

type MonthCalendarProps = {
  currentDate: Date;
  monthDays: Date[];
  recordDateKeys: Set<string>;
  onSelectDate: (date: Date) => void;
  onChangeDay: (days: number) => void;
  onChangeMonth: (months: number) => void;
  onToday: () => void;
};

const weekLabels = ["日", "一", "二", "三", "四", "五", "六"];

function MonthCalendar({
  currentDate,
  monthDays,
  recordDateKeys,
  onSelectDate,
  onChangeDay,
  onChangeMonth,
  onToday,
}: MonthCalendarProps) {
  return (
    <section className="rounded-[1.75rem] border border-slate-100 bg-white p-4 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
            <CalendarDays size={18} />
          </div>
          <div>
            <p className="text-base font-black text-slate-800">{formatMonthTitle(currentDate)}</p>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
              {formatWeekday(currentDate)} · {formatMonthDay(currentDate)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1 rounded-2xl bg-slate-100 p-1">
          <button
            aria-label="上个月"
            onClick={() => onChangeMonth(-1)}
            className="rounded-xl p-2 text-slate-500 transition hover:bg-white"
          >
            <ChevronLeft size={15} />
          </button>
          <button
            aria-label="下个月"
            onClick={() => onChangeMonth(1)}
            className="rounded-xl p-2 text-slate-500 transition hover:bg-white"
          >
            <ChevronRight size={15} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center">
        {weekLabels.map((label) => (
          <div key={label} className="py-1 text-[10px] font-black text-slate-300">
            {label}
          </div>
        ))}
        {monthDays.map((date) => {
          const dateKey = getDateKey(date);
          const selected = isSameDay(date, currentDate);
          const today = isSameDay(date, new Date());
          const inCurrentMonth = isSameMonth(date, currentDate);
          const hasRecord = recordDateKeys.has(dateKey);

          return (
            <button
              key={dateKey}
              onClick={() => onSelectDate(date)}
              className={`relative flex aspect-square min-h-10 flex-col items-center justify-center rounded-xl text-sm font-black tabular-nums transition ${
                selected
                  ? "bg-slate-900 text-white shadow-lg shadow-slate-200"
                  : inCurrentMonth
                    ? "text-slate-700 hover:bg-slate-50"
                    : "text-slate-300 hover:bg-slate-50"
              } ${today && !selected ? "ring-1 ring-indigo-200" : ""}`}
            >
              <span>{date.getDate()}</span>
              <span
                className={`mt-1 h-1.5 w-1.5 rounded-full ${
                  hasRecord
                    ? selected
                      ? "bg-white"
                      : "bg-indigo-500"
                    : "bg-transparent"
                }`}
              />
            </button>
          );
        })}
      </div>

      <div className="mt-4 flex items-center justify-between border-t border-slate-50 pt-3">
        <button
          aria-label="前一天"
          onClick={() => onChangeDay(-1)}
          className="rounded-xl bg-slate-50 p-2 text-slate-500"
        >
          <ChevronLeft size={16} />
        </button>
        <button
          onClick={onToday}
          className="min-h-9 rounded-xl px-4 text-[11px] font-black uppercase tracking-widest text-indigo-600 transition hover:bg-indigo-50"
        >
          回到今天
        </button>
        <button
          aria-label="后一天"
          onClick={() => onChangeDay(1)}
          className="rounded-xl bg-slate-50 p-2 text-slate-500"
        >
          <ChevronRight size={16} />
        </button>
      </div>
    </section>
  );
}

type HabitListProps = {
  type: HabitType;
  title: string;
  icon: LucideIcon;
  colorClass: string;
  data: HabitView[];
  collapsed: boolean;
  onToggle: () => void;
  onPointerDown: (event: React.PointerEvent, habit: HabitView, type: HabitType) => void;
  onPointerMove: (event: React.PointerEvent) => void;
  onPointerEnd: () => void;
  onAction: (habit: HabitView, type: HabitType) => void;
};

function HabitList({
  type,
  title,
  icon: Icon,
  colorClass,
  data,
  collapsed,
  onToggle,
  onPointerDown,
  onPointerMove,
  onPointerEnd,
  onAction,
}: HabitListProps) {
  if (data.length === 0) {
    return null;
  }

  return (
    <section className="space-y-3">
      <button
        onClick={onToggle}
        className="flex w-full items-center justify-between px-2"
      >
        <div className="flex items-center gap-2">
          <div className={`h-3 w-1 rounded-full ${colorClass}`} />
          <h2 className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">
            {title}
            <span className="opacity-50">({data.length})</span>
          </h2>
        </div>
        {collapsed ? (
          <ChevronDown size={14} className="text-slate-300" />
        ) : (
          <ChevronUp size={14} className="text-slate-300" />
        )}
      </button>

      {!collapsed && (
        <div className="space-y-2">
          {data.map((item) => (
            <div
              key={item.stableKey}
              onPointerDown={(event) => onPointerDown(event, item, type)}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerEnd}
              onPointerCancel={onPointerEnd}
              onPointerLeave={onPointerEnd}
              className="relative flex touch-pan-y select-none items-center gap-3 rounded-2xl border border-slate-100 bg-white px-4 py-3 transition active:scale-[0.99] active:bg-slate-50"
            >
              <div
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                  type === "good"
                    ? "bg-emerald-50 text-emerald-500"
                    : "bg-rose-50 text-rose-500"
                }`}
              >
                <Icon size={19} />
              </div>
              <p className="min-w-0 flex-1 truncate text-sm font-bold text-slate-700">
                {item.habit}
              </p>
              <button
                aria-label="管理习惯"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => onAction(item, type)}
                className="rounded-xl p-2 text-slate-300 transition hover:bg-slate-50 hover:text-slate-500"
              >
                <MoreVertical size={17} />
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

type ModalShellProps = {
  children: React.ReactNode;
  onClose: () => void;
  layer?: "default" | "high";
};

function ModalShell({ children, onClose, layer = "default" }: ModalShellProps) {
  return (
    <div
      className={`fixed inset-0 flex items-center justify-center bg-slate-900/50 p-6 backdrop-blur-sm ${
        layer === "high" ? "z-[60]" : "z-50"
      }`}
      onClick={onClose}
    >
      <div onClick={(event) => event.stopPropagation()}>{children}</div>
    </div>
  );
}
