import React from "react";

export function SkeletonDashboardLoader() {
  return (
    <div
      className="w-full min-h-[80vh] p-4 sm:p-6 space-y-6 font-mono bg-[#060913] text-white animate-pulse"
      data-testid="skeleton-dashboard-loader"
      role="status"
      aria-label="Loading institutional dashboard module"
    >
      {/* 1. Top Telemetry & Status Strip Skeleton */}
      <div className="w-full flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl border border-slate-800 bg-[#0c1017]">
        <div className="flex items-center gap-3">
          <div className="h-6 w-36 bg-slate-800 rounded-md" />
          <div className="h-5 w-24 bg-emerald-950/40 border border-emerald-800/40 rounded-full" />
        </div>
        <div className="flex items-center gap-3">
          <div className="h-4 w-32 bg-slate-800 rounded" />
          <div className="h-6 w-28 bg-slate-800 rounded-md" />
        </div>
      </div>

      {/* 2. Ready to Trade / Active Execution Card Skeleton (60/40 Split) */}
      <div className="w-full p-5 rounded-xl border border-slate-800 bg-[#0c1017] space-y-4">
        {/* Header row */}
        <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
          <div className="flex items-center gap-3">
            <div className="h-3 w-3 rounded-full bg-emerald-500/50" />
            <div className="h-6 w-48 bg-slate-800 rounded" />
            <div className="h-5 w-32 bg-emerald-950/40 border border-emerald-800/40 rounded-md" />
          </div>
          <div className="h-5 w-40 bg-slate-800 rounded" />
        </div>

        {/* 60/40 Responsive Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 pt-2">
          {/* Left Column (60% width): Chart & Diagnostics */}
          <div className="lg:col-span-7 flex flex-col gap-3">
            <div className="h-52 w-full rounded-lg bg-slate-900 border border-slate-800 relative overflow-hidden flex items-center justify-center">
              <div className="w-full px-6 flex justify-between items-center opacity-30">
                <div className="h-0.5 w-full bg-cyan-500/40 border-b border-dashed border-cyan-400" />
              </div>
              <span className="absolute text-xs text-slate-500 font-bold uppercase tracking-wider">
                [ Loading Execution Chart & Moving Averages ]
              </span>
            </div>
            {/* Diagnostics strip skeleton */}
            <div className="h-10 w-full rounded-lg bg-slate-900/60 border border-slate-800" />
          </div>

          {/* Right Column (40% width): Prices, Steps, Fidelity Ticket */}
          <div className="lg:col-span-5 flex flex-col gap-3">
            <div className="grid grid-cols-3 gap-2 p-3 rounded-lg bg-slate-900 border border-slate-800">
              <div className="h-10 bg-slate-800/80 rounded" />
              <div className="h-10 bg-slate-800/80 rounded" />
              <div className="h-10 bg-slate-800/80 rounded" />
            </div>
            <div className="h-28 rounded-lg bg-slate-900 border border-slate-800" />
            <div className="h-10 rounded-lg bg-cyan-950/40 border border-cyan-800/40" />
          </div>
        </div>
      </div>

      {/* 3. Pending & Waiting Setups Table Skeleton */}
      <div className="w-full p-4 rounded-xl border border-slate-800 bg-[#0c1017] space-y-3">
        <div className="flex items-center justify-between pb-2 border-b border-slate-800">
          <div className="h-5 w-44 bg-slate-800 rounded" />
          <div className="h-4 w-28 bg-slate-800 rounded" />
        </div>
        {[1, 2, 3].map((row) => (
          <div key={row} className="h-12 w-full bg-slate-900/60 border border-slate-800/60 rounded-lg flex items-center px-4 justify-between">
            <div className="flex items-center gap-3">
              <div className="h-5 w-16 bg-slate-800 rounded" />
              <div className="h-4 w-24 bg-slate-800/60 rounded" />
            </div>
            <div className="h-6 w-32 bg-slate-800 rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default SkeletonDashboardLoader;
