// Chart Ecosystem — Part 5: AI proximity tips (client). Deterministic templates from shared/proximityTips,
// built from the SAME 1H Shared Market Context every panel reads → a tip never contradicts the SwingDecision.
// Shown on the Trade Card, in the AI Coach (Trade Summary) and in Practice Alerts. Muting is per symbol.
// Optional in-app toast only (no email / SMS). Practice / analysis only — never an order.
import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Lightbulb, BellOff, Bell, HelpCircle } from "lucide-react";
import { useMarketContext, useContextUiEnabled } from "@/lib/marketContext";
import { useLiveAllowed } from "@/lib/liveStatus";
import { usePersistentState } from "@/hooks/use-persistent-state";
import { swingGet } from "@/lib/swing";
import { focusSymbol } from "@/lib/plans";
import { useToast } from "@/hooks/use-toast";
import { DEFAULT_TIP_CONFIG, ZONE_LABEL, newTips, proximityTips, type ProximityTip, type TipConfig, type TipMode, type TipZone } from "@shared/proximityTips";
import type { SwingSettings } from "@shared/swingDecision";

export const TIP_SAFETY = "PRACTICE ONLY — ANALYSIS, NOT FINANCIAL ADVICE";
export interface TipPrefs { on: boolean; cfg: TipConfig; muted: string[]; notify: boolean }
const DEF: TipPrefs = { on: true, cfg: DEFAULT_TIP_CONFIG, muted: [], notify: false };
export function useTipPrefs() {
  const [p, set] = usePersistentState<TipPrefs>("proximity-tips", DEF);
  const prefs: TipPrefs = { ...DEF, ...p, cfg: { ...DEF.cfg, ...(p?.cfg ?? {}) } };
  return [prefs, (patch: Partial<TipPrefs>) => set({ ...prefs, ...patch })] as const;
}
export function useTipMode(): TipMode {
  const s = useQuery<SwingSettings>({ queryKey: ["/api/swing/settings"], queryFn: () => swingGet("/api/swing/settings"), staleTime: 60_000 });
  const m = (s.data as any)?.userMode;
  return m === "LEARN" || m === "DISCIPLINED" ? m : "PRACTICE";
}

/** Tips for one symbol from its lean 1H context. */
export function useProximityTips(symbol: string | undefined, stamp?: string | null) {
  const [ui] = useContextUiEnabled();
  const [prefs] = useTipPrefs();
  const mode = useTipMode();
  const liveAllowed = useLiveAllowed(); // same regime source as every other status label
  const sym = (symbol ?? "").toUpperCase();
  const muted = prefs.muted.includes(sym);
  const q = useMarketContext(sym || undefined, "1H", { stamp: stamp ?? null, enabled: ui && prefs.on && !!sym });
  const tips = useMemo(() => (q.data && q.data.symbol === sym && prefs.on ? proximityTips(q.data, prefs.cfg, mode, undefined, liveAllowed) : []), [q.data, sym, prefs.on, JSON.stringify(prefs.cfg), mode, liveAllowed]);
  return { tips: muted ? [] : tips, hidden: muted ? tips.length : 0, muted, mode, ctx: q.data };
}

// Rate limiter for the optional toast: one per symbol per level per closed bar (keys persist across reloads).
const SEEN_KEY = "chizzle/v2/tips-seen";
function seenSet(): Set<string> { try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) ?? "[]")); } catch { return new Set(); } }
function saveSeen(s: Set<string>) { try { localStorage.setItem(SEEN_KEY, JSON.stringify([...s].slice(-300))); } catch { /* storage blocked */ } }

const ZONE_TONE: Record<TipZone, { card: string; cockpit: string }> = {
  APPROACHING: { card: "var(--ac-accent)", cockpit: "#38bdf8" },
  AT_LEVEL: { card: "var(--ac-warn)", cockpit: "#fbbf24" },
  THROUGH: { card: "var(--ac-bad)", cockpit: "#f472b6" },
};

