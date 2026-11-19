import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { computeMenuPosition, nextMenuIndex, type MenuKey } from "../lib/menuNav";
import type { QuestionType } from "../types";
import { CaretIcon, QuestionTypeIcon } from "./questionIcons";

type QuestionTypeSelectProps = {
  value: QuestionType;
  /** Types offered in the list, in display order. */
  types: QuestionType[];
  labels: Record<QuestionType, string>;
  onChange: (type: QuestionType) => void;
};

export default function QuestionTypeSelect({ value, types, labels, onChange }: QuestionTypeSelectProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    setPos(null);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  const reposition = useCallback(() => {
    const trigger = triggerRef.current;
    const list = listRef.current;
    if (!trigger || !list) return;
    const next = computeMenuPosition(
      trigger.getBoundingClientRect(),
      { width: list.offsetWidth, height: list.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight },
    );
    setPos({ top: next.top, left: next.left });
  }, []);

  // Position before paint, then focus the selected option.
  useLayoutEffect(() => {
    if (!open) return;
    reposition();
    const options = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? []);
    (options.find((el) => el.getAttribute("aria-selected") === "true") ?? options[0])?.focus();
  }, [open, reposition]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (listRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open, close, reposition]);

  function options(): HTMLElement[] {
    return Array.from(listRef.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? []);
  }

  function onListKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      close(true);
      return;
    }
    if (event.key === "Tab") {
      close(false);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const els = options();
      const current = els.findIndex((el) => el === document.activeElement);
      els[nextMenuIndex(current, event.key as MenuKey, els.length)]?.focus();
    }
  }

  function choose(type: QuestionType) {
    close(true);
    if (type !== value) onChange(type);
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="question-type-select"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={`Question type: ${labels[value]}`}
        onClick={(e) => {
          e.stopPropagation();
          if (open) close(false);
          else setOpen(true);
        }}
        onKeyDown={(e) => {
          if ((e.key === "ArrowDown" || e.key === "ArrowUp") && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span className="question-type-select-icon"><QuestionTypeIcon type={value} /></span>
        <span className="question-type-select-label">{labels[value]}</span>
        <CaretIcon size={16} />
      </button>

      {open
        ? createPortal(
            <div
              ref={listRef}
              id={listId}
              role="listbox"
              aria-label="Question type"
              className="popover-menu question-type-list"
              style={{
                position: "fixed",
                top: pos?.top ?? 0,
                left: pos?.left ?? 0,
                visibility: pos ? "visible" : "hidden",
              }}
              onKeyDown={onListKeyDown}
            >
              {types.map((type) => (
                <div
                  key={type}
                  role="option"
                  tabIndex={-1}
                  aria-selected={type === value}
                  className={`popover-menu-item${type === value ? " is-selected" : ""}`}
                  onClick={() => choose(type)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      choose(type);
                    }
                  }}
                >
                  <span className="popover-menu-icon" aria-hidden="true"><QuestionTypeIcon type={type} /></span>
                  <span>{labels[type]}</span>
                </div>
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
