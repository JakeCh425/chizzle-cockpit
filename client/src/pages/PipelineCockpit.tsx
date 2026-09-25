// ─── PipelineCockpit ───────────────────────────────────────────────────────
// Chizzle Wealth Engine — 6-step swing pipeline.
//
// Layout order (top to bottom):
//   1. P&L header
//   2. Regime v2 gauge
//   3. Active Setups (pinned at top per user spec — persistent watchlist)
//   4. Proximity Watch (REACHING → TOUCHING → READY → REJECTED)
//   5. Pipeline: SCAN → SELECT → PLAN → EXECUTE → MANAGE → REVIEW
//   6. Tools drawer (Mini Charts + Advanced Cockpit link)
//
// CRITICAL: lanes are always mounted, hidden via CSS. This keeps input focus
// stable inside TradeCheckPanel and prevents remount-loss on collapse toggles.

import { useState, useEffect } from "react";
import { Link } from "wouter";
import { Search, Target, ClipboardList, Play, Activity, BookOpen, ChevronDown, ChevronRight, Wrench, ArrowRight } from "lucide-react";
import PnLHeader from "@/components/PnLHeader";
import RegimeV2Panel from "@/components/RegimeV2Panel";
import ActiveSetupsPanel from "@/components/ActiveSetupsPanel";
import ProximityWatchPanel from "@/components/ProximityWatchPanel";
import SwingScannerPanel from "@/components/SwingScannerPanel";
import TradeCheckPanel from "@/components/TradeCheckPanel";
import PlanCheckPanel from "@/components/PlanCheckPanel";
import FlexScannerPanel from "@/components/FlexScannerPanel";
import FidelityCheatSheet from "@/components/FidelityCheatSheet";
import MiniChartGrid from "@/components/MiniChartGrid";
import ErrorBoundary from "@/components/ErrorBoundary";
import CollapsibleSection from "@/components/CollapsibleSection";
import TickerChartPanel from "@/components/TickerChartPanel";
import { CockpitTickerProvider } from "@/components/CockpitTickerContext";
import DoTodayCard from "@/components/DoTodayCard";
import SwingWorkspace from "@/components/swing/SwingWorkspace";
import { SwingDoToday, UnifiedSwingMount } from "@/components/swing/SwingConsistency";
import MarketPulsePanel from "@/components/MarketPulsePanel";
import CockpitWorkspace from "@/components/CockpitWorkspace";

// Static lane definitions — kept outside the render body so array identity is
// stable across renders (React can reconcile without remounting children).
const LANE_KEYS = ["SCAN", "SELECT", "PLAN", "EXECUTE", "MANAGE", "REVIEW"] as const;
type LaneKey = typeof LANE_KEYS[number];

const LANE_META: Record<LaneKey, { index: number; purpose: string; Icon: typeof Search }> = {
  SCAN:    { index: 1, purpose: "Propose candidates from the universe",  Icon: Search },
  SELECT:  { index: 2, purpose: "Choose one setup to develop",          Icon: Target },
  PLAN:    { index: 3, purpose: "Evaluator + full setup fields",         Icon: ClipboardList },
  EXECUTE: { index: 4, purpose: "Fidelity OTOCO reference + mark Active",Icon: Play },
  MANAGE:  { index: 5, purpose: "Trim, trail, adjust risk",              Icon: Activity },
  REVIEW:  { index: 6, purpose: "Log notes, analytics, archive",         Icon: BookOpen },
};

