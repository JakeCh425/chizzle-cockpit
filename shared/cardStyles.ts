// Chart Ecosystem — Part 4: Trading Card backgrounds. Pure CSS (gradients + inline SVG data-URI patterns,
// no image downloads). Visual only: a background never changes data, status or levels.
// Each background carries its OWN text/status tokens so contrast passes WCAG AA on every one of the
// 7 themes (the tokens override the theme's inside the card only). `stops` lists the darkest and lightest
// colours the text can sit on; the contrast test checks every token against every stop.
export const CARD_BG_IDS = ["default", "aurora", "carbon", "glass", "grid", "neon", "steel", "ocean", "ember"] as const;
export type CardBgId = typeof CARD_BG_IDS[number];
export interface CardBg {
  id: CardBgId; name: string; desc: string;
  /** CSS background shorthand (layers). Empty for Default = the theme's own surface. */
  background: string;
  /** Token overrides applied inside the card (text, muted, status colours, tile surface). */
  tokens: Record<string, string>;
  border?: string; shadow?: string; blur?: boolean;
  /** Colours behind text, for the contrast test (worst cases of the gradient + tile overlay). */
  stops: string[];
}

const svg = (s: string) => `url("data:image/svg+xml,${encodeURIComponent(s)}")`;
const CARBON = svg(`<svg xmlns='http://www.w3.org/2000/svg' width='8' height='8'><rect width='8' height='8' fill='#111214'/><path d='M0 0h4v4H0zM4 4h4v4H4z' fill='#1a1c20'/><path d='M0 4h4v4H0z' fill='#0d0e10'/></svg>`);
const GRID = svg(`<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24'><path d='M24 0H0v24' fill='none' stroke='#1d3357' stroke-width='1'/></svg>`);
const STEEL = svg(`<svg xmlns='http://www.w3.org/2000/svg' width='4' height='4'><path d='M0 1h4' stroke='#ffffff' stroke-opacity='.035'/></svg>`);

/** Dark-surface tokens shared by every new background (bright status colours, light text). */
const DARK = (extra: Record<string, string> = {}) => ({
  "--ac-text": "#F4F7FB", "--ac-muted": "#C3CDDA", "--ac-good": "#4ADE80", "--ac-warn": "#FCD34D", "--ac-bad": "#FCA5A5",
  "--ac-surface-2": "rgba(8,12,20,.55)", "--ac-border": "rgba(255,255,255,.16)",
  "--ac-accent": "#22D3EE", "--ac-on-accent": "#04121A", "--ac-accent-2": "#F5C451", "--ac-bg": "#0B1220", "--ac-surface": "#111A2E", ...extra,
});

