"use client";

import { useState } from "react";
import { Moon, Sun } from "lucide-react";
import {
  nextThemePreference,
  THEME_COOKIE,
  THEME_COOKIE_MAX_AGE,
  THEME_LABELS,
  type ThemePreference,
} from "@/lib/theme";
import { cn } from "@/lib/utils";

const ICONS = { light: Sun, dark: Moon } as const;

/** Botón que alterna Claro ⇄ Oscuro y persiste la elección en cookie. */
export function ThemeToggle({
  initial,
  className,
}: {
  initial: ThemePreference;
  className?: string;
}) {
  const [pref, setPref] = useState<ThemePreference>(initial);

  function cycle() {
    const value = nextThemePreference(pref);
    setPref(value);
    document.documentElement.setAttribute("data-theme", value);
    document.cookie = `${THEME_COOKIE}=${value};path=/;max-age=${THEME_COOKIE_MAX_AGE};samesite=lax`;
  }

  const Icon = ICONS[pref];
  const label = `Tema: ${THEME_LABELS[pref]}`;

  return (
    <button
      type="button"
      onClick={cycle}
      aria-label={label}
      title={`${label} (clic para cambiar)`}
      className={cn(
        "rounded p-1 text-text-3 transition-colors hover:text-foreground",
        className
      )}
    >
      <Icon className="h-4 w-4" strokeWidth={1.7} />
    </button>
  );
}
