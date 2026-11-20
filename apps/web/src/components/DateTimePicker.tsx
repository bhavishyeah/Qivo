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
import { DayPicker } from "react-day-picker";
import "react-day-picker/style.css";
import { computeMenuPosition } from "../lib/menuNav";
import {
  clampToMin,
  dateToParts,
  formatDisplay,
  formatLocalValue,
  parseLocalValue,
  partsToDate,
  stepMinute,
  to12Hour,
  to24Hour,
  wrapStep,
  type LocalParts,
} from "../lib/dateTimeValue";

const SHEET_QUERY = "(max-width: 520px)";
const DEFAULT_HOUR = 9;

export type DateTimePickerProps = {
  /** "YYYY-MM-DDTHH:mm" local wall-clock (what datetime-local produced), or "". */
  value: string;
  onChange: (value: string) => void;
  /** Earliest allowed value, same format. Earlier days are disabled. */
  min?: string;
  /** Id for the trigger so an external <label htmlFor> works. */
  id?: string;
  "aria-label"?: string;
  placeholder?: string;
  disabled?: boolean;
};

function CalendarIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4.5" width="18" height="16" rx="2.5" />
      <path d="M3 9.5h18M8 2.5v4M16 2.5v4" />
    </svg>
  );
}

function Stepper({
  label,
  display,
  onStep,
  disabled,
}: {
  label: string;
  display: string;
  onStep: (direction: 1 | -1) => void;
  disabled?: boolean;
}) {
  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowUp") {
      event.preventDefault();
      onStep(1);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      onStep(-1);
    }
  }
  return (
    <div className="dtp-stepper">
      <button type="button" className="dtp-step-btn" tabIndex={-1} aria-label={`Increase ${label.toLowerCase()}`} disabled={disabled} onClick={() => onStep(1)}>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m2.5 7.5 3.5-3.5 3.5 3.5" /></svg>
      </button>
      <div
        className="dtp-step-value"
        role="spinbutton"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-valuetext={display}
        aria-valuenow={Number(display)}
        onKeyDown={onKeyDown}
      >
        {display}
      </div>
      <button type="button" className="dtp-step-btn" tabIndex={-1} aria-label={`Decrease ${label.toLowerCase()}`} disabled={disabled} onClick={() => onStep(-1)}>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m2.5 4.5 3.5 3.5 3.5-3.5" /></svg>
      </button>
    </div>
  );
}

/**
 * Themed replacement for <input type="datetime-local">. The value format is the
 * same "YYYY-MM-DDTHH:mm" local string, so the save code is unchanged. The
 * native browser popup cannot be styled; this renders react-day-picker plus a
 * hour / minute / AM-PM control in a portal popover (bottom sheet on phones).
 */
