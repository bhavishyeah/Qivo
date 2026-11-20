import { useEffect, type RefObject } from "react";

/**
 * Scroll reveal for the landing page. Marks the root `data-motion="on"` only when
 * IntersectionObserver exists and reduced motion is not requested; then each `.reveal`
 * element gets `.is-in` once it enters the viewport. Otherwise everything stays visible.
 */
export function useReveal(rootRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof IntersectionObserver === "undefined" || typeof window.matchMedia !== "function") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const targets = Array.from(root.querySelectorAll<HTMLElement>(".reveal"));
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add("is-in");
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.05 },
    );
    root.dataset.motion = "on";
    targets.forEach((el) => observer.observe(el));
    return () => {
      observer.disconnect();
      delete root.dataset.motion;
    };
  }, [rootRef]);
}
