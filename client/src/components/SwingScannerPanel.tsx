// ─── Chizzle Swing Scanner Panel ────────────────────────────────────────────
// One-tap scan across the ETF universe (plus optional single stocks). Runs the
// server /api/swing-scan endpoint which auto-derives entry/stop/T1/T2 for each
// candidate and rates them through the tiered Chizzle Trade Evaluator.
//
// Output:
//   • MARKET_TONE badge (trending / orderly_pullback / choppy)
//   • Top 1–3 setups with tier color, RR, one-sentence reason, card summary
//   • Deterministic RISK_GUIDANCE (max positions + size)
//   • Collapsible diagnostics (SPY vs 20 SMA, breadth, rejects)
//
// Collapsed by default to keep the cockpit clean.

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  ChevronDown, ChevronUp, ShieldCheck, BookOpenCheck, XCircle,
  Loader2, Sparkles, Radar, TrendingUp, TrendingDown, MinusCircle,
  Cpu, Pause,
} from "lucide-react";

type TradeStatus =
  | "STANDARD_SWING_APPROVED"
  | "FLEX_SWING_APPROVED"
  | "PRACTICE_CARD"
  | "NO_TRADE";

type MarketTone = "trending" | "orderly_pullback" | "choppy";
type RiskSize = "tiny_practice" | "small" | "normal" | "no_new";

type SmhDayClass = "SWING_DAY" | "PRACTICE_SWING_DAY" | "STANDBY_DAY";

interface SmhRegimeSnapshot {
  day_class: SmhDayClass;
  reason: string;
  smh: {
    last: number;
    sma20: number;
    sma50: number;
    sma50_slope_10d_pct: number;
    peak_120d: number;
    drawdown_from_peak_pct: number;
    dist_from_20sma_pct: number;
    dist_from_50sma_pct: number;
    trend_intact: boolean;
    structure_messy: boolean;
  };
  leaders: {
    breadth_above_20sma_pct: number;
    detail: Array<{ ticker: string; last: number; sma20: number; above: boolean }>;
  };
  computed_at: string;
}

interface SwingSetup {
  ticker: string;
  direction: "long";
  setup_type: string;
  entry: number;
  stop: number;
  t1: number;
  t2: number;
  risk_reward: number;
  status: TradeStatus;
  technical_score: number;
  fundamental_score: number;
  one_sentence_reason: string;
  card_summary_5_lines: string[] | null;
  distance_from_sma20_pct: number;
  current_price: number;
  sma20: number;
}

interface SwingScanResult {
  market_tone: MarketTone;
  scanned_at: string;
  universe_size: number;
  include_stocks: boolean;
  setups: SwingSetup[];
  risk_guidance: { max_positions: number; size: RiskSize; note: string };
  smh_regime: SmhRegimeSnapshot;
  diagnostics: {
    spy_last: number | null;
    spy_sma20: number | null;
    spy_dist_pct: number | null;
    pct_above_20sma: number;
    rejected: Array<{ ticker: string; reason: string }>;
  };
}

const SMH_TIER_STYLES: Record<SmhDayClass, { border: string; bg: string; text: string; label: string; Icon: any }> = {
  SWING_DAY: {
    border: "border-signal-green",
    bg: "bg-signal-green/10",
    text: "text-signal-green",
    label: "SWING DAY",
    Icon: Cpu,
  },
  PRACTICE_SWING_DAY: {
    border: "border-signal-amber",
    bg: "bg-signal-amber/10",
    text: "text-signal-amber",
    label: "PRACTICE DAY",
    Icon: BookOpenCheck,
  },
  STANDBY_DAY: {
    border: "border-signal-red",
    bg: "bg-signal-red/10",
    text: "text-signal-red",
    label: "STANDBY",
    Icon: Pause,
  },
};

