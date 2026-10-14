// Chart Ecosystem — Part 5: AI proximity tips. Deterministic templates (no LLM, no paid calls), built ONLY
// from the Shared Market Context, so a tip can never contradict the SwingDecision it came from.
// Zones: APPROACHING → AT LEVEL → THROUGH. "Close" = within max(pct %, atrMult × ATR) of a trading area.
// Wording rules: no "buy now"/"sell now", no order language, no sizing words unless the engine says READY
// (same contract as harmonizeCoach + FORBIDDEN_PHRASES). Analysis / practice only.
import type { MarketContext } from "./marketContext";
import { FORBIDDEN_PHRASES, type SetupStatus } from "./swingDecision";
import { FORBIDDEN_ALERT_WORDS } from "./priceAlerts";

export type TipZone = "APPROACHING" | "AT_LEVEL" | "THROUGH";
export const ZONE_LABEL: Record<TipZone, string> = { APPROACHING: "APPROACHING", AT_LEVEL: "AT LEVEL", THROUGH: "THROUGH" };
export type TipMode = "LEARN" | "PRACTICE" | "DISCIPLINED";
export interface TipConfig { pct: number; atrMult: number; atFrac: number; maxTips: number }
export const DEFAULT_TIP_CONFIG: TipConfig = { pct: 0.5, atrMult: 0.5, atFrac: 0.25, maxTips: 2 };

export type AreaKind = "ENTRY" | "TRIGGER" | "RETEST" | "STOP" | "T1" | "T2" | "HOD" | "LOD" | "PDH" | "PDL" | "RES" | "SUP" | "DRAWING";
export interface TradingArea { kind: AreaKind; price: number; name: string; extra?: string }
export interface ProximityTip {
  /** Rate-limit key: one tip per symbol per level per closed bar. */
  key: string; symbol: string; zone: TipZone; area: TradingArea; also: string[];
  price: number; distPct: number; side: "above" | "below" | "at";
  headline: string; what: string; watch: string; risk: string; learn: string;
  /** The text shown for the user's mode (Learn = long, Disciplined = short). */
  text: string; status: SetupStatus; bar: string | null;
}

const f2 = (n: number) => n.toFixed(2);
const SIZING = /(full pilot size|size up|scaling in|scale in|full size|consider scaling|shares|position size)/i;
const AREA_RANK: Record<AreaKind, number> = { STOP: 0, ENTRY: 1, TRIGGER: 1, RETEST: 2, T1: 3, T2: 4, DRAWING: 5, LOD: 6, HOD: 6, PDH: 7, PDL: 7, RES: 8, SUP: 8 };
const LIVE: SetupStatus[] = ["READY_TO_TRADE", "SETUP_CONFIRMED", "SETUP_FORMING", "WATCH_RETEST", "WATCH_EXTENDED", "WATCH_STOP_TOO_WIDE", "WATCH_RR_TOO_LOW"];

/** Every trading area the context knows about (plan levels only while the setup is live). */
export function tradingAreas(c: MarketContext): TradingArea[] {
  const d = c.decision, out: TradingArea[] = [];
  const add = (kind: AreaKind, price: number | null | undefined, name: string, extra?: string) => { if (price != null && Number.isFinite(price) && price > 0) out.push({ kind, price: Math.round(price * 100) / 100, name, extra }); };
  if (LIVE.includes(d.setupStatus)) {
    add("ENTRY", c.plan.entry, `${f2(c.plan.entry ?? 0)} entry`);
    if (d.originalTrigger != null && Math.abs(d.originalTrigger - (c.plan.entry ?? 0)) >= 0.005) add("TRIGGER", d.originalTrigger, `${f2(d.originalTrigger)} trigger`);
    if (d.retestLevel) { add("RETEST", d.retestLevel.high, `retest zone ${f2(d.retestLevel.low)}–${f2(d.retestLevel.high)}`); }
    add("STOP", c.plan.stop, `${f2(c.plan.stop ?? 0)} stop`);
    add("T1", c.plan.t1, `T1 ${f2(c.plan.t1 ?? 0)}`); add("T2", c.plan.t2, `T2 ${f2(c.plan.t2 ?? 0)}`);
  }
  if (c.trade) { add("STOP", c.trade.stop, `your trade's ${f2(c.trade.stop)} stop`); add("T1", c.trade.t1, `your trade's T1 ${f2(c.trade.t1)}`); }
  add("HOD", c.day.hod, `today's high ${f2(c.day.hod ?? 0)}`); add("LOD", c.day.lod, `today's low ${f2(c.day.lod ?? 0)}`);
  add("PDH", c.day.pdh, `the prior-day high ${f2(c.day.pdh ?? 0)}`); add("PDL", c.day.pdl, `the prior-day low ${f2(c.day.pdl ?? 0)}`);
  for (const l of c.sr.above) if (l.source === "PIVOT") add("RES", l.price, `resistance ${f2(l.price)}`, `strength ${l.strength}`);
  for (const l of c.sr.below) if (l.source === "PIVOT") add("SUP", l.price, `support ${f2(l.price)}`, `strength ${l.strength}`);
  for (const dr of c.drawings) { add("DRAWING", dr.price, `your drawn ${dr.priceHigh != null ? "zone" : "line"} ${f2(dr.price ?? 0)}`, dr.label || undefined); if (dr.priceHigh != null) add("DRAWING", dr.priceHigh, `your drawn zone top ${f2(dr.priceHigh)}`, dr.label || undefined); }
  return out;
}

