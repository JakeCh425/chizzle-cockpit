// ─── LegacyPipeline ─────────────────────────────────────────────────────────
// The original 6-step pipeline (SCAN → SELECT → PLAN → MANAGE → REVIEW).
// The "Execute — Place order" step was removed: the app never places orders.
// When a unified card prints READY, its Trade Summary tells you to go to your
// broker and enter the order yourself.
//
// With ENABLE_UNIFIED_SWING_ENGINE on, this lives on its own archived page
// (/#/archive/pipeline) so it can be reconfigured later without cluttering the
// main cockpit. With the flag off it still renders inline on the main page.

import { useState, useEffect } from "react";
import { Link } from "wouter";
import { Search, Target, ClipboardList, Activity, BookOpen, ChevronDown, ChevronRight, ArrowRight } from "lucide-react";
import SwingScannerPanel from "@/components/SwingScannerPanel";
import TradeCheckPanel from "@/components/TradeCheckPanel";
import PlanCheckPanel from "@/components/PlanCheckPanel";
import FlexScannerPanel from "@/components/FlexScannerPanel";
import ErrorBoundary from "@/components/ErrorBoundary";
import TickerChartPanel from "@/components/TickerChartPanel";

/** Prefill events fired while the pipeline is archived are parked here and replayed on the archive page. */
export const PENDING_PREFILL_KEY = "__chizzlePendingPrefill";

// Static lane definitions — kept outside the render body so array identity is
// stable across renders (React can reconcile without remounting children).
const LANE_KEYS = ["SCAN", "SELECT", "PLAN", "MANAGE", "REVIEW"] as const;
type LaneKey = typeof LANE_KEYS[number];

const LANE_META: Record<LaneKey, { index: number; purpose: string; Icon: typeof Search }> = {
  SCAN:    { index: 1, purpose: "Propose candidates from the universe",  Icon: Search },
  SELECT:  { index: 2, purpose: "Choose one setup to develop",          Icon: Target },
  PLAN:    { index: 3, purpose: "Evaluator + full setup fields",         Icon: ClipboardList },
  MANAGE:  { index: 4, purpose: "Trim, trail, adjust risk",              Icon: Activity },
  REVIEW:  { index: 5, purpose: "Log notes, analytics, archive",         Icon: BookOpen },
};

// ── Display-only progress strip ────────────────────────────────────────────
// Maps beginner-friendly labels to the existing lane keys. NEVER creates
// new lane keys, workflow states, or routes. Clicking a step just triggers
// the parent's onJump (which sets the existing expandedKey state).
const PROGRESS_STEPS: { key: LaneKey; label: string; sub: string }[] = [
  { key: "SCAN",    label: "Scan",              sub: "Find candidates" },
  { key: "SELECT",  label: "Review Candidates", sub: "Filter shortlist" },
  { key: "PLAN",    label: "Plan Trade",        sub: "Levels + risk" },
  { key: "MANAGE",  label: "Manage Position",   sub: "Trim & trail" },
  { key: "REVIEW",  label: "Review / Journal",  sub: "Log lessons" },
];

