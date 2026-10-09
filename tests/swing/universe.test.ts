// PR 3d — §Q1/§Q2 watchlist, resolver, scan selection (pure; search is injected).
import { describe, it, expect } from "vitest";
import { resolveSymbol, addItem, removeItem, patchItem, restoreDefaults, selectUniverse, normalizeList, riskNote, customCount, RESOLVE_ERRORS, type SearchFn } from "../../server/swing/universe";
import { DEFAULT_WATCHLIST, DEFAULT_UNIVERSE_HINT, ETF_RISK, SINGLE_STOCK_RISK } from "@shared/swingDecision";

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
    expect(l.map((x) => x.symbol)).toEqual(["SMH", "QQQ", "SPY", "XLE", "XLV"]);
    expect(l.every((x) => x.isDefault)).toBe(true);
    expect(normalizeList([{ ...DEFAULT_WATCHLIST[0] }]).length).toBe(5);
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
    expect(syms("DEFAULT")).toEqual(["SMH", "QQQ", "SPY", "XLE", "XLV"]);
    expect(syms("DEFAULT_PLUS_CUSTOM")).toEqual(["SMH", "QQQ", "SPY", "XLE", "XLV", "NVDA"]);
    expect(syms("STOCKS")).toEqual(["NVDA"]);
    expect(syms("ETFS")).toEqual(["SMH", "QQQ", "SPY", "XLE", "XLV"]);
    expect(syms("SEMICONDUCTOR")).toEqual(expect.arrayContaining(["SMH", "NVDA"]));
    expect(syms("CUSTOM_SELECTION", ["AMEX:IWM"])).toEqual(["IWM"]);
    expect(selectUniverse(patchItem(l, "QQQ", { hidden: true }), "DEFAULT").map((x) => x.symbol)).toEqual(["SMH", "SPY", "XLE", "XLV"]);
  });
  it("risk notes", () => {
    expect(riskNote("STOCK")).toBe(SINGLE_STOCK_RISK);
    expect(riskNote("ETF")).toBe(ETF_RISK);
    expect(SINGLE_STOCK_RISK).toBe("SINGLE-STOCK EVENT RISK — verify earnings date and news before swing planning.");
  });
});

describe("Part 6 — XLE / XLV in the default learning universe", () => {
  const nvda = { symbol: "NVDA", exchange: "NASDAQ", assetType: "STOCK" as const, sector: "Technology", industry: "Semiconductors" };
  // A list saved before Part 6: SMH/QQQ/SPY + a pinned custom + another custom, with SPY hidden.
  const legacy = () => {
    let l = addItem(addItem(DEFAULT_WATCHLIST.slice(0, 3).map((d) => ({ ...d })), nvda, 12), { symbol: "IWM", exchange: "AMEX", assetType: "ETF" }, 12);
    l = patchItem(patchItem(l, "SPY", { hidden: true }), "NVDA", { pinned: true });
    return l.filter((x) => x.symbol !== "XLE" && x.symbol !== "XLV");
  };
  it("existing saved lists gain XLE/XLV right after the last default; pins, hidden flags and custom order kept", () => {
    const l = normalizeList(legacy());
    expect(l.map((x) => x.symbol)).toEqual(["NVDA", "SMH", "QQQ", "SPY", "XLE", "XLV", "IWM"]);
    expect(l.find((x) => x.symbol === "SPY")!.hidden).toBe(true);
    expect(l.filter((x) => x.isDefault).map((x) => x.symbol)).toEqual(["SMH", "QQQ", "SPY", "XLE", "XLV"]);
  });
  it("XLE/XLV can be hidden but not deleted", () => {
    const l = patchItem(normalizeList([]), "XLE", { hidden: true });
    expect(l.find((x) => x.symbol === "XLE")!.hidden).toBe(true);
    expect(selectUniverse(l, "DEFAULT").map((x) => x.symbol)).not.toContain("XLE");
    expect(() => removeItem(l, "XLV")).toThrow(/DEFAULT LEARNING UNIVERSE/);
  });
  it("Restore Defaults un-hides XLE/XLV and keeps customs after them", () => {
    const l = restoreDefaults(patchItem(patchItem(normalizeList(legacy()), "XLE", { hidden: true }), "XLV", { hidden: true }));
    expect(l.filter((x) => x.isDefault).map((x) => [x.symbol, x.hidden])).toEqual([["SMH", false], ["QQQ", false], ["SPY", false], ["XLE", false], ["XLV", false]]);
    expect(l.map((x) => x.symbol)).toEqual(["NVDA", "SMH", "QQQ", "SPY", "XLE", "XLV", "IWM"]); // pinned custom stays on top, as before
  });
  it("custom limit does not count XLE/XLV; a user's earlier custom XLE becomes the default entry", () => {
    expect(customCount(normalizeList([]))).toBe(0);
    const l = normalizeList([...DEFAULT_WATCHLIST.slice(0, 3).map((d) => ({ ...d })), { symbol: "XLE", exchange: "AMEX", assetType: "ETF", categories: ["CUSTOM"], isDefault: false, hidden: false, pinned: false, order: 3 } as any]);
    expect(l.filter((x) => x.symbol === "XLE").length).toBe(1);
    expect(l.find((x) => x.symbol === "XLE")!.isDefault).toBe(true);
    expect(l.find((x) => x.symbol === "XLE")!.categories).toEqual(["DEFAULT_LEARNING", "ETFS"]);
  });
  it("header hint lists the full default universe", () => {
    expect(DEFAULT_UNIVERSE_HINT).toBe("SMH · QQQ · SPY · XLE · XLV + custom");
  });
});
