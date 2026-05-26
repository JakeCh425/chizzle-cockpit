import { useState, useEffect } from "react";
import { Sun, Sunrise, Moon } from "lucide-react";

type Theme = "light" | "medium" | "dark";

function readTheme(): Theme {
  if (typeof document !== "undefined") {
    const attr = document.documentElement.getAttribute("data-theme");
    if (attr === "light" || attr === "medium" || attr === "dark") return attr;
  }
  return "light";
}

function applyTheme(t: Theme) {
  document.documentElement.setAttribute("data-theme", t);
  // Legacy .dark class toggle so any consumer keyed off it still works.
  if (t === "dark") document.documentElement.classList.add("dark");
  else document.documentElement.classList.remove("dark");
  try {
    localStorage.setItem("chizzle-theme", t);
  } catch {}
}

export function ThemeSwitcher() {
  const [theme, setTheme] = useState<Theme>(readTheme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const themes: { value: Theme; label: string; Icon: typeof Sun }[] = [
    { value: "light", label: "Light", Icon: Sun },
    { value: "medium", label: "Medium", Icon: Sunrise },
    { value: "dark", label: "Dark", Icon: Moon },
  ];

  return (
    <div
      className="hidden md:inline-flex items-center border border-ink-line rounded-sm bg-ink-panel/60 backdrop-blur"
      role="group"
      aria-label="Theme switcher"
    >
      {themes.map(({ value, label, Icon }) => {
        const active = theme === value;
        return (
          <button
            key={value}
            onClick={() => setTheme(value)}
            data-testid={`button-theme-${value}`}
            title={label}
            aria-label={`Switch to ${label} theme`}
            aria-pressed={active}
            className={`px-2 py-1 transition-colors cursor-pointer ${
              active
                ? "bg-neon-blue/20 text-neon-blue"
                : "text-slate-gray hover:text-soft-white hover:bg-ink-line/40"
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
          </button>
        );
      })}
    </div>
  );
}
