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
      className="inline-flex items-center gap-0.5 border border-neon-blue/50 rounded-sm bg-ink-panel/80 backdrop-blur px-0.5 py-0.5 shadow-[0_0_8px_hsl(var(--neon-blue)/0.25)]"
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
            title={`${label} theme`}
            aria-label={`Switch to ${label} theme`}
            aria-pressed={active}
            className={`px-2 py-1.5 rounded-sm transition-colors cursor-pointer ${
              active
                ? "bg-neon-blue/25 text-neon-blue"
                : "text-soft-white/80 hover:text-neon-blue hover:bg-neon-blue/10"
            }`}
            style={active ? { textShadow: "0 0 6px hsl(var(--neon-blue) / 0.7)" } : undefined}
          >
            <Icon className="w-4 h-4" />
          </button>
        );
      })}
    </div>
  );
}
