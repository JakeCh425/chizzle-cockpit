// Collapsible wrapper for cockpit panels.
// ----------------------------------------------------------------------------
// Every panel gets a slim header row with a chevron, title, optional badges,
// and any secondary action (e.g. refresh). Body is hidden when collapsed.
// State persists via /api/ui-prefs so the cockpit remembers exactly how the
// user left each panel. localStorage is blocked in the sandboxed iframe, so
// the KV store lives on the server.
//
// Usage:
//   <CollapsibleSection id="market-pulse" title="Market Pulse" defaultCollapsed>
//     <MarketPulsePanel />
//   </CollapsibleSection>

import { useEffect, useState, ReactNode } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { ChevronDown, ChevronUp } from "lucide-react";

interface UiPrefs {
  id: number;
  data: {
    collapse?: Record<string, boolean>;
    [k: string]: any;
  };
  updatedAt?: string;
}

// ─── Hook: read + write the collapse state for one panel id ─────────────────
export function usePanelCollapsed(id: string, defaultCollapsed: boolean) {
  const { data } = useQuery<UiPrefs>({
    queryKey: ["/api/ui-prefs"],
    queryFn: async () => (await (await apiRequest("GET", "/api/ui-prefs")).json()) as UiPrefs,
    staleTime: 60_000,
  });

  const savedRaw = data?.data?.collapse?.[id];
  const collapsed = savedRaw == null ? defaultCollapsed : Boolean(savedRaw);

  const patch = useMutation({
    mutationFn: async (next: boolean) => {
      return (await apiRequest("PATCH", "/api/ui-prefs", {
        data: { collapse: { [id]: next } },
      })).json();
    },
    onMutate: async (next: boolean) => {
      // Optimistic update so the click feels instant.
      await queryClient.cancelQueries({ queryKey: ["/api/ui-prefs"] });
      const prev = queryClient.getQueryData<UiPrefs>(["/api/ui-prefs"]);
      const nextData: UiPrefs = prev
        ? { ...prev, data: { ...prev.data, collapse: { ...(prev.data.collapse || {}), [id]: next } } }
        : { id: 1, data: { collapse: { [id]: next } } };
      queryClient.setQueryData(["/api/ui-prefs"], nextData);
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(["/api/ui-prefs"], ctx.prev);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ui-prefs"] });
    },
  });

  return {
    collapsed,
    toggle: () => patch.mutate(!collapsed),
    setCollapsed: (v: boolean) => patch.mutate(v),
  };
}

interface CollapsibleSectionProps {
  id: string;                          // stable key stored in ui_prefs.data.collapse
  title: string;                       // header text
  hint?: string;                       // secondary label (e.g. count, timestamp)
  action?: ReactNode;                  // right-aligned button/badge
  defaultCollapsed?: boolean;          // used until the user toggles once
  children: ReactNode;
  containerClassName?: string;
  headerToneClassName?: string;        // e.g. tint the header for status
}

export default function CollapsibleSection({
  id,
  title,
  hint,
  action,
  defaultCollapsed = false,
  children,
  containerClassName = "rounded-lg border border-ink-line bg-ink-panel/30",
  headerToneClassName = "",
}: CollapsibleSectionProps) {
  const { collapsed, toggle } = usePanelCollapsed(id, defaultCollapsed);

  return (
    <section className={containerClassName} data-testid={`section-${id}`}>
      <div
        className={[
          "flex items-center justify-between gap-2 px-3 py-2",
          collapsed ? "" : "border-b border-ink-line",
          headerToneClassName,
        ].join(" ")}
      >
        <button
          type="button"
          onClick={toggle}
          className="flex items-center gap-2 min-w-0 hover:opacity-90 text-left"
          data-testid={`button-collapse-${id}`}
          aria-expanded={!collapsed}
          title={collapsed ? `Expand ${title}` : `Collapse ${title}`}
        >
          {collapsed
            ? <ChevronDown className="w-3.5 h-3.5 text-slate-gray shrink-0" />
            : <ChevronUp className="w-3.5 h-3.5 text-slate-gray shrink-0" />}
          <span className="text-[11px] font-mono uppercase tracking-wider text-soft-white truncate">{title}</span>
          {hint && (
            <span className="text-[9px] font-mono uppercase tracking-wider text-slate-gray truncate">
              {hint}
            </span>
          )}
        </button>
        {action && <div className="flex items-center gap-1.5 shrink-0">{action}</div>}
      </div>
      {!collapsed && <div>{children}</div>}
    </section>
  );
}

// A tiny state-only variant with no persistence — used when a component
// wants a local-only collapse (kept for future).
export function LocalCollapsible({
  title, children, defaultCollapsed = false,
}: { title: string; children: ReactNode; defaultCollapsed?: boolean }) {
  const [c, setC] = useState(defaultCollapsed);
  useEffect(() => { /* no-op */ }, []);
  return (
    <div className="rounded border border-ink-line bg-ink-panel/30">
      <button onClick={() => setC(v => !v)} className="w-full flex items-center gap-2 px-3 py-2 border-b border-ink-line">
        {c ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
        <span className="text-[11px] font-mono uppercase tracking-wider text-soft-white">{title}</span>
      </button>
      {!c && <div className="p-3">{children}</div>}
    </div>
  );
}
