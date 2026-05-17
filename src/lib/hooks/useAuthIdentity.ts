"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";
import { onAuthStateChanged, signInAnonymously } from "firebase/auth";
import { auth, isFirebaseConfigured } from "@/lib/firebase";

export const FIXED_ACCOUNT_ID = "lin";
const FIXED_ACCOUNT_PASSWORD = "123456";
const AUTHENTICATED_KEY = "habit_mirror_authenticated";

export function useAuthIdentity() {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(() =>
    typeof window === "undefined"
      ? false
      : window.localStorage.getItem(AUTHENTICATED_KEY) === "true",
  );
  const [isLoading, setIsLoading] = useState(isFirebaseConfigured);
  const [error, setError] = useState<string | null>(
    isFirebaseConfigured ? null : "Firebase 配置未填写，请先设置 .env.local。",
  );

  useEffect(() => {
    if (!isFirebaseConfigured || !auth) {
      return;
    }

    let cancelled = false;
    const firebaseAuth = auth;

    const unsubscribe = onAuthStateChanged(firebaseAuth, async (nextUser) => {
      if (cancelled) {
        return;
      }

      setUser(nextUser);

      if (nextUser) {
        setIsLoading(false);
        return;
      }

      try {
        await signInAnonymously(firebaseAuth);
      } catch {
        if (!cancelled) {
          setError("匿名登录失败，请检查 Firebase Auth 配置。");
          setIsLoading(false);
        }
      }
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const login = useCallback((accountId: string, password: string) => {
    if (accountId.trim() !== FIXED_ACCOUNT_ID || password !== FIXED_ACCOUNT_PASSWORD) {
      return false;
    }

    setIsAuthenticated(true);
    window.localStorage.setItem(AUTHENTICATED_KEY, "true");
    return true;
  }, []);

  const logout = useCallback(() => {
    setIsAuthenticated(false);
    window.localStorage.removeItem(AUTHENTICATED_KEY);
  }, []);

  const activeUid = useMemo(
    () => (isAuthenticated ? FIXED_ACCOUNT_ID : null),
    [isAuthenticated],
  );

  return {
    user,
    firebaseUid: user?.uid ?? null,
    activeUid,
    accountId: FIXED_ACCOUNT_ID,
    isAuthenticated,
    isLoading,
    error,
    login,
    logout,
  };
}
