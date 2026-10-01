// Section R4 — Set Alert dialog, Alerts panel (active + recent + acknowledge) and Alert Settings
// (channels, verification, quiet hours, caps, dedupe). PRICE ALERT ONLY — never a broker order.
import { useEffect, useRef, useState } from "react";
import { Bell, BellOff, BellRing, Check, Settings2, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  ALERT_SAFETY, ALERT_TYPES, ALERT_TYPE_LABEL, CHANNELS, CHANNEL_LABEL, needsLevel,
  type AlertPrefs, type AlertType, type Channel, type ExpiryMode, type Frequency,
} from "@shared/priceAlerts";
import { fmtCT } from "@/lib/swing";
import { alertApi, invalidateAlerts, useAlertEvents, useAlertPrefs, useAlerts, type AlertDraft, type AlertEvent } from "@/lib/alerts";

const $ = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? "—" : `$${n.toFixed(2)}`);
const btn = "inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neon-blue";
const btnMain = `${btn} border-neon-blue/60 text-neon-blue hover:bg-neon-blue/10`;
const btnSub = `${btn} border-ink-line text-slate-gray hover:text-soft-white`;
const field = "w-full rounded border border-ink-line bg-ink-black px-2 py-1 text-[12px] font-mono text-soft-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neon-blue";
const lab = "block text-[10px] font-mono font-bold uppercase tracking-wide text-neon-blue mb-1";

export function SetAlertButton({ draft, label = "Set Alert", testId }: { draft: AlertDraft; label?: string; testId?: string }) {
  return (
    <button className={btnMain} onClick={() => window.dispatchEvent(new CustomEvent("chizzle:set-alert", { detail: draft }))}
      data-testid={testId ?? `button-set-alert-${draft.symbol}`} aria-label={`${label} for ${draft.symbol}`}>
      <Bell className="h-3 w-3" aria-hidden /> {label}
    </button>
  );
}

// ─── Set Alert dialog ────────────────────────────────────────────────────────
export function AlertDialogHost() {
  const [draft, setDraft] = useState<AlertDraft | null>(null);
  useEffect(() => {
    const on = (e: Event) => setDraft((e as CustomEvent).detail as AlertDraft);
    window.addEventListener("chizzle:set-alert", on);
    return () => window.removeEventListener("chizzle:set-alert", on);
  }, []);
  return (
    <Dialog open={!!draft} onOpenChange={(o) => { if (!o) setDraft(null); }}>
      <DialogContent className="max-w-lg bg-ink-panel border-ink-line text-soft-white" data-testid="dialog-set-alert">
        {draft && <AlertForm draft={draft} onDone={() => setDraft(null)} />}
      </DialogContent>
    </Dialog>
  );
}

