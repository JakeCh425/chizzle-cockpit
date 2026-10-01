// PR 3d — /api/swing/* routes. Additive; all gated by ENABLE_UNIFIED_SWING_ENGINE
// (or ?unified=1 for QA preview). Analysis / practice only — no broker endpoints exist.
import type { Express, Request, Response } from "express";
import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { db } from "../storage";
import { swingJournal } from "@shared/schema";
import { PRACTICE_BANNER, SETUP_STATUSES, WATCH_CATEGORIES, practiceVerdict, type ScanSelection, type SetupStatus } from "@shared/swingDecision";
import { isUnifiedSwingEnabled } from "../featureFlags";
import { CHART_RANGES, CHART_TFS, chartBars, decisionFor, loadSettings, readDataEvents, readLog, saveSettings, scan, settingsPatchSchema, startSwingScheduler } from "./service";
import { ackEvent, confirmVerification, contactsWithStatus, createAlert, deleteAlert, listAlerts, listEvents, loadPrefs, savePrefs, sendVerification, setAlertActive, startAlertLoop, tickAlerts } from "./alerts";
import { ALERT_TYPES, CHANNELS, needsLevel } from "@shared/priceAlerts";
import { listVersions, planContext, saveVersion, selectVersion, selectedVersions } from "./plans";
import { ENTRY_METHODS, STOP_METHODS, TARGET_METHODS } from "@shared/practicePlan";
import { addItem, patchItem, removeItem, resolveSymbol, restoreDefaults, riskNote, WatchlistError, yahooSearch } from "./universe";

const SELECTIONS: ScanSelection[] = ["DEFAULT", "DEFAULT_PLUS_CUSTOM", "ETFS", "STOCKS", "SEMICONDUCTOR", "BROAD_MARKET", "CUSTOM_SELECTION"];
export const JOURNAL_ACTIONS = ["PRACTICE_TRADE", "WATCH", "OBSERVED", "MISSED", "DO_NOT_TAKE", "NOTE"] as const;

export function swingGate(req: Request): boolean {
  return isUnifiedSwingEnabled() || req.query.unified === "1";
}

const wrap = (fn: (req: Request, res: Response) => Promise<any>) => async (req: Request, res: Response) => {
  if (!swingGate(req)) return res.status(404).json({ enabled: false, message: "Unified Swing Engine is off (ENABLE_UNIFIED_SWING_ENGINE=false)." });
  try { const out = await fn(req, res); if (!res.headersSent) res.json(out); }
  catch (e: any) {
    if (e instanceof WatchlistError) return res.status(e.code).json({ error: e.message });
    if (e instanceof z.ZodError) return res.status(400).json({ error: "Invalid input", issues: e.issues });
    console.error("[swing]", e); res.status(500).json({ error: e?.message || "Swing engine error" });
  }
};

async function findItem(symbol: string) {
  const s = await loadSettings();
  const sym = symbol.toUpperCase().split(":").pop()!;
  return s.watchlist!.find((x) => x.symbol === sym) ?? null;
}

const num = z.number().finite();
const planInputsSchema = z.object({
  entry: num.positive(), entryMethod: z.enum(ENTRY_METHODS), stopMethod: z.enum(STOP_METHODS),
  stopLevel: num.positive().nullable().optional(), bufferMethod: z.enum(["AUTO", "MANUAL"]),
  manualBuffer: num.min(0).nullable().optional(), targetMethod: z.enum(TARGET_METHODS),
  t1R: num.min(0.5).max(10), t2R: num.min(0.5).max(20), manualT1: num.positive().nullable().optional(), manualT2: num.positive().nullable().optional(),
  maxDollarRisk: num.positive().max(1_000_000), minRrT1: num.min(0).max(10), shareMethod: z.enum(["AUTO", "MANUAL"]),
  manualShares: num.min(0).max(1_000_000).nullable().optional(), stopLimitBufferPct: num.min(0).max(5).optional(),
});

