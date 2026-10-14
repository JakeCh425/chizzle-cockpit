// Chart Ecosystem — Part 1: server side of the Shared Market Context.
// Built ONCE per (symbol, timeframe, engine snapshot) from the bars + decision the swing engine already
// cached (hourly sync / boot snapshots) — no extra vendor calls of its own. Every panel reads this.
// Behind ENABLE_MARKET_CONTEXT (default ON). Analysis / practice only.
import { buildMarketContext, CONTEXT_TFS, sanitizeParams, type ContextTf, type CtxBar, type MarketContext } from "@shared/marketContext";
import { toContextDrawings } from "@shared/chartDrawings";
import { listDrawings } from "./drawings";
import { isChartDrawingsEnabled } from "../featureFlags";
import { aggregate4H, aggregateWeekly, dailyClosed, tag1H } from "./bars";
import { bootSnapshotOf, cachedEvalFor, evaluateSymbol, scanDecisionOf } from "./service";
import { selectedVersions } from "./plans";
import { listTrades } from "./trades";
import { listAlerts } from "./alerts";
import type { SwingBar } from "./candleMath";

const nowSec = () => Math.floor(Date.now() / 1000);
type Core = { resRef: unknown; at: number; minute: number; bars: CtxBar[]; bars1h: CtxBar[]; daily: CtxBar[]; dailyClosedBars: CtxBar[]; ext1h: CtxBar[] };
/** Bars per (symbol, tf) are derived once per engine snapshot (and re-tagged at most once a minute for bar closes). */
const coreCache = new Map<string, Core>();
let builds = 0, hits = 0;
export const contextStats = () => ({ builds, hits, entries: coreCache.size });
export function _resetContextCache() { coreCache.clear(); builds = 0; hits = 0; }

/** Same bar derivations the chart endpoint uses (RTH, closed flags), from the same cached bars. */
export function barsForTf(tf: ContextTf, bars1h: SwingBar[], daily: SwingBar[], now: number): CtxBar[] {
  const norm = (b: SwingBar & { closed?: boolean }): CtxBar => ({ t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v ?? 0, closed: b.closed ?? true });
  if (tf === "1H") return tag1H(bars1h, now, true).map(norm);
  if (tf === "4H") return aggregate4H(bars1h, now).map(norm);
  const d = daily.slice().sort((a, z) => a.t - z.t);
  if (tf === "D") return d.map((b) => norm({ ...b, closed: dailyClosed(b, now) }));
  return aggregateWeekly(d, now).map(norm);
}

export async function getMarketContext(rawSymbol: string, exchange: string, tfRaw: string, opts: { series?: boolean; params?: unknown } = {}): Promise<MarketContext & { cache: "hit" | "build" | "snapshot" }> {
  const tf = ((CONTEXT_TFS as readonly string[]).includes(tfRaw) ? tfRaw : "D") as ContextTf;
  const sym = rawSymbol.toUpperCase().split(":").pop()!;
  const now = nowSec();
  let hit = cachedEvalFor(sym);
  // No snapshot yet: share the engine's own (deduplicated) evaluation instead of fetching separately.
  if (!hit) {
    const snap = bootSnapshotOf(sym);
    void evaluateSymbol({ symbol: sym, exchange }, { allowStale: true }).catch(() => {});
    if (snap) {
      const ctx = buildMarketContext({ symbol: sym, tf, now, bars: [], bars1h: [], daily: [], dailyClosedBars: [], decision: snap, withSeries: opts.series });
      return { ...ctx, cache: "snapshot" };
    }
    await evaluateSymbol({ symbol: sym, exchange }, { allowStale: true });
    hit = cachedEvalFor(sym);
    if (!hit) throw new Error(`No market data for ${sym} yet`);
  }
  const key = `${sym}|${tf}`, minute = Math.floor(now / 60);
  let core = coreCache.get(key), how: "hit" | "build" = "hit";
  if (!core || core.resRef !== hit.res || core.at !== hit.at || core.minute !== minute) {
    const daily = barsForTf("D", hit.bars1h, hit.daily, now);
    // Extended-hours 1H bars (pre-market high/low only) come from the SAME cached bars, untagged.
    const ext1h = tag1H(hit.bars1h, now, false).map((b) => ({ t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v ?? 0, closed: (b as any).closed ?? true }));
    core = { resRef: hit.res, at: hit.at, minute, bars: barsForTf(tf, hit.bars1h, hit.daily, now), bars1h: barsForTf("1H", hit.bars1h, hit.daily, now), daily, dailyClosedBars: daily.filter((b) => b.closed), ext1h };
    coreCache.set(key, core); how = "build"; builds++;
  } else hits++;
  // User-owned state (plan version, practice trade, alerts) is read fresh so an edit shows everywhere at once.
  const [selected, trades, alerts, drawings] = await Promise.all([
    selectedVersions().catch(() => ({})),
    listTrades({ symbol: sym, status: ["ARMED", "ACTIVE"] }).catch(() => []),
    listAlerts(sym).catch(() => []),
    isChartDrawingsEnabled() ? listDrawings(sym).catch(() => []) : Promise.resolve([]),
  ]);
  const ctx = buildMarketContext({
    symbol: sym, tf, now, bars: core.bars, bars1h: core.bars1h, daily: core.daily, dailyClosedBars: core.dailyClosedBars,
    decision: scanDecisionOf(hit.res), selected,
    trades: trades.map((t) => ({ id: t.id, status: t.status, entry: t.entry, stop: t.stop, stopLimit: t.stopLimit, t1: t.t1, t2: t.t2, shares: t.shares })),
    alerts: alerts.map((a: any) => ({ active: a.active, symbol: a.symbol, type: a.type, level: a.level, levelHigh: a.levelHigh })),
    drawings: toContextDrawings(drawings), withSeries: opts.series,
    params: opts.params !== undefined ? sanitizeParams(opts.params) : undefined, extended1h: core.ext1h,
  });
  return { ...ctx, cache: how };
}