function TipRow({ t, variant }: { t: ProximityTip; variant: "card" | "cockpit" }) {
  const c = variant === "card" ? ZONE_TONE[t.zone].card : ZONE_TONE[t.zone].cockpit;
  const card = variant === "card";
  return (
    <li className={card ? "rounded-lg px-2.5 py-1.5" : "rounded border px-2 py-1.5 text-[11.5px]"} style={{ border: `1.5px solid ${c}` }} data-testid={`tip-${t.symbol}-${t.area.kind}`} data-zone={t.zone}>
      <div className="flex flex-wrap items-center gap-2" style={card ? { fontSize: "var(--ac-fs-xs)" } : undefined}>
        <span className="inline-flex items-center gap-1 font-bold font-mono" style={{ color: c }} data-testid={`tip-zone-${t.symbol}`}><Lightbulb className="h-3.5 w-3.5" aria-hidden />{ZONE_LABEL[t.zone]}</span>
        <span className={card ? "ac-muted font-mono" : "text-slate-gray font-mono"}>{t.symbol} · {t.distPct >= 0 ? "+" : ""}{t.distPct.toFixed(2)}% vs {t.area.price.toFixed(2)}</span>
        <button className={`ml-auto inline-flex items-center gap-0.5 underline ${card ? "ac-accent" : "text-neon-blue"}`} onClick={() => focusSymbol(t.symbol, "why")} data-testid={`button-tip-why-${t.symbol}`}><HelpCircle className="h-3 w-3" aria-hidden /> Why?</button>
      </div>
      <div className={card ? "" : "text-soft-white"} style={card ? { fontSize: "var(--ac-fs-sm)" } : undefined} data-testid={`tip-text-${t.symbol}`}>
        <b>{t.what}</b> {t.watch}
      </div>
      {t.text.includes(t.risk) && <div className={card ? "ac-warn font-semibold" : "text-signal-amber font-mono text-[10.5px]"} style={card ? { fontSize: "var(--ac-fs-xs)" } : undefined}>{t.risk}</div>}
      {t.text.includes(t.learn) && <div className={card ? "ac-muted" : "text-slate-gray text-[10.5px]"} style={card ? { fontSize: "var(--ac-fs-xs)" } : undefined} data-testid={`tip-learn-${t.symbol}`}>{t.learn}</div>}
    </li>
  );
}

/** Tip strip for one symbol. Renders nothing when price is not near any trading area. */
export function ProximityTips({ symbol, stamp, variant = "cockpit", showEmpty = false }: { symbol: string; stamp?: string | null; variant?: "card" | "cockpit"; showEmpty?: boolean }) {
  const { tips, hidden, muted, mode } = useProximityTips(symbol, stamp);
  const [prefs, set] = useTipPrefs();
  const toggleMute = () => set({ muted: muted ? prefs.muted.filter((s) => s !== symbol) : [...prefs.muted, symbol] });
  if (!prefs.on) return null;
  if (!tips.length && !muted && !showEmpty) return null;
  const card = variant === "card";
  return (
    <section className={card ? "ac-tile rounded-xl px-3 py-2 space-y-1.5" : "space-y-1"} aria-label={`${symbol} proximity tips`} data-testid={`tips-${variant}-${symbol}`}>
      <div className="flex flex-wrap items-center gap-2" style={card ? { fontSize: "var(--ac-fs-xs)" } : undefined}>
        <span className={card ? "font-bold" : "font-mono font-bold text-[11px] text-soft-white"}>AI TIP · near a trading area</span>
        <span className={card ? "ac-muted" : "text-[10px] text-slate-gray font-mono"}>{mode === "LEARN" ? "Learn mode" : mode === "DISCIPLINED" ? "Disciplined mode" : "Practice mode"} · {TIP_SAFETY}</span>
        <button className={`ml-auto inline-flex items-center gap-1 ${card ? "ac-btn !py-0.5 !px-2" : "text-[10.5px] text-slate-gray hover:text-soft-white"}`} onClick={toggleMute} aria-pressed={muted} data-testid={`button-tip-mute-${symbol}`}>
          {muted ? <><Bell className="h-3 w-3" aria-hidden /> Unmute {symbol}</> : <><BellOff className="h-3 w-3" aria-hidden /> Mute {symbol}</>}
        </button>
      </div>
      {muted ? <div className={card ? "ac-muted" : "text-[10.5px] text-slate-gray"} style={card ? { fontSize: "var(--ac-fs-xs)" } : undefined} data-testid={`tip-muted-${symbol}`}>Tips muted for {symbol}{hidden ? ` (${hidden} hidden)` : ""}.</div>
        : tips.length ? <ul className="space-y-1">{tips.map((t) => <TipRow key={t.key} t={t} variant={variant} />)}</ul>
        : <div className="text-[10.5px] text-slate-gray">Price is not near a trading area right now.</div>}
    </section>
  );
}

