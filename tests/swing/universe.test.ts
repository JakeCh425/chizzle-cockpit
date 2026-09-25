// PR 3d — §Q1/§Q2 watchlist, resolver, scan selection (pure; search is injected).
import { describe, it, expect } from "vitest";
import { resolveSymbol, addItem, removeItem, patchItem, restoreDefaults, selectUniverse, normalizeList, riskNote, RESOLVE_ERRORS, type SearchFn } from "../../server/swing/universe";
import { DEFAULT_WATCHLIST, ETF_RISK, SINGLE_STOCK_RISK } from "@shared/swingDecision";

const db: Record<string, any[]> = {
  NVDA: [{ symbol: "NVDA", exchange: "NMS", quoteType: "EQUITY", longname: "NVIDIA", sector: "Technology", industry: "Semiconductors" }],
  SOXX: [{ symbol: "SOXX", exchange: "NMS", quoteType: "ETF", longname: "iShares Semiconductor ETF" }],
  IWM: [{ symbol: "IWM", exchange: "PCX", quoteType: "ETF", longname: "iShares Russell 2000" }],
  SHOP: [{ symbol: "SHOP", exchange: "NYQ", quoteType: "EQUITY" }, { symbol: "SHOP", exchange: "TOR", quoteType: "EQUITY" }, { symbol: "SHOP", exchange: "NMS", quoteType: "EQUITY" }],
  BTC: [{ symbol: "BTC", exchange: "CCC", quoteType: "CRYPTOCURRENCY" }],
};
const search: SearchFn = async (q) => (q === "DOWN" ? null : db[q] ?? []);

describe("resolver — all four error messages + qualified symbols", () => {
  it("bare ticker → exchange resolved", async () => {
    const r = await resolveSymbol("nvda", search);
    expect(r).toMatchObject({ ok: true, item: { symbol: "NVDA", exchange: "NASDAQ", assetType: "STOCK" } });
    expect((await resolveSymbol("IWM", search) as any).item.exchange).toBe("AMEX");
  });
  it("errors", async () => {
    expect(await resolveSymbol("ZZZZ", search)).toEqual({ ok: false, error: RESOLVE_ERRORS.NOT_FOUND });
    expect(await resolveSymbol("$$$", search)).toEqual({ ok: false, error: "Symbol not found" });
    const a = await resolveSymbol("SHOP", search);
    expect(a).toMatchObject({ ok: false, error: "Ambiguous symbol — choose exchange" });
    expect((a as any).choices.map((c: any) => c.exchange).sort()).toEqual(["NASDAQ", "NYSE"]);
    expect(await resolveSymbol("BTC", search)).toEqual({ ok: false, error: "Unsupported asset type" });
    expect(await resolveSymbol("DOWN", search)).toEqual({ ok: false, error: "Data unavailable" });
    expect(await resolveSymbol("LSE:SHOP", search)).toEqual({ ok: false, error: "Unsupported asset type" });
  });
  it("exchange-qualified symbol picks that listing", async () => {
    expect(await resolveSymbol("NYSE:SHOP", search)).toMatchObject({ ok: true, item: { exchange: "NYSE" } });
  });
});

describe("watchlist ops", () => {
  const nvda = { symbol: "NVDA", exchange: "NASDAQ", assetType: "STOCK" as const, sector: "Technology", industry: "Semiconductors" };
  it("defaults are permanent and labeled; empty/missing list → defaults", () => {
    const l = normalizeList([]);
    expect(l.map((x) => x.symbol)).toEqual(["SMH", "QQQ", "SPY"]);
    expect(l.every((x) => x.isDefault)).toBe(true);
    expect(normalizeList([{ ...DEFAULT_WATCHLIST[0] }]).length).toBe(3);
  });
  it("add → auto categories; duplicates rejected; max custom enforced", () => {
    const l = addItem([], nvda, 12);
    const n = l.find((x) => x.symbol === "NVDA")!;
    expect(n.categories).toEqual(expect.arrayContaining(["SEMICONDUCTOR", "CUSTOM"]));
    expect(() => addItem(l, nvda, 12)).toThrow(/already/);
    expect(() => addItem(l, { ...nvda, symbol: "AMD" }, 1)).toThrow(/full \(1\)/);
  });
  it("defaults cannot be removed or archived, only hidden; customs can be removed", () => {
    const l = addItem([], nvda, 12);
    expect(() => removeItem(l, "SMH")).toThrow(/hide it instead/);
    expect(() => patchItem(l, "QQQ", { archived: true })).toThrow(/hide it instead/);
    const h = patchItem(l, "SMH", { hidden: true });
    expect(h.find((x) => x.symbol === "SMH")!.hidden).toBe(true);
    expect(removeItem(l, "NVDA").some((x) => x.symbol === "NVDA")).toBe(false);
  });
  it("pin floats to the top; moveTo reorders; notes stored", () => {
    let l = addItem([], nvda, 12);
    l = patchItem(l, "NVDA", { pinned: true, notes: "earnings 11/19" });
    expect(l[0].symbol).toBe("NVDA");
    expect(l[0].notes).toBe("earnings 11/19");
    l = patchItem(patchItem(l, "NVDA", { pinned: false }), "SPY", { moveTo: 0 });
    expect(l[0].symbol).toBe("SPY");
  });
  it("Restore Defaults un-hides SMH/QQQ/SPY in order and keeps customs", () => {
    const l = restoreDefaults(patchItem(addItem([], nvda, 12), "SMH", { hidden: true }));
    expect(l.slice(0, 3).map((x) => [x.symbol, x.hidden])).toEqual([["SMH", false], ["QQQ", false], ["SPY", false]]);
    expect(l.some((x) => x.symbol === "NVDA")).toBe(true);
  });
  it("scan selections; archived skipped unless explicitly selected; hidden default skipped", () => {
    let l = addItem(addItem([], nvda, 12), { symbol: "IWM", exchange: "AMEX", assetType: "ETF" }, 12);
    l = patchItem(l, "IWM", { archived: true });
    const syms = (s: any, x: string[] = []) => selectUniverse(l, s, x).map((i) => i.symbol);
    expect(syms("DEFAULT")).toEqual(["SMH", "QQQ", "SPY"]);
    expect(syms("DEFAULT_PLUS_CUSTOM")).toEqual(["SMH", "QQQ", "SPY", "NVDA"]);
    expect(syms("STOCKS")).toEqual(["NVDA"]);
    expect(syms("ETFS")).toEqual(["SMH", "QQQ", "SPY"]);
    expect(syms("SEMICONDUCTOR")).toEqual(expect.arrayContaining(["SMH", "NVDA"]));
    expect(syms("CUSTOM_SELECTION", ["AMEX:IWM"])).toEqual(["IWM"]);
    expect(selectUniverse(patchItem(l, "QQQ", { hidden: true }), "DEFAULT").map((x) => x.symbol)).toEqual(["SMH", "SPY"]);
  });
  it("risk notes", () => {
    expect(riskNote("STOCK")).toBe(SINGLE_STOCK_RISK);
    expect(riskNote("ETF")).toBe(ETF_RISK);
    expect(SINGLE_STOCK_RISK).toBe("SINGLE-STOCK EVENT RISK — verify earnings date and news before swing planning.");
  });
});

