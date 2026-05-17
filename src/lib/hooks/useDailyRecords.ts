"use client";

import { useCallback, useEffect, useState } from "react";
import { collection, doc, onSnapshot, setDoc } from "firebase/firestore";
import { APP_ID, type DailyRecord } from "@/lib/types";
import { db, isFirebaseConfigured } from "@/lib/firebase";
import { normalizeDailyRecord } from "@/lib/habits";

type DailyRecordMap = Record<string, DailyRecord>;
const SAVE_TIMEOUT_MS = 8000;

export function useDailyRecords(activeUid: string | null) {
  const [records, setRecords] = useState<DailyRecordMap>({});
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(
    isFirebaseConfigured ? null : "Firebase 数据库未配置。",
  );

  useEffect(() => {
    if (!isFirebaseConfigured || !db) {
      return;
    }

    if (!activeUid) {
      return;
    }

    const recordsRef = collection(
      db,
      "artifacts",
      APP_ID,
      "users",
      activeUid,
      "dailyRecords",
    );

    const unsubscribe = onSnapshot(
      recordsRef,
      (snapshot) => {
        const fetched: DailyRecordMap = {};
        snapshot.forEach((recordDoc) => {
          fetched[recordDoc.id] = normalizeDailyRecord(recordDoc.data());
        });
        setRecords(fetched);
        setError(null);
        setIsLoading(false);
      },
      () => {
        setError("读取同步数据失败，请检查 Firestore 规则或网络。");
        setIsLoading(false);
      },
    );

    return () => unsubscribe();
  }, [activeUid]);

  const saveDailyRecord = useCallback(
    async (dateKey: string, record: DailyRecord) => {
      if (!activeUid || !db) {
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
          setDoc(
            doc(db, "artifacts", APP_ID, "users", activeUid, "dailyRecords", dateKey),
            nextRecord,
            { merge: true },
          ),
          SAVE_TIMEOUT_MS,
          "保存到云端超时，请检查 Firestore 网络或规则。",
        );
      } catch (saveError) {
        const message =
          saveError instanceof Error
            ? saveError.message
            : "保存到云端失败，请检查 Firestore 网络或规则。";
        setError(message);
        throw new Error(message);
      }
    },
    [activeUid],
  );

  return {
    records: activeUid ? records : {},
    isLoading: activeUid ? isLoading : false,
    error,
    saveDailyRecord,
  };
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