/** Zone for one level: AT LEVEL inside the inner band, THROUGH once price crossed it since the last closed bar. */
export function zoneOf(price: number, level: number, refClose: number | null, tol: number, atTol: number): TipZone | null {
  const dist = price - level;
  if (Math.abs(dist) <= atTol) return "AT_LEVEL";
  if (refClose != null && Math.abs(refClose - level) > atTol && Math.sign(refClose - level) !== Math.sign(dist) && Math.abs(dist) <= tol * 2) return "THROUGH";
  if (Math.abs(dist) <= tol) return "APPROACHING";
  return null;
}

/** True when a line is safe for this status (the harmonizeCoach contract + alert wording rules). */
export function tipTextAllowed(status: SetupStatus, line: string): boolean {
  const banned = FORBIDDEN_PHRASES[status] ?? [];
  if (banned.some((p) => line.toLowerCase().includes(p.toLowerCase()))) return false;
  if (FORBIDDEN_ALERT_WORDS.some((r) => r.test(line))) return false;
  if (status !== "READY_TO_TRADE" && SIZING.test(line)) return false;
  return true;
}

/** Same vocabulary as the cockpit (client/src/lib/liveStatus.ts): never "Ready to Trade" while live risk is blocked. */
export const PRACTICE_READY_TIP_LABEL = "Practice Ready — live entry not permitted";
export const tipStatusLabel = (c: MarketContext, liveAllowed: boolean | null) =>
  c.decision.setupStatus === "READY_TO_TRADE" && liveAllowed === false ? PRACTICE_READY_TIP_LABEL : c.panel.statusLabel;

function words(c: MarketContext, a: TradingArea, zone: TipZone, side: "above" | "below" | "at", distPct: number, also: string[], liveAllowed: boolean | null) {
  const sym = c.symbol, st = c.decision.setupStatus, ready = st === "READY_TO_TRADE", blocked = ready && liveAllowed === false;
  const dist = `${Math.abs(distPct).toFixed(1)}%`;
  const near = also.length ? ` near ${also.join(" and ")}` : "";
  const ind = c.indicators, fading = ind.macd && ind.histPrev != null && Math.abs(ind.macd.hist) < Math.abs(ind.histPrev);
  const vol = ind.volRatio != null ? (ind.volRatio >= 1.2 ? "volume is above its 20-bar average" : ind.volRatio <= 0.7 ? "volume is light" : "volume is about average") : null;
  const where = zone === "AT_LEVEL" ? `is testing ${a.name}` : zone === "THROUGH" ? `moved ${side} ${a.name} since the last closed bar` : `is ${dist} ${side} ${a.name}`;
  const what = `${sym} ${where}${near}.`;
  let watch: string, risk = "OVERNIGHT GAP RISK — STOP ORDERS CAN FILL BELOW STOP PRICE. Targets are reference levels, not promises.";
  switch (a.kind) {
    case "ENTRY": case "TRIGGER": case "RETEST":
      watch = ready
        ? (zone === "THROUGH" && side === "below" ? "Price slipped back under the entry area; check whether the 1H closes back above it before relying on the plan." : (blocked ? "The engine lists this setup as Practice Ready only — live entry is not permitted (Capital Protection). Review the plan levels on the card as practice." : "The engine lists this setup as Ready. Review the plan levels and your risk on the card before you decide anything."))
        : zone === "THROUGH" && side === "above"
          ? "A newer quote alone does not confirm the setup. Wait for a closed 1H above it before treating this as confirmed."
          : "Wait for a closed 1H above it before treating this as confirmed.";
      break;
    case "STOP":
      watch = zone === "THROUGH" ? "Price is under the stop area. Re-read the plan's invalidation rule and check whether the 1H closes back above it." : "Check volume and whether a bullish reversal bar forms.";
      risk = "OVERNIGHT GAP RISK — STOP ORDERS CAN FILL BELOW STOP PRICE.";
      break;
    case "T1": case "T2":
      watch = "Review the plan's management notes for this target.";
      break;
    case "LOD": case "PDL": case "SUP":
      watch = "Check volume and whether a bullish reversal bar forms.";
      break;
    case "HOD": case "PDH": case "RES":
      watch = fading ? "MACD histogram is fading: consider waiting for the retest." : "Watch whether a closed bar holds above it or gets rejected.";
      break;
    default: {
      const res = side === "below" || (side === "at" && (c.quote.price ?? 0) <= a.price);
      watch = res ? (fading ? "MACD histogram is fading: consider waiting for the retest." : "Watch whether a closed bar holds above your line or gets rejected.") : "Check volume and whether a bullish reversal bar forms.";
    }
  }
  if (a.kind === "DRAWING") {
    const res = side === "below" || (side === "at" && (c.quote.price ?? 0) <= a.price);
    a = { ...a, name: a.name.replace("your drawn line", res ? "your drawn resistance line" : "your drawn support line") };
  }
  const what2 = `${sym} ${zone === "AT_LEVEL" ? `is at ${a.name}` : where.replace(/^is /, "is ")}${near}.`;
  const learn = [
    zone === "APPROACHING" ? `Price is within ${dist} of this area (the "close" band is the larger of your % setting and half an ATR).` : zone === "AT_LEVEL" ? "Price is inside the level's inner band right now." : "The last closed bar was on the other side of this level, so price has moved through it intraday.",
    a.extra ? `This level: ${a.extra}.` : "",
    vol ? `Right now ${vol}.` : "",
    `Engine status stays ${tipStatusLabel(c, liveAllowed)}; a tip never changes it.`,
  ].filter(Boolean).join(" ");
  return { what: a.kind === "DRAWING" || zone === "AT_LEVEL" ? what2 : what, watch, risk, learn };
}

