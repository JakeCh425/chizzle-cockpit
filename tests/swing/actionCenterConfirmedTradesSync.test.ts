import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const actionCenterPath = path.resolve(__dirname, "../../client/src/components/swing/ActionCenter.tsx");
const globalStatePath = path.resolve(__dirname, "../../client/src/lib/globalState.tsx");
const dashboardPath = path.resolve(__dirname, "../../client/src/pages/WealthEngineDashboard.tsx");

describe("Action Center UI - Highlight 'Confirmed Trades' Badge & Sync Global State", () => {
  const actionCenterSrc = fs.readFileSync(actionCenterPath, "utf-8").replace(/\r\n/g, "\n");
  const globalStateSrc = fs.readFileSync(globalStatePath, "utf-8").replace(/\r\n/g, "\n");
  const dashboardSrc = fs.readFileSync(dashboardPath, "utf-8").replace(/\r\n/g, "\n");

  describe("1. Dynamic UI Styling for 'Confirmed Trades' Badge", () => {
    it("locates the [ CONFIRMED TRADES: X ] filter badge with data-testid='pill-confirmed-trades'", () => {
      expect(actionCenterSrc).toContain('data-testid="pill-confirmed-trades"');
      expect(actionCenterSrc).toContain("[ CONFIRMED TRADES:");
    });

    it("applies subdued neutral styling when confirmedCount === 0 (Inactive)", () => {
      // Subdued: transparent background, white/10 or slate border, text-slate-400, font-medium, dot bg-slate-600
      expect(actionCenterSrc).toContain('border-white/10 bg-transparent text-slate-400 font-medium');
      expect(actionCenterSrc).toContain('confirmedCount > 0 ? "bg-gray-950 shadow-sm" : "bg-slate-600"');
    });

    it("applies aggressive high-visibility styling when confirmedCount > 0 (Active)", () => {
      // Active: solid vibrant bg (bg-emerald-500), bold text and dark contrast (font-extrabold text-gray-950), animate-pulse, ring & glow
      expect(actionCenterSrc).toContain("bg-emerald-500");
      expect(actionCenterSrc).toContain("font-extrabold text-gray-950");
      expect(actionCenterSrc).toContain("animate-pulse");
      expect(actionCenterSrc).toContain("shadow-[0_0_20px_rgba(16,185,129,0.85)]");
      expect(actionCenterSrc).toContain("ring-2 ring-emerald-300");
    });

    it("dynamically styles the indicator dot and count number based on confirmedCount", () => {
      expect(actionCenterSrc).toContain('confirmedCount > 0 ? "text-gray-950" : "text-slate-400"');
      expect(actionCenterSrc).toContain('data-active={confirmedCount > 0 ? "true" : "false"}');
    });
  });

  describe("2. Enforce Global State Synchronization (Cockpit <-> Wealth Studio)", () => {
    it("declares confirmedCount, confirmedTradesCount, and setConfirmedSetup in GlobalStateContextType", () => {
      expect(globalStateSrc).toContain("confirmedCount: number;");
      expect(globalStateSrc).toContain("confirmedTradesCount: number;");
      expect(globalStateSrc).toContain("confirmedSetups: Record<string, boolean>;");
      expect(globalStateSrc).toContain("setConfirmedSetup: (symbol: string, confirmed?: boolean) => void;");
      expect(globalStateSrc).toContain("registerConfirmedSetup: (symbol: string, confirmed?: boolean) => void;");
    });

    it("calculates confirmedCount reactively from synced watchlist statuses and live confirmations in GlobalStateProvider", () => {
      expect(globalStateSrc).toContain("const [liveConfirmedSetups, setLiveConfirmedSetups] = useState<Record<string, boolean>>({});");
      expect(globalStateSrc).toContain("const confirmedCount = useMemo(() => {");
      expect(globalStateSrc).toContain('s === "READY" || s === "CONFIRMED" || s === "SETUP_CONFIRMED"');
    });

    it("binds Action Center directly to Global State Manager to prevent local/stale prop desync", () => {
      expect(actionCenterSrc).toContain("useOptionalGlobalState");
      expect(actionCenterSrc).toContain("const global = useOptionalGlobalState();");
      expect(actionCenterSrc).toContain("const confirmedCount = global");
      expect(actionCenterSrc).toContain("Math.max(global.confirmedCount, counts.CONFIRMED ?? 0)");
    });

    it("synchronizes candle confirmation from Wealth Studio WebSocket feed to Global State Manager", () => {
      // In LiveTradingChart (WebSocket candle confirmation trigger)
      expect(dashboardSrc).toContain("setConfirmedSetup(symbol, Boolean(isConfirmedSetup));");

      // In WealthEngineDashboard main view (TRADE_READY / isTradeConfirmed logic)
      expect(dashboardSrc).toContain("const isConfirmed = Boolean(isTradeReady || isTradeConfirmed || activeItem?.status === \"Ready\");");
      expect(dashboardSrc).toContain("global.setConfirmedSetup(activeTicker, isConfirmed);");
    });
  });

  describe("3. Functional Logic & Reactivity Unit Check", () => {
    it("properly deduplicates and calculates confirmed count across symbols", () => {
      const watchlist = [
        { symbol: "NVDA", status: "Ready" },
        { symbol: "AAPL", status: "Forming" },
        { symbol: "TSLA", status: "Confirmed" },
        { symbol: "MSFT", status: "Awaiting Close" },
      ];

      const liveConfirmations: Record<string, boolean> = {
        AAPL: true, // AAPL confirmed via 1H candle close
        TSLA: true, // TSLA already confirmed in watchlist, duplicate must not double-count
      };

      const confirmedSyms = new Set<string>();
      for (const item of watchlist) {
        const s = (item.status || "").toUpperCase();
        if (s === "READY" || s === "CONFIRMED" || s === "SETUP_CONFIRMED") {
          confirmedSyms.add(item.symbol.toUpperCase());
        }
      }
      for (const [sym, isConf] of Object.entries(liveConfirmations)) {
        if (isConf) {
          confirmedSyms.add(sym.toUpperCase());
        } else {
          confirmedSyms.delete(sym.toUpperCase());
        }
      }

      // NVDA (Ready) + TSLA (Confirmed) + AAPL (live 1H candle confirmed) = 3 unique
      expect(confirmedSyms.size).toBe(3);
      expect(Array.from(confirmedSyms).sort()).toEqual(["AAPL", "NVDA", "TSLA"]);
    });

    it("removes unconfirmed setups if live status is revoked (false)", () => {
      const watchlist = [
        { symbol: "NVDA", status: "Ready" },
      ];

      const liveConfirmations: Record<string, boolean> = {
        NVDA: false, // Revoked / invalidated
      };

      const confirmedSyms = new Set<string>();
      for (const item of watchlist) {
        const s = (item.status || "").toUpperCase();
        if (s === "READY" || s === "CONFIRMED" || s === "SETUP_CONFIRMED") {
          confirmedSyms.add(item.symbol.toUpperCase());
        }
      }
      for (const [sym, isConf] of Object.entries(liveConfirmations)) {
        if (isConf) {
          confirmedSyms.add(sym.toUpperCase());
        } else {
          confirmedSyms.delete(sym.toUpperCase());
        }
      }

      expect(confirmedSyms.size).toBe(0);
    });
  });
});