export const CARD_BGS: CardBg[] = [
  { id: "default", name: "Default", desc: "The current card look from your theme.", background: "", tokens: {}, stops: [] },
  { id: "aurora", name: "Aurora Gradient", desc: "Soft teal → violet gradient.",
    background: "radial-gradient(120% 90% at 0% 0%, rgba(45,212,191,.30), transparent 55%), radial-gradient(120% 90% at 100% 100%, rgba(139,92,246,.34), transparent 55%), linear-gradient(135deg, #0b2a2e 0%, #161433 100%)",
    tokens: DARK({ "--ac-accent": "#5EEAD4" }), stops: ["#0b2a2e", "#161433", "#1b4a4a", "#2a2058"] },
  { id: "carbon", name: "Carbon Fiber", desc: "Dark woven texture.",
    background: `linear-gradient(180deg, rgba(255,255,255,.04), rgba(0,0,0,.25)), ${CARBON}`,
    tokens: DARK(), stops: ["#0d0e10", "#1a1c20", "#24262b"] },
  { id: "glass", name: "Glassmorphism", desc: "Frosted translucent blur.",
    background: "linear-gradient(135deg, rgba(148,163,184,.20), rgba(30,41,59,.55)), linear-gradient(135deg, #1e293b, #0f172a)",
    tokens: DARK({ "--ac-surface-2": "rgba(255,255,255,.07)", "--ac-border": "rgba(255,255,255,.22)" }), border: "1px solid rgba(255,255,255,.22)", blur: true,
    stops: ["#0f172a", "#1e293b", "#3a4558"] },
  { id: "grid", name: "Midnight Grid", desc: "Navy with a subtle grid.",
    background: `${GRID}, linear-gradient(180deg, #0a1730, #0b1220)`,
    tokens: DARK({ "--ac-accent": "#7DD3FC" }), stops: ["#0a1730", "#0b1220", "#1d3357"] },
  { id: "neon", name: "Neon Edge", desc: "Black with a glowing accent border.",
    background: "linear-gradient(180deg, #050505, #0b0b0f)",
    tokens: DARK({ "--ac-accent": "#22D3EE" }), border: "2px solid #22D3EE", shadow: "0 0 0 3px rgba(34,211,238,.22), 0 0 24px rgba(34,211,238,.35)",
    stops: ["#050505", "#0b0b0f", "#14141a"] },
  { id: "steel", name: "Brushed Steel", desc: "Graphite metallic sheen.",
    background: `${STEEL}, linear-gradient(115deg, #1f2328 0%, #2d3238 35%, #1b1e22 60%, #2a2f35 100%)`,
    tokens: DARK({ "--ac-accent": "#CBD5E1" }), stops: ["#1b1e22", "#2d3238", "#353a41"] },
  { id: "ocean", name: "Deep Ocean", desc: "Blue depth gradient.",
    background: "radial-gradient(140% 100% at 50% 0%, rgba(56,189,248,.22), transparent 60%), linear-gradient(180deg, #082f49 0%, #04172b 70%, #020c18 100%)",
    tokens: DARK({ "--ac-accent": "#7DD3FC" }), stops: ["#082f49", "#04172b", "#020c18", "#1a4a68"] },
  { id: "ember", name: "Sunset Ember", desc: "Charcoal with a copper / orange glow.",
    background: "radial-gradient(110% 80% at 100% 100%, rgba(234,88,12,.32), transparent 60%), radial-gradient(80% 60% at 0% 0%, rgba(180,83,9,.18), transparent 60%), linear-gradient(160deg, #1c1917, #120f0d)",
    tokens: DARK({ "--ac-accent": "#FB923C" }), stops: ["#1c1917", "#120f0d", "#4a2414", "#3a2614"] },
];
export const cardBg = (id: string | null | undefined): CardBg => CARD_BGS.find((b) => b.id === id) ?? CARD_BGS[0];

export type CardState = "READY" | "ACTIVE" | "WATCH";
export interface CardStylePrefs { mode: "all" | "state"; all: CardBgId; READY: CardBgId; ACTIVE: CardBgId; WATCH: CardBgId }
export const DEFAULT_CARD_STYLE: CardStylePrefs = { mode: "all", all: "default", READY: "default", ACTIVE: "default", WATCH: "default" };
export const bgFor = (p: CardStylePrefs, state: CardState): CardBg => cardBg(p.mode === "all" ? p.all : p[state]);

/** Inline style for a card element (Default → nothing, so the existing look is byte-identical). */
export function cardBgStyle(b: CardBg): Record<string, string> {
  if (b.id === "default") return {};
  const st: Record<string, string> = { ...b.tokens, background: b.background, color: "var(--ac-text)" };
  if (b.border) st.border = b.border;
  if (b.shadow) st.boxShadow = b.shadow;
  if (b.blur) { st.backdropFilter = "blur(14px) saturate(140%)"; st.WebkitBackdropFilter = "blur(14px) saturate(140%)"; }
  return st;
}

// ─── WCAG contrast ──────────────────────────────────────────────────────────
function rgb(hex: string): [number, number, number] {
  const h = hex.replace("#", ""); const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const lin = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
export const luminance = (hex: string) => { const [r, g, b] = rgb(hex); return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b); };
export function contrast(a: string, b: string): number { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
/** Worst-case contrast of each text/status token against every stop of a background. */
export function bgContrast(b: CardBg): { token: string; min: number }[] {
  const keys = ["--ac-text", "--ac-muted", "--ac-good", "--ac-warn", "--ac-bad", "--ac-accent"].filter((k) => b.tokens[k]);
  return keys.map((k) => ({ token: k, min: Math.min(...b.stops.map((s) => contrast(b.tokens[k], s))) }));
}
