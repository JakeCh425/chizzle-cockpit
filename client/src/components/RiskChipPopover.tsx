import { useEffect, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Regime } from "@/lib/engine";
import { useToast } from "@/hooks/use-toast";

// Clickable RISK chip → opens a 1-10% slider popover for the active regime.
// Saves to /api/settings (riskPctGreen | riskPctYellow | riskPctRed).
//
// `valuePct` is the current % (e.g. 2.0 for 2%).
// `regime` decides which settings field to patch.
export function RiskChipPopover({
  valuePct,
  regime,
  className = "",
  testId = "chip-risk-pct",
}: {
  valuePct: number;
  regime: Regime;
  className?: string;
  testId?: string;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [local, setLocal] = useState<number>(valuePct);
  const [saving, setSaving] = useState(false);

  // Keep slider synced with server when the chip is closed and equity/regime/settings change
  useEffect(() => {
    if (!open) setLocal(valuePct);
  }, [valuePct, open]);

  const hue =
    regime === "GREEN"
      ? "--signal-green"
      : regime === "YELLOW"
        ? "--signal-amber"
        : "--signal-red";

  const fieldName =
    regime === "GREEN" ? "riskPctGreen" : regime === "YELLOW" ? "riskPctYellow" : "riskPctRed";

  const save = async () => {
    setSaving(true);
    try {
      await apiRequest("PATCH", "/api/settings", { [fieldName]: local });
      await queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      toast({
        title: "Risk updated",
        description: `${regime} regime → ${local.toFixed(1)}% per trade.`,
      });
      setOpen(false);
    } catch (e: any) {
      toast({ title: "Failed to save", description: e?.message || "Try again." });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid={testId}
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-sm border font-mono-num tabular-nums text-[10px] tracking-tight uppercase transition-colors hover:bg-neon-blue/20 ${className}`}
          style={{
            borderColor: `hsl(var(${hue}) / 0.5)`,
            background: `hsl(var(${hue}) / 0.08)`,
            color: `hsl(var(${hue}))`,
          }}
          title="Click to adjust risk %"
        >
          {valuePct.toFixed(1)}% per trade
          <span className="text-[8px] opacity-60">▾</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="start"
        className="w-64 border border-neon-blue/40 bg-ink-panel text-soft-white p-3 rounded-sm"
      >
        <div className="text-[10px] uppercase tracking-wider text-slate-gray mb-2">
          {regime} regime · risk % per trade
        </div>
        <div className="flex items-baseline gap-2 mb-2">
          <span
            className="font-mono-num tabular-nums text-2xl font-semibold"
            style={{ color: `hsl(var(${hue}))` }}
          >
            {local.toFixed(1)}
          </span>
          <span className="text-[11px] text-slate-gray">% per trade</span>
        </div>
        <input
          type="range"
          min={1}
          max={10}
          step={0.1}
          value={local}
          onChange={(e) => setLocal(Number(e.target.value))}
          className="w-full cursor-pointer"
          style={{ accentColor: `hsl(var(${hue}))` }}
          data-testid="slider-risk-chip"
        />
        <div className="flex justify-between text-[9px] text-slate-gray mt-1 mb-3">
          <span>1%</span>
          <span>5%</span>
          <span>10%</span>
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => {
              setLocal(valuePct);
              setOpen(false);
            }}
            className="px-2 py-1 text-[10px] uppercase tracking-wider border border-ink-line text-slate-gray hover:text-soft-white hover:border-soft-white/40 rounded-sm"
            data-testid="button-risk-cancel"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving || local === valuePct}
            className="px-2 py-1 text-[10px] uppercase tracking-wider border border-neon-blue/60 bg-neon-blue/10 text-neon-blue hover:bg-neon-blue/20 disabled:opacity-50 disabled:cursor-not-allowed rounded-sm"
            data-testid="button-risk-save"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default RiskChipPopover;
