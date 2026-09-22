// MTF Signal Engine v2 — Settings Panel (PR 2f, spec §1)
// ----------------------------------------------------------------------------
// Dashboard controls for STRICT / STANDARD / FLEXIBLE mode and all sub-toggles.
// Reads /api/mtf/settings + /api/feature-flags; writes via PATCH /api/mtf/settings.
// When ENABLE_MTF_ENGINE_V2 is OFF, the panel renders read-only with a clear
// notice that changes are disabled.

import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Panel, Chip } from "@/components/Panel";
import { Loader2, Save, ShieldCheck, Zap, Gauge } from "lucide-react";

type Mode = "STRICT" | "STANDARD" | "FLEXIBLE";

interface Settings {
  id: number;
  mode: Mode;
  minRr: number;
  expiryBars: number;
  allowEarlyTrigger: boolean;
  requireVolume: boolean;
  requireDailyAlignment: boolean;
  requireWeeklyAlignment: boolean;
  showForming: boolean;
  updatedAt: string;
}

interface SettingsResponse {
  settings: Settings;
  modes: Mode[];
  flagEnabled: boolean;
}

const MODE_DESCRIPTIONS: Record<Mode, { blurb: string; icon: React.ReactNode; tone: "green" | "blue" | "amber" }> = {
  STRICT:   { blurb: "A4 core-swing quality only. Weekly green + volume + 2R minimum.", icon: <ShieldCheck className="h-3.5 w-3.5" />, tone: "green" },
  STANDARD: { blurb: "Balanced. Weekly green or neutral; daily improving; volume preferred.", icon: <Gauge className="h-3.5 w-3.5" />, tone: "blue" },
  FLEXIBLE: { blurb: "More cards, lower confidence. Practice / reduced-risk labels applied.", icon: <Zap className="h-3.5 w-3.5" />, tone: "amber" },
};