/** Practice Alerts block: tips across symbols + settings + the optional in-app toast (fires here only). */
export function TipsAlertsBlock({ symbols }: { symbols: string[] }) {
  const [prefs, set] = useTipPrefs();
  const list = [...new Set(symbols.map((s) => s.toUpperCase()).filter(Boolean))].slice(0, 8);
  const inp = "w-14 rounded border border-ink-line bg-ink-deep px-1 py-0.5 text-[11px] font-mono text-soft-white";
  return (
    <div className="mt-2 rounded border border-ink-line px-2 py-1.5 space-y-1.5" data-testid="panel-alert-tips">
      <div className="flex flex-wrap items-center gap-2 text-[10.5px] font-mono">
        <span className="font-bold text-soft-white">AI PROXIMITY TIPS</span>
        <label className="inline-flex items-center gap-1 text-slate-gray"><input type="checkbox" checked={prefs.on} onChange={(e) => set({ on: e.target.checked })} data-testid="checkbox-tips-on" /> On</label>
        <label className="inline-flex items-center gap-1 text-slate-gray">Close = within <input className={inp} type="number" step="0.1" min="0.1" max="5" value={prefs.cfg.pct} onChange={(e) => { const n = Number(e.target.value); if (n >= 0.1 && n <= 5) set({ cfg: { ...prefs.cfg, pct: n } }); }} aria-label="Percent band" data-testid="input-tips-pct" />%</label>
        <label className="inline-flex items-center gap-1 text-slate-gray">or <input className={inp} type="number" step="0.1" min="0.1" max="3" value={prefs.cfg.atrMult} onChange={(e) => { const n = Number(e.target.value); if (n >= 0.1 && n <= 3) set({ cfg: { ...prefs.cfg, atrMult: n } }); }} aria-label="ATR multiple" data-testid="input-tips-atr" />× ATR (larger wins)</label>
        <label className="inline-flex items-center gap-1 text-slate-gray"><input type="checkbox" checked={prefs.notify} onChange={(e) => set({ notify: e.target.checked })} data-testid="checkbox-tips-notify" /> In-app notification</label>
        {prefs.muted.length > 0 && <span className="text-slate-gray">Muted: {prefs.muted.join(", ")}</span>}
      </div>
      {prefs.on && list.map((s) => <SymbolTips key={s} symbol={s} notify={prefs.notify} />)}
      {prefs.on && <p className="text-[10px] text-slate-gray">Tips use the same shared context as the card, so they never contradict the engine. One tip per symbol per level per closed 1H bar. Not an order and not advice.</p>}
    </div>
  );
}
function SymbolTips({ symbol, notify }: { symbol: string; notify: boolean }) {
  const { tips } = useProximityTips(symbol);
  const { toast } = useToast();
  useEffect(() => {
    if (!notify || !tips.length) return;
    const seen = seenSet(); const fresh = newTips(tips, seen); saveSeen(seen);
    for (const t of fresh) toast({ title: `${t.symbol} · ${ZONE_LABEL[t.zone]}`, description: `${t.what} ${t.watch} PRICE ALERT ONLY — VERIFY DATA AND REVIEW THE PLAN BEFORE ACTING.` });
  }, [tips.map((t) => t.key).join("|"), notify]);
  return <ProximityTips symbol={symbol} variant="cockpit" />;
}
