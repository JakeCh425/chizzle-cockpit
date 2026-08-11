// ─── PipelineCockpit ───────────────────────────────────────────────────────
// Chizzle Wealth Engine — 6-step swing pipeline.
// SCAN → SELECT → PLAN → EXECUTE → MANAGE → REVIEW
// Zero widget clutter. Hard section boundaries. Operator tone.
// Every step contains only its relevant tool(s). Ancillary widgets live in
// the Tools drawer. Active Setups always render at the bottom, persistent
// until manually archived.

import { useState } from "react";
import { Link } from "wouter";
import { Search, Target, ClipboardList, Play, Activity, BookOpen, ChevronDown, ChevronRight, Wrench, ArrowRight } from "lucide-react";
import PnLHeader from "@/components/PnLHeader";
import RegimeV2Panel from "@/components/RegimeV2Panel";
import ActiveSetupsPanel from "@/components/ActiveSetupsPanel";
import SwingScannerPanel from "@/components/SwingScannerPanel";
import TradeCheckPanel from "@/components/TradeCheckPanel";
import FidelityCheatSheet from "@/components/FidelityCheatSheet";
import MiniChartGrid from "@/components/MiniChartGrid";
import ErrorBoundary from "@/components/ErrorBoundary";

interface StepDef {
  key: string;
  index: number;
  title: string;
  purpose: string;
  Icon: typeof Search;
  content: React.ReactNode;
}

function StepLane({ step, expanded, onToggle }: { step: StepDef; expanded: boolean; onToggle: () => void }) {
  const Icon = step.Icon;
  return (
    <div className="rounded-md border border-ink-line bg-ink-black" data-testid={`step-${step.key.toLowerCase()}`}>
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-3 hover:bg-ink-deep transition-colors"
        data-testid={`button-toggle-${step.key.toLowerCase()}`}
      >
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-slate-gray">{String(step.index).padStart(2, "0")}</span>
            <Icon className="h-4 w-4 text-neon-blue" />
            <span className="text-sm font-bold text-soft-white tracking-wide">{step.key}</span>
          </div>
          <span className="text-xs text-slate-gray hidden sm:inline">— {step.purpose}</span>
        </div>
        {expanded ? <ChevronDown className="h-4 w-4 text-slate-gray" /> : <ChevronRight className="h-4 w-4 text-slate-gray" />}
      </button>
      {expanded && (
        <div className="border-t border-ink-line p-3">
          <ErrorBoundary>{step.content}</ErrorBoundary>
        </div>
      )}
    </div>
  );
}

export default function PipelineCockpit() {
  // Default: SCAN and SELECT expanded, others collapsed for one-screen readability.
  const [expandedKey, setExpandedKey] = useState<string>("SCAN");
  const [toolsOpen, setToolsOpen] = useState(false);

  const steps: StepDef[] = [
    {
      key: "SCAN",
      index: 1,
      title: "Scan the tape",
      purpose: "Propose candidates from the universe",
      Icon: Search,
      content: <SwingScannerPanel />,
    },
    {
      key: "SELECT",
      index: 2,
      title: "Select a candidate",
      purpose: "Choose one setup to develop",
      Icon: Target,
      content: (
        <div className="space-y-2 text-sm">
          <div className="text-xs text-slate-gray">
            Pick the strongest candidate from SCAN. Judgment prevails — regime, fundamentals, structure, R:R.
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
      ),
    },
    {
      key: "PLAN",
      index: 3,
      title: "Write the plan",
      purpose: "Evaluator + full setup fields",
      Icon: ClipboardList,
      content: (
        <div className="space-y-3">
          <TradeCheckPanel />
          <div className="border-t border-ink-line pt-3">
            <div className="text-xs text-slate-gray mb-2">
              Once the evaluator returns Standard/Flex/Practice, save the plan to Active Setups below.
            </div>
          </div>
        </div>
      ),
    },
    {
      key: "EXECUTE",
      index: 4,
      title: "Execute the trade",
      purpose: "Fidelity OTOCO reference + mark Active",
      Icon: Play,
      content: (
        <div className="space-y-3">
          <div className="text-xs text-slate-gray">
            Place the OTOCO (One-Triggers-One-Cancels-Other) bracket at your broker.
            Then click "Mark Active" on the corresponding setup in Active Setups below.
          </div>
          <FidelityCheatSheet />
        </div>
      ),
    },
    {
      key: "MANAGE",
      index: 5,
      title: "Manage the position",
      purpose: "Trim, trail, adjust risk",
      Icon: Activity,
      content: (
        <div className="space-y-2 text-sm">
          <div className="text-xs text-slate-gray">
            Adjust risk, log scaling, or move stops directly on each active setup below.
            Trim at T1 (typically half), let T2 run with trail.
          </div>
          <ul className="text-xs text-soft-white space-y-1 pl-4 list-disc marker:text-slate-gray">
            <li>At T1: trim half, move stop to breakeven</li>
            <li>At T2: exit remainder or trail 20-SMA</li>
            <li>Stop hit: exit and log to REVIEW</li>
          </ul>
        </div>
      ),
    },
    {
      key: "REVIEW",
      index: 6,
      title: "Review the outcome",
      purpose: "Log notes, analytics, archive",
      Icon: BookOpen,
      content: (
        <div className="space-y-2 text-sm">
          <div className="text-xs text-slate-gray">Close out finished setups. Log lessons in the Journal.</div>
          <div className="flex gap-2">
            <Link
              href="/journal"
              className="text-xs px-3 py-1.5 rounded border border-ink-line text-soft-white hover:bg-ink-deep"
              data-testid="link-journal"
            >
              Open Journal
            </Link>
            <Link
              href="/analytics"
              className="text-xs px-3 py-1.5 rounded border border-ink-line text-soft-white hover:bg-ink-deep"
              data-testid="link-analytics"
            >
              Open Analytics
            </Link>
            <Link
              href="/trades"
              className="text-xs px-3 py-1.5 rounded border border-ink-line text-soft-white hover:bg-ink-deep"
              data-testid="link-trades"
            >
              Trade History
            </Link>
          </div>
        </div>
      ),
    },
  ];

  return (
    <div className="max-w-6xl mx-auto p-3 sm:p-4 space-y-4">
      {/* P&L header — always visible at top */}
      <PnLHeader />

      {/* Regime v2 gauge — always visible, drives every decision below */}
      <RegimeV2Panel />

      {/* Pipeline lane header */}
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

      {/* 6-step pipeline */}
      <div className="space-y-2">
        {steps.map((step) => (
          <StepLane
            key={step.key}
            step={step}
            expanded={expandedKey === step.key}
            onToggle={() => setExpandedKey(expandedKey === step.key ? "" : step.key)}
          />
        ))}
      </div>

      {/* Active Setups — persistent, always after the pipeline */}
      <ActiveSetupsPanel />

      {/* Tools drawer — accessed via button, contains ancillary widgets */}
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
                <Link
                  href="/advanced"
                  className="text-xs px-3 py-1.5 rounded border border-neon-blue text-neon-blue hover:bg-neon-blue/10 inline-block"
                  data-testid="link-advanced-cockpit"
                >
                  Open Advanced Cockpit
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
