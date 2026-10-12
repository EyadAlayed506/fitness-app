import { createContext, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Appearance, Platform } from "react-native";

import { storage } from "./storage";

export type AppearancePreference = "system" | "light" | "dark";

const KEY = "appearance";
const isPreference = (v: unknown): v is AppearancePreference => v === "system" || v === "light" || v === "dark";

export const AppearanceContext = createContext<{
  preference: AppearancePreference;
  setPreference: (p: AppearancePreference) => void;
}>({ preference: "system", setPreference: () => {} });

/** Light or dark mode: follow the phone (default), or the user's choice, remembered on this device. */
export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [preference, setState] = useState<AppearancePreference>("system");

  const apply = useCallback((p: AppearancePreference) => {
    // Phones: also switch native parts (keyboard, alerts, switches) to the same mode
    if (Platform.OS !== "web") Appearance.setColorScheme?.(p === "system" ? "unspecified" : p);
  }, []);

  useEffect(() => {
    storage
      .get(KEY)
      .then((saved) => {
        if (isPreference(saved)) {
          setState(saved);
          apply(saved);
        }
      })
      .catch(() => {});
  }, [apply]);

  const setPreference = useCallback(
    (p: AppearancePreference) => {
      setState(p);
      apply(p);
      storage.set(KEY, p).catch(() => {});
    },
    [apply],
  );

  const value = useMemo(() => ({ preference, setPreference }), [preference, setPreference]);
  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}
