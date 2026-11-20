import { useState } from "react";
import { applyScheme, setStoredScheme, type ColorScheme } from "../lib/colorScheme";
import PopoverMenu from "./PopoverMenu";

function currentScheme(): ColorScheme {
  return typeof document !== "undefined" && document.documentElement.dataset.colorScheme === "dark" ? "dark" : "light";
}

export default function UserMenu({ name, onLogout }: { name: string; onLogout: () => void }) {
  const [scheme, setScheme] = useState<ColorScheme>(currentScheme);
  const next: ColorScheme = scheme === "dark" ? "light" : "dark";
  const initial = (name.trim()[0] ?? "?").toUpperCase();

  return (
    <PopoverMenu
      label={`Account menu for ${name}`}
      triggerClassName="user-menu-trigger"
      trigger={
        <>
          <span className="user-menu-avatar" aria-hidden="true">{initial}</span>
          <span className="user-menu-name">{name}</span>
        </>
      }
      items={[
        { id: "settings", label: "Settings", href: "/settings" },
        {
          id: "scheme",
          label: next === "dark" ? "Switch to dark mode" : "Switch to light mode",
          onSelect: () => {
            applyScheme(next);
            setStoredScheme(next);
            setScheme(next);
          },
        },
        { id: "logout", label: "Log out", onSelect: onLogout },
      ]}
    />
  );
}
