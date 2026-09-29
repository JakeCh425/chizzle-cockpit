// One clock for every panel: a few minutes after each closed RTH 1H bar (the server recomputes
// 2–7 min after the close), invalidate ALL market queries together so the top card, Do Today,
// scanner, watchlist, chart and guide all move to the same bar at the same time.
import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { queryClient } from "@/lib/queryClient";

const SYNC_LAG_MIN = 8;
const BOUNDARIES = [570, 630, 690, 750, 810, 870, 900]; // 9:30 … 14:30, 15:00 CT (1H closes)

function ct(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short" })
    .formatToParts(d).map((x) => [x.type, x.value]));
  return { ymd: `${p.year}-${p.month}-${p.day}`, min: Number(p.hour) * 60 + Number(p.minute), wd: p.weekday as string };
}
const hm = (m: number) => { const h = Math.floor(m / 60), mm = String(m % 60).padStart(2, "0"); return `${((h + 11) % 12) + 1}:${mm} ${h < 12 ? "AM" : "PM"}`; };
const weekday = (wd: string) => !["Sat", "Sun"].includes(wd);

/** Latest sync slot that has passed (e.g. "2026-09-29:910"), or the previous session's last slot. */
function currentSlot() {
  const c = ct();
  const passed = weekday(c.wd) ? BOUNDARIES.filter((b) => c.min >= b + SYNC_LAG_MIN) : [];
  return passed.length ? `${c.ymd}:${passed[passed.length - 1]}` : `pre:${c.ymd}`;
}
function nextSyncLabel() {
  const c = ct();
  const next = weekday(c.wd) ? BOUNDARIES.find((b) => c.min < b + SYNC_LAG_MIN) : undefined;
  return next != null ? `${hm(next + SYNC_LAG_MIN)} CT (after the ${hm(next)} 1H close)` : "9:38 AM CT next session (after the first 1H close)";
}

export function syncAllPanels() {
  return queryClient.invalidateQueries({
    predicate: (q) => { const k = String(q.queryKey[0] ?? ""); return k.startsWith("/api/swing") || k.startsWith("/api/flex-scan") || k.startsWith("/api/regime"); },
  });
}

export default function SyncClock() {
  const [slot, setSlot] = useState(currentSlot);
  const [syncedAt, setSyncedAt] = useState(() => new Date());
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const t = setInterval(() => {
      const s = currentSlot();
      setSlot((prev) => {
        if (prev !== s) { void syncAllPanels(); setSyncedAt(new Date()); }
        return s;
      });
    }, 30_000);
    return () => clearInterval(t);
  }, []);
  const at = ct(syncedAt);
  return (
    <div className="flex flex-wrap items-center gap-2 text-[10px] font-mono text-slate-gray" data-testid="sync-clock" data-slot={slot}>
      <span className="h-1.5 w-1.5 rounded-full bg-signal-green animate-pulse" />
      <span data-testid="text-sync-last">All panels synced {hm(at.min)} CT</span>
      <span>· next sync {nextSyncLabel()}</span>
      <button
        className="inline-flex items-center gap-1 rounded border border-ink-line px-1.5 py-0 hover:text-soft-white disabled:opacity-50"
        disabled={busy}
        onClick={async () => { setBusy(true); try { await syncAllPanels(); setSyncedAt(new Date()); } finally { setBusy(false); } }}
        data-testid="button-sync-now"
      >
        <RefreshCw className={`h-3 w-3 ${busy ? "animate-spin" : ""}`} /> Sync now
      </button>
    </div>
  );
}
