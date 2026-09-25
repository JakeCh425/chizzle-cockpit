// PR 3d — §Q4 chart overlay + §Q8 fixtures. Markers come only from SwingDecision objects.
import { describe, it, expect } from "vitest";
import { buildOverlay, clusterMarkers, MARKER_COPY } from "../../server/swing/markers";
import { flat, type OHLC } from "../fixtures/builders";
import { raw1HFrom4H, raw1H, scale, dailySeries, upTo } from "../fixtures/replay";
import { T, run, smh, post, endOf, K, base, rbEnd } from "../fixtures/smh";
import { practiceVerdict, FORBIDDEN_PHRASES, type ChartMarker } from "@shared/swingDecision";

const kinds = (ms: ChartMarker[]) => ms.map((m) => m.kind);

describe("§Q8-1 SMH reclaim → extended: historical markers preserved", () => {
  it("READY bar shows CONFIRMED + READY + entry/stop/T1/T2 lines; entry is solid once triggered", () => {
    const r = run(T.ready); const o = buildOverlay(r, { scope: "CURRENT" });
    expect(r.decision.setupStatus).toBe("READY_TO_TRADE");
    expect(kinds(o.markers)).toEqual(expect.arrayContaining(["CONFIRMED", "READY"]));
    const ready = o.markers.find((m) => m.kind === "READY")!;
    expect(ready.label).toBe("READY — PRACTICE PLAN");
    expect(ready.timeframe).toBe("1H");
    expect(ready.time).toBe(post[4].t); // the confirming closed 1H bar
    const byKind = Object.fromEntries(o.levels.map((l) => [l.kind, l]));
    expect(byKind.ENTRY.label).toMatch(/^ENTRY TRIGGER: \$[\d.]+$/);
    expect(byKind.ENTRY.style).toBe("solid");
    expect(byKind.ENTRY.tooltip).toContain(MARKER_COPY.ENTRY);
    expect(byKind.STOP.label).toMatch(/^INVALIDATION \/ STOP: \$[\d.]+$/);
    expect(byKind.STOP.tooltip).toContain(MARKER_COPY.STOP);
    expect(byKind.T1.label).toMatch(/^T1: \$[\d.]+ — [\d.]+R$/);
    expect(byKind.T2).toBeDefined();
    expect(JSON.stringify(o)).not.toMatch(/buy now/i);
  });
  it("after the run to ≈600 the original CONFIRMED marker is still there, plus EXTENDED and a retest zone; no READY", () => {
    const rr = run(T.ready), re = run(T.extended);
    const confirmedAtReady = buildOverlay(rr, { scope: "ALL" }).markers.find((m) => m.kind === "CONFIRMED" && m.current)!;
    const o = buildOverlay(re, { scope: "LAST5" });
    expect(re.decision.setupStatus).toBe("WATCH_EXTENDED");
    expect(o.markers.some((m) => m.kind === "CONFIRMED" && m.time === confirmedAtReady.time)).toBe(true);
    const ext = o.markers.find((m) => m.kind === "EXTENDED")!;
    expect(ext.label).toBe("EXTENDED — AWAIT RETEST");
    expect(ext.tooltip).toContain(MARKER_COPY.EXTENDED);
    expect(o.markers.some((m) => m.kind === "READY")).toBe(false);
    const z = o.zones.find((x) => x.kind === "RETEST")!;
    expect(z.low).toBe(re.decision.retestLevel!.low);
    expect(z.tooltip).toContain(MARKER_COPY.RETEST);
    expect(o.history.find((h) => h.current)?.trigger).toBe(rr.decision.originalTrigger);
    expect(practiceVerdict(re.decision).code).toBe("C_WAIT_EXTENDED");
  });
  it("FORMING marker on the developing bar, with the fixed tooltip", () => {
    const o = buildOverlay(run(T.forming), { scope: "CURRENT" });
    const f = o.markers.find((m) => m.kind === "FORMING")!;
    expect(f.label).toMatch(/^FORMING: /);
    expect(f.tooltip).toContain(MARKER_COPY.FORMING);
    expect(o.markers.some((m) => m.kind === "READY")).toBe(false);
  });
});

