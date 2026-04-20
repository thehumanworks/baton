import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { AppPreferences } from "@shared/preferences-types";
import type { ShellDescriptorDTO } from "@shared/terminal-types";
import { DEFAULT_PREFERENCES } from "@shared/preferences-types";
import { useTerminalClient } from "./terminalContext";

interface PreferencesContextValue {
  preferences: AppPreferences;
  shells: readonly ShellDescriptorDTO[];
  backendDefaultShellId: string;
  wasFreshlyCreated: boolean;
  setPreferences: (next: AppPreferences) => Promise<void>;
  ready: boolean;
}

const PreferencesContext = createContext<PreferencesContextValue | null>(null);

export function PreferencesProvider(props: { children: ReactNode }) {
  const client = useTerminalClient();
  const [preferences, setPrefsState] = useState<AppPreferences>(DEFAULT_PREFERENCES);
  const [shells, setShells] = useState<readonly ShellDescriptorDTO[]>([]);
  const [backendDefaultShellId, setBackendDefault] = useState("auto");
  const [wasFreshlyCreated, setWasFreshlyCreated] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      const list = await client.listShells();
      if (cancelled) return;
      setShells(list.shells);
      setBackendDefault(list.defaultShellId);

      const bridge = window.baton?.preferences;
      if (bridge) {
        const [prefs, freshly] = await Promise.all([
          bridge.get(),
          bridge.wasFreshlyCreated(),
        ]);
        if (cancelled) return;
        setPrefsState(prefs);
        setWasFreshlyCreated(freshly);
      }

      setReady(true);
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [client]);

  const setPreferences = useCallback(async (next: AppPreferences) => {
    const bridge = window.baton?.preferences;
    const saved = bridge ? await bridge.set(next) : next;
    setPrefsState(saved);
    setWasFreshlyCreated(false);
  }, []);

  const value = useMemo<PreferencesContextValue>(
    () => ({
      preferences,
      shells,
      backendDefaultShellId,
      wasFreshlyCreated,
      setPreferences,
      ready,
    }),
    [preferences, shells, backendDefaultShellId, wasFreshlyCreated, setPreferences, ready],
  );

  return (
    <PreferencesContext.Provider value={value}>
      {props.children}
    </PreferencesContext.Provider>
  );
}

export function usePreferences(): PreferencesContextValue {
  const value = useContext(PreferencesContext);
  if (!value) throw new Error("usePreferences used outside PreferencesProvider");
  return value;
}
