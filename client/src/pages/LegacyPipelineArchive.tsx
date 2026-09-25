// Archived legacy pipeline — kept intact (minus the removed Execute step) so it
// can be reconfigured later. Reached from Tools → Archive or Settings.
import { Link } from "wouter";
import { ArrowLeft, Archive } from "lucide-react";
import LegacyPipeline from "@/components/LegacyPipeline";
import { CockpitTickerProvider } from "@/components/CockpitTickerContext";

export default function LegacyPipelineArchive() {
  return (
    <CockpitTickerProvider>
      <div className="max-w-[1440px] mx-auto p-3 sm:p-4 lg:p-5 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-sm font-bold text-soft-white uppercase tracking-wide flex items-center gap-1.5">
            <Archive className="h-4 w-4 text-slate-gray" /> Legacy pipeline (archived)
          </h1>
          <Link href="/" className="text-xs px-3 py-1.5 rounded border border-ink-line text-slate-gray hover:text-soft-white hover:border-neon-blue flex items-center gap-1" data-testid="link-back-cockpit">
            <ArrowLeft className="h-3 w-3" /> Back to cockpit
          </Link>
        </div>
        <div className="rounded border border-ink-line bg-ink-deep px-3 py-2 text-[11.5px] text-slate-gray" data-testid="text-archive-note">
          The Unified Swing Engine is the authority for every setup status. This older pipeline is kept for reference and future reconfiguration.
          Its Flex scanner already mirrors the unified engine. The old “Execute — Place order” step was removed: when a unified card prints,
          its Trade Summary tells you to open your broker and place the order yourself.
        </div>
        <LegacyPipeline />
      </div>
    </CockpitTickerProvider>
  );
}