export default function DateTimePicker({
  value,
  onChange,
  min,
  id,
  "aria-label": ariaLabel,
  placeholder = "Select date and time",
  disabled = false,
}: DateTimePickerProps) {
  const [open, setOpen] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [month, setMonth] = useState<Date>(() => new Date());
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  const parsed = parseLocalValue(value);
  const minParts = parseLocalValue(min);
  const minDate = minParts ? partsToDate(minParts) : undefined;
  // Time shown in the controls: the value's, or a sensible default when empty.
  const hour24 = parsed?.hour ?? DEFAULT_HOUR;
  const minute = parsed?.minute ?? 0;
  const time12 = to12Hour(hour24);

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    setPos(null);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  const reposition = useCallback(() => {
    const trigger = triggerRef.current;
    const panel = panelRef.current;
    if (!trigger || !panel || panel.dataset.sheet === "true") return;
    const next = computeMenuPosition(
      trigger.getBoundingClientRect(),
      { width: panel.offsetWidth, height: panel.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight },
    );
    setPos({ top: next.top, left: next.left });
  }, []);

  function openPicker() {
    if (disabled) return;
    setSheet(typeof window.matchMedia === "function" && window.matchMedia(SHEET_QUERY).matches);
    setMonth(parsed ? partsToDate(parsed) : (minDate ?? new Date()));
    setOpen(true);
  }

  // Position before paint, then move focus into the calendar.
  useLayoutEffect(() => {
    if (!open) return;
    reposition();
    const target =
      panelRef.current?.querySelector<HTMLElement>('.rdp-day_button[tabindex="0"]') ??
      panelRef.current?.querySelector<HTMLElement>("button");
    target?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once per open
  }, [open]);

  // Month navigation changes the panel height; keep it inside the viewport.
  useLayoutEffect(() => {
    if (open) reposition();
  }, [open, month, reposition]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close(false);
    }
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open, close, reposition]);

  function commit(parts: LocalParts) {
    onChange(clampToMin(formatLocalValue(parts), min && minParts ? min : undefined));
  }

  function selectDay(day: Date | undefined) {
    if (!day) return;
    commit(dateToParts(day, hour24, minute));
  }

  function setTime(nextHour24: number, nextMinute: number) {
    const base = parsed ?? dateToParts(minDate ?? new Date(), nextHour24, nextMinute);
    commit({ ...base, hour: nextHour24, minute: nextMinute });
  }

  function pickToday() {
    const today = new Date();
    setMonth(today);
    commit(dateToParts(today, hour24, minute));
  }

  function onPanelKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
      return;
    }
    if (event.key === "Tab") {
      // Keep Tab inside the dialog while it is open.
      const focusables = Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled):not([tabindex="-1"]), [tabindex="0"]',
        ) ?? [],
      );
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
  }

  const display = formatDisplay(value);

  return (
    <>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        className="select-trigger is-full dtp-trigger"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={ariaLabel ? `${ariaLabel}: ${display || placeholder}` : undefined}
        onClick={() => (open ? close(false) : openPicker())}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open && !disabled) {
            e.preventDefault();
            openPicker();
          }
        }}
      >
        <span className={`select-trigger-text dtp-trigger-text${display ? "" : " is-placeholder"}`}>
          {display || placeholder}
        </span>
        <CalendarIcon />
      </button>

      {open
        ? createPortal(
            <div className="app-root">
              {sheet ? <div className="select-backdrop" aria-hidden="true" /> : null}
              <div
                ref={panelRef}
                id={panelId}
                role="dialog"
                aria-label={ariaLabel ? `${ariaLabel}, choose date and time` : "Choose date and time"}
                data-sheet={sheet ? "true" : undefined}
                className={`popover-menu dtp-panel${sheet ? " is-sheet" : ""}`}
                style={{
                  position: "fixed",
                  ...(sheet ? {} : { top: pos?.top ?? 0, left: pos?.left ?? 0 }),
                  visibility: pos || sheet ? "visible" : "hidden",
                }}
                onKeyDown={onPanelKeyDown}
              >
                <DayPicker
                  mode="single"
                  selected={parsed ? partsToDate(parsed) : undefined}
                  onSelect={selectDay}
                  month={month}
                  onMonthChange={setMonth}
                  disabled={minDate ? { before: minDate } : undefined}
                  showOutsideDays
                  fixedWeeks
                  className="dtp-calendar"
                />
                <div className="dtp-time" role="group" aria-label="Time">
                  <span className="dtp-time-label" aria-hidden="true">Time</span>
                  <Stepper
                    label="Hour"
                    display={String(time12.hour)}
                    onStep={(dir) => setTime(to24Hour(wrapStep(time12.hour, dir, 1, 12), time12.period), minute)}
                  />
                  <span className="dtp-time-colon" aria-hidden="true">:</span>
                  <Stepper
                    label="Minute"
                    display={String(minute).padStart(2, "0")}
                    onStep={(dir) => setTime(hour24, stepMinute(minute, dir))}
                  />
                  <div className="dtp-period" role="group" aria-label="AM or PM">
                    {(["AM", "PM"] as const).map((p) => (
                      <button
                        key={p}
                        type="button"
                        className="dtp-period-btn"
                        aria-pressed={time12.period === p}
                        onClick={() => setTime(to24Hour(time12.hour, p), minute)}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="dtp-footer">
                  <button
                    type="button"
                    className="dtp-link-btn"
                    onClick={() => {
                      onChange("");
                      close(true);
                    }}
                  >
                    Clear
                  </button>
                  <button type="button" className="dtp-link-btn" onClick={pickToday}>
                    Today
                  </button>
                  <button type="button" className="dtp-done" onClick={() => close(true)}>
                    Done
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}