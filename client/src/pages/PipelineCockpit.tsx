// ─── PipelineCockpit ───────────────────────────────────────────────────────
// Chizzle Wealth Engine — 6-step swing pipeline.
//
// Layout order (top to bottom):
//   1. P&L header
//   2. Regime v2 gauge
//   3. Active Setups (pinned at top per user spec — persistent watchlist)
//   4. Proximity Watch (REACHING → TOUCHING → READY → REJECTED)
//   5. Pipeline: SCAN → SELECT → PLAN → MANAGE → REVIEW (archived to /#/archive/pipeline when the unified engine is on)
//   6. Tools drawer (Mini Charts + Advanced Cockpit link)
//
// CRITICAL: lanes are always mounted, hidden via CSS. This keeps input focus
// stable inside TradeCheckPanel and prevents remount-loss on collapse toggles.

import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { Wrench } from "lucide-react";
import PnLHeader from "@/components/PnLHeader";
import RegimeV2Panel from "@/components/RegimeV2Panel";
import ActiveSetupsPanel from "@/components/ActiveSetupsPanel";
import ProximityWatchPanel from "@/components/ProximityWatchPanel";
import FidelityCheatSheet from "@/components/FidelityCheatSheet";
import MiniChartGrid from "@/components/MiniChartGrid";
import ErrorBoundary from "@/components/ErrorBoundary";
import CollapsibleSection from "@/components/CollapsibleSection";
import { CockpitTickerProvider } from "@/components/CockpitTickerContext";
import DoTodayCard from "@/components/DoTodayCard";
import SwingWorkspace from "@/components/swing/SwingWorkspace";
import { SwingDoToday, UnifiedSwingMount } from "@/components/swing/SwingConsistency";
import MarketPulsePanel from "@/components/MarketPulsePanel";
import CockpitWorkspace from "@/components/CockpitWorkspace";
import LegacyPipeline, { PENDING_PREFILL_KEY } from "@/components/LegacyPipeline";
import { useSwingEnabled } from "@/lib/swing";

export default function PipelineCockpit() {
  const [toolsOpen, setToolsOpen] = useState(false);
  const unifiedOn = useSwingEnabled();
  const [, navigate] = useLocation();

  // Pipeline archived (unified engine ON): a Proximity READY click parks its
  // prefill and opens the archived pipeline, which replays it into PLAN.
  useEffect(() => {
    if (!unifiedOn) return;
    function onPrefill(e: Event) {
      const detail = (e as CustomEvent).detail;
      if (!detail) return;
      (window as any)[PENDING_PREFILL_KEY] = detail;
      navigate("/archive/pipeline");
    }
    window.addEventListener("chizzle:prefill-plan", onPrefill);
    return () => window.removeEventListener("chizzle:prefill-plan", onPrefill);
  }, [unifiedOn, navigate]);

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

      {/* 5. Pipeline — archived to /#/archive/pipeline when the Unified Swing Engine is on. */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-soft-white uppercase tracking-wide">{unifiedOn ? "Tools & archive" : "Pipeline"}</h2>
        <button
          onClick={() => setToolsOpen(true)}
          className="text-xs px-3 py-1.5 rounded border border-ink-line text-slate-gray hover:text-soft-white hover:border-neon-blue flex items-center gap-1"
          data-testid="button-open-tools"
        >
          <Wrench className="h-3 w-3" /> Tools
        </button>
      </div>
      {!unifiedOn && <LegacyPipeline />}

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
                <h4 className="text-xs font-bold text-slate-gray uppercase mb-2">Archive</h4>
                <p className="text-xs text-slate-gray mb-2">
                  The legacy pipeline (Scan → Select → Plan → Manage → Review) is archived here for future reconfiguration.
                </p>
                <Link href="/archive/pipeline" className="text-xs px-3 py-1.5 rounded border border-ink-line text-soft-white hover:bg-ink-deep inline-block" data-testid="link-archive-pipeline">
                  Open archived pipeline
                </Link>
              </div>
              <div className="border-t border-ink-line pt-3">
                <h4 className="text-xs font-bold text-slate-gray uppercase mb-2">Broker order reference</h4>
                <p className="text-xs text-slate-gray mb-2">Reference only — you place every order yourself at your broker.</p>
                <FidelityCheatSheet />
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