export function registerSwingRoutes(app: Express) {
  startSwingScheduler(); // no-op each tick while the flag is off
  startAlertLoop();      // Section R4 — informational price alerts, every 60s (no-op when none are active)

  app.get("/api/swing/status", wrap(async () => ({ enabled: isUnifiedSwingEnabled(), banner: PRACTICE_BANNER })));

  app.get("/api/swing/settings", wrap(async () => loadSettings()));
  app.put("/api/swing/settings", wrap(async (req) => saveSettings(settingsPatchSchema.parse(req.body ?? {}))));

  // ── Watchlist (§Q1) ──
  app.get("/api/swing/watchlist", wrap(async () => {
    const s = await loadSettings();
    return { items: s.watchlist!.map((x) => ({ ...x, riskNote: riskNote(x.assetType) })), maxCustomTickers: s.maxCustomTickers ?? 12, categories: WATCH_CATEGORIES };
  }));
  app.get("/api/swing/resolve", wrap(async (req) => resolveSymbol(String(req.query.q ?? ""), yahooSearch)));
  app.post("/api/swing/watchlist", wrap(async (req, res) => {
    const { symbol } = z.object({ symbol: z.string().min(1).max(24) }).parse(req.body ?? {});
    const r = await resolveSymbol(symbol, yahooSearch);
    if (!r.ok) { res.status(422).json(r); return; }
    const s = await loadSettings();
    return saveSettings({ watchlist: addItem(s.watchlist!, r.item, s.maxCustomTickers ?? 12) }).then((x) => ({ ok: true, added: r.item, items: x.watchlist }));
  }));
  app.patch("/api/swing/watchlist/:symbol", wrap(async (req) => {
    const p = z.object({ hidden: z.boolean().optional(), pinned: z.boolean().optional(), notes: z.string().max(2000).optional(),
      assetType: z.enum(["ETF", "STOCK"]).optional(), categories: z.array(z.enum(WATCH_CATEGORIES as [string, ...string[]])).optional() as any,
      archived: z.boolean().optional(), moveTo: z.number().int().min(0).max(100).optional() }).strict().parse(req.body ?? {});
    const s = await loadSettings();
    return saveSettings({ watchlist: patchItem(s.watchlist!, String(req.params.symbol), p) }).then((x) => ({ ok: true, items: x.watchlist }));
  }));
  app.delete("/api/swing/watchlist/:symbol", wrap(async (req) => {
    const s = await loadSettings();
    return saveSettings({ watchlist: removeItem(s.watchlist!, String(req.params.symbol)) }).then((x) => ({ ok: true, items: x.watchlist }));
  }));
  app.post("/api/swing/watchlist/restore-defaults", wrap(async () => {
    const s = await loadSettings();
    return saveSettings({ watchlist: restoreDefaults(s.watchlist!) }).then((x) => ({ ok: true, items: x.watchlist }));
  }));

  // ── Decisions & scans (§Q2) ──
  app.get("/api/swing/scan", wrap(async (req) => {
    const sel = (SELECTIONS.includes(String(req.query.selection) as ScanSelection) ? String(req.query.selection) : "DEFAULT") as ScanSelection;
    const symbols = String(req.query.symbols ?? "").split(",").map((x) => x.trim()).filter(Boolean);
    const status = String(req.query.status ?? "").split(",").filter((x) => (SETUP_STATUSES as readonly string[]).includes(x)) as SetupStatus[];
    const out = await scan(symbols.length && sel === "DEFAULT" ? "CUSTOM_SELECTION" : sel, symbols, status, req.query.force === "1");
    return { ...out, banner: PRACTICE_BANNER, rows: out.rows.map((r) => ({ ...r, verdict: practiceVerdict(r.decision) })) };
  }));
  app.get("/api/swing/decision/:symbol", wrap(async (req, res) => {
    const item = await findItem(String(req.params.symbol));
    const sym = String(req.params.symbol).toUpperCase();
    const [ex, s] = sym.includes(":") ? sym.split(":") : [item?.exchange ?? "", sym];
    if (!item && !ex) { res.status(404).json({ error: `${s} is not on the watchlist — add it first.` }); return; }
    const scope = (["CURRENT", "LAST5", "ALL"].includes(String(req.query.history)) ? String(req.query.history) : "LAST5") as any;
    const d = await decisionFor(s, item?.exchange ?? ex, scope, req.query.force === "1");
    return { banner: PRACTICE_BANNER, decision: d, verdict: practiceVerdict(d), riskNote: item ? riskNote(item.assetType) : null };
  }));
  app.get("/api/swing/bars/:symbol", wrap(async (req, res) => {
    const tf = String(req.query.tf ?? "4H"), range = String(req.query.range ?? "3M").toUpperCase();
    if (!(CHART_TFS as readonly string[]).includes(tf)) { res.status(400).json({ error: `tf must be one of ${CHART_TFS.join(", ")}` }); return; }
    if (!(CHART_RANGES as readonly string[]).includes(range)) { res.status(400).json({ error: `range must be one of ${CHART_RANGES.join(", ")}` }); return; }
    const item = await findItem(String(req.params.symbol));
    if (!item) { res.status(404).json({ error: "Not on the watchlist" }); return; }
    return chartBars(item.symbol, item.exchange, tf as any, range as any, req.query.extended === "1");
  }));
  app.get("/api/swing/data-events", wrap(async (req) => ({ events: readDataEvents(req.query.symbol ? String(req.query.symbol) : null, Number(req.query.limit) || 100) })));
  app.get("/api/swing/log", wrap(async (req) => readLog(req.query.symbol ? String(req.query.symbol) : null, Number(req.query.limit) || 50)));

  // ── Section R: practice plan versions (the system plan is never modified) ──
  const symEx = async (raw: string) => {
    const item = await findItem(raw); const sym = raw.toUpperCase().split(":").pop()!;
    return { sym, ex: item?.exchange ?? (raw.includes(":") ? raw.split(":")[0].toUpperCase() : "") };
  };
  app.get("/api/swing/plans-selected", wrap(async () => ({ selected: await selectedVersions() })));
  app.get("/api/swing/plans/:symbol", wrap(async (req) => {
    const { sym } = await symEx(String(req.params.symbol));
    const versions = await listVersions(sym);
    return { symbol: sym, versions, selected: versions.find((v) => v.selected)?.version ?? 0 };
  }));
  app.get("/api/swing/plan-context/:symbol", wrap(async (req, res) => {
    const { sym, ex } = await symEx(String(req.params.symbol));
    if (!ex) { res.status(404).json({ error: `${sym} is not on the watchlist — add it first.` }); return; }
    return planContext(sym, ex);
  }));
  app.post("/api/swing/plans/:symbol", wrap(async (req, res) => {
    const { sym, ex } = await symEx(String(req.params.symbol));
    if (!ex) { res.status(404).json({ error: `${sym} is not on the watchlist — add it first.` }); return; }
    const b = z.object({ inputs: planInputsSchema, reason: z.string().max(2000).default(""), chartState: z.record(z.unknown()).default({}) }).parse(req.body ?? {});
    return { ok: true, version: await saveVersion(sym, ex, b.inputs, b.reason, b.chartState) };
  }));
  app.post("/api/swing/plans/:symbol/select", wrap(async (req, res) => {
    const { sym } = await symEx(String(req.params.symbol));
    const b = z.object({ version: z.number().int().min(0) }).parse(req.body ?? {});
    try { return { ok: true, ...(await selectVersion(sym, b.version)) }; }
    catch (e: any) { if (e?.status === 404) { res.status(404).json({ error: e.message }); return; } throw e; }
  }));

  // ── Section R4: practice price alerts (informational only — never a broker order) ──
  const httpErr = (res: Response, e: any) => { if (e?.status) { res.status(e.status).json({ error: e.message }); return true; } return false; };
  app.get("/api/swing/alerts", wrap(async (req) => ({ alerts: await listAlerts(req.query.symbol ? String(req.query.symbol) : null) })));
  app.post("/api/swing/alerts", wrap(async (req, res) => {
    const b = z.object({
      symbol: z.string().min(1).max(16), type: z.enum(ALERT_TYPES), level: num.positive().nullable().optional(), levelHigh: num.positive().nullable().optional(),
      channels: z.array(z.enum(CHANNELS)).max(4).default(["in_app"]), frequency: z.enum(["ONCE", "PER_BAR", "REPEAT"]).default("ONCE"),
      repeatMinutes: z.number().int().min(5).max(480).optional(), expiryMode: z.enum(["END_OF_DAY", "END_OF_WEEK", "CUSTOM", "SETUP_EXPIRES"]).default("END_OF_DAY"),
      customExpiry: z.string().datetime().nullable().optional(), note: z.string().max(500).optional(),
    }).parse(req.body ?? {});
    if (needsLevel(b.type) && b.level == null) { res.status(400).json({ error: "This alert type needs a price level." }); return; }
    if (b.type === "RETEST_ZONE" && b.levelHigh == null) { res.status(400).json({ error: "A retest-zone alert needs a low and a high price." }); return; }
    if (b.expiryMode === "CUSTOM" && !b.customExpiry) { res.status(400).json({ error: "Pick a custom expiry date." }); return; }
    const { sym, ex } = await symEx(b.symbol);
    if (!ex) { res.status(404).json({ error: `${sym} is not on the watchlist — add it first.` }); return; }
    return { ok: true, alert: await createAlert({ ...b, symbol: sym, exchange: ex }) };
  }));
  app.post("/api/swing/alerts/:id/active", wrap(async (req, res) => {
    try { return await setAlertActive(Number(req.params.id), z.object({ active: z.boolean() }).parse(req.body ?? {}).active); } catch (e) { if (!httpErr(res, e)) throw e; }
  }));
  app.delete("/api/swing/alerts/:id", wrap(async (req) => deleteAlert(Number(req.params.id))));
  app.get("/api/swing/alert-events", wrap(async (req) => ({ events: await listEvents(Number(req.query.limit) || 50, Number(req.query.since) || 0) })));
  app.post("/api/swing/alert-events/:id/ack", wrap(async (req) => ackEvent(Number(req.params.id))));
  app.get("/api/swing/alert-prefs", wrap(async () => ({ prefs: await loadPrefs(), contacts: await contactsWithStatus() })));
  app.put("/api/swing/alert-prefs", wrap(async (req) => {
    const hhmm = z.string().regex(/^\d{1,2}:\d{2}$/).nullable();
    const b = z.object({
      channels: z.object({ in_app: z.boolean(), email: z.boolean(), telegram: z.boolean(), push: z.boolean() }).partial().optional(),
      quietStart: hhmm.optional(), quietEnd: hhmm.optional(), marketHoursOnly: z.boolean().optional(),
      maxPerTickerPerDay: z.number().int().min(1).max(100).optional(), maxPerDay: z.number().int().min(1).max(500).optional(), dedupeMinutes: z.number().int().min(0).max(1440).optional(),
    }).parse(req.body ?? {});
    return { prefs: await savePrefs(b as any) };
  }));
  app.post("/api/swing/alert-verify/:contactId/send", wrap(async (req, res) => {
    try { return await sendVerification(Number(req.params.contactId)); } catch (e) { if (!httpErr(res, e)) throw e; }
  }));
  app.post("/api/swing/alert-verify/:contactId/confirm", wrap(async (req, res) => {
    try { return await confirmVerification(Number(req.params.contactId), z.object({ code: z.string().min(4).max(10) }).parse(req.body ?? {}).code); } catch (e) { if (!httpErr(res, e)) throw e; }
  }));
  app.post("/api/swing/alerts/check-now", wrap(async () => tickAlerts()));

  // ── Practice journal (§Q5 buttons) — stores the shared decision snapshot ──
  app.get("/api/swing/journal", wrap(async (req) => {
    const q = db.select().from(swingJournal);
    return (req.query.symbol ? q.where(eq(swingJournal.symbol, String(req.query.symbol).toUpperCase())) : q).orderBy(desc(swingJournal.createdAt)).limit(200);
  }));
  app.post("/api/swing/journal", wrap(async (req) => {
    const b = z.object({ action: z.enum(JOURNAL_ACTIONS), symbol: z.string().min(1).max(16), notes: z.string().max(4000).optional(), lesson: z.string().max(4000).optional() }).parse(req.body ?? {});
    const item = await findItem(b.symbol);
    const d = await decisionFor(b.symbol.toUpperCase(), item?.exchange ?? "", "CURRENT");
    const row = (await db.insert(swingJournal).values({
      action: b.action, symbol: d.symbol, setupType: d.setupType, grade: d.cardGrade,
      timeframes: [d.setupTimeframe, "1H"].filter(Boolean).join("/"), entry: d.entryPrice, stop: d.structuralStop,
      target1: d.target1, target2: d.target2, plannedRisk: d.riskPerShare != null && d.suggestedShares ? d.riskPerShare * d.suggestedShares : null,
      notes: b.notes ?? null, lesson: b.lesson ?? null, decision: d as any,
    }).returning())[0];
    return { ok: true, entry: row };
  }));
  app.delete("/api/swing/journal/:id", wrap(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) { res.status(400).json({ error: "Invalid id" }); return; }
    const gone = await db.delete(swingJournal).where(eq(swingJournal.id, id)).returning({ id: swingJournal.id });
    if (!gone.length) { res.status(404).json({ error: "Journal entry not found" }); return; }
    return { ok: true, id };
  }));
}
