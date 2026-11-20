import type { ReactNode } from "react";
import type { ThemePreference } from "../lib/colorScheme";
import PopoverMenu from "./PopoverMenu";

type UserMenuProps = {
  name: string;
  email: string;
  preference: ThemePreference;
  onPreferenceChange: (pref: ThemePreference) => void;
  onLogout: () => void;
  /** Custom trigger content and class (mobile bottom nav). Defaults to avatar + name. */
  trigger?: ReactNode;
  triggerClassName?: string;
};

export default function UserMenu({
  name,
  email,
  preference,
  onPreferenceChange,
  onLogout,
  trigger,
  triggerClassName,
}: UserMenuProps) {
  const initial = (name.trim()[0] ?? "?").toUpperCase();
  const choice = (id: ThemePreference, label: string) => ({
    id,
    label,
    checked: preference === id,
    onSelect: () => onPreferenceChange(id),
  });

  return (
    <PopoverMenu
      label="Profile menu"
      triggerClassName={triggerClassName ?? "user-menu-trigger"}
      trigger={
        trigger ?? (
          <>
            <span className="user-menu-avatar" aria-hidden="true">{initial}</span>
            <span className="user-menu-name">{name}</span>
          </>
        )
      }
      header={
        <div className="user-menu-header">
          <span className="user-menu-avatar user-menu-avatar-lg" aria-hidden="true">{initial}</span>
          <div className="user-menu-identity">
            <span className="user-menu-fullname">{name}</span>
            <span className="user-menu-email">{email}</span>
          </div>
        </div>
      }
      items={[
        {
          id: "appearance",
          label: "Appearance",
          segments: [choice("light", "Light"), choice("dark", "Dark"), choice("system", "System")],
        },
        { id: "settings", label: "Account settings", href: "/settings" },
        { id: "password", label: "Change password", href: "/settings#password" },
        { id: "divider", label: "", divider: true },
        { id: "logout", label: "Log out", danger: true, onSelect: onLogout },
      ]}
    />
  );
}