describe("§Q8-2 QQQ first pullback — lines drawn from the decision", () => {
  const bo: OHLC = [100.4, 101.6, 100.3, 101.5];
  const b = raw1HFrom4H(scale([...flat(22), bo], 4.8));
  const boEnd = b[b.length - 1].t + 3600;
  const bars = [...b, ...raw1H(scale([[101.5, 101.9, 101.3, 101.8], [101.8, 101.85, 101.1, 101.2], [101.2, 101.25, 100.7, 100.8], [100.8, 101.7, 100.72, 101.65], [101.65, 102.0, 101.6, 101.95]], 4.8), boEnd)];
  const p = bars.filter((x) => x.t >= boEnd);
  it("every level equals the decision's numbers; entry dashed until triggered", () => {
    const r = run(endOf(p[3]), { minRrT1: 1.5 }, {}, bars, dailySeries(Array(140).fill(487)), "QQQ");
    const o = buildOverlay(r, { scope: "CURRENT" });
    const d = r.decision;
    if (d.entryPrice != null && o.levels.length) {
      expect(o.levels.find((l) => l.kind === "ENTRY")!.price).toBe(d.entryPrice);
      expect(o.levels.find((l) => l.kind === "STOP")!.price).toBe(d.structuralStop);
      expect(o.levels.find((l) => l.kind === "T1")!.price).toBe(d.target1);
      if (d.setupStatus !== "READY_TO_TRADE") expect(o.levels.find((l) => l.kind === "ENTRY")!.style).toBe("dashed");
    }
    expect(o.history.length).toBeGreaterThan(0);
  });
});

describe("§Q8-3 SPY higher-low — no READY until the 1H closes", () => {
  const b = raw1HFrom4H(scale(flat(22), 6.6));
  const end = b[b.length - 1].t + 3600;
  const rows: OHLC[] = [
    ...flat(10).map(([o, h, l, c]) => [o, h, l + 0.4, c] as OHLC),
    [99.9, 100.0, 99.5, 99.6], [99.6, 99.7, 99.2, 99.3], [99.3, 99.5, 99.0, 99.4],
    [99.4, 100.2, 99.3, 100.1], [100.1, 101.0, 100.3, 100.9], [100.9, 100.95, 100.4, 100.5],
    [100.5, 100.6, 100.1, 100.4], [100.4, 100.8, 100.25, 100.6], [100.6, 100.8, 100.3, 100.5],
    [100.5, 100.75, 100.35, 100.7], [100.7, 101.3, 100.6, 101.2],
  ];
  const bars = [...b, ...raw1H(scale(rows, 6.6), end)];
  const last = bars[bars.length - 1];
  const spy = (now: number) => run(now, {}, {}, bars, dailySeries(Array(140).fill(660)), "SPY");
  it("mid-bar: no READY status and no READY marker anywhere", () => {
    const r = spy(last.t + 900); // last RTH bar is the 14:30–15:00 half-hour; 15 min in = still open
    expect(r.decision.setupStatus).not.toBe("READY_TO_TRADE");
    expect(buildOverlay(r, { scope: "ALL" }).markers.some((m) => m.kind === "READY")).toBe(false);
    expect(FORBIDDEN_PHRASES[r.decision.setupStatus].some((p) => practiceVerdict(r.decision).headline.includes(p))).toBe(false);
  });
  it("READY markers only ever appear with READY status", () => {
    const r = spy(last.t + 1800);
    const hasReady = buildOverlay(r, { scope: "ALL" }).markers.some((m) => m.kind === "READY" && m.current);
    expect(hasReady).toBe(r.decision.setupStatus === "READY_TO_TRADE");
  });
});

describe("§Q8-4 mismatch — markers allowed, READY blocked", () => {
  it("0.2% reference disagreement: CONFIRMED marker stays, no READY marker, verdict NOT YET", () => {
    const lastBar = upTo(smh, T.ready).filter((b) => b.t + 3600 <= T.ready).pop()!;
    const r = run(T.ready, {}, { reference: { symbol: "SMH", close: lastBar.c * 1.002, barEnd: lastBar.t + 3600, source: "tradingview" } });
    const o = buildOverlay(r, { scope: "CURRENT" });
    expect(r.decision.setupStatus).toBe("BLOCKED_DATA_MISMATCH");
    expect(o.markers.some((m) => m.kind === "CONFIRMED")).toBe(true);
    expect(o.markers.some((m) => m.kind === "READY")).toBe(false);
    expect(practiceVerdict(r.decision).code).toBe("B_NOT_YET");
  });
});