/** Tips for one symbol from ONE context. Pure: same context + config → same tips. */
export function proximityTips(c: MarketContext, cfg: TipConfig = DEFAULT_TIP_CONFIG, mode: TipMode = "PRACTICE", atr?: number | null, liveAllowed: boolean | null = null): ProximityTip[] {
  const price = c.quote.price; if (price == null || !(price > 0)) return [];
  const a14 = atr ?? c.indicators.atr ?? null;
  const ref = c.lastClosed?.c ?? null, st = c.decision.setupStatus;
  const areas = tradingAreas(c);
  const tolOf = (lvl: number) => Math.max((cfg.pct / 100) * lvl, a14 != null ? cfg.atrMult * a14 : 0);
  type Hit = { a: TradingArea; zone: TipZone; dist: number };
  const hits: Hit[] = [];
  for (const a of areas) { const tol = tolOf(a.price), z = zoneOf(price, a.price, ref, tol, tol * cfg.atFrac); if (z) hits.push({ a, zone: z, dist: price - a.price }); }
  // Merge areas that sit on (almost) the same price: "testing today's low 63.50 near your stop".
  hits.sort((x, y) => AREA_RANK[x.a.kind] - AREA_RANK[y.a.kind] || Math.abs(x.dist) - Math.abs(y.dist));
  const used = new Set<number>(), tips: ProximityTip[] = [];
  const zoneRank: Record<TipZone, number> = { AT_LEVEL: 0, THROUGH: 1, APPROACHING: 2 };
  const order = hits.map((h, i) => ({ h, i })).sort((x, y) => zoneRank[x.h.zone] - zoneRank[y.h.zone] || Math.abs(x.h.dist) - Math.abs(y.h.dist) || AREA_RANK[x.h.a.kind] - AREA_RANK[y.h.a.kind]);
  for (const { h, i } of order) {
    if (used.has(i)) continue; used.add(i);
    const also: string[] = [];
    hits.forEach((o, j) => { if (!used.has(j) && Math.abs(o.a.price - h.a.price) <= Math.max(0.0015 * h.a.price, 0.01)) { used.add(j); also.push(o.a.kind === "STOP" ? "your stop" : o.a.name); } });
    const distPct = ((price - h.a.price) / h.a.price) * 100;
    const side = h.zone === "AT_LEVEL" ? "at" : price > h.a.price ? "above" : "below";
    const w = words(c, h.a, h.zone, side, distPct, also, liveAllowed);
    const headline = `${ZONE_LABEL[h.zone]} · ${h.a.name}`;
    const full = [w.what, w.watch, w.risk].filter(Boolean);
    if (![headline, ...full, w.learn].every((x) => tipTextAllowed(st, x) && !(liveAllowed === false && (SIZING.test(x) || /ready to trade/i.test(x))))) continue; // never shown if it could contradict
    const text = mode === "DISCIPLINED" ? `${w.what} ${w.watch}` : mode === "LEARN" ? `${full.join(" ")} ${w.learn}` : full.join(" ");
    tips.push({
      key: `${c.symbol}|${h.a.kind}|${h.a.price.toFixed(2)}|${c.lastClosedBar ?? ""}`, symbol: c.symbol, zone: h.zone, area: h.a, also,
      price, distPct: Math.round(distPct * 100) / 100, side, headline, what: w.what, watch: w.watch, risk: w.risk, learn: w.learn, text,
      status: st, bar: c.lastClosedBar,
    });
    if (tips.length >= cfg.maxTips) break;
  }
  return tips;
}

/** Rate limiter: at most one tip per symbol per level per closed bar (the key encodes all three). */
export function newTips(tips: ProximityTip[], seen: Set<string>): ProximityTip[] {
  const out: ProximityTip[] = [];
  for (const t of tips) if (!seen.has(t.key)) { seen.add(t.key); out.push(t); }
  return out;
}
