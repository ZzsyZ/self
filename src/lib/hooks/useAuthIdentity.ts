"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { User } from "firebase/auth";
import { onAuthStateChanged, signInAnonymously } from "firebase/auth";
import { auth, isFirebaseConfigured } from "@/lib/firebase";

export const FIXED_ACCOUNT_ID = "lin";
const FIXED_ACCOUNT_PASSWORD = "123456";
const AUTHENTICATED_KEY = "habit_mirror_authenticated";
const authStoreListeners = new Set<() => void>();

function readStoredAuthentication() {
  try {
    return window.localStorage.getItem(AUTHENTICATED_KEY) === "true";
  } catch {
    return false;
  }
}

function writeStoredAuthentication(isAuthenticated: boolean) {
  try {
    if (isAuthenticated) {
      window.localStorage.setItem(AUTHENTICATED_KEY, "true");
      notifyStoredAuthenticationChanged();
      return;
    }

    window.localStorage.removeItem(AUTHENTICATED_KEY);
    notifyStoredAuthenticationChanged();
  } catch {
    // Some embedded browsers disable storage. Keep the in-memory session usable.
  }
}

function notifyStoredAuthenticationChanged() {
  authStoreListeners.forEach((listener) => listener());
}

function subscribeStoredAuthentication(listener: () => void) {
  authStoreListeners.add(listener);
  window.addEventListener("storage", listener);

  return () => {
    authStoreListeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

export function useAuthIdentity() {
  const [user, setUser] = useState<User | null>(null);
  const isAuthenticated = useSyncExternalStore(
    subscribeStoredAuthentication,
    readStoredAuthentication,
    () => false,
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

    writeStoredAuthentication(true);
    return true;
  }, []);

  const logout = useCallback(() => {
    writeStoredAuthentication(false);
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
