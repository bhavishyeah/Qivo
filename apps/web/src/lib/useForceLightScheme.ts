// Respondent surfaces (public form, builder preview) are light-only. While one
// is mounted, force data-color-scheme="light" on <html> and restore the
// previous value on unmount so the app chrome keeps its dark mode.

import { useLayoutEffect } from "react";

export function useForceLightScheme(): void {
  useLayoutEffect(() => {
    const root = document.documentElement;
    const previous = root.dataset.colorScheme;
    root.dataset.colorScheme = "light";
    return () => {
      if (previous === undefined) delete root.dataset.colorScheme;
      else root.dataset.colorScheme = previous;
    };
  }, []);
}