const TIER_STYLES: Record<TradeStatus, { border: string; bg: string; text: string; label: string; Icon: any }> = {
  STANDARD_SWING_APPROVED: {
    border: "border-signal-green",
    bg: "bg-signal-green/10",
    text: "text-signal-green",
    label: "STANDARD",
    Icon: ShieldCheck,
  },
  FLEX_SWING_APPROVED: {
    border: "border-neon-blue",
    bg: "bg-neon-blue/10",
    text: "text-neon-blue",
    label: "FLEX",
    Icon: Sparkles,
  },
  PRACTICE_CARD: {
    border: "border-signal-amber",
    bg: "bg-signal-amber/10",
    text: "text-signal-amber",
    label: "PRACTICE",
    Icon: BookOpenCheck,
  },
  NO_TRADE: {
    border: "border-signal-red",
    bg: "bg-signal-red/10",
    text: "text-signal-red",
    label: "NO TRADE",
    Icon: XCircle,
  },
};

const TONE_STYLES: Record<MarketTone, { text: string; bg: string; label: string; Icon: any }> = {
  trending: {
    text: "text-signal-green",
    bg: "bg-signal-green/10",
    label: "TRENDING",
    Icon: TrendingUp,
  },
  orderly_pullback: {
    text: "text-neon-blue",
    bg: "bg-neon-blue/10",
    label: "ORDERLY PULLBACK",
    Icon: MinusCircle,
  },
  choppy: {
    text: "text-signal-amber",
    bg: "bg-signal-amber/10",
    label: "CHOPPY",
    Icon: TrendingDown,
  },
};

const SIZE_LABEL: Record<RiskSize, string> = {
  no_new: "NO NEW TRADES",
  tiny_practice: "TINY / PRACTICE",
  small: "SMALL",
  normal: "NORMAL",
};

function ScoreBar({ score, max = 5, tone }: { score: number; max?: number; tone: string }) {
  return (
    <div className="flex gap-0.5">
      {Array.from({ length: max }).map((_, i) => (
        <div
          key={i}
          className={`h-1.5 w-3 rounded-sm ${i < score ? tone : "bg-ink-line"}`}
        />
      ))}
    </div>
  );
}