describe("§Q8-5/6 stop too wide, R:R too low → PASS verdict", () => {
  it("tiny max dollar risk → WATCH_STOP_TOO_WIDE or R:R fail → D_PASS_RISK", () => {
    const r = run(T.ready, { maxDollarRisk: 1 });
    const v = practiceVerdict(r.decision);
    if (r.decision.setupStatus === "WATCH_STOP_TOO_WIDE" || r.decision.setupStatus === "WATCH_RR_TOO_LOW") expect(v.code).toBe("D_PASS_RISK");
    expect(v.riskWarning).toMatch(/OVERNIGHT GAP RISK/);
  });
  it("min R:R 2.5 on a thin target → verdict never A_READY unless READY", () => {
    const r = run(T.ready, { minRrT1: 2.5 });
    expect(practiceVerdict(r.decision).code === "A_READY").toBe(r.decision.setupStatus === "READY_TO_TRADE");
  });
});

describe("§Q8-7 historical marker persistence + clustering", () => {
  it("a setup seen at READY is still in history at every later bar of the run", () => {
    const id = buildOverlay(run(T.ready), { scope: "CURRENT" }).history.find((h) => h.current)!.id;
    for (let i = 5; i <= 9; i++) expect(buildOverlay(run(endOf(post[i])), { scope: "ALL" }).history.some((h) => h.id === id)).toBe(true);
  });
  it("same-kind markers on one bar merge with a +n count", () => {
    const m = (id: string): ChartMarker => ({ id, kind: "CONFIRMED", time: 10, barEnd: 20, timeframe: "4H", price: 1, label: "CONFIRMED: A", setupType: "HAMMER", status: "SETUP_CONFIRMED", tooltip: [id], current: false });
    const c = clusterMarkers([m("a"), m("b"), m("c")]);
    expect(c.length).toBe(1);
    expect(c[0].label).toBe("CONFIRMED: A +2");
    expect(c[0].tooltip).toEqual(["a", "—", "b", "—", "c"]);
  });
  it("scope CURRENT ⊆ LAST5 ⊆ ALL", () => {
    const r = run(T.extended);
    const n = (s: any) => buildOverlay(r, { scope: s }).markers.length;
    expect(n("CURRENT")).toBeLessThanOrEqual(n("LAST5"));
    expect(n("LAST5")).toBeLessThanOrEqual(n("ALL"));
  });
});

describe("invalidation / expiry markers", () => {
  it("closed 1H below structure → SETUP INVALIDATED marker with the lesson", () => {
    const dump = [...base, ...raw1H(scale([[100.5, 100.6, 98.5, 98.6], [98.6, 98.8, 98.3, 98.4]], K), rbEnd)];
    const o = buildOverlay(run(rbEnd + 2 * 3600, {}, {}, dump), { scope: "ALL" });
    const x = o.markers.find((m) => m.kind === "INVALIDATED");
    expect(x?.label).toMatch(/^SETUP INVALIDATED( \+\d+)?$/);
    expect(x?.tooltip).toContain(MARKER_COPY.INVALIDATED);
  });
});

describe("risk-policy WATCH ages out (live SMH finding 2026-09-24)", () => {
  const ref = run(T.ready).decision; // the reclaim setup at default risk
  const same = (r: ReturnType<typeof run>) => r.candidates.find((x) => x.decision.setupType === ref.setupType && x.decision.setupTimestamp === ref.setupTimestamp)!;
  it("stop-too-wide at signal stays WATCH until a later closed 1H passes T1, then SIGNAL_EXPIRED (kept in history, EXPIRED marker)", () => {
    expect(same(run(T.ready, { maxDollarRisk: 5 })).decision.setupStatus).toBe("WATCH_STOP_TOO_WIDE");
    const t1 = ref.target1!;
    const k = post.findIndex((b, i) => i > 4 && b.c >= t1);
    expect(k).toBeGreaterThan(4);
    expect(same(run(endOf(post[k - 1]), { maxDollarRisk: 5 })).decision.setupStatus).toBe("WATCH_STOP_TOO_WIDE");
    const r = run(endOf(post[k]), { maxDollarRisk: 5 });
    const c = same(r);
    expect(c.decision.setupStatus).toBe("SIGNAL_EXPIRED");
    expect(c.decision.whyNotReady[0]).toMatch(/^Expired: risk never fit .* passed T1/);
    const o = buildOverlay(r, { scope: "ALL" });
    expect(o.markers.some((m) => m.kind === "EXPIRED")).toBe(true);
    expect(o.history.some((h) => h.setupType === ref.setupType && h.status === "SIGNAL_EXPIRED")).toBe(true);
  });
});
