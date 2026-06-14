// Phase 1 — Trade Planner page.
// Layout: header (account + regime risk + open-risk meter) + form (left)
// + saved plans table (right/below). No journaling/charts/AI/screenshots.
import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Panel, Chip } from "@/components/Panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { errMsg } from "@/lib/errors";
import { riskPctFromSettings, type Regime } from "@/lib/engine";
import { PositionSizeCalculator } from "@/components/PositionSizeCalculator";
import { calcPositionSize, calcRR } from "@/lib/positionSize";
import type { Settings, TradePlan, RegimeState, RegimeInputsRow } from "@shared/schema";

interface RegimePayload {
  state: RegimeState;
  latestInputs: RegimeInputsRow | null;
  effective: { code: "green" | "yellow" | "red"; source: "AUTO" | "MANUAL" };
}

const SETUP_TYPES = [
  "Hammer",
  "Bullish Engulfing",
  "Strong Bull Bar",
  "Aggressive Bounce",
  "V-Bottom Continuation",
  "Follow-through Green Run",
  "SMA20 Bounce",
  "Other",
] as const;

export default function TradePlanner() {
  const { toast } = useToast();
  const { data: settings } = useQuery<Settings>({ queryKey: ["/api/settings"] });
  const { data: regimePayload } = useQuery<RegimePayload>({ queryKey: ["/api/regime"] });
  const { data: plans = [], isLoading: plansLoading } = useQuery<TradePlan[]>({
    queryKey: ["/api/trade-plans"],
  });

  const activeRegime: Regime = (regimePayload?.effective?.code?.toUpperCase() as Regime) || "YELLOW";
  const riskPcts = useMemo(() => riskPctFromSettings(settings), [settings]);
  const defaultRiskPct = (riskPcts[activeRegime] ?? 0.03) * 100; // → percent units
  const accountSize = Number(settings?.equity ?? 0);
  const maxOpenRiskPct = Number(settings?.maxOpenRiskPct ?? 6);

  // Form state
  const [ticker, setTicker] = useState("");
  const [setupType, setSetupType] = useState<string>("Hammer");
  const [direction, setDirection] = useState<"long" | "short">("long");
  const [entry, setEntry] = useState("");
  const [stop, setStop] = useState("");
  const [target, setTarget] = useState("");
  const [riskPctStr, setRiskPctStr] = useState<string>(defaultRiskPct.toFixed(1));
  const [thesis, setThesis] = useState("");
  const [prefilled, setPrefilled] = useState(false);

  // Pre-fill from URL query (?ticker=SMH&entry=210&stop=205&target=225&setup=Hammer&direction=long).
  // wouter's useHashLocation puts the query in window.location.search (not the hash) when
  // navigating with hrefs like "/trade-planner?ticker=...".
  useEffect(() => {
    if (typeof window === "undefined") return;
    const search = window.location.search;
    if (!search || search.length <= 1) return;
    const params = new URLSearchParams(search);
    const t = params.get("ticker");
    const e = params.get("entry");
    const s = params.get("stop");
    const tg = params.get("target");
    const setup = params.get("setup");
    const dir = params.get("direction");
    if (t) setTicker(t.toUpperCase());
    if (e) setEntry(e);
    if (s) setStop(s);
    if (tg) setTarget(tg);
    if (setup && (SETUP_TYPES as readonly string[]).includes(setup)) setSetupType(setup);
    if (dir === "long" || dir === "short") setDirection(dir);
    if (t || e || s || tg || setup || dir) {
      setPrefilled(true);
      // Strip the query so a refresh doesn't re-prefill stale values.
      window.history.replaceState(null, "", window.location.pathname + window.location.hash);
    }
  }, []);

  // Sync risk% with regime when user hasn't touched it / when regime flips
  // (only auto-fill if current value matches a previously-derived default)
  const entryNum = Number(entry);
  const stopNum = Number(stop);
  const targetNum = target.trim() === "" ? null : Number(target);
  const riskPctNum = Number(riskPctStr);

  const calc = useMemo(
    () =>
      calcPositionSize({
        accountSize,
        riskPercent: riskPctNum,
        entryPrice: entryNum,
        stopPrice: stopNum,
        direction,
      }),
    [accountSize, riskPctNum, entryNum, stopNum, direction],
  );
  const rr = calcRR(entryNum, stopNum, targetNum);

  // Open-risk meter — sum of planned (not cancelled/executed) plans.
  const currentOpenRisk = useMemo(
    () => plans.filter((p) => p.status === "planned").reduce((acc, p) => acc + Number(p.riskPercent || 0), 0),
    [plans],
  );
  const projectedOpenRisk = currentOpenRisk + (Number.isFinite(riskPctNum) ? riskPctNum : 0);
  const overCap = projectedOpenRisk > maxOpenRiskPct + 1e-6;

  const createMutation = useMutation({
    mutationFn: async (body: any) => {
      const res = await apiRequest("POST", "/api/trade-plans", body);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/trade-plans"] });
      toast({ title: "Plan saved", description: `${ticker.toUpperCase()} added to planner` });
      setTicker("");
      setEntry("");
      setStop("");
      setTarget("");
      setThesis("");
    },
    onError: (e: any) => toast({ title: "Could not save plan", description: errMsg(e), variant: "destructive" }),
  });

  const statusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "planned" | "cancelled" | "executed" }) => {
      const res = await apiRequest("PATCH", `/api/trade-plans/${id}`, { status });
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/trade-plans"] }),
    onError: (e: any) => toast({ title: "Update failed", description: errMsg(e), variant: "destructive" }),
  });

  const canSave = calc.ok && ticker.trim().length > 0 && setupType.length > 0 && !overCap;

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!calc.ok) return;
    createMutation.mutate({
      ticker: ticker.trim().toUpperCase(),
      setupType,
      direction,
      entryPrice: entryNum,
      stopPrice: stopNum,
      targetPrice: targetNum,
      riskPercent: riskPctNum,
      plannedShares: calc.shares,
      thesis,
      status: "planned",
    });
  }

  return (
    <div className="p-4 space-y-4" data-testid="page-trade-planner">
      {/* ── Header strip ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <HeaderStat label="Account" value={`$${accountSize.toLocaleString(undefined, { maximumFractionDigits: 2 })}`} testid="hdr-account" />
        <HeaderStat
          label={`${activeRegime} Risk`}
          value={`${defaultRiskPct.toFixed(1)}%`}
          accent={activeRegime === "GREEN" ? "signal-green" : activeRegime === "YELLOW" ? "signal-amber" : "signal-red"}
          testid="hdr-regime-risk"
        />
        <HeaderStat
          label="Open Risk (planned)"
          value={`${currentOpenRisk.toFixed(2)}% / ${maxOpenRiskPct.toFixed(1)}%`}
          accent={currentOpenRisk >= maxOpenRiskPct ? "signal-red" : "neon-blue"}
          testid="hdr-open-risk"
        />
        <HeaderStat
          label="Projected if saved"
          value={`${projectedOpenRisk.toFixed(2)}%`}
          accent={overCap ? "signal-red" : "signal-green"}
          testid="hdr-projected-risk"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* ── New plan form ───────────────────────────────────────────────── */}
        <Panel title="New Trade Plan" hint={prefilled ? "Pre-filled from monitor — review and save" : "Phase 1 · sized via your risk profile"}>
          <form onSubmit={onSubmit} className="space-y-3" data-testid="form-trade-plan">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-[10px] uppercase tracking-wider text-slate-gray">Ticker</Label>
                <Input
                  value={ticker}
                  onChange={(e) => setTicker(e.target.value.toUpperCase())}
                  placeholder="SMH"
                  maxLength={16}
                  className="font-mono-num"
                  data-testid="input-ticker"
                />
              </div>
              <div>
                <Label className="text-[10px] uppercase tracking-wider text-slate-gray">Setup</Label>
                <Select value={setupType} onValueChange={setSetupType}>
                  <SelectTrigger data-testid="select-setup-type">
                    <SelectValue placeholder="Choose setup" />
                  </SelectTrigger>
                  <SelectContent>
                    {SETUP_TYPES.map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-[10px] uppercase tracking-wider text-slate-gray">Direction</Label>
                <Select value={direction} onValueChange={(v) => setDirection(v as "long" | "short")}>
                  <SelectTrigger data-testid="select-direction">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="long">Long</SelectItem>
                    <SelectItem value="short">Short</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-[10px] uppercase tracking-wider text-slate-gray">Risk %</Label>
                <Input
                  type="number"
                  step="0.1"
                  min="0.1"
                  max="100"
                  value={riskPctStr}
                  onChange={(e) => setRiskPctStr(e.target.value)}
                  className="font-mono-num"
                  data-testid="input-risk-pct"
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label className="text-[10px] uppercase tracking-wider text-slate-gray">Entry</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={entry}
                  onChange={(e) => setEntry(e.target.value)}
                  placeholder="0.00"
                  className="font-mono-num"
                  data-testid="input-entry"
                />
              </div>
              <div>
                <Label className="text-[10px] uppercase tracking-wider text-slate-gray">Stop</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={stop}
                  onChange={(e) => setStop(e.target.value)}
                  placeholder="0.00"
                  className="font-mono-num"
                  data-testid="input-stop"
                />
              </div>
              <div>
                <Label className="text-[10px] uppercase tracking-wider text-slate-gray">
                  Target <span className="text-slate-gray/60">(opt.)</span>
                </Label>
                <Input
                  type="number"
                  step="0.01"
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  placeholder="0.00"
                  className="font-mono-num"
                  data-testid="input-target"
                />
              </div>
            </div>

            <PositionSizeCalculator
              accountSize={accountSize}
              riskPercent={riskPctNum}
              entryPrice={entryNum}
              stopPrice={stopNum}
              targetPrice={targetNum}
              direction={direction}
            />

            <div>
              <Label className="text-[10px] uppercase tracking-wider text-slate-gray">Thesis</Label>
              <Textarea
                value={thesis}
                onChange={(e) => setThesis(e.target.value)}
                rows={3}
                placeholder="Why this setup, where it invalidates, where you scale out…"
                data-testid="input-thesis"
              />
            </div>

            {overCap && (
              <div
                className="text-[11px] p-2 border rounded-sm"
                style={{ borderColor: "hsl(var(--signal-red) / 0.5)", background: "hsl(var(--signal-red) / 0.06)", color: "hsl(var(--signal-red))" }}
                data-testid="warn-over-cap"
              >
                Saving this plan would push planned open risk to {projectedOpenRisk.toFixed(2)}%, above your cap of {maxOpenRiskPct.toFixed(1)}%. Cancel or execute an existing plan, or raise the cap in Settings.
              </div>
            )}

            <Button
              type="submit"
              disabled={!canSave || createMutation.isPending}
              className="w-full"
              data-testid="button-save-plan"
            >
              {createMutation.isPending ? "Saving…" : "Save Plan"}
            </Button>
          </form>
        </Panel>

        {/* ── Saved plans ─────────────────────────────────────────────────── */}
        <Panel title="Saved Plans" hint={`${plans.filter((p) => p.status === "planned").length} open · ${plans.length} total`}>
          {plansLoading ? (
            <div className="text-[12px] text-slate-gray">Loading…</div>
          ) : plans.length === 0 ? (
            <div className="text-[12px] text-slate-gray" data-testid="text-empty-plans">No plans yet. Build one on the left.</div>
          ) : (
            <div className="space-y-2" data-testid="list-plans">
              {plans.map((p) => (
                <PlanRow
                  key={p.id}
                  plan={p}
                  onStatus={(status) => statusMutation.mutate({ id: p.id, status })}
                  isPending={statusMutation.isPending}
                />
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}

function HeaderStat({
  label,
  value,
  accent,
  testid,
}: {
  label: string;
  value: string;
  accent?: "neon-blue" | "signal-green" | "signal-amber" | "signal-red";
  testid: string;
}) {
  const cls =
    accent === "neon-blue"
      ? "text-neon-blue"
      : accent === "signal-green"
      ? "text-signal-green"
      : accent === "signal-amber"
      ? "text-signal-amber"
      : accent === "signal-red"
      ? "text-signal-red"
      : "text-soft-white";
  return (
    <div className="border border-ink-line rounded-sm px-3 py-2">
      <div className="text-[9px] uppercase tracking-wider text-slate-gray mb-0.5">{label}</div>
      <div className={`font-mono-num tabular-nums text-[16px] font-semibold ${cls}`} data-testid={testid}>{value}</div>
    </div>
  );
}

function PlanRow({
  plan,
  onStatus,
  isPending,
}: {
  plan: TradePlan;
  onStatus: (s: "cancelled" | "executed") => void;
  isPending: boolean;
}) {
  const rr = calcRR(Number(plan.entryPrice), Number(plan.stopPrice), plan.targetPrice == null ? null : Number(plan.targetPrice));
  const statusTone =
    plan.status === "planned" ? "blue" : plan.status === "executed" ? "green" : "amber";
  return (
    <div className="border border-ink-line rounded-sm p-2" data-testid={`row-plan-${plan.id}`}>
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="flex items-baseline gap-2 min-w-0">
          <span className="font-display text-[13px] text-soft-white" data-testid={`text-ticker-${plan.id}`}>{plan.ticker}</span>
          <span className="text-[10px] uppercase tracking-wider text-slate-gray">{plan.setupType}</span>
          <Chip tone={plan.direction === "long" ? "green" : "red"}>{plan.direction}</Chip>
        </div>
        <Chip tone={statusTone as any}>{plan.status}</Chip>
      </div>
      <div className="grid grid-cols-5 gap-2 text-[11px] font-mono-num tabular-nums">
        <Kv k="Entry" v={`$${Number(plan.entryPrice).toFixed(2)}`} />
        <Kv k="Stop" v={`$${Number(plan.stopPrice).toFixed(2)}`} />
        <Kv k="Target" v={plan.targetPrice == null ? "—" : `$${Number(plan.targetPrice).toFixed(2)}`} />
        <Kv k="Shares" v={plan.plannedShares.toLocaleString()} accent="neon-blue" />
        <Kv k="R:R" v={rr == null ? "—" : `${rr.toFixed(2)}R`} accent={rr != null && rr >= 2 ? "green" : undefined} />
      </div>
      {plan.thesis && (
        <div className="mt-1.5 text-[11px] text-slate-gray line-clamp-2" data-testid={`text-thesis-${plan.id}`}>{plan.thesis}</div>
      )}
      {plan.status === "planned" && (
        <div className="flex gap-2 mt-2">
          <Button
            size="sm"
            variant="outline"
            disabled={isPending}
            onClick={() => onStatus("executed")}
            data-testid={`button-execute-${plan.id}`}
            className="flex-1 text-[11px]"
          >
            Mark Executed
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={isPending}
            onClick={() => onStatus("cancelled")}
            data-testid={`button-cancel-${plan.id}`}
            className="flex-1 text-[11px]"
          >
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}

function Kv({ k, v, accent }: { k: string; v: string; accent?: "neon-blue" | "green" }) {
  const cls =
    accent === "neon-blue" ? "text-neon-blue" : accent === "green" ? "text-signal-green" : "text-soft-white";
  return (
    <div>
      <div className="text-[9px] uppercase tracking-wider text-slate-gray">{k}</div>
      <div className={cls}>{v}</div>
    </div>
  );
}