export default function SwingScannerPanel() {
  const [expanded, setExpanded] = useState(true);
  const [includeStocks, setIncludeStocks] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [result, setResult] = useState<SwingScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const scanMutation = useMutation<SwingScanResult, Error, void>({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/swing-scan", {
        include_stocks: includeStocks,
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Scan failed");
      }
      return res.json();
    },
    onSuccess: (data) => {
      setResult(data);
      setError(null);
    },
    onError: (err) => {
      setError(err.message || "Scan failed");
      setResult(null);
    },
  });

  return (
    <div className="rounded-lg border border-ink-line bg-ink-panel shadow-sm" data-testid="panel-swing-scanner">
      {/* Header */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-ink-deep rounded-t-lg"
        data-testid="button-toggle-swing-scanner"
      >
        <div className="flex items-center gap-2">
          <Radar className="h-4 w-4 text-neon-blue" />
          <span className="text-sm font-medium text-soft-white">
            Swing Scanner
          </span>
          <span className="text-xs text-slate-gray">
            — one-tap scan across your ETF universe
          </span>
        </div>
        {expanded ? (
          <ChevronUp className="h-4 w-4 text-slate-gray" />
        ) : (
          <ChevronDown className="h-4 w-4 text-slate-gray" />
        )}
      </button>

      {expanded && (
        <div className="border-t border-ink-line p-4 space-y-4">
          {/* Controls */}
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => scanMutation.mutate()}
              disabled={scanMutation.isPending}
              className="inline-flex items-center gap-2 rounded-md bg-neon-blue px-4 py-2 text-sm font-semibold text-ink-black hover:bg-neon-blue/90 disabled:opacity-50 disabled:cursor-not-allowed"
              data-testid="button-scan-now"
            >
              {scanMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Scanning…
                </>
              ) : (
                <>
                  <Radar className="h-4 w-4" />
                  Scan Now
                </>
              )}
            </button>

            <label className="inline-flex items-center gap-2 text-sm text-soft-white cursor-pointer select-none">
              <input
                type="checkbox"
                checked={includeStocks}
                onChange={(e) => setIncludeStocks(e.target.checked)}
                className="h-4 w-4 rounded border-ink-line bg-ink-deep text-neon-blue focus:ring-neon-blue"
                data-testid="checkbox-include-stocks"
              />
              Include single stocks
            </label>

            {result && (
              <span className="text-xs text-slate-gray ml-auto">
                Scanned {new Date(result.scanned_at).toLocaleTimeString()} · {result.universe_size} symbols
              </span>
            )}
          </div>

          {/* Error */}
          {error && (
            <div className="rounded-md border border-signal-red bg-signal-red/10 p-3 text-sm text-signal-red" data-testid="text-scan-error">
              {error}
            </div>
          )}

          {/* Result */}
          {result && (
            <div className="space-y-3">
              {/* SMH regime gauge — primary day classifier */}
              {(() => {
                const smh = result.smh_regime;
                const style = SMH_TIER_STYLES[smh.day_class];
                const Icon = style.Icon;
                return (
                  <div
                    className={`rounded-md border ${style.border} ${style.bg} p-3`}
                    data-testid="section-smh-regime"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Icon className={`h-4 w-4 ${style.text}`} />
                        <span className={`text-sm font-bold ${style.text}`}>
                          SMH REGIME: {style.label}
                        </span>
                      </div>
                      <div className="text-xs text-slate-gray">
                        SMH ${smh.smh.last.toFixed(2)} · 20SMA ${smh.smh.sma20.toFixed(2)} · 50SMA ${smh.smh.sma50.toFixed(2)}
                      </div>
                    </div>
                    <div className="text-xs text-soft-white mb-2">{smh.reason}</div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                      <div>
                        <div className="text-slate-gray">Drawdown</div>
                        <div className={`font-mono ${smh.smh.drawdown_from_peak_pct <= -8 ? "text-signal-amber" : "text-soft-white"}`}>
                          {smh.smh.drawdown_from_peak_pct.toFixed(2)}%
                        </div>
                      </div>
                      <div>
                        <div className="text-slate-gray">50 SMA slope 10d</div>
                        <div className={`font-mono ${smh.smh.sma50_slope_10d_pct >= 0 ? "text-signal-green" : "text-signal-red"}`}>
                          {smh.smh.sma50_slope_10d_pct >= 0 ? "+" : ""}{smh.smh.sma50_slope_10d_pct.toFixed(2)}%
                        </div>
                      </div>
                      <div>
                        <div className="text-slate-gray">Trend intact</div>
                        <div className={`font-mono ${smh.smh.trend_intact ? "text-signal-green" : "text-signal-red"}`}>
                          {smh.smh.trend_intact ? "YES" : "NO"}
                        </div>
                      </div>
                      <div>
                        <div className="text-slate-gray">Leaders ≥ 20 SMA</div>
                        <div className="font-mono text-soft-white">
                          {smh.leaders.breadth_above_20sma_pct.toFixed(0)}%
                        </div>
                      </div>
                    </div>
                    {smh.leaders.detail.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {smh.leaders.detail.map((l) => (
                          <span
                            key={l.ticker}
                            className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${l.above ? "border-signal-green text-signal-green" : "border-signal-red text-signal-red"}`}
                          >
                            {l.ticker} {l.above ? "↑" : "↓"}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* MARKET_TONE + RISK_GUIDANCE strip */}
              <div className="flex flex-wrap items-center gap-3 rounded-md border border-ink-line bg-ink-black p-3">
                {(() => {
                  const tone = TONE_STYLES[result.market_tone];
                  const ToneIcon = tone.Icon;
                  return (
                    <div className={`inline-flex items-center gap-2 rounded-md px-2.5 py-1 text-xs font-semibold ${tone.bg} ${tone.text}`}>
                      <ToneIcon className="h-3.5 w-3.5" />
                      MARKET TONE: {tone.label}
                    </div>
                  );
                })()}
                <div className="text-xs text-slate-gray">
                  Size: <span className="text-soft-white font-medium">{SIZE_LABEL[result.risk_guidance.size]}</span>
                  {" · "}Max positions: <span className="text-soft-white font-medium">{result.risk_guidance.max_positions}</span>
                </div>
                <div className="text-xs text-slate-gray w-full">{result.risk_guidance.note}</div>
              </div>

              {/* Setups */}
              {result.setups.length === 0 ? (
                <div className="rounded-md border border-signal-red bg-signal-red/5 p-4 text-sm text-soft-white" data-testid="text-no-setups">
                  <div className="font-semibold text-signal-red mb-1">No new swing trades today</div>
                  <div className="text-slate-gray">
                    Nothing passed the Chizzle filters (min 2:1 RR, 20 SMA pullback zone, professional structure).
                    Wait for a real setup.
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {result.setups.map((s) => {
                    const style = TIER_STYLES[s.status];
                    const Icon = style.Icon;
                    const scoreTone = style.text.replace("text-", "bg-");
                    return (
                      <div
                        key={s.ticker}
                        className={`rounded-md border ${style.border} ${style.bg} p-4`}
                        data-testid={`card-setup-${s.ticker}`}
                      >
                        {/* Header row */}
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <Icon className={`h-5 w-5 ${style.text}`} />
                            <span className="text-lg font-bold text-soft-white">{s.ticker}</span>
                            <span className={`text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${style.text} border ${style.border}`}>
                              {style.label}
                            </span>
                            <span className="text-xs text-slate-gray">LONG · {s.setup_type}</span>
                          </div>
                          <div className="text-right">
                            <div className="text-xs text-slate-gray">RR</div>
                            <div className={`text-lg font-bold ${style.text}`}>{s.risk_reward.toFixed(2)}:1</div>
                          </div>
                        </div>

                        {/* Levels grid */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3 text-sm">
                          <div className="rounded bg-ink-black/50 px-2 py-1.5">
                            <div className="text-[10px] text-slate-gray uppercase">Entry</div>
                            <div className="font-mono text-soft-white" data-testid={`text-entry-${s.ticker}`}>${s.entry.toFixed(2)}</div>
                          </div>
                          <div className="rounded bg-ink-black/50 px-2 py-1.5">
                            <div className="text-[10px] text-slate-gray uppercase">Stop</div>
                            <div className="font-mono text-signal-red" data-testid={`text-stop-${s.ticker}`}>${s.stop.toFixed(2)}</div>
                          </div>
                          <div className="rounded bg-ink-black/50 px-2 py-1.5">
                            <div className="text-[10px] text-slate-gray uppercase">T1</div>
                            <div className="font-mono text-signal-green" data-testid={`text-t1-${s.ticker}`}>${s.t1.toFixed(2)}</div>
                          </div>
                          <div className="rounded bg-ink-black/50 px-2 py-1.5">
                            <div className="text-[10px] text-slate-gray uppercase">T2</div>
                            <div className="font-mono text-signal-green" data-testid={`text-t2-${s.ticker}`}>${s.t2.toFixed(2)}</div>
                          </div>
                        </div>

                        {/* Scores */}
                        <div className="flex flex-wrap items-center gap-4 mb-2 text-xs">
                          <div className="flex items-center gap-2">
                            <span className="text-slate-gray">Tech {s.technical_score}/5</span>
                            <ScoreBar score={s.technical_score} tone={scoreTone} />
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-slate-gray">Fund {s.fundamental_score}/5</span>
                            <ScoreBar score={s.fundamental_score} tone={scoreTone} />
                          </div>
                          <div className="text-slate-gray">
                            Now <span className="font-mono text-soft-white">${s.current_price.toFixed(2)}</span>
                            {" · "}20 SMA <span className="font-mono text-soft-white">${s.sma20.toFixed(2)}</span>
                            {" ("}
                            <span className={s.distance_from_sma20_pct >= 0 ? "text-signal-green" : "text-signal-red"}>
                              {s.distance_from_sma20_pct >= 0 ? "+" : ""}{s.distance_from_sma20_pct.toFixed(2)}%
                            </span>
                            {")"}
                          </div>
                        </div>

                        {/* One-sentence reason */}
                        <div className="text-sm text-soft-white mb-2" data-testid={`text-reason-${s.ticker}`}>
                          {s.one_sentence_reason}
                        </div>

                        {/* Card summary (only if approved) */}
                        {s.card_summary_5_lines && s.card_summary_5_lines.length > 0 && (
                          <div className="rounded bg-ink-black/60 border border-ink-line p-2 mt-2">
                            <div className="text-[10px] text-slate-gray uppercase mb-1">Card Summary</div>
                            <ul className="space-y-0.5 text-xs text-soft-white font-mono">
                              {s.card_summary_5_lines.map((line, i) => (
                                <li key={i}>{line}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Diagnostics */}
              <button
                type="button"
                onClick={() => setShowDiagnostics((v) => !v)}
                className="text-xs text-slate-gray hover:text-soft-white inline-flex items-center gap-1"
                data-testid="button-toggle-diagnostics"
              >
                {showDiagnostics ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                Diagnostics
              </button>

              {showDiagnostics && (
                <div className="rounded-md border border-ink-line bg-ink-black p-3 text-xs space-y-2" data-testid="section-diagnostics">
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    <div>
                      <div className="text-slate-gray">SPY last</div>
                      <div className="font-mono text-soft-white">
                        {result.diagnostics.spy_last?.toFixed(2) ?? "—"}
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-gray">SPY 20 SMA</div>
                      <div className="font-mono text-soft-white">
                        {result.diagnostics.spy_sma20?.toFixed(2) ?? "—"}
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-gray">SPY vs 20 SMA</div>
                      <div className="font-mono text-soft-white">
                        {result.diagnostics.spy_dist_pct !== null
                          ? `${result.diagnostics.spy_dist_pct >= 0 ? "+" : ""}${result.diagnostics.spy_dist_pct.toFixed(2)}%`
                          : "—"}
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-gray">Breadth ≥ 20 SMA</div>
                      <div className="font-mono text-soft-white">
                        {result.diagnostics.pct_above_20sma.toFixed(1)}%
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-gray">Universe</div>
                      <div className="font-mono text-soft-white">
                        {result.universe_size} symbols
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-gray">Rejected</div>
                      <div className="font-mono text-soft-white">
                        {result.diagnostics.rejected.length}
                      </div>
                    </div>
                  </div>

                  {result.diagnostics.rejected.length > 0 && (
                    <div className="pt-2 border-t border-ink-line">
                      <div className="text-slate-gray mb-1">Filter rejects</div>
                      <ul className="space-y-0.5 text-slate-gray font-mono">
                        {result.diagnostics.rejected.slice(0, 10).map((r) => (
                          <li key={r.ticker}>
                            <span className="text-soft-white">{r.ticker}</span>: {r.reason}
                          </li>
                        ))}
                        {result.diagnostics.rejected.length > 10 && (
                          <li className="text-slate-gray">…and {result.diagnostics.rejected.length - 10} more</li>
                        )}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* First-run empty state */}
          {!result && !error && !scanMutation.isPending && (
            <div className="text-xs text-slate-gray border border-dashed border-ink-line rounded-md p-3">
              Tap <span className="text-neon-blue font-medium">Scan Now</span> to run the Chizzle swing filter across your ETF universe.
              Toggle single stocks on if you want NVDA/AMD/MU/TSM/AAPL/META/MSFT in the mix.
              Results show only STANDARD, FLEX, or PRACTICE tier — never NO_TRADE noise.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