// ── Display-only progress strip ────────────────────────────────────────────
// Maps beginner-friendly labels to the existing lane keys. NEVER creates
// new lane keys, workflow states, or routes. Clicking a step just triggers
// the parent's onJump (which sets the existing expandedKey state).
const PROGRESS_STEPS: { key: LaneKey; label: string; sub: string }[] = [
  { key: "SCAN",    label: "Scan",              sub: "Find candidates" },
  { key: "SELECT",  label: "Review Candidates", sub: "Filter shortlist" },
  { key: "PLAN",    label: "Plan Trade",        sub: "Levels + risk" },
  { key: "EXECUTE", label: "Execute",           sub: "Place order" },
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

export default function PipelineCockpit() {
  const [expandedKey, setExpandedKey] = useState<LaneKey | "">("SCAN");
  const [toolsOpen, setToolsOpen] = useState(false);

  // When a proximity READY tile is clicked, the ProximityWatchPanel fires a
  // custom event; we intercept it here to auto-expand PLAN so the prefilled
  // trade-check form is immediately visible.
  useEffect(() => {
    function onPrefill() {
      setExpandedKey("PLAN");
      // Give the DOM a tick, then scroll to the PLAN lane.
      setTimeout(() => {
        const el = document.querySelector('[data-testid="step-plan"]');
        el?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
    }
    window.addEventListener("chizzle:prefill-plan", onPrefill);
    return () => window.removeEventListener("chizzle:prefill-plan", onPrefill);
  }, []);

  function toggle(key: LaneKey) {
    setExpandedKey(expandedKey === key ? "" : key);
  }

  return (
    <CockpitTickerProvider>
    <div className="max-w-[1440px] mx-auto p-3 sm:p-4 lg:p-5 space-y-4">
      {/* 1. P&L header — always visible at very top */}
      <PnLHeader />

      {/* 2. "What should I do today?" — plain-English translation of
           existing regime + scanner outputs. No new signals. */}
      <DoTodayCard />

      {/* PR 3e — Unified Swing Engine (§Q). Renders nothing unless ENABLE_UNIFIED_SWING_ENGINE is on. */}
      <UnifiedSwingMount>
        {() => (
          <>
            <SwingDoToday />
            <CollapsibleSection id="unified-swing" title="Unified Swing Engine" hint="SMH · QQQ · SPY + custom">
              <ErrorBoundary label="Unified Swing Engine">
                <SwingWorkspace />
              </ErrorBoundary>
            </CollapsibleSection>
          </>
        )}
      </UnifiedSwingMount>

      {/* 3. Cockpit Workspace — 3-column: Regime + Pulse (L) / TradingView chart (C) / Strength + Snapshot + Coach (R) */}
      <ErrorBoundary label="Cockpit Workspace">
        <CockpitWorkspace />
      </ErrorBoundary>

      {/* 5. Active Setups — pinned at top per user spec */}
      <ActiveSetupsPanel />

      {/* 4. Proximity Watch — hidden until at least one ticker is READY, per user
           preference. Keeps the top-of-page clean when nothing is actionable. */}
      <ProximityWatchPanel hideWhenNoReady />

      {/* 5. Pipeline lanes */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-soft-white uppercase tracking-wide">Pipeline</h2>
        <button
          onClick={() => setToolsOpen(true)}
          className="text-xs px-3 py-1.5 rounded border border-ink-line text-slate-gray hover:text-soft-white hover:border-neon-blue flex items-center gap-1"
          data-testid="button-open-tools"
        >
          <Wrench className="h-3 w-3" /> Tools
        </button>
      </div>

      {/* Compact progress strip — display-only. Maps beginner labels to the
          existing lane keys (SCAN/SELECT/PLAN/EXECUTE/MANAGE/REVIEW). Clicking
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

        <LaneShell laneKey="EXECUTE" expanded={expandedKey === "EXECUTE"} onToggle={() => toggle("EXECUTE")}>
          <div className="space-y-3">
            <div className="text-xs text-slate-gray">
              Place the OTOCO (One-Triggers-One-Cancels-Other) bracket at your broker.
              Then click "Mark Active" on the corresponding setup in Active Setups.
            </div>
            <FidelityCheatSheet />
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

      {/* Tools drawer */}
      {toolsOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto"
          onClick={() => setToolsOpen(false)}
          data-testid="drawer-tools"
        >
          <div
            className="max-w-4xl w-full bg-ink-black border border-ink-line rounded-md p-4 my-8 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-soft-white uppercase tracking-wide">Tools</h3>
              <button
                onClick={() => setToolsOpen(false)}
                className="text-xs px-2 py-1 rounded border border-ink-line text-slate-gray hover:text-soft-white"
                data-testid="button-close-tools"
              >
                Close
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <h4 className="text-xs font-bold text-slate-gray uppercase mb-2">Mini Charts</h4>
                <MiniChartGrid />
              </div>
              <div className="border-t border-ink-line pt-3">
                <h4 className="text-xs font-bold text-slate-gray uppercase mb-2">Advanced Cockpit</h4>
                <p className="text-xs text-slate-gray mb-2">
                  The full legacy Cockpit with every widget is still available.
                </p>
                <Link href="/advanced" className="text-xs px-3 py-1.5 rounded border border-neon-blue text-neon-blue hover:bg-neon-blue/10 inline-block" data-testid="link-advanced-cockpit">
                  Open Advanced Cockpit
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
    </CockpitTickerProvider>
  );
}
