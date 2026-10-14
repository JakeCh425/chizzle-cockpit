// Chart Ecosystem — Part 4: "Card Style" (collapsible, remembered). Visual only — never changes data.
// Default keeps the existing card look byte-for-byte (no inline style is applied).
import { CheckCircle2, Eye, Lock, Hourglass } from "lucide-react";
import { usePersistentState } from "@/hooks/use-persistent-state";
import { CARD_BGS, DEFAULT_CARD_STYLE, bgFor, cardBg, cardBgStyle, type CardBgId, type CardState, type CardStylePrefs } from "@shared/cardStyles";
import { Section } from "./TradingCard";

export function useCardStyle() {
  const [p, set] = usePersistentState<CardStylePrefs>("card-style", DEFAULT_CARD_STYLE);
  const prefs = { ...DEFAULT_CARD_STYLE, ...p };
  return [prefs, (patch: Partial<CardStylePrefs>) => set({ ...prefs, ...patch })] as const;
}
/** Style + data attribute for one card. State: READY group → Ready; armed/active trade → Active; else Watch. */
export function useCardBg(state: CardState) {
  const [prefs] = useCardStyle();
  const b = bgFor(prefs, state);
  return { style: cardBgStyle(b) as React.CSSProperties, attrs: { "data-card-bg": b.id, "data-card-state": state } };
}

const STATES: { id: CardState; label: string }[] = [{ id: "READY", label: "Ready" }, { id: "ACTIVE", label: "Active" }, { id: "WATCH", label: "Watch" }];
const xs = { fontSize: "var(--ac-fs-xs)" } as const, sm = { fontSize: "var(--ac-fs-sm)" } as const;

function Swatch({ id, on, onPick, testId }: { id: CardBgId; on: boolean; onPick: () => void; testId: string }) {
  const b = cardBg(id);
  return (
    <button role="radio" aria-checked={on} onClick={onPick} title={b.desc} data-testid={testId}
      className="flex flex-col items-stretch gap-1 rounded-lg p-1 text-left" style={{ border: on ? "2px solid var(--ac-accent)" : "1px solid var(--ac-border)", width: 96 }}>
      <span className="block h-10 rounded-md" style={b.id === "default" ? { background: "var(--ac-surface)", border: "1px solid var(--ac-border)" } : { background: b.background, border: b.border ?? "1px solid rgba(255,255,255,.12)", boxShadow: b.shadow }} aria-hidden />
      <span className="font-semibold leading-tight truncate" style={xs}>{b.name}{on && <CheckCircle2 className="inline h-3 w-3 ml-0.5" aria-hidden />}</span>
    </button>
  );
}

/** Live preview: one mini card per state with the real status badges on top of the chosen background. */
export function CardPreview({ prefs, state, testId }: { prefs: CardStylePrefs; state: CardState; testId?: string }) {
  const b = bgFor(prefs, state);
  const badge = state === "READY" ? { t: "READY · practice", c: "var(--ac-good)", I: CheckCircle2 } : state === "ACTIVE" ? { t: "ACTIVE @ $66.93", c: "var(--ac-good)", I: Lock } : { t: "WATCH · retest", c: "var(--ac-warn)", I: Eye };
  return (
    <div className="ac-card rounded-xl px-3 py-2 space-y-1 min-w-0" style={cardBgStyle(b) as React.CSSProperties} data-card-bg={b.id} data-card-state={state} data-testid={testId}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="ac-num font-extrabold" style={{ fontSize: "calc(var(--ac-ticker) * 0.6)" }}>XLE</span>
        <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold" style={{ ...xs, color: badge.c, border: `1.5px solid ${badge.c}` }}><badge.I className="h-3 w-3" aria-hidden />{badge.t}</span>
        {state === "ACTIVE" && <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold" style={{ ...xs, color: "var(--ac-accent)", border: "1.5px solid var(--ac-accent)" }}><Hourglass className="h-3 w-3" aria-hidden />ARMED</span>}
        <span className="ml-auto ac-num font-bold" style={sm}>$67.12</span>
      </div>
      <div className="ac-num" style={xs}>Entry <b>$66.93</b> · Stop <b>$65.82</b> · T1 <b>$69.15</b></div>
      <div className="flex gap-2 flex-wrap" style={xs}>
        <span className="ac-muted">Muted text sample</span><span className="ac-bad font-semibold">STALE / INVALID</span><span className="ac-warn font-semibold">Gap risk: stops can fill below stop</span>
      </div>
      <div className="ac-muted" style={{ fontSize: 10 }}>{b.name} · PRACTICE ONLY — ANALYSIS, NOT FINANCIAL ADVICE</div>
    </div>
  );
}

export function CardStyleSection() {
  const [prefs, set] = useCardStyle();
  const [editing, setEditing] = usePersistentState<CardState>("card-style-editing", "READY");
  const current = prefs.mode === "all" ? prefs.all : prefs[editing];
  const pick = (id: CardBgId) => (prefs.mode === "all" ? set({ all: id }) : set({ [editing]: id } as Partial<CardStylePrefs>));
  const summary = prefs.mode === "all" ? `All cards · ${cardBg(prefs.all).name}` : `Ready ${cardBg(prefs.READY).name} · Active ${cardBg(prefs.ACTIVE).name} · Watch ${cardBg(prefs.WATCH).name}`;
  return (
    <Section id="ac:card-style" title="Card Style" def={false} testId="sec-card-style" summary={summary}>
      <div className="space-y-2.5">
        <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Apply background to">
          <span className="font-semibold" style={sm}>Apply to</span>
          <button className="ac-btn !py-1" aria-pressed={prefs.mode === "all"} onClick={() => set({ mode: "all" })} data-testid="button-cardstyle-mode-all">All cards</button>
          <button className="ac-btn !py-1" aria-pressed={prefs.mode === "state"} onClick={() => set({ mode: "state" })} data-testid="button-cardstyle-mode-state">Per state</button>
          {prefs.mode === "state" && STATES.map((s) => (
            <button key={s.id} className="ac-btn !py-1" aria-pressed={editing === s.id} onClick={() => setEditing(s.id)} data-testid={`button-cardstyle-state-${s.id}`}>{s.label}: {cardBg(prefs[s.id]).name}</button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Card background">
          {CARD_BGS.map((b) => <Swatch key={b.id} id={b.id} on={current === b.id} onPick={() => pick(b.id)} testId={`swatch-cardbg-${b.id}`} />)}
        </div>
        <div className="ac-muted" style={xs}>Live preview{prefs.mode === "all" ? "" : " (each state)"} · visual only — backgrounds never change data, status or levels.</div>
        <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 240px), 1fr))" }} data-testid="cardstyle-preview">
          {STATES.map((s) => <CardPreview key={s.id} prefs={prefs} state={s.id} testId={`preview-card-${s.id}`} />)}
        </div>
        <button className="ac-btn !py-1" onClick={() => set(DEFAULT_CARD_STYLE)} data-testid="button-cardstyle-reset">Reset to Default</button>
      </div>
    </Section>
  );
}
