import { useCallback, useEffect, useState } from "react";
import {
  applyScheme,
  getThemePreference,
  resolvePreference,
  setThemePreference,
  type ThemePreference,
} from "./colorScheme";

/**
 * Appearance preference for the app chrome. `applyEnabled` is false on
 * respondent-like routes (builder preview) that must stay light; the choice is
 * still stored there but not applied to the page.
 */
export function useThemePreference(applyEnabled: boolean): [ThemePreference, (pref: ThemePreference) => void] {
  const [pref, setPrefState] = useState<ThemePreference>(getThemePreference);

  const setPref = useCallback(
    (next: ThemePreference) => {
      setThemePreference(next);
      setPrefState(next);
      if (applyEnabled) applyScheme(resolvePreference(next));
    },
    [applyEnabled],
  );

  // In system mode, follow OS changes.
  useEffect(() => {
    if (pref !== "system" || !applyEnabled || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyScheme(resolvePreference("system"));
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [pref, applyEnabled]);

  return [pref, setPref];
}