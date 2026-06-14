// Builds a hash-route URL that pre-fills the Trade Planner form.
// Hash routing keeps everything after the `#`, so we put query params there.
// Example: /#/trade-planner?ticker=SMH&entry=210&stop=205&target=225&setup=Hammer&direction=long
export interface PlanPrefill {
  ticker: string;
  entry?: number | null;
  stop?: number | null;
  target?: number | null;
  setup?: string | null;
  direction?: "long" | "short";
}

export function buildPlannerHref(p: PlanPrefill): string {
  const params = new URLSearchParams();
  params.set("ticker", p.ticker.toUpperCase());
  if (p.entry != null && Number.isFinite(p.entry)) params.set("entry", String(p.entry));
  if (p.stop != null && Number.isFinite(p.stop)) params.set("stop", String(p.stop));
  if (p.target != null && Number.isFinite(p.target)) params.set("target", String(p.target));
  if (p.setup) params.set("setup", p.setup);
  if (p.direction) params.set("direction", p.direction);
  return `/trade-planner?${params.toString()}`;
}
