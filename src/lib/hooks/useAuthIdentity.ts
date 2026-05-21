"use client";

import { useCallback, useEffect, useState } from "react";

export const FIXED_ACCOUNT_ID = "lin";

type SessionResponse = {
  isAuthenticated?: boolean;
  accountId?: string;
  error?: string;
};

export function useAuthIdentity() {
  const [accountId, setAccountId] = useState(FIXED_ACCOUNT_ID);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadSession() {
      try {
        const session = await requestSession("/api/session", { method: "GET" });

        if (cancelled) {
          return;
        }

        setAccountId(session.accountId ?? FIXED_ACCOUNT_ID);
        setIsAuthenticated(Boolean(session.isAuthenticated));
        setError(null);
      } catch (sessionError) {
        if (!cancelled) {
          setError(
            sessionError instanceof Error
              ? sessionError.message
              : "读取登录状态失败，请检查同步服务配置。",
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    loadSession();

    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (nextAccountId: string, password: string) => {
    try {
      const session = await requestSession("/api/session", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ accountId: nextAccountId, password }),
      });

      setAccountId(session.accountId ?? nextAccountId.trim());
      setIsAuthenticated(Boolean(session.isAuthenticated));
      setError(null);
      return Boolean(session.isAuthenticated);
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "登录失败，请稍后重试。");
      return false;
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      const session = await requestSession("/api/session", { method: "DELETE" });
      setAccountId(session.accountId ?? FIXED_ACCOUNT_ID);
      setError(null);
    } catch (logoutError) {
      setError(logoutError instanceof Error ? logoutError.message : "退出失败，请稍后重试。");
    } finally {
      setIsAuthenticated(false);
    }
  }, []);

  return {
    activeUid: isAuthenticated ? accountId : null,
    accountId,
    isAuthenticated,
    isLoading,
    error,
    login,
    logout,
  };
}

async function requestSession(url: string, init: RequestInit) {
  const response = await fetch(url, init);
  const payload = (await response.json().catch(() => null)) as SessionResponse | null;

  if (!response.ok) {
    throw new Error(payload?.error ?? "同步服务请求失败，请稍后重试。");
  }

  return payload ?? {};
}
