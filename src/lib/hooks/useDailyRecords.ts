"use client";

import { useCallback, useEffect, useState } from "react";
import { type DailyRecord } from "@/lib/types";
import { normalizeDailyRecord } from "@/lib/habits";

type DailyRecordMap = Record<string, DailyRecord>;
const SAVE_TIMEOUT_MS = 8000;

type RecordsResponse = {
  records?: DailyRecordMap;
  record?: DailyRecord;
  error?: string;
};

export function useDailyRecords(activeUid: string | null) {
  const [records, setRecords] = useState<DailyRecordMap>({});
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!activeUid) {
      return;
    }

    const controller = new AbortController();

    async function loadRecords() {
      try {
        await Promise.resolve();
        if (controller.signal.aborted) {
          return;
        }

        setIsLoading(true);
        const response = await fetch("/api/records", {
          method: "GET",
          signal: controller.signal,
        });
        const payload = (await response.json().catch(() => null)) as RecordsResponse | null;

        if (!response.ok) {
          throw new Error(payload?.error ?? "读取同步数据失败，请检查 Supabase 配置或网络。");
        }

        setRecords(normalizeRecordMap(payload?.records));
        setError(null);
      } catch (loadError) {
        if (loadError instanceof DOMException && loadError.name === "AbortError") {
          return;
        }

        setError(
          loadError instanceof Error
            ? loadError.message
            : "读取同步数据失败，请检查 Supabase 配置或网络。",
        );
      } finally {
        setIsLoading(false);
      }
    }

    loadRecords();

    return () => controller.abort();
  }, [activeUid]);

  const saveDailyRecord = useCallback(
    async (dateKey: string, record: DailyRecord) => {
      if (!activeUid) {
        throw new Error("同步身份尚未就绪");
      }

      const nextRecord = normalizeDailyRecord(record);
      setRecords((previous) => ({
        ...previous,
        [dateKey]: nextRecord,
      }));
      setError(null);

      try {
        await withTimeout(
          saveRecord(dateKey, nextRecord),
          SAVE_TIMEOUT_MS,
          "保存到云端超时，请检查 Supabase 网络或配置。",
        );
      } catch (saveError) {
        const message =
          saveError instanceof Error
            ? saveError.message
            : "保存到云端失败，请检查 Supabase 网络或配置。";
        setError(message);
        throw new Error(message);
      }
    },
    [activeUid],
  );

  return {
    records: activeUid ? records : {},
    isLoading: activeUid ? isLoading : false,
    error: activeUid ? error : null,
    saveDailyRecord,
  };
}

async function saveRecord(dateKey: string, record: DailyRecord) {
  const response = await fetch(`/api/records/${encodeURIComponent(dateKey)}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(record),
  });
  const payload = (await response.json().catch(() => null)) as RecordsResponse | null;

  if (!response.ok) {
    throw new Error(payload?.error ?? "保存到云端失败，请检查 Supabase 网络或配置。");
  }
}

function normalizeRecordMap(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(input).map(([dateKey, record]) => [
      dateKey,
      normalizeDailyRecord(record as Partial<DailyRecord>),
    ]),
  );
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string) {
  let timeoutId: ReturnType<typeof setTimeout>;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  promise.catch(() => undefined);

  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timeoutId);
  });
}