function PipelineProgressStrip({ activeKey, onJump }: { activeKey: LaneKey | ""; onJump: (k: LaneKey) => void }) {
  const activeIdx = PROGRESS_STEPS.findIndex((s) => s.key === activeKey);
  return (
    <div
      className="rounded-md border border-ink-line bg-ink-black p-3"
      data-testid="pipeline-progress-strip"
      role="navigation"
      aria-label="Pipeline progress"
    >
      <div className="flex items-stretch gap-1 overflow-x-auto">
        {PROGRESS_STEPS.map((step, i) => {
          const isActive = step.key === activeKey;
          const isPast = activeIdx >= 0 && i < activeIdx;
          const meta = LANE_META[step.key];
          const Icon = meta.Icon;
          return (
            <div key={step.key} className="flex items-stretch gap-1 min-w-0 flex-1">
              <button
                onClick={() => onJump(step.key)}
                className={`flex-1 min-w-[110px] rounded px-2.5 py-2 text-left border transition-colors ${
                  isActive
                    ? "border-neon-blue bg-neon-blue/10"
                    : isPast
                      ? "border-signal-green/30 bg-signal-green/5 hover:bg-signal-green/10"
                      : "border-ink-line bg-ink-deep hover:border-neon-blue/40"
                }`}
                data-testid={`progress-step-${step.key.toLowerCase()}`}
                title={`Step ${meta.index} — ${meta.purpose}`}
              >
                <div className="flex items-center gap-1.5">
                  <span className={`inline-flex items-center justify-center rounded-full text-[10px] font-mono font-bold w-4 h-4 flex-shrink-0 ${
                    isActive
                      ? "bg-neon-blue text-ink-black"
                      : isPast
                        ? "bg-signal-green/30 text-signal-green"
                        : "bg-ink-line text-slate-gray"
                  }`}>
                    {meta.index}
                  </span>
                  <Icon className={`h-3 w-3 flex-shrink-0 ${
                    isActive ? "text-neon-blue" : isPast ? "text-signal-green" : "text-slate-gray"
                  }`} />
                  <span className={`text-[11.5px] font-bold uppercase tracking-wide truncate ${
                    isActive ? "text-neon-blue" : isPast ? "text-signal-green" : "text-soft-white/60"
                  }`}>
                    {step.label}
                  </span>
                </div>
                <div className="text-[10px] text-slate-gray mt-0.5 truncate">{step.sub}</div>
              </button>
              {i < PROGRESS_STEPS.length - 1 && (
                <div className="flex items-center flex-shrink-0">
                  <ChevronRight className={`h-3 w-3 ${isPast ? "text-signal-green/60" : "text-ink-line"}`} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface LaneShellProps {
  laneKey: LaneKey;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

function LaneShell({ laneKey, expanded, onToggle, children }: LaneShellProps) {
  const meta = LANE_META[laneKey];
  const Icon = meta.Icon;
  return (
    <div className="rounded-md border border-ink-line bg-ink-black" data-testid={`step-${laneKey.toLowerCase()}`}>
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-3 hover:bg-ink-deep transition-colors"
        data-testid={`button-toggle-${laneKey.toLowerCase()}`}
      >
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-slate-gray">{String(meta.index).padStart(2, "0")}</span>
            <Icon className="h-4 w-4 text-neon-blue" />
            <span className="text-sm font-bold text-soft-white tracking-wide">{laneKey}</span>
          </div>
          <span className="text-xs text-slate-gray hidden sm:inline">— {meta.purpose}</span>
        </div>
        {expanded ? <ChevronDown className="h-4 w-4 text-slate-gray" /> : <ChevronRight className="h-4 w-4 text-slate-gray" />}
      </button>
      {/* Always mounted; hidden via CSS to preserve child state (input focus). */}
      <div className={`border-t border-ink-line p-3 ${expanded ? "" : "hidden"}`}>
        <ErrorBoundary>{children}</ErrorBoundary>
      </div>
    </div>
  );
}

export default function LegacyPipeline() {
  const [expandedKey, setExpandedKey] = useState<LaneKey | "">("SCAN");

  useEffect(() => {
    function onPrefill() {
      setExpandedKey("PLAN");
      setTimeout(() => {
        const el = document.querySelector('[data-testid="step-plan"]');
        el?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
    }
    window.addEventListener("chizzle:prefill-plan", onPrefill);
    // Replay a prefill parked by the main cockpit while the pipeline was archived.
    const pending = (window as any)[PENDING_PREFILL_KEY];
    if (pending) {
      delete (window as any)[PENDING_PREFILL_KEY];
      setTimeout(() => window.dispatchEvent(new CustomEvent("chizzle:prefill-plan", { detail: pending })), 300);
    }
    return () => window.removeEventListener("chizzle:prefill-plan", onPrefill);
  }, []);

  function toggle(key: LaneKey) {
    setExpandedKey(expandedKey === key ? "" : key);
  }

  return (
    <div className="space-y-4" data-testid="legacy-pipeline">
      {/* Compact progress strip — display-only. Maps beginner labels to the
          existing lane keys (SCAN/SELECT/PLAN/MANAGE/REVIEW). Clicking
          a step just expands the corresponding lane below — no new state. */}
      <PipelineProgressStrip activeKey={expandedKey} onJump={(k) => setExpandedKey(k)} />

      <div className="space-y-2">
        <LaneShell laneKey="SCAN" expanded={expandedKey === "SCAN"} onToggle={() => toggle("SCAN")}>
          <div className="space-y-3">
            {/* Cockpit v2: On xl+ screens the scanner sits beside a dedicated
                chart + technical-snapshot panel that used to be dead space on
                the left/right. Below xl the panels stack so the layout stays
                comfortable on laptops and tablets. */}
            <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_460px] gap-4 items-start">
              <div className="min-w-0 space-y-3">
                <FlexScannerPanel />
                <div className="border-t border-ink-line pt-3">
                  <SwingScannerPanel />
                </div>
              </div>
              <ErrorBoundary label="Ticker Chart">
                {/* Legacy compact chart kept inside the SCAN lane for scanner-adjacent quick reference. */}
                <TickerChartPanel embedded showSnapshot={false} />
              </ErrorBoundary>
            </div>
          </div>
        </LaneShell>

        <LaneShell laneKey="SELECT" expanded={expandedKey === "SELECT"} onToggle={() => toggle("SELECT")}>
          <div className="space-y-2 text-sm">
            <div className="text-xs text-slate-gray">
              Pick the strongest candidate from SCAN or Proximity Watch above. Judgment prevails —
              regime, fundamentals, structure, R:R.
            </div>
            <div className="text-xs text-soft-white">
              Then click <span className="font-bold text-neon-blue">PLAN</span> below to write the full setup.
            </div>
            <button
              onClick={() => setExpandedKey("PLAN")}
              className="text-xs px-3 py-1.5 rounded border border-neon-blue text-neon-blue hover:bg-neon-blue/10 flex items-center gap-1"
              data-testid="button-goto-plan"
            >
              Go to PLAN <ArrowRight className="h-3 w-3" />
            </button>
          </div>
        </LaneShell>

        <LaneShell laneKey="PLAN" expanded={expandedKey === "PLAN"} onToggle={() => toggle("PLAN")}>
          <div className="space-y-3">
            <TradeCheckPanel />
            <div className="border-t border-ink-line pt-3">
              <PlanCheckPanel />
            </div>
            <div className="border-t border-ink-line pt-3">
              <div className="text-xs text-slate-gray mb-2">
                Once the evaluator returns Standard/Flex/Practice, save the plan to Active Setups at the top.
              </div>
            </div>
          </div>
        </LaneShell>

        <LaneShell laneKey="MANAGE" expanded={expandedKey === "MANAGE"} onToggle={() => toggle("MANAGE")}>
          <div className="space-y-2 text-sm">
            <div className="text-xs text-slate-gray">
              Adjust risk, log scaling, or move stops directly on each active setup.
              Trim at T1 (typically half), let T2 run with trail.
            </div>
            <ul className="text-xs text-soft-white space-y-1 pl-4 list-disc marker:text-slate-gray">
              <li>At T1: trim half, move stop to breakeven</li>
              <li>At T2: exit remainder or trail 20-SMA</li>
              <li>Stop hit: exit and log to REVIEW</li>
            </ul>
          </div>
        </LaneShell>

        <LaneShell laneKey="REVIEW" expanded={expandedKey === "REVIEW"} onToggle={() => toggle("REVIEW")}>
          <div className="space-y-2 text-sm">
            <div className="text-xs text-slate-gray">Close out finished setups. Log lessons in the Journal.</div>
            <div className="flex gap-2 flex-wrap">
              <Link href="/journal" className="text-xs px-3 py-1.5 rounded border border-ink-line text-soft-white hover:bg-ink-deep" data-testid="link-journal">
                Open Journal
              </Link>
              <Link href="/analytics" className="text-xs px-3 py-1.5 rounded border border-ink-line text-soft-white hover:bg-ink-deep" data-testid="link-analytics">
                Open Analytics
              </Link>
              <Link href="/trades" className="text-xs px-3 py-1.5 rounded border border-ink-line text-soft-white hover:bg-ink-deep" data-testid="link-trades">
                Trade History
              </Link>
            </div>
          </div>
        </LaneShell>
      </div>

    </div>
  );
}
