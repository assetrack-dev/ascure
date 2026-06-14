"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

type Theme = "light" | "dark";

const STORAGE_KEY = "ascure-theme";

function currentTheme(): Theme {
  if (typeof document === "undefined") {
    return "light";
  }
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

/**
 * Light/dark switch. The actual <html data-theme> is set pre-paint by the
 * inline script in layout.tsx; this just flips + persists the choice.
 */
export function ThemeToggle({
  variant = "full",
  className = "",
}: {
  variant?: "full" | "icon";
  className?: string;
}) {
  const [theme, setTheme] = useState<Theme>("light");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setTheme(currentTheme());
    setMounted(true);
  }, []);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  }

  const nextLabel = theme === "dark" ? "light" : "dark";
  const Icon = theme === "dark" ? Sun : Moon;

  if (variant === "icon") {
    return (
      <button
        type="button"
        onClick={toggle}
        aria-label={`Switch to ${nextLabel} mode`}
        title={`Switch to ${nextLabel} mode`}
        className={`inline-flex h-10 w-10 items-center justify-center rounded-md border border-[var(--line)] bg-[var(--panel)] text-[var(--foreground)] transition hover:bg-[var(--surface-pressed)] ${className}`}
      >
        {mounted ? <Icon size={18} /> : <Moon size={18} />}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={`Switch to ${nextLabel} mode`}
      className={`inline-flex h-10 w-full items-center justify-center gap-2 rounded-md border border-[var(--chrome-line-strong)] px-3 text-sm font-semibold text-[var(--on-chrome)] transition hover:bg-[var(--chrome-active)] ${className}`}
    >
      {mounted ? <Icon size={16} /> : <Moon size={16} />}
      {mounted ? (theme === "dark" ? "Light mode" : "Dark mode") : "Theme"}
    </button>
  );
}
