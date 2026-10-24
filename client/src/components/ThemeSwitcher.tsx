import { useState, useEffect } from "react";
import { Zap, Moon, Sun } from "lucide-react";

export type Theme = "cyber-neon" | "stealth" | "arctic";

function readTheme(): Theme {
  if (typeof document !== "undefined") {
    const saved = localStorage.getItem("chizzle-wealth-theme") || localStorage.getItem("chizzle-theme");
    if (saved === "cyber-neon" || saved === "stealth" || saved === "arctic") return saved;
    if (saved === "dark") return "stealth";
    if (saved === "light") return "arctic";
    if (saved === "medium") return "cyber-neon";
    const attr = document.documentElement.getAttribute("data-theme");
    if (attr === "cyber-neon" || attr === "stealth" || attr === "arctic") return attr as Theme;
  }
  return "cyber-neon";
}

function applyTheme(t: Theme) {
  document.documentElement.setAttribute("data-theme", t);
  if (t === "cyber-neon" || t === "stealth") {
    document.documentElement.classList.add("dark");
  } else {
    document.documentElement.classList.remove("dark");
  }
  try {
    localStorage.setItem("chizzle-wealth-theme", t);
    localStorage.setItem("chizzle-theme", t);
  } catch {}
}

export function ThemeSwitcher() {
  const [theme, setTheme] = useState<Theme>(readTheme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const cycleTheme = () => {
    const next: Theme = theme === "cyber-neon" ? "stealth" : theme === "stealth" ? "arctic" : "cyber-neon";
    setTheme(next);
  };

  const themes: { value: Theme; label: string; Icon: typeof Zap }[] = [
    { value: "cyber-neon", label: "Cyber Neon", Icon: Zap },
    { value: "stealth", label: "Stealth", Icon: Moon },
    { value: "arctic", label: "Arctic", Icon: Sun },
  ];

  return (
    <div className="flex items-center gap-1.5" role="group" aria-label="Theme switcher">
      <button
        onClick={cycleTheme}
        data-testid="button-theme-switcher"
        title={`Current: ${theme.replace("-", " ")}. Click to cycle theme`}
        aria-label="Cycle theme"
        className="flex items-center gap-1.5 px-2.5 py-1 rounded border border-neon-blue/50 bg-ink-panel/80 backdrop-blur text-xs font-mono font-bold uppercase tracking-wider text-neon-blue shadow-[0_0_8px_hsl(var(--neon-blue)/0.25)] hover:bg-neon-blue/10 transition-colors cursor-pointer"
      >
        {theme === "cyber-neon" && <Zap className="w-3.5 h-3.5 text-cyan-400" />}
        {theme === "stealth" && <Moon className="w-3.5 h-3.5 text-amber-400" />}
        {theme === "arctic" && <Sun className="w-3.5 h-3.5 text-blue-600" />}
        <span className="hidden sm:inline capitalize">{theme.replace("-", " ")}</span>
      </button>

      {/* Direct icon buttons for specific themes */}
      <div className="hidden lg:inline-flex items-center gap-0.5 border border-ink-line/60 rounded bg-ink-panel/60 p-0.5">
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
              className={`p-1 rounded text-xs transition-colors cursor-pointer ${
                active
                  ? "bg-neon-blue/25 text-neon-blue shadow-sm"
                  : "text-slate-gray hover:text-soft-white hover:bg-white/5"
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
            </button>
          );
        })}
      </div>
    </div>
  );
}
