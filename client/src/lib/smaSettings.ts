// ============================================================================
//  SMA Settings & Persistence Engine (SMA 20, 50, 200 Color & Thickness)
// ============================================================================

export interface SmaStyle {
  color: string;
  lineWidth: number; // 1 through 4
  visible: boolean;
}

export interface SmaSettings {
  sma20: SmaStyle;
  sma50: SmaStyle;
  sma200: SmaStyle;
  showVolume?: boolean;
  showAtr?: boolean;
  showRibbon?: boolean;
  candleStyle?: "solid" | "hollow";
}

export const TRADINGVIEW_DEFAULTS = {
  sma20Color: "#2962FF",
  sma50Color: "#EF5350",
  sma200Color: "#FFD700",
  bullishRibbon: "rgba(38, 166, 154, 0.12)",
  bearishRibbon: "rgba(239, 83, 80, 0.12)",
};

export const DEFAULT_SMA_SETTINGS: SmaSettings = {
  sma20: { color: "#22D3EE", lineWidth: 2, visible: true },   // Blue (#22D3EE)
  sma50: { color: "#F43F5E", lineWidth: 2, visible: true },   // Red/Magenta (#F43F5E)
  sma200: { color: "#FFD700", lineWidth: 2, visible: true },  // Golden Yellow (#FFD700)
  showVolume: true,
  showAtr: true,
  showRibbon: true,
  candleStyle: "solid",
};

export const STORAGE_KEY_SMA = "chizzle-sma-settings";

function parseLineWidth(val: unknown, fallback: number): number {
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(4, Math.max(1, Math.round(n)));
}

export function loadSmaSettings(): SmaSettings {
  if (typeof window === "undefined") return DEFAULT_SMA_SETTINGS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SMA);
    if (!raw) return DEFAULT_SMA_SETTINGS;
    const parsed = JSON.parse(raw);
    return {
      sma20: {
        color: parsed?.sma20?.color || DEFAULT_SMA_SETTINGS.sma20.color,
        lineWidth: parseLineWidth(parsed?.sma20?.lineWidth, DEFAULT_SMA_SETTINGS.sma20.lineWidth),
        visible: parsed?.sma20?.visible !== false,
      },
      sma50: {
        color: parsed?.sma50?.color || DEFAULT_SMA_SETTINGS.sma50.color,
        lineWidth: parseLineWidth(parsed?.sma50?.lineWidth, DEFAULT_SMA_SETTINGS.sma50.lineWidth),
        visible: parsed?.sma50?.visible !== false,
      },
      sma200: {
        color: parsed?.sma200?.color || DEFAULT_SMA_SETTINGS.sma200.color,
        lineWidth: parseLineWidth(parsed?.sma200?.lineWidth, DEFAULT_SMA_SETTINGS.sma200.lineWidth),
        visible: parsed?.sma200?.visible !== false,
      },
      showVolume: parsed?.showVolume !== false,
      showAtr: parsed?.showAtr !== false,
      showRibbon: parsed?.showRibbon !== false,
      candleStyle: parsed?.candleStyle === "hollow" ? "hollow" : "solid",
    };
  } catch {
    return DEFAULT_SMA_SETTINGS;
  }
}

export function saveSmaSettings(settings: SmaSettings): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY_SMA, JSON.stringify(settings));
  } catch {}
}
