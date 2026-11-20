// @vitest-environment jsdom
import { useState } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import UserMenu from "./UserMenu";
import { COLOR_SCHEME_KEY, applyScheme, resolvePreference, setThemePreference, type ThemePreference } from "../lib/colorScheme";

function Harness({ onLogout }: { onLogout: () => void }) {
  const [pref, setPref] = useState<ThemePreference>("system");
  return (
    <MemoryRouter>
      <UserMenu
        name="Asha Rao"
        email="asha@example.com"
        preference={pref}
        onPreferenceChange={(next) => {
          setPref(next);
          setThemePreference(next);
          applyScheme(resolvePreference(next));
        }}
        onLogout={onLogout}
      />
    </MemoryRouter>
  );
}

beforeEach(() => {
  localStorage.clear();
  window.matchMedia = ((query: string) => ({ matches: false, media: query })) as unknown as typeof window.matchMedia;
});
afterEach(cleanup);

describe("UserMenu (profile menu)", () => {
  it("opens with header, appearance control, links and log out", async () => {
    const user = userEvent.setup();
    render(<Harness onLogout={() => {}} />);
    const trigger = screen.getByRole("button", { name: "Profile menu" });
    expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
    await user.click(trigger);
    expect(screen.getByRole("menu", { name: "Profile menu" })).toBeTruthy();
    expect(screen.getByText("asha@example.com")).toBeTruthy();
    expect(screen.getByRole("group", { name: "Appearance" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Account settings" }).getAttribute("href")).toBe("/settings");
    expect(screen.getByRole("menuitem", { name: "Change password" }).getAttribute("href")).toBe("/settings#password");
    expect(screen.getByRole("menuitem", { name: "Log out" })).toBeTruthy();
  });

  it("persists and applies the chosen theme, and system clears the key", async () => {
    const user = userEvent.setup();
    render(<Harness onLogout={() => {}} />);
    await user.click(screen.getByRole("button", { name: "Profile menu" }));
    await user.click(screen.getByRole("menuitemradio", { name: "Dark" }));
    expect(localStorage.getItem(COLOR_SCHEME_KEY)).toBe("dark");
    expect(document.documentElement.dataset.colorScheme).toBe("dark");
    expect(screen.getByRole("menuitemradio", { name: "Dark" }).getAttribute("aria-checked")).toBe("true");
    // menu stays open after choosing
    expect(screen.getByRole("menu")).toBeTruthy();
    await user.click(screen.getByRole("menuitemradio", { name: "System" }));
    expect(localStorage.getItem(COLOR_SCHEME_KEY)).toBeNull();
    expect(document.documentElement.dataset.colorScheme).toBe("light");
  });

  it("calls the logout handler", async () => {
    const user = userEvent.setup();
    const onLogout = vi.fn();
    render(<Harness onLogout={onLogout} />);
    await user.click(screen.getByRole("button", { name: "Profile menu" }));
    await user.click(screen.getByRole("menuitem", { name: "Log out" }));
    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape and returns focus to the trigger", async () => {
    const user = userEvent.setup();
    render(<Harness onLogout={() => {}} />);
    const trigger = screen.getByRole("button", { name: "Profile menu" });
    await user.click(trigger);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});