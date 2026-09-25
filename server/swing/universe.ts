// PR 3d — §Q1/§Q2 watchlist + scan universe. Pure list operations (unit-tested)
// plus a Yahoo-search symbol resolver. The watchlist lives inside
// swing_settings.data.watchlist, so no new table is needed.
import {
  DEFAULT_WATCHLIST, ETF_RISK, SINGLE_STOCK_RISK,
  type AssetType, type ScanSelection, type WatchCategory, type WatchItem,
} from "@shared/swingDecision";

export const RESOLVE_ERRORS = {
  NOT_FOUND: "Symbol not found",
  AMBIGUOUS: "Ambiguous symbol — choose exchange",
  UNSUPPORTED: "Unsupported asset type",
  UNAVAILABLE: "Data unavailable",
} as const;
export type ResolveError = typeof RESOLVE_ERRORS[keyof typeof RESOLVE_ERRORS];

export interface Resolved { symbol: string; exchange: string; assetType: AssetType; name?: string; sector?: string; industry?: string }
export type ResolveResult = { ok: true; item: Resolved } | { ok: false; error: ResolveError; choices?: Resolved[] };
export interface SearchQuote { symbol: string; exchange: string; quoteType: string; shortname?: string; longname?: string; sector?: string; industry?: string }
export type SearchFn = (q: string) => Promise<SearchQuote[] | null>;

const EXCH: Record<string, string> = {
  NMS: "NASDAQ", NGM: "NASDAQ", NCM: "NASDAQ", NAS: "NASDAQ", NASDAQ: "NASDAQ",
  NYQ: "NYSE", NYSE: "NYSE", PCX: "AMEX", ASE: "AMEX", AMEX: "AMEX", ARCA: "AMEX", NYSEARCA: "AMEX", BTS: "CBOE", CBOE: "CBOE", BATS: "CBOE",
};
export const normExchange = (x: string) => EXCH[x.toUpperCase()] ?? null;

const SEMIS = new Set(["SMH", "SOXX", "SOXL", "XSD", "PSI", "NVDA", "AMD", "AVGO", "TSM", "INTC", "MU", "QCOM", "ASML", "AMAT", "LRCX", "KLAC", "MRVL", "ARM", "TXN", "ON", "ADI", "NXPI", "MCHP"]);
const BROAD = new Set(["SPY", "IVV", "VOO", "VTI", "DIA", "IWM", "RSP", "MDY", "IJH", "SPLG", "ITOT"]);
const GROWTH = new Set(["QQQ", "QQQM", "XLK", "VGT", "IGV", "ARKK", "AAPL", "MSFT", "META", "GOOGL", "GOOG", "AMZN", "TSLA", "NFLX", "CRM", "ADBE", "ORCL", "PLTR"]);

export function autoCategories(r: Resolved): WatchCategory[] {
  const c: WatchCategory[] = ["CUSTOM"];
  if (r.assetType === "ETF") c.push("ETFS");
  if (SEMIS.has(r.symbol) || /semiconductor/i.test(r.industry ?? "")) c.push("SEMICONDUCTOR");
  if (BROAD.has(r.symbol)) c.push("BROAD_MARKET");
  if (GROWTH.has(r.symbol) || (/technology/i.test(r.sector ?? "") && !c.includes("SEMICONDUCTOR"))) c.push("GROWTH_TECH");
  return c;
}

export const riskNote = (a: AssetType) => (a === "ETF" ? ETF_RISK : SINGLE_STOCK_RISK);

/** Resolve "AAPL" or "NASDAQ:AAPL" to one US-listed stock/ETF. Bare tickers must resolve to exactly one exchange. */
export async function resolveSymbol(input: string, search: SearchFn): Promise<ResolveResult> {
  const raw = input.trim().toUpperCase();
  if (!/^([A-Z]{2,10}:)?[A-Z][A-Z0-9.\-]{0,9}$/.test(raw)) return { ok: false, error: RESOLVE_ERRORS.NOT_FOUND };
  const [qEx, qSym] = raw.includes(":") ? raw.split(":") : [null, raw];
  if (qEx && !normExchange(qEx)) return { ok: false, error: RESOLVE_ERRORS.UNSUPPORTED };
  const hits = await search(qSym);
  if (hits == null) return { ok: false, error: RESOLVE_ERRORS.UNAVAILABLE };
  const exact = hits.filter((h) => h.symbol.toUpperCase() === qSym);
  if (!exact.length) return { ok: false, error: RESOLVE_ERRORS.NOT_FOUND };
  const usable: Resolved[] = [];
  let unsupported = false;
  for (const h of exact) {
    const ex = normExchange(h.exchange);
    const qt = h.quoteType.toUpperCase();
    const at: AssetType | null = qt === "ETF" ? "ETF" : qt === "EQUITY" ? "STOCK" : null;
    if (!ex || !at) { unsupported = true; continue; }
    if (usable.some((u) => u.exchange === ex)) continue;
    usable.push({ symbol: qSym, exchange: ex, assetType: at, name: h.longname || h.shortname, sector: h.sector, industry: h.industry });
  }
  if (!usable.length) return { ok: false, error: unsupported ? RESOLVE_ERRORS.UNSUPPORTED : RESOLVE_ERRORS.NOT_FOUND };
  if (qEx) {
    const m = usable.find((u) => u.exchange === normExchange(qEx));
    return m ? { ok: true, item: m } : { ok: false, error: RESOLVE_ERRORS.NOT_FOUND };
  }
  if (usable.length > 1) return { ok: false, error: RESOLVE_ERRORS.AMBIGUOUS, choices: usable };
  return { ok: true, item: usable[0] };
}

export const yahooSearch: SearchFn = async (q) => {
  try {
    const r = await fetch(`https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=10&newsCount=0`, {
      headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" }, signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return null;
    const j: any = await r.json();
    return (j?.quotes ?? []).filter((x: any) => x?.symbol).map((x: any) => ({
      symbol: String(x.symbol), exchange: String(x.exchange ?? ""), quoteType: String(x.quoteType ?? ""),
      shortname: x.shortname, longname: x.longname, sector: x.sector, industry: x.industry,
    }));
  } catch { return null; }
};

// ─── Pure list operations ────────────────────────────────────────────────────
export class WatchlistError extends Error { constructor(msg: string, public code = 400) { super(msg); } }

export function normalizeList(list: WatchItem[] | undefined | null): WatchItem[] {
  const out: WatchItem[] = [];
  const src = list && list.length ? list : DEFAULT_WATCHLIST;
  for (const d of DEFAULT_WATCHLIST) if (!src.some((x) => x.symbol === d.symbol)) out.push({ ...d, order: -1 }); // defaults are permanent
  for (const x of src) if (!out.some((o) => o.symbol === x.symbol)) out.push({ ...x, isDefault: DEFAULT_WATCHLIST.some((d) => d.symbol === x.symbol) });
  return sortList(out);
}
export const sortList = (l: WatchItem[]) => l.slice().sort((a, z) => (Number(z.pinned) - Number(a.pinned)) || a.order - z.order).map((x, i) => ({ ...x, order: i }));
export const customCount = (l: WatchItem[]) => l.filter((x) => !x.isDefault && !x.categories.includes("ARCHIVED")).length;

export function addItem(list: WatchItem[], r: Resolved, maxCustom: number): WatchItem[] {
  const l = normalizeList(list);
  const hit = l.find((x) => x.symbol === r.symbol);
  if (hit) {
    if (hit.hidden || hit.categories.includes("ARCHIVED")) return sortList(l.map((x) => x.symbol === r.symbol ? { ...x, hidden: false, categories: x.categories.filter((c) => c !== "ARCHIVED") } : x));
    throw new WatchlistError(`${r.symbol} is already on the watchlist`);
  }
  if (customCount(l) >= maxCustom) throw new WatchlistError(`Custom watchlist is full (${maxCustom}). Remove or archive a ticker, or raise the limit in settings.`);
  return sortList([...l, { symbol: r.symbol, exchange: r.exchange, name: r.name, assetType: r.assetType, categories: autoCategories(r), isDefault: false, hidden: false, pinned: false, order: l.length }]);
}

export function removeItem(list: WatchItem[], symbol: string): WatchItem[] {
  const l = normalizeList(list), s = symbol.toUpperCase();
  const hit = l.find((x) => x.symbol === s);
  if (!hit) throw new WatchlistError(`${s} is not on the watchlist`, 404);
  if (hit.isDefault) throw new WatchlistError(`${s} is part of the DEFAULT LEARNING UNIVERSE — hide it instead of deleting.`);
  return sortList(l.filter((x) => x.symbol !== s));
}

export interface WatchPatch { hidden?: boolean; pinned?: boolean; notes?: string; assetType?: AssetType; categories?: WatchCategory[]; archived?: boolean; moveTo?: number }
export function patchItem(list: WatchItem[], symbol: string, p: WatchPatch): WatchItem[] {
  let l = normalizeList(list); const s = symbol.toUpperCase();
  const i = l.findIndex((x) => x.symbol === s);
  if (i < 0) throw new WatchlistError(`${s} is not on the watchlist`, 404);
  const x = { ...l[i] };
  if (p.hidden != null) x.hidden = p.hidden;
  if (p.pinned != null) x.pinned = p.pinned;
  if (p.notes != null) x.notes = p.notes.slice(0, 2000);
  if (p.assetType) x.assetType = p.assetType;
  if (p.categories) x.categories = Array.from(new Set(x.isDefault ? ["DEFAULT_LEARNING" as WatchCategory, ...p.categories] : p.categories));
  if (p.archived != null) {
    if (x.isDefault && p.archived) throw new WatchlistError(`${s} is a default ticker — hide it instead of archiving.`);
    x.categories = p.archived ? Array.from(new Set([...x.categories, "ARCHIVED" as WatchCategory])) : x.categories.filter((c) => c !== "ARCHIVED");
  }
  l[i] = x;
  if (p.moveTo != null) { const [m] = l.splice(i, 1); l.splice(Math.max(0, Math.min(l.length, p.moveTo)), 0, m); l = l.map((y, k) => ({ ...y, order: k })); }
  return sortList(l);
}

export function restoreDefaults(list: WatchItem[]): WatchItem[] {
  const customs = normalizeList(list).filter((x) => !x.isDefault);
  return sortList([...DEFAULT_WATCHLIST.map((d) => ({ ...d })), ...customs.map((c, i) => ({ ...c, order: 3 + i }))]);
}

/** §Q2 — which symbols a scan covers. Hidden/archived tickers are skipped unless explicitly selected. */
export function selectUniverse(list: WatchItem[], sel: ScanSelection, symbols: string[] = []): WatchItem[] {
  const l = normalizeList(list);
  const active = l.filter((x) => !x.hidden && !x.categories.includes("ARCHIVED"));
  switch (sel) {
    case "DEFAULT": return l.filter((x) => x.isDefault && !x.hidden);
    case "DEFAULT_PLUS_CUSTOM": return active;
    case "ETFS": return active.filter((x) => x.assetType === "ETF");
    case "STOCKS": return active.filter((x) => x.assetType === "STOCK");
    case "SEMICONDUCTOR": return active.filter((x) => x.categories.includes("SEMICONDUCTOR"));
    case "BROAD_MARKET": return active.filter((x) => x.categories.includes("BROAD_MARKET"));
    case "CUSTOM_SELECTION": { const want = new Set(symbols.map((s) => s.toUpperCase().split(":").pop()!)); return l.filter((x) => want.has(x.symbol)); }
  }
}
