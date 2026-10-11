import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { api, server, setToken, setUnauthorizedHandler } from "./api";
import { storage } from "./storage";
import type { Plan, Profile, User } from "./types";

const TOKEN_KEY = "token";

interface AuthState {
  ready: boolean;
  token: string | null;
  user: User | null;
  profile: Profile | null;
  plan: Plan | null;
  login(email: string, password: string): Promise<void>;
  signup(email: string, password: string, marketing: boolean): Promise<void>;
  logout(): Promise<void>;
  /** Reload user, profile and plan (after changing the profile or logging weight). */
  refresh(): Promise<void>;
  setUser(user: User): void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [token, setTokenState] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);

  const clear = useCallback(async () => {
    setToken(null);
    setTokenState(null);
    setUser(null);
    setProfile(null);
    setPlan(null);
    await storage.remove(TOKEN_KEY);
  }, []);

  const refresh = useCallback(async () => {
    const me = await api<User>("/me");
    setUser(me);
    if (me.has_profile) {
      const [p, pl] = await Promise.all([api<Profile>("/me/profile"), api<Plan>("/me/plan")]);
      setProfile(p);
      setPlan(pl);
    } else {
      setProfile(null);
      setPlan(null);
    }
  }, []);

  const applyToken = useCallback(
    async (value: string) => {
      setToken(value);
      await storage.set(TOKEN_KEY, value);
      await refresh();
      setTokenState(value);
    },
    [refresh],
  );

  // On start: restore the server address and a saved login
  useEffect(() => {
    setUnauthorizedHandler(() => void clear());
    (async () => {
      await server.load();
      const saved = await storage.get(TOKEN_KEY);
      if (saved) {
        try {
          await applyToken(saved);
        } catch {
          await clear();
        }
      }
      setReady(true);
    })();
  }, [clear, applyToken]);

  const value = useMemo<AuthState>(
    () => ({
      ready,
      token,
      user,
      profile,
      plan,
      async login(email, password) {
        const res = await api<{ access_token: string }>("/auth/login", {
          method: "POST",
          form: { username: email.trim(), password },
        });
        await applyToken(res.access_token);
      },
      async signup(email, password, marketing) {
        await api("/auth/signup", {
          method: "POST",
          body: { email: email.trim(), password, marketing_opt_in: marketing },
        });
        const res = await api<{ access_token: string }>("/auth/login", {
          method: "POST",
          form: { username: email.trim(), password },
        });
        await applyToken(res.access_token);
      },
      logout: clear,
      refresh,
      setUser,
    }),
    [ready, token, user, profile, plan, applyToken, clear, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

/** For screens inside the tabs, where a profile always exists. */
export function useProfile() {
  const { profile, plan } = useAuth();
  return { profile: profile!, plan: plan! };
}