export default function MTFSettingsPanel() {
  const { data, isLoading, isError } = useQuery<SettingsResponse>({
    queryKey: ["/api/mtf/settings"],
  });

  // Local draft state — only committed via PATCH.
  const [draft, setDraft] = useState<Settings | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (data?.settings) setDraft(data.settings);
  }, [data?.settings]);

  const flagEnabled = data?.flagEnabled ?? false;
  const dirty = draft && data?.settings && JSON.stringify(draft) !== JSON.stringify(data.settings);

  const patch = useMutation({
    mutationFn: async (payload: Partial<Settings>) => {
      const res = await apiRequest("PATCH", "/api/mtf/settings", payload);
      return res.json();
    },
    onSuccess: () => {
      setSaveError(null);
      queryClient.invalidateQueries({ queryKey: ["/api/mtf/settings"] });
    },
    onError: (err: any) => setSaveError(err?.message || "Save failed"),
  });

  if (isLoading) {
    return (
      <Panel title="Signal Sensitivity">
        <div className="flex items-center gap-2 text-[12px] text-slate-gray">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading settings…
        </div>
      </Panel>
    );
  }
  if (isError || !draft) {
    return (
      <Panel title="Signal Sensitivity">
        <div className="text-[12px] text-signal-red">Failed to load settings.</div>
      </Panel>
    );
  }

  const onSave = () => {
    if (!draft) return;
    const { id, updatedAt, ...payload } = draft;
    void id; void updatedAt;
    patch.mutate(payload);
  };

  const readOnly = !flagEnabled;

  return (
    <Panel
      title="Signal Sensitivity"
      hint={`v2 engine ${flagEnabled ? "ON" : "OFF"} · mode ${data?.settings.mode ?? "STANDARD"}`}
      action={
        <div className="flex items-center gap-2">
          {dirty && !readOnly && (
            <span className="text-[10px] text-signal-amber font-mono uppercase tracking-wider">Unsaved</span>
          )}
          <button
            type="button"
            onClick={onSave}
            disabled={!dirty || readOnly || patch.isPending}
            className="inline-flex items-center gap-1.5 px-2 py-1 border border-ink-line rounded-sm text-[10px] uppercase tracking-wider text-soft-white hover:bg-ink-line/40 disabled:opacity-40 disabled:cursor-not-allowed"
            data-testid="button-save-mtf-settings"
          >
            {patch.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
            Save
          </button>
        </div>
      }
    >
      {readOnly && (
        <div className="mb-3 p-2 border border-ink-line rounded-sm bg-ink-line/20 text-[11px] text-slate-gray">
          MTF Engine v2 is disabled. Set <span className="font-mono text-soft-white">ENABLE_MTF_ENGINE_V2=true</span> to activate custom sensitivity. Current values displayed are baseline defaults.
        </div>
      )}
      {saveError && (
        <div className="mb-3 p-2 border border-signal-red/40 bg-signal-red/10 rounded-sm text-[11px] text-signal-red" data-testid="text-save-error">
          {saveError}
        </div>
      )}

      {/* ─── Mode picker (three-way segmented) ─── */}
      <div className="mb-4">
        <div className="text-[10px] uppercase tracking-wider text-slate-gray mb-2">Signal Mode</div>
        <div className="grid grid-cols-3 gap-1.5">
          {(["STRICT", "STANDARD", "FLEXIBLE"] as const).map((m) => {
            const active = draft.mode === m;
            const meta = MODE_DESCRIPTIONS[m];
            return (
              <button
                key={m}
                type="button"
                disabled={readOnly}
                onClick={() => setDraft({ ...draft, mode: m })}
                className={[
                  "flex flex-col items-start gap-1 p-2 border rounded-sm text-left transition-colors",
                  active
                    ? "border-neon-blue bg-neon-blue/10 text-soft-white"
                    : "border-ink-line hover:bg-ink-line/40 text-slate-gray",
                  readOnly ? "opacity-60 cursor-not-allowed" : "cursor-pointer",
                ].join(" ")}
                data-testid={`button-mode-${m.toLowerCase()}`}
              >
                <div className="flex items-center gap-1.5">
                  {meta.icon}
                  <span className="font-display text-[11px] tracking-[0.15em] uppercase">{m}</span>
                </div>
                <span className="text-[10px] leading-tight text-slate-gray">{meta.blurb}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ─── Numeric selectors ─── */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wider text-slate-gray">Min Target 1 R:R</span>
          <select
            value={draft.minRr}
            disabled={readOnly}
            onChange={(e) => setDraft({ ...draft, minRr: Number(e.target.value) })}
            className="bg-ink-panel border border-ink-line rounded-sm px-2 py-1 text-[12px] text-soft-white font-mono tabular-nums disabled:opacity-60"
            data-testid="select-min-rr"
          >
            <option value={1.5}>1.5R</option>
            <option value={2.0}>2.0R</option>
            <option value={2.5}>2.5R</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wider text-slate-gray">Card Expiry (4H bars)</span>
          <select
            value={draft.expiryBars}
            disabled={readOnly}
            onChange={(e) => setDraft({ ...draft, expiryBars: Number(e.target.value) })}
            className="bg-ink-panel border border-ink-line rounded-sm px-2 py-1 text-[12px] text-soft-white font-mono tabular-nums disabled:opacity-60"
            data-testid="select-expiry-bars"
          >
            <option value={1}>1 bar</option>
            <option value={2}>2 bars</option>
            <option value={3}>3 bars</option>
          </select>
        </label>
      </div>

      {/* ─── Toggle stack ─── */}
      <div className="space-y-1.5 mb-3">
        <Toggle
          label="Require Weekly Alignment"
          hint="Weekly regime must be at least neutral"
          checked={draft.requireWeeklyAlignment}
          disabled={readOnly}
          onChange={(v) => setDraft({ ...draft, requireWeeklyAlignment: v })}
          testId="toggle-require-weekly"
        />
        <Toggle
          label="Require Daily Alignment"
          hint="Daily must be reclaimed / pullback-valid / neutral"
          checked={draft.requireDailyAlignment}
          disabled={readOnly}
          onChange={(v) => setDraft({ ...draft, requireDailyAlignment: v })}
          testId="toggle-require-daily"
        />
        <Toggle
          label="Require Volume Confirmation"
          hint="≥ 1.2× 10-bar avg on the setup bar"
          checked={draft.requireVolume}
          disabled={readOnly}
          onChange={(v) => setDraft({ ...draft, requireVolume: v })}
          testId="toggle-require-volume"
        />
        <Toggle
          label="Show Setup-Forming Cards"
          hint="Early observation cards before pattern completes"
          checked={draft.showForming}
          disabled={readOnly}
          onChange={(v) => setDraft({ ...draft, showForming: v })}
          testId="toggle-show-forming"
        />
        <Toggle
          label="Allow Early Trigger"
          hint="Reduced-risk entry before 1H close confirms"
          checked={draft.allowEarlyTrigger}
          disabled={readOnly}
          onChange={(v) => setDraft({ ...draft, allowEarlyTrigger: v })}
          testId="toggle-allow-early"
        />
      </div>

      <div className="pt-2 border-t border-ink-line/60 flex items-center justify-between text-[10px] text-slate-gray">
        <span className="uppercase tracking-wider">Last saved</span>
        <span className="font-mono tabular-nums">{new Date(data?.settings.updatedAt || Date.now()).toLocaleString()}</span>
      </div>
      <div className="mt-2 flex items-center gap-1.5">
        <Chip tone={flagEnabled ? "green" : "neutral"}>{flagEnabled ? "Flag ON" : "Flag OFF"}</Chip>
        <Chip tone={MODE_DESCRIPTIONS[draft.mode].tone}>{draft.mode}</Chip>
      </div>
    </Panel>
  );
}

// ─── Small toggle component ────────────────────────────────────────────────
function Toggle({
  label, hint, checked, disabled, onChange, testId,
}: {
  label: string; hint?: string; checked: boolean; disabled?: boolean;
  onChange: (v: boolean) => void; testId?: string;
}) {
  return (
    <label className={[
      "flex items-start justify-between gap-3 py-1.5 border-b border-ink-line/60 last:border-b-0",
      disabled ? "opacity-60" : "cursor-pointer",
    ].join(" ")}>
      <div className="flex-1 min-w-0">
        <div className="text-[12px] text-soft-white">{label}</div>
        {hint && <div className="text-[10px] text-slate-gray">{hint}</div>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => !disabled && onChange(!checked)}
        className={[
          "relative w-9 h-5 rounded-full border transition-colors flex-shrink-0 mt-0.5",
          checked ? "bg-neon-blue/70 border-neon-blue" : "bg-ink-line/60 border-ink-line",
          disabled ? "cursor-not-allowed" : "cursor-pointer",
        ].join(" ")}
        data-testid={testId}
      >
        <span
          className={[
            "absolute top-0.5 h-3.5 w-3.5 rounded-full bg-soft-white transition-transform",
            checked ? "translate-x-4" : "translate-x-0.5",
          ].join(" ")}
        />
      </button>
    </label>
  );
}
