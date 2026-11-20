// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DateTimePicker from "./DateTimePicker";

afterEach(cleanup);

function Harness({ initial = "", min }: { initial?: string; min?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <label htmlFor="when">When</label>
      <DateTimePicker id="when" value={value} onChange={setValue} {...(min ? { min } : {})} />
      <output data-testid="raw">{value}</output>
    </>
  );
}

describe("DateTimePicker", () => {
  it("shows the placeholder, then the formatted value", () => {
    const { rerender } = render(<DateTimePicker id="x" value="" onChange={() => {}} />);
    expect(screen.getByRole("button", { name: /select date and time/i })).toBeTruthy();
    rerender(<DateTimePicker id="x" value="2026-11-21T14:30" onChange={() => {}} />);
    expect(screen.getByRole("button", { name: /21 Nov 2026, 2:30 PM/ })).toBeTruthy();
  });

  it("emits the datetime-local string when a day and a time are picked", async () => {
    const user = userEvent.setup();
    render(<Harness initial="2026-11-21T14:30" />);
    await user.click(screen.getByLabelText("When"));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /November 25th, 2026/ }));
    expect(screen.getByTestId("raw").textContent).toBe("2026-11-25T14:30");

    await user.click(within(dialog).getByRole("button", { name: "AM" }));
    expect(screen.getByTestId("raw").textContent).toBe("2026-11-25T02:30");

    await user.click(within(dialog).getByRole("button", { name: "Increase minute" }));
    expect(screen.getByTestId("raw").textContent).toBe("2026-11-25T02:35");
  });

  it("clears the value and closes", async () => {
    const user = userEvent.setup();
    render(<Harness initial="2026-11-21T14:30" />);
    await user.click(screen.getByLabelText("When"));
    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.getByTestId("raw").textContent).toBe("");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes on Escape and returns focus to the trigger", async () => {
    const user = userEvent.setup();
    render(<Harness initial="2026-11-21T14:30" />);
    const trigger = screen.getByLabelText("When");
    await user.click(trigger);
    expect(screen.getByRole("dialog")).toBeTruthy();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("disables days before min and never emits an earlier value", async () => {
    const user = userEvent.setup();
    render(<Harness initial="2026-11-21T10:00" min="2026-11-21T09:00" />);
    await user.click(screen.getByLabelText("When"));
    const dialog = screen.getByRole("dialog");
    const before = within(dialog).getByRole("button", { name: /November 20th, 2026/ });
    expect((before as HTMLButtonElement).disabled).toBe(true);
    // Stepping the hour down below min on the same day is clamped to min.
    await user.click(within(dialog).getByRole("button", { name: "Decrease hour" }));
    await user.click(within(dialog).getByRole("button", { name: "Decrease hour" }));
    expect(screen.getByTestId("raw").textContent).toBe("2026-11-21T09:00");
  });
});