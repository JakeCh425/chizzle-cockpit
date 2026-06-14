// Phase 3 — Tag library management page.
// Standalone /tags route. Reuses TagManager (also embedded in TagPicker).

import { Link } from "wouter";
import { Panel } from "@/components/Panel";
import { TagManager } from "@/components/TagManager";

export default function TagsPage() {
  return (
    <div className="p-4 space-y-3" data-testid="page-tags">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <Link
            href="/trade-planner"
            className="text-[11px] uppercase tracking-wider text-slate-gray hover:text-neon-blue"
            data-testid="link-back-planner-from-tags"
          >
            ← Back to Planner
          </Link>
          <span className="font-display text-[14px] text-soft-white">Tag Library</span>
        </div>
      </div>

      <Panel
        title="Tags"
        hint="Used to tag post-trade reviews"
      >
        <TagManager />
      </Panel>
    </div>
  );
}