function AlertForm({ draft, onDone }: { draft: AlertDraft; onDone: () => void }) {
  const prefsQ = useAlertPrefs();
  const [type, setType] = useState<AlertType>(draft.type);
  const [level, setLevel] = useState(draft.level != null ? draft.level.toFixed(2) : "");
  const [levelHigh, setLevelHigh] = useState(draft.levelHigh != null ? draft.levelHigh.toFixed(2) : "");
  const [channels, setChannels] = useState<Channel[]>(["in_app"]);
  const [frequency, setFrequency] = useState<Frequency>("ONCE");
  const [repeatMinutes, setRepeat] = useState(30);
  const [expiryMode, setExpiry] = useState<ExpiryMode>("END_OF_DAY");
  const [custom, setCustom] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const prefs = prefsQ.data?.prefs, contacts = prefsQ.data?.contacts ?? [];
  const chState = (ch: Channel): string | null => {
    if (!prefs) return null;
    if (!prefs.channels[ch]) return "off in Alert Settings";
    if (ch === "email" || ch === "telegram") {
      const c = contacts.find((x) => x.channel === ch);
      if (!c) return "no contact";
      if (!c.verifiedAt) return "not verified";
    }
    return null;
  };
  const save = async () => {
    setBusy(true); setMsg(null);
    try {
      await alertApi.create({
        symbol: draft.symbol, type, level: needsLevel(type) ? Number(level) : null,
        levelHigh: type === "RETEST_ZONE" ? Number(levelHigh) : null, channels, frequency,
        repeatMinutes: frequency === "REPEAT" ? repeatMinutes : undefined, expiryMode,
        customExpiry: expiryMode === "CUSTOM" && custom ? new Date(custom).toISOString() : null, note: draft.context,
      });
      invalidateAlerts(); onDone();
    } catch (e: any) { setMsg(e?.message ?? "Could not save"); }
    finally { setBusy(false); }
  };
  const lvlBad = needsLevel(type) && !(Number(level) > 0) || (type === "RETEST_ZONE" && !(Number(levelHigh) > 0));
  return (
    <>
      <DialogHeader>
        <DialogTitle className="font-mono text-[15px]" data-testid="text-set-alert-title">Set Practice Alert — {draft.symbol}</DialogTitle>
        <DialogDescription className="text-[11px] font-mono font-bold text-signal-amber">{ALERT_SAFETY}</DialogDescription>
      </DialogHeader>
      <div className="space-y-3 text-[12px]">
        <div>
          <label className={lab} htmlFor="alert-type">Alert when</label>
          <select id="alert-type" className={field} value={type} onChange={(e) => setType(e.target.value as AlertType)} data-testid="select-alert-type">
            {ALERT_TYPES.map((t) => <option key={t} value={t}>{ALERT_TYPE_LABEL[t]}</option>)}
          </select>
        </div>
        {needsLevel(type) && (
          <div className="grid grid-cols-2 gap-2">
            <div><label className={lab} htmlFor="alert-level">{type === "RETEST_ZONE" ? "Zone low" : "Price level"}</label>
              <input id="alert-level" type="number" step="0.01" className={field} value={level} onChange={(e) => setLevel(e.target.value)} data-testid="input-alert-level" /></div>
            {type === "RETEST_ZONE" && <div><label className={lab} htmlFor="alert-level-high">Zone high</label>
              <input id="alert-level-high" type="number" step="0.01" className={field} value={levelHigh} onChange={(e) => setLevelHigh(e.target.value)} data-testid="input-alert-level-high" /></div>}
          </div>
        )}
        <fieldset>
          <legend className={lab}>Send to</legend>
          <div className="flex flex-wrap gap-3">
            {CHANNELS.map((ch) => {
              const why = chState(ch);
              return (
                <label key={ch} className="inline-flex items-center gap-1.5 font-mono text-[11.5px]">
                  <input type="checkbox" checked={ch === "in_app" || channels.includes(ch)} disabled={ch === "in_app"}
                    onChange={(e) => setChannels((c) => e.target.checked ? [...c, ch] : c.filter((x) => x !== ch))} data-testid={`checkbox-alert-channel-${ch}`} />
                  {CHANNEL_LABEL[ch]}{ch === "in_app" && " (always)"}
                  {why && ch !== "in_app" && <span className="text-signal-amber">· {why}</span>}
                </label>
              );
            })}
          </div>
          <p className="mt-1 text-[10.5px] text-slate-gray">Email and Telegram send only after you verify them in Alert Settings. Browser push shows while the Cockpit is open.</p>
        </fieldset>
        <div className="grid grid-cols-2 gap-2">
          <div><label className={lab} htmlFor="alert-frequency">Frequency</label>
            <select id="alert-frequency" className={field} value={frequency} onChange={(e) => setFrequency(e.target.value as Frequency)} data-testid="select-alert-frequency">
              <option value="ONCE">Once</option><option value="PER_BAR">Once per 1H bar</option><option value="REPEAT">Repeat every N minutes</option>
            </select></div>
          {frequency === "REPEAT" && <div><label className={lab} htmlFor="alert-repeat">Minutes</label>
            <input id="alert-repeat" type="number" min={5} max={480} className={field} value={repeatMinutes} onChange={(e) => setRepeat(Number(e.target.value))} data-testid="input-alert-repeat" /></div>}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div><label className={lab} htmlFor="alert-expiry">Expires</label>
            <select id="alert-expiry" className={field} value={expiryMode} onChange={(e) => setExpiry(e.target.value as ExpiryMode)} data-testid="select-alert-expiry">
              <option value="END_OF_DAY">End of day (3:00 PM CT)</option><option value="END_OF_WEEK">End of week (Fri 3:00 PM CT)</option>
              <option value="SETUP_EXPIRES">When this setup expires</option><option value="CUSTOM">Custom date/time</option>
            </select></div>
          {expiryMode === "CUSTOM" && <div><label className={lab} htmlFor="alert-custom">Until</label>
            <input id="alert-custom" type="datetime-local" className={field} value={custom} onChange={(e) => setCustom(e.target.value)} data-testid="input-alert-custom-expiry" /></div>}
        </div>
        <p className="text-[10.5px] text-slate-gray">The alert is tied to the plan version in use right now (system plan or your Practice Plan vN). It only tells you a level was reached — it never places, changes or cancels an order.</p>
        {msg && <div className="text-[11.5px] text-signal-red" role="alert" data-testid="text-alert-error">{msg}</div>}
        <div className="flex gap-2">
          <button className={`${btnMain} py-1`} disabled={busy || lvlBad} onClick={save} data-testid="button-save-alert"><BellRing className="h-3 w-3" aria-hidden /> {busy ? "Saving…" : "Save Alert"}</button>
          <button className={`${btnSub} py-1`} onClick={onDone} data-testid="button-cancel-alert">Cancel</button>
        </div>
      </div>
    </>
  );
}

