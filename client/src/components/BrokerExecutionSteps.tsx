import { useState } from "react";
import { ChevronDown, ChevronUp, CheckCircle2, ShieldCheck, ArrowRight, ExternalLink, AlertTriangle, Copy, Check } from "lucide-react";

export interface BrokerExecutionStepsProps {
  symbol?: string;
  entry?: number | null;
  stop?: number | null;
  target1?: number | null;
  defaultOpen?: boolean;
  className?: string;
}

export function BrokerExecutionSteps({
  symbol = "TICKER",
  entry,
  stop,
  target1,
  defaultOpen = true,
  className = "",
}: BrokerExecutionStepsProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [checkedSteps, setCheckedSteps] = useState<Record<number, boolean>>({});
  const [copiedPrice, setCopiedPrice] = useState<string | null>(null);

  const toggleStep = (stepNum: number) => {
    setCheckedSteps((prev) => ({ ...prev, [stepNum]: !prev[stepNum] }));
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard?.writeText(text);
    setCopiedPrice(label);
    setTimeout(() => setCopiedPrice(null), 2000);
  };

  const entryText = entry != null && Number.isFinite(entry) ? `$${entry.toFixed(2)}` : "Buy Target";
  const stopText = stop != null && Number.isFinite(stop) ? `$${stop.toFixed(2)}` : "Stop Loss";
  const stopLimitText = stop != null && Number.isFinite(stop) ? `$${(stop - 0.08).toFixed(2)}` : "Stop - $0.08";
  const target1Text = target1 != null && Number.isFinite(target1) ? `$${target1.toFixed(2)}` : "Target 1";

  const steps = [
    {
      num: 1,
      title: "Execute the Entry (Limit Order)",
      badge: "STEP 1: ENTRY",
      badgeColor: "border-cyan-500/40 bg-cyan-950/50 text-cyan-300",
      details: [
        { label: "Action", val: "Select Buy" },
        { label: "Order Type", val: "Select Limit" },
        {
          label: "Price",
          val: `Enter ${entryText} (exact Buy Target on Setup Card)`,
          copyVal: entry != null ? entry.toFixed(2) : undefined,
          copyLabel: "entry",
        },
        { label: "Time in Force", val: "Select Day. Place the order and wait for it to fill." },
      ],
    },
    {
      num: 2,
      title: "Set Up the Exit (OCO - One Cancels the Other)",
      badge: "STEP 2: BRACKET",
      badgeColor: "border-indigo-500/40 bg-indigo-950/50 text-indigo-300",
      details: [
        { label: "Action", val: `Once the initial buy order fills, navigate to your Positions tab, select ${symbol}, and click Sell.` },
        { label: "Order Type", val: "Change the order type from Limit to OCO (or Bracket Order)." },
      ],
    },
    {
      num: 3,
      title: "Define the Profit Target (The Limit Leg)",
      badge: "STEP 3: PROFIT",
      badgeColor: "border-emerald-500/40 bg-emerald-950/50 text-emerald-300",
      details: [
        { label: "OCO Leg 1", val: "Under the first OCO section, set the Order Type to Limit." },
        {
          label: "Price",
          val: `Enter ${target1Text} (Target 1 from Chizzle Setup Card)`,
          copyVal: target1 != null ? target1.toFixed(2) : undefined,
          copyLabel: "target",
        },
      ],
    },
    {
      num: 4,
      title: "Define the Risk (The Stop Leg)",
      badge: "STEP 4: RISK",
      badgeColor: "border-rose-500/40 bg-rose-950/50 text-rose-300",
      details: [
        { label: "OCO Leg 2", val: "Under the second OCO section, set the Order Type to Stop Limit (recommended to avoid extreme gap-down fills) or Stop Loss." },
        {
          label: "Stop Price",
          val: `Enter ${stopText} (exact Stop Loss from Chizzle Setup Card)`,
          copyVal: stop != null ? stop.toFixed(2) : undefined,
          copyLabel: "stop",
        },
        {
          label: "Limit Price (if using Stop Limit)",
          val: `Set to ${stopLimitText} ($0.05 to $0.10 below the Stop Price to account for slight slippage)`,
          copyVal: stop != null ? (stop - 0.08).toFixed(2) : undefined,
          copyLabel: "stop-limit",
        },
      ],
    },
    {
      num: 5,
      title: "Finalize the Trade",
      badge: "STEP 5: AUTOMATE",
      badgeColor: "border-amber-500/40 bg-amber-950/50 text-amber-300",
      details: [
        { label: "Time in Force", val: "Set to GTC (Good 'Til Canceled)." },
        { label: "Final Step", val: "Submit the order. The trade is now fully automated and requires no further manual management." },
      ],
    },
  ];

  const totalSteps = steps.length;
  const completedCount = Object.values(checkedSteps).filter(Boolean).length;
  const progressPct = Math.round((completedCount / totalSteps) * 100);

  return (
    <div
      className={`rounded-xl border border-slate-800 bg-slate-900/90 shadow-md transition-all overflow-hidden ${className}`}
      data-testid="broker-execution-steps-accordion"
    >
      {/* Accordion Header */}
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="w-full flex items-center justify-between px-4 py-3.5 sm:px-5 border-b border-slate-800 bg-slate-950/40 hover:bg-slate-900 transition-colors text-left select-none cursor-pointer"
        aria-expanded={isOpen}
        data-testid="button-toggle-broker-steps"
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-8 w-8 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center shrink-0">
            <ShieldCheck className="h-4 w-4 text-emerald-400" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm font-bold uppercase tracking-wider text-soft-white">
                Fidelity Trade Execution Workflow
              </span>
              <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-cyan-500/10 border border-cyan-500/30 text-cyan-300">
                {symbol}
              </span>
            </div>
            <p className="text-[11px] text-slate-400 font-sans mt-0.5">
              Strict step-by-step checklist to place and bracket your trade at your broker
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <div className="hidden sm:flex items-center gap-2 font-mono text-xs">
            <span className="text-slate-400">Checklist:</span>
            <span className="font-bold text-emerald-400">{completedCount}/{totalSteps}</span>
            <div className="w-16 h-1.5 rounded-full bg-slate-800 overflow-hidden">
              <div
                className="h-full bg-emerald-400 transition-all duration-300"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>
          {isOpen ? (
            <ChevronUp className="h-5 w-5 text-slate-400" />
          ) : (
            <ChevronDown className="h-5 w-5 text-slate-400" />
          )}
        </div>
      </button>

      {/* Accordion Body */}
      {isOpen && (
        <div className="p-4 sm:p-5 space-y-4 animate-in fade-in duration-200">
          {/* Practice / Compliance Reminder banner */}
          <div className="rounded-lg border border-amber-500/30 bg-amber-950/20 px-3.5 py-2.5 flex items-start gap-2.5 text-xs text-amber-200/90 font-mono">
            <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <span className="font-bold uppercase text-amber-300">Self-Directed Execution Checklist:</span>{" "}
              The engine provides analysis and levels; you place every order yourself directly on Fidelity or your preferred broker.
            </div>
          </div>

          {/* Sequential Checklist Steps */}
          <div className="space-y-3">
            {steps.map((step) => {
              const isChecked = !!checkedSteps[step.num];
              return (
                <div
                  key={step.num}
                  className={`rounded-xl border transition-all ${
                    isChecked
                      ? "border-emerald-500/40 bg-emerald-950/15 opacity-90"
                      : "border-slate-800 bg-slate-950/60 hover:border-slate-700"
                  } p-3.5 sm:p-4`}
                  data-testid={`broker-step-${step.num}`}
                >
                  <div className="flex items-start gap-3">
                    {/* Checkbox trigger */}
                    <button
                      type="button"
                      onClick={() => toggleStep(step.num)}
                      className={`mt-0.5 h-5 w-5 rounded border flex items-center justify-center shrink-0 transition-colors cursor-pointer ${
                        isChecked
                          ? "bg-emerald-500 border-emerald-400 text-slate-950 font-bold"
                          : "border-slate-600 bg-slate-900 hover:border-slate-400 text-transparent"
                      }`}
                      aria-label={`Mark Step ${step.num} as ${isChecked ? "incomplete" : "complete"}`}
                      data-testid={`checkbox-step-${step.num}`}
                    >
                      <Check className="h-3.5 w-3.5 stroke-[3]" />
                    </button>

                    <div className="min-w-0 flex-1 space-y-2">
                      {/* Step Header */}
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className={`px-2 py-0.5 rounded text-[9.5px] font-mono font-bold uppercase tracking-wider border ${step.badgeColor}`}>
                            {step.badge}
                          </span>
                          <h4 className={`text-sm font-bold font-mono ${isChecked ? "line-through text-slate-400" : "text-soft-white"}`}>
                            {step.title}
                          </h4>
                        </div>
                      </div>

                      {/* Step Instructions Grid */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs font-mono pt-1">
                        {step.details.map((item, idx) => (
                          <div
                            key={idx}
                            className={`p-2 rounded-lg border border-slate-800/80 bg-slate-900/50 flex flex-col justify-between ${
                              item.copyVal ? "border-cyan-500/20" : ""
                            }`}
                          >
                            <span className="text-[10px] uppercase font-bold text-slate-400">
                              {item.label}
                            </span>
                            <div className="flex items-center justify-between gap-2 mt-1">
                              <span className="font-semibold text-slate-200 leading-snug">
                                {item.val}
                              </span>
                              {item.copyVal && (
                                <button
                                  type="button"
                                  onClick={() => copyToClipboard(item.copyVal!, item.copyLabel || "")}
                                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-cyan-500/40 bg-cyan-950/60 text-[10px] text-cyan-300 hover:bg-cyan-500/20 shrink-0 cursor-pointer"
                                  title={`Copy ${item.copyVal}`}
                                  data-testid={`button-copy-${item.copyLabel}`}
                                >
                                  {copiedPrice === item.copyLabel ? (
                                    <>
                                      <Check className="h-3 w-3 text-emerald-400" />
                                      <span className="text-emerald-400">Copied</span>
                                    </>
                                  ) : (
                                    <>
                                      <Copy className="h-3 w-3" />
                                      <span>Copy</span>
                                    </>
                                  )}
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Completion summary */}
          {completedCount === totalSteps && (
            <div
              className="rounded-lg border border-emerald-500/40 bg-emerald-950/30 p-3 text-xs font-mono text-emerald-300 flex items-center gap-2"
              data-testid="broker-steps-completed"
            >
              <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
              <span>All 5 steps completed. Limit entry and OCO bracket submitted to Fidelity (GTC).</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default BrokerExecutionSteps;
