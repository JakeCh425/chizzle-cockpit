// ─── Phase 4: Analytics filter bar ───────────────────────────────────────────
// Controlled component. Owns no state beyond what the parent passes.
// All field changes are emitted via onChange so the parent can decide whether
// to refetch (date) or just recompute (everything else).

import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import type { AnalyticsFilters } from "@shared/analytics";

interface Props {
  filters: AnalyticsFilters;
  onChange: (next: AnalyticsFilters) => void;
  /** Distinct values present in the loaded dataset; used to populate selects. */
  options: {
    tickers: string[];
    setups: Array<{ key: string; label: string }>;
    tags: string[];
  };
  /** Optional reset handler. If absent the button is hidden. */
  onReset?: () => void;
}

// shadcn's <SelectItem> requires a non-empty value, so we use a sentinel for
// the "all/any" choice and strip it in the change handler.
const ANY = "__any__";

export function AnalyticsFilters({ filters, onChange, options, onReset }: Props) {
  const set = <K extends keyof AnalyticsFilters>(key: K, value: AnalyticsFilters[K] | undefined) => {
    const next = { ...filters };
    if (value === undefined) delete next[key];
    else (next as any)[key] = value;
    onChange(next);
  };

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2 items-end">
      <Field label="From">
        <Input
          type="date"
          value={filters.from ?? ""}
          onChange={(e) => set("from", e.target.value || undefined)}
          className="h-8 text-[12px]"
          data-testid="input-analytics-from"
        />
      </Field>
      <Field label="To">
        <Input
          type="date"
          value={filters.to ?? ""}
          onChange={(e) => set("to", e.target.value || undefined)}
          className="h-8 text-[12px]"
          data-testid="input-analytics-to"
        />
      </Field>
      <Field label="Ticker">
        <Select
          value={filters.ticker ?? ANY}
          onValueChange={(v) => set("ticker", v === ANY ? undefined : v)}
        >
          <SelectTrigger className="h-8 text-[12px]" data-testid="select-analytics-ticker">
            <SelectValue placeholder="Any" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Any</SelectItem>
            {options.tickers.map((t) => (
              <SelectItem key={t} value={t}>{t}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label="Setup">
        <Select
          value={filters.setupType ?? ANY}
          onValueChange={(v) => set("setupType", v === ANY ? undefined : v)}
        >
          <SelectTrigger className="h-8 text-[12px]" data-testid="select-analytics-setup">
            <SelectValue placeholder="Any" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Any</SelectItem>
            {options.setups.map((s) => (
              <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label="Direction">
        <Select
          value={filters.direction ?? ANY}
          onValueChange={(v) => set("direction", v === ANY ? undefined : (v as "long" | "short"))}
        >
          <SelectTrigger className="h-8 text-[12px]" data-testid="select-analytics-direction">
            <SelectValue placeholder="Any" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Any</SelectItem>
            <SelectItem value="long">Long</SelectItem>
            <SelectItem value="short">Short</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <Field label="Followed plan">
        <Select
          value={filters.followedPlan === undefined ? ANY : filters.followedPlan ? "yes" : "no"}
          onValueChange={(v) =>
            set("followedPlan", v === ANY ? undefined : v === "yes")
          }
        >
          <SelectTrigger className="h-8 text-[12px]" data-testid="select-analytics-followed">
            <SelectValue placeholder="Any" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Any</SelectItem>
            <SelectItem value="yes">Yes</SelectItem>
            <SelectItem value="no">No</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <Field label="Tag">
        <Select
          value={filters.tag ?? ANY}
          onValueChange={(v) => set("tag", v === ANY ? undefined : v)}
        >
          <SelectTrigger className="h-8 text-[12px]" data-testid="select-analytics-tag">
            <SelectValue placeholder="Any" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Any</SelectItem>
            {options.tags.map((t) => (
              <SelectItem key={t} value={t}>{t}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <div className="flex items-end">
        {onReset && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onReset}
            className="h-8 text-[11px] uppercase tracking-wider w-full"
            data-testid="button-analytics-reset"
          >
            Reset
          </Button>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 min-w-0">
      <span className="text-[10px] uppercase tracking-wider text-slate-gray">{label}</span>
      {children}
    </label>
  );
}