// ─── Alerts panel (in Action Center) ─────────────────────────────────────────
function useBrowserPush(events: AlertEvent[] | undefined, enabled: boolean) {
  const seen = useRef<number | null>(null);
  useEffect(() => {
    if (!events?.length) return;
    const top = events[0].id;
    if (seen.current == null) { seen.current = top; return; } // don't replay history on load
    if (enabled && typeof Notification !== "undefined" && Notification.permission === "granted") {
      for (const e of events.filter((x) => x.id > seen.current! && x.delivery?.push)) {
        try { new Notification(`Chizzle practice alert: ${e.symbol}`, { body: e.message.slice(0, 180), tag: `chizzle-${e.id}` }); } catch { /* blocked in frame */ }
      }
    }
    seen.current = Math.max(seen.current, top);
  }, [events, enabled]);
}

export function AlertsPanel() {
  const alertsQ = useAlerts();
  const eventsQ = useAlertEvents();
  const prefsQ = useAlertPrefs();
  const [showSettings, setShowSettings] = useState(false);
  const [showAll, setShowAll] = useState(false);
  useBrowserPush(eventsQ.data?.events, !!prefsQ.data?.prefs.channels.push);
  const active = (alertsQ.data?.alerts ?? []).filter((a) => a.active);
  const events = eventsQ.data?.events ?? [];
  const unacked = events.filter((e) => !e.acknowledged);
  const shown = showAll ? events.slice(0, 20) : unacked.slice(0, 5);
  const act = async (fn: () => Promise<unknown>) => { try { await fn(); } finally { invalidateAlerts(); } };

  return (
    <section className="mt-3 rounded-lg border border-ink-line px-3 py-2" aria-label="Practice alerts" data-testid="panel-alerts">
      <div className="flex flex-wrap items-center gap-2">
        <Bell className="h-4 w-4 text-neon-blue" aria-hidden />
        <span className="font-mono font-bold text-[12.5px] text-soft-white">PRACTICE ALERTS</span>
        <span className="font-mono text-[11px] text-slate-gray" data-testid="text-alert-counts">{active.length} active · {unacked.length} new</span>
        <span className="ml-auto flex gap-1.5">
          <button className={btnSub} onClick={() => setShowAll((v) => !v)} data-testid="button-alert-history">{showAll ? "New only" : "History"}</button>
          <button className={btnSub} onClick={() => setShowSettings((v) => !v)} aria-expanded={showSettings} data-testid="button-alert-settings"><Settings2 className="h-3 w-3" aria-hidden /> Alert Settings</button>
        </span>
      </div>
      <p className="text-[10.5px] font-mono font-bold text-signal-amber mt-0.5">{ALERT_SAFETY}</p>

      {shown.length > 0 && (
        <ul className="mt-2 space-y-1.5" data-testid="list-alert-events">
          {shown.map((e) => (
            <li key={e.id} className={`rounded border px-2 py-1.5 text-[11.5px] ${e.acknowledged ? "border-ink-line opacity-70" : "border-neon-blue/60"}`} data-testid={`row-alert-event-${e.id}`}>
              <div className="flex flex-wrap items-center gap-2 font-mono">
                <BellRing className="h-3 w-3 text-neon-blue" aria-hidden />
                <b className="text-soft-white">{e.symbol}</b>
                <span className="text-slate-gray">{ALERT_TYPE_LABEL[e.type]}</span>
                <span className="text-slate-gray">{fmtCT(e.firedAt)}</span>
                {e.planVersion > 0 && <span className="text-neon-blue">Plan v{e.planVersion}</span>}
                <span className="text-slate-gray">data {e.dataStatus ?? "—"} · {e.dataSource ?? "—"}</span>
                {!e.acknowledged
                  ? <button className={`${btnSub} ml-auto`} onClick={() => act(() => alertApi.ack(e.id))} data-testid={`button-ack-${e.id}`}><Check className="h-3 w-3" aria-hidden /> Acknowledge</button>
                  : <span className="ml-auto text-slate-gray">acknowledged</span>}
              </div>
              <div className="text-soft-white mt-0.5" data-testid={`text-alert-message-${e.id}`}>{e.message}</div>
              <div className="text-[10px] font-mono text-slate-gray mt-0.5">
                {Object.entries(e.delivery ?? {}).map(([ch, v]) => `${CHANNEL_LABEL[ch as Channel] ?? ch}: ${v.status}${v.error ? ` (${v.error})` : ""}`).join(" · ")}
              </div>
            </li>
          ))}
        </ul>
      )}
      {!shown.length && <div className="mt-1 text-[11px] text-slate-gray" data-testid="text-no-alert-events">{showAll ? "No alerts have fired yet." : "No new alerts."}</div>}

      {active.length > 0 && (
        <div className="mt-2">
          <div className="text-[10px] font-mono font-bold text-slate-gray uppercase">Active alerts</div>
          <ul className="mt-1 space-y-1" data-testid="list-active-alerts">
            {active.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-2 text-[11px] font-mono" data-testid={`row-alert-${a.id}`}>
                <Bell className="h-3 w-3 text-neon-blue" aria-hidden />
                <b className="text-soft-white">{a.symbol}</b>
                <span className="text-soft-white">{ALERT_TYPE_LABEL[a.type]}{a.level != null && ` · ${$(a.level)}`}{a.levelHigh != null && `–${$(a.levelHigh)}`}</span>
                <span className="text-slate-gray">{a.planVersion > 0 ? `Plan v${a.planVersion}` : "System plan"} · {a.frequency === "ONCE" ? "once" : a.frequency === "PER_BAR" ? "per 1H bar" : `every ${a.repeatMinutes}m`} · {a.expiresAt ? `until ${fmtCT(a.expiresAt)}` : "until setup expires"}</span>
                <span className="text-slate-gray">{a.channels.map((c) => CHANNEL_LABEL[c]).join(", ")}</span>
                <span className="ml-auto flex gap-1">
                  <button className={btnSub} onClick={() => act(() => alertApi.setActive(a.id, false))} data-testid={`button-pause-alert-${a.id}`}><BellOff className="h-3 w-3" aria-hidden /> Turn off</button>
                  <button className={btnSub} onClick={() => act(() => alertApi.remove(a.id))} aria-label={`Delete ${a.symbol} alert`} data-testid={`button-delete-alert-${a.id}`}><Trash2 className="h-3 w-3" aria-hidden /></button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {showSettings && prefsQ.data && <AlertSettings prefs={prefsQ.data.prefs} contacts={prefsQ.data.contacts} />}
    </section>
  );
}

function AlertSettings({ prefs, contacts }: { prefs: AlertPrefs; contacts: NonNullable<ReturnType<typeof useAlertPrefs>["data"]>["contacts"] }) {
  const [p, setP] = useState(prefs);
  const [code, setCode] = useState<Record<number, string>>({});
  const [note, setNote] = useState<Record<number, string>>({});
  const [saved, setSaved] = useState<string | null>(null);
  const save = async () => {
    try {
      await alertApi.savePrefs({ channels: p.channels, quietStart: p.quietStart || null, quietEnd: p.quietEnd || null, marketHoursOnly: p.marketHoursOnly, maxPerTickerPerDay: p.maxPerTickerPerDay, maxPerDay: p.maxPerDay, dedupeMinutes: p.dedupeMinutes });
      setSaved("Saved"); invalidateAlerts();
    } catch (e: any) { setSaved(e?.message ?? "Save failed"); }
  };
  const send = async (id: number) => { try { await alertApi.sendCode(id); setNote((n) => ({ ...n, [id]: "Code sent — check that inbox/chat." })); } catch (e: any) { setNote((n) => ({ ...n, [id]: e?.message ?? "Could not send" })); } };
  const confirm = async (id: number) => { try { await alertApi.confirmCode(id, code[id] ?? ""); setNote((n) => ({ ...n, [id]: "Verified" })); invalidateAlerts(); } catch (e: any) { setNote((n) => ({ ...n, [id]: e?.message ?? "Wrong code" })); } };
  const askPush = async () => { try { if (typeof Notification !== "undefined") await Notification.requestPermission(); } catch { /* ignore */ } setP({ ...p, channels: { ...p.channels, push: true } }); };
  return (
    <div className="mt-3 rounded border border-ink-line px-3 py-2 space-y-3 text-[11.5px]" data-testid="panel-alert-settings">
      <fieldset>
        <legend className={lab}>Channels (master switches)</legend>
        <div className="flex flex-wrap gap-3 font-mono">
          {CHANNELS.map((ch) => (
            <label key={ch} className="inline-flex items-center gap-1.5">
              <input type="checkbox" checked={p.channels[ch]} disabled={ch === "in_app"}
                onChange={(e) => (ch === "push" && e.target.checked ? askPush() : setP({ ...p, channels: { ...p.channels, [ch]: e.target.checked } }))} data-testid={`checkbox-pref-channel-${ch}`} />
              {CHANNEL_LABEL[ch]}
            </label>
          ))}
        </div>
      </fieldset>
      <div>
        <div className={lab}>Verify destinations</div>
        {contacts.length === 0 && <div className="text-slate-gray">No email/Telegram contacts yet — add them under Settings → Alerts.</div>}
        <ul className="space-y-1.5">
          {contacts.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-2 font-mono" data-testid={`row-contact-${c.id}`}>
              <span className="text-soft-white">{c.channel === "email" ? "Email" : "Telegram"} · {c.destination}</span>
              {c.verifiedAt
                ? <span className="text-signal-green" data-testid={`text-verified-${c.id}`}>Verified {fmtCT(c.verifiedAt)}</span>
                : <>
                    <button className={btnSub} onClick={() => send(c.id)} data-testid={`button-send-code-${c.id}`}>Send code</button>
                    <input className={`${field.replace("w-full ", "")} w-28`} inputMode="numeric" placeholder="6-digit code" value={code[c.id] ?? ""} onChange={(e) => setCode((x) => ({ ...x, [c.id]: e.target.value }))} aria-label="Verification code" data-testid={`input-code-${c.id}`} />
                    <button className={btnMain} onClick={() => confirm(c.id)} data-testid={`button-confirm-code-${c.id}`}>Verify</button>
                  </>}
              {note[c.id] && <span className="text-slate-gray" role="status">{note[c.id]}</span>}
            </li>
          ))}
        </ul>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <div><label className={lab} htmlFor="pref-quiet-start">Quiet from (CT)</label><input id="pref-quiet-start" type="time" className={field} value={p.quietStart ?? ""} onChange={(e) => setP({ ...p, quietStart: e.target.value || null })} data-testid="input-quiet-start" /></div>
        <div><label className={lab} htmlFor="pref-quiet-end">Quiet until (CT)</label><input id="pref-quiet-end" type="time" className={field} value={p.quietEnd ?? ""} onChange={(e) => setP({ ...p, quietEnd: e.target.value || null })} data-testid="input-quiet-end" /></div>
        <div><label className={lab} htmlFor="pref-max-ticker">Max / ticker / day</label><input id="pref-max-ticker" type="number" min={1} className={field} value={p.maxPerTickerPerDay} onChange={(e) => setP({ ...p, maxPerTickerPerDay: Number(e.target.value) })} data-testid="input-max-ticker" /></div>
        <div><label className={lab} htmlFor="pref-max-day">Max / day</label><input id="pref-max-day" type="number" min={1} className={field} value={p.maxPerDay} onChange={(e) => setP({ ...p, maxPerDay: Number(e.target.value) })} data-testid="input-max-day" /></div>
        <div><label className={lab} htmlFor="pref-dedupe">Ignore repeats (min)</label><input id="pref-dedupe" type="number" min={0} className={field} value={p.dedupeMinutes} onChange={(e) => setP({ ...p, dedupeMinutes: Number(e.target.value) })} data-testid="input-dedupe" /></div>
      </div>
      <label className="inline-flex items-center gap-1.5 font-mono"><input type="checkbox" checked={p.marketHoursOnly} onChange={(e) => setP({ ...p, marketHoursOnly: e.target.checked })} data-testid="checkbox-market-hours-only" /> Market hours only (8:30 AM–3:00 PM CT; data alerts always allowed)</label>
      <div className="flex items-center gap-2">
        <button className={`${btnMain} py-1`} onClick={save} data-testid="button-save-alert-prefs">Save Alert Settings</button>
        {saved && <span className="text-slate-gray" role="status">{saved}</span>}
      </div>
    </div>
  );
}
