import { afterEach, describe, expect, it, vi } from "vitest";
import { createLeaveDelay } from "./editorSelection";

describe("createLeaveDelay", () => {
  afterEach(() => vi.useRealTimers());
  it("runs the action after the delay", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    createLeaveDelay(fn, 150).schedule();
    vi.advanceTimersByTime(149);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it("cancel stops a pending run (pointer re-entered the toolbar)", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const d = createLeaveDelay(fn, 150);
    d.schedule();
    d.cancel();
    vi.advanceTimersByTime(500);
    expect(fn).not.toHaveBeenCalled();
  });
  it("re-scheduling restarts the timer", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const d = createLeaveDelay(fn, 150);
    d.schedule();
    vi.advanceTimersByTime(100);
    d.schedule();
    vi.advanceTimersByTime(100);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(50);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
