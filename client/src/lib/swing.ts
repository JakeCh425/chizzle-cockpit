// PR 3e — client helpers for the Unified Swing Engine (§Q UI).
// Everything here is inert unless ENABLE_UNIFIED_SWING_ENGINE is on, or the
// QA preview override `?unified=1` is present in the URL (search or hash).
// Analysis / practice only — no broker calls exist anywhere in this module.
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { PracticeVerdict, SwingDecision, WatchItem, WatchCategory, ScanSelection } from "@shared/swingDecision";

export function unifiedOverride(): boolean {
  if (typeof window === "undefined") return false;
  const q = window.location.search + "&" + (window.location.hash.split("?")[1] ?? "");
  return /(^|[?&])unified=1(&|$)/.test(q);
}

/** Append the QA override to a swing URL when it is in use. */
export function swingUrl(path: string): string {
  if (!unifiedOverride()) return path;
  return path + (path.includes("?") ? "&" : "?") + "unified=1";
}

export async function swingGet<T>(path: string): Promise<T> {
  return (await (await apiRequest("GET", swingUrl(path))).json()) as T;
}
export async function swingSend<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetchRaw(method, path, body);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(json?.error || `HTTP ${res.status}`), { body: json, status: res.status });
  return json as T;
}
// Non-throwing variant so the UI can show the resolver's exact error text (422 bodies).
async function fetchRaw(method: string, path: string, body?: unknown): Promise<Response> {
  try { return await apiRequest(method, swingUrl(path), body); }
  catch (e: any) {
    const m = /^(\d{3}): ([\s\S]*)$/.exec(e?.message || "");
    if (!m) throw e;
    return new Response(m[2], { status: Number(m[1]), headers: { "Content-Type": "application/json" } });
  }
}

export function useSwingEnabled(): boolean {
  const override = unifiedOverride();
  const { data } = useQuery<Record<string, boolean>>({
    queryKey: ["/api/feature-flags"],
    queryFn: async () => (await (await apiRequest("GET", "/api/feature-flags")).json()),
    staleTime: 5 * 60_000,
    enabled: !override,
  });
  return override || data?.ENABLE_UNIFIED_SWING_ENGINE === true;
}

export interface WatchRow extends WatchItem { riskNote: string }
export interface WatchlistResp { items: WatchRow[]; maxCustomTickers: number; categories: WatchCategory[] }
export interface ScanRowResp { item: WatchItem; riskNote: string; decision: SwingDecision; verdict: PracticeVerdict }
export interface ScanResp { selection: ScanSelection; scanned: number; rows: ScanRowResp[]; emptyReason: string | null; evaluatedAt: string; banner: string }
export interface DecisionResp { banner: string; decision: SwingDecision; verdict: PracticeVerdict; riskNote: string | null }
export interface BarsResp {
  symbol: string; exchange: string; timeframe: string; range: string; session: "RTH" | "EXTENDED"; source: string | null; error?: string;
  visualOnly: boolean; visualOnlyNote: string | null; quoteTimestamp: string | null; dataStatus: string; lastCompletedBar: string | null;
  bars: { t: number; o: number; h: number; l: number; c: number; v: number; closed: boolean }[];
}

/** The one shared decision for a symbol — every §Q surface reads this same query key. */
export function useSwingDecision(symbol: string | null | undefined, scope: "CURRENT" | "LAST5" | "ALL" = "LAST5", enabled = true) {
  return useQuery<DecisionResp>({
    queryKey: ["/api/swing/decision", symbol ?? "", scope],
    queryFn: () => swingGet<DecisionResp>(`/api/swing/decision/${encodeURIComponent(symbol!)}?history=${scope}`),
    enabled: enabled && !!symbol,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    retry: false,
  });
}

// §K "Do Today" wording, derived from the shared decision (mirrors server doTodayLine()).
export function doTodayLine(d: SwingDecision): string {
  return d.nextAction;
}

export const fmt$ = (n: number | null | undefined) => (n == null || !isFinite(n) ? "—" : `$${n.toFixed(2)}`);
export const fmtCT = (iso: string | null | undefined) => {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " CT";
  } catch { return iso; }
};

export const STATUS_TONE: Record<string, string> = {
  READY_TO_TRADE: "text-emerald-400 border-emerald-500/50 bg-emerald-500/10",
  SETUP_CONFIRMED: "text-sky-400 border-sky-500/50 bg-sky-500/10",
  SETUP_FORMING: "text-yellow-300 border-yellow-500/50 bg-yellow-500/10",
  WATCH_EXTENDED: "text-orange-300 border-orange-500/50 bg-orange-500/10",
  WATCH_RETEST: "text-orange-300 border-orange-500/50 bg-orange-500/10",
  WATCH_STOP_TOO_WIDE: "text-rose-300 border-rose-500/50 bg-rose-500/10",
  WATCH_RR_TOO_LOW: "text-rose-300 border-rose-500/50 bg-rose-500/10",
  BLOCKED_DATA_MISMATCH: "text-fuchsia-300 border-fuchsia-500/50 bg-fuchsia-500/10",
  SETUP_INVALIDATED: "text-slate-300 border-slate-500/50 bg-slate-500/10",
  SIGNAL_EXPIRED: "text-slate-300 border-slate-500/50 bg-slate-500/10",
  NO_SETUP: "text-slate-300 border-slate-500/50 bg-slate-500/10",
};
export const DATA_TONE: Record<string, string> = {
  LIVE: "text-emerald-400 border-emerald-500/50",
  DELAYED: "text-yellow-300 border-yellow-500/50",
  ERROR: "text-rose-400 border-rose-500/50",
  MISMATCH: "text-fuchsia-300 border-fuchsia-500/50",
};
