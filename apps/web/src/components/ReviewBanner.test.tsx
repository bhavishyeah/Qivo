// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ReviewBanner from "./ReviewBanner";

const sections = [
  { id: "a", title: "About you" },
  { id: "b", title: "" },
  { id: "c", title: "Payment" },
];

afterEach(cleanup);

describe("ReviewBanner", () => {
  it("shows the banner without jump controls for a single section", () => {
    render(<ReviewBanner sections={[sections[0]!]} currentIndex={0} onJump={() => {}} />);
    expect(screen.getByText("Review and update")).toBeTruthy();
    expect(screen.queryByText("Skip to last section")).toBeNull();
    expect(screen.queryByLabelText(/Jump to section/)).toBeNull();
  });

  it("skips to the last section", async () => {
    const onJump = vi.fn();
    render(<ReviewBanner sections={sections} currentIndex={0} onJump={onJump} />);
    await userEvent.setup().click(screen.getByText("Skip to last section"));
    expect(onJump).toHaveBeenCalledWith(2);
  });

  it("jumps to a chosen section and labels untitled ones", async () => {
    const onJump = vi.fn();
    render(<ReviewBanner sections={sections} currentIndex={0} onJump={onJump} />);
    expect(screen.getByRole("option", { name: "2. Section 2" })).toBeTruthy();
    await userEvent.setup().selectOptions(screen.getByLabelText(/Jump to section/), "1");
    expect(onJump).toHaveBeenCalledWith(1);
  });

  it("hides the skip button on the last section", () => {
    render(<ReviewBanner sections={sections} currentIndex={2} onJump={() => {}} />);
    expect(screen.queryByText("Skip to last section")).toBeNull();
  });
});
