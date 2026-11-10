import { useSyncExternalStore } from "react";
import type { ConfirmedHeroTrade } from "@/hooks/useStrategyEngine";
import type { ClientNotificationAuditEntry } from "@/hooks/useNotificationAuditLog";

export type SetupStage = 1 | 2 | 3;

export interface SetupStageInfo {
  stage: SetupStage;
  stageBadge: string;
  distanceToSma20Pct: number | null;
  supportFloorPrice: number | null;
  testedLine: "10_EMA" | "20_SMA" | "50_SMA" | string | null;
  minsRemaining: number;
  statusText: string;
  isInitializing?: boolean;
}

export interface TradeSetupStoreState {
  activeExecutionSetups: ConfirmedHeroTrade[];
  stages: Record<string, SetupStageInfo>;
  tradeSetups: Record<string, any>;
  dismissedSymbols: Set<string>;
}

type Listener = () => void;

class TradeSetupStore {
  private state: TradeSetupStoreState = {
    activeExecutionSetups: [],
    stages: {},
    tradeSetups: {},
    dismissedSymbols: new Set<string>(),
  };

  private listeners = new Set<Listener>();

  constructor() {
    this.loadPersistedState();
  }

  private loadPersistedState() {
    if (typeof window === "undefined") return;
    try {
      const saved = localStorage.getItem("chizzle_active_execution_setups");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          this.state.activeExecutionSetups = parsed;
        }
      }
    } catch {}
  }

  private persistActiveSetups() {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(
        "chizzle_active_execution_setups",
        JSON.stringify(this.state.activeExecutionSetups)
      );
    } catch {}
  }

  public getState(): TradeSetupStoreState {
    return this.state;
  }

  public subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    this.listeners.forEach((listener) => listener());
  }

  /**
   * Adds or updates a confirmed execution setup in activeExecutionSetups.
   * Guarantees the setup is never swallowed by local component filters.
   */
  public addActiveExecutionSetup(setup: ConfirmedHeroTrade) {
    const sym = (setup.symbol || setup.ticker).trim().toUpperCase();
    if (this.state.dismissedSymbols.has(sym)) {
      // Re-enable if explicitly re-confirmed
      this.state.dismissedSymbols.delete(sym);
    }

    const index = this.state.activeExecutionSetups.findIndex(
      (s) => s.symbol.toUpperCase() === sym
    );

    const updated = {
      ...setup,
      symbol: sym,
      ticker: sym,
      isTradeConfirmed: true,
      status: "CONFIRMED BOUNCE",
      timestamp: setup.timestamp || Date.now(),
    };

    if (index >= 0) {
      this.state.activeExecutionSetups[index] = {
        ...this.state.activeExecutionSetups[index],
        ...updated,
      };
    } else {
      this.state.activeExecutionSetups = [updated, ...this.state.activeExecutionSetups];
    }

    // Also update stage to Stage 3
    this.state.stages[sym] = {
      stage: 3,
      stageBadge: "[ ⚡ ACTIVE EXECUTION READY ]",
      distanceToSma20Pct: 0,
      supportFloorPrice: updated.entryPrice,
      testedLine: updated.testedLine || "20_SMA",
      minsRemaining: 0,
      statusText: `1H candle closed green. Active execution ready at $${updated.entryPrice.toFixed(2)}.`,
      isInitializing: false,
    };

    this.persistActiveSetups();
    this.notify();
  }

  public removeActiveExecutionSetup(symbol: string) {
    const sym = symbol.trim().toUpperCase();
    this.state.activeExecutionSetups = this.state.activeExecutionSetups.filter(
      (s) => s.symbol.toUpperCase() !== sym
    );
    this.persistActiveSetups();
    this.notify();
  }

  public dismissHeroTrade(symbol: string) {
    const sym = symbol.trim().toUpperCase();
    this.state.dismissedSymbols.add(sym);
    this.removeActiveExecutionSetup(sym);
  }

  public clearDismissed() {
    this.state.dismissedSymbols.clear();
    this.notify();
  }

  /**
   * Marks a trade confirmed and immediately appends to activeExecutionSetups
   */
  public setTradeConfirmed(
    symbol: string,
    isConfirmed: boolean,
    details?: Partial<ConfirmedHeroTrade>
  ) {
    const sym = symbol.trim().toUpperCase();
    if (!isConfirmed) {
      this.removeActiveExecutionSetup(sym);
      return;
    }

    const livePrice = details?.currentPrice || details?.entryPrice || 100;
    const entry = details?.entryPrice || livePrice;
    const stop = details?.stopLoss || +(entry * 0.985).toFixed(2);
    const risk = Math.max(0.01, +(entry - stop).toFixed(2));
    const target1 = details?.target1 || +(entry + 1.5 * risk).toFixed(2);
    const target2 = details?.target2 || +(entry + 2.0 * risk).toFixed(2);
    const shares = details?.shares || Math.max(1, Math.floor(250 / risk));
    const t1Shares = details?.t1Shares || Math.max(1, Math.floor(shares * 0.5));
    const t2Shares = details?.t2Shares || Math.max(1, shares - t1Shares);

    const setup: ConfirmedHeroTrade = {
      symbol: sym,
      ticker: sym,
      currentPrice: livePrice,
      entryPrice: entry,
      stopLoss: stop,
      riskPerShare: risk,
      target1,
      target2,
      testedLine: details?.testedLine || "20_SMA",
      status: "CONFIRMED BOUNCE",
      isTradeConfirmed: true,
      shares,
      t1Shares,
      t2Shares,
      timestamp: Date.now(),
    };

    this.addActiveExecutionSetup(setup);
  }

  /**
   * Synchronizes backend notification audit log (/api/alerts/audit-log)
   * into activeExecutionSetups so JPM and any confirmed alert sent to Telegram
   * automatically appears in the top Active Execution Zone banner.
   */
  public syncFromBackendAuditLog(
    bySymbol: Record<string, ClientNotificationAuditEntry>
  ) {
    let changed = false;

    for (const [rawSym, entry] of Object.entries(bySymbol)) {
      if (!entry) continue;
      const sym = rawSym.trim().toUpperCase();

      const isConfirmedAlert =
        entry.alertType === "CONFIRMED_1H_20SMA" ||
        entry.alertType === "CONFIRMED_1H_10SMA" ||
        entry.alertType === "READY_TO_TRADE" ||
        entry.alertType === "CONFIRMED_1H_CLOSE" ||
        (entry.status === "SENT" && !entry.alertType?.includes("PROXIMITY")) ||
        (entry.status === "STUBBED" && !entry.alertType?.includes("PROXIMITY"));

      if (isConfirmedAlert) {
        const alreadyPresent = this.state.activeExecutionSetups.some(
          (s) => s.symbol.toUpperCase() === sym
        );

        if (!alreadyPresent && !this.state.dismissedSymbols.has(sym)) {
          const entryPrice = entry.entryPrice > 0 ? entry.entryPrice : 100;
          const stopLoss = entry.stopLoss > 0 ? entry.stopLoss : +(entryPrice * 0.985).toFixed(2);
          const riskPerShare = Math.max(0.01, +(entryPrice - stopLoss).toFixed(2));
          const target1 = entry.target1 > 0 ? entry.target1 : +(entryPrice + 1.5 * riskPerShare).toFixed(2);
          const target2 = +(entryPrice + 2.0 * riskPerShare).toFixed(2);
          const shares = entry.calculatedShares > 0 ? entry.calculatedShares : Math.max(1, Math.floor(250 / riskPerShare));
          const t1Shares = Math.max(1, Math.floor(shares * 0.5));
          const t2Shares = Math.max(1, shares - t1Shares);

          const heroTrade: ConfirmedHeroTrade = {
            symbol: sym,
            ticker: sym,
            currentPrice: entryPrice,
            entryPrice,
            stopLoss,
            riskPerShare,
            target1,
            target2,
            testedLine: entry.alertType?.includes("10SMA") ? "10_SMA" : "20_SMA",
            status: "CONFIRMED BOUNCE",
            isTradeConfirmed: true,
            shares,
            t1Shares,
            t2Shares,
            timestamp: entry.firedAt || entry.lastAlertTimestamp || Date.now(),
          };

          this.state.activeExecutionSetups = [heroTrade, ...this.state.activeExecutionSetups];
          this.state.stages[sym] = {
            stage: 3,
            stageBadge: "[ ⚡ ACTIVE EXECUTION READY ]",
            distanceToSma20Pct: 0,
            supportFloorPrice: entryPrice,
            testedLine: heroTrade.testedLine,
            minsRemaining: 0,
            statusText: `1H candle closed green. Active execution ready at $${entryPrice.toFixed(2)}.`,
            isInitializing: false,
          };
          changed = true;
        }
      }
    }

    if (changed) {
      this.persistActiveSetups();
      this.notify();
    }
  }

  /**
   * Calculates the remaining minutes until the top of the next hour (1H bar close).
   */
  public getMinsToNext1HClose(now = new Date()): number {
    const mins = now.getMinutes();
    return Math.max(1, 60 - mins);
  }

  /**
   * Evaluates and updates the 3-Stage Lifecycle for a symbol:
   * - STAGE 1: [ WATCH / PENDING RETEST ] (Price > 1.0% away from MAs)
   * - STAGE 2: [ ⏳ TESTING SUPPORT / AWAITING 1H CLOSE ] (Price within 0.5% of MA)
   * - STAGE 3: [ ⚡ ACTIVE EXECUTION READY ] (1H candle closed green)
   */
  public evaluateSetupStage(params: {
    symbol: string;
    currentPrice: number;
    sma20?: number | null;
    sma50?: number | null;
    ema10?: number | null;
    isTradeConfirmed?: boolean;
    isInitializing?: boolean;
    now?: Date;
  }): SetupStageInfo {
    const sym = params.symbol.trim().toUpperCase();
    const price = params.currentPrice;
    const now = params.now || new Date();
    const minsRemaining = this.getMinsToNext1HClose(now);

    // Initializing state takes temporary precedence
    if (params.isInitializing) {
      const info: SetupStageInfo = {
        stage: 1,
        stageBadge: "[ INITIALIZING SCAN... ]",
        distanceToSma20Pct: null,
        supportFloorPrice: null,
        testedLine: null,
        minsRemaining,
        statusText: "Status: Initializing scanner & connecting WebSocket feed...",
        isInitializing: true,
      };
      this.state.stages[sym] = info;
      this.notify();
      return info;
    }

    // Stage 3: Trade Confirmed (1H candle closed green off MA)
    if (params.isTradeConfirmed) {
      const info: SetupStageInfo = {
        stage: 3,
        stageBadge: "[ ⚡ ACTIVE EXECUTION READY ]",
        distanceToSma20Pct: 0,
        supportFloorPrice: params.sma20 ?? price,
        testedLine: "20_SMA",
        minsRemaining: 0,
        statusText: "1H candle closed green holding support. Active execution ready.",
        isInitializing: false,
      };
      this.state.stages[sym] = info;
      this.notify();
      return info;
    }

    const sma20 = params.sma20 ?? null;
    const sma50 = params.sma50 ?? null;
    const ema10 = params.ema10 ?? null;

    let dist20Pct: number | null = null;
    if (sma20 && sma20 > 0 && price > 0) {
      dist20Pct = +(((price - sma20) / sma20) * 100).toFixed(2);
    }

    // Check proximity to any key MA: 10-EMA, 20-SMA, 50-SMA (within 0.5% = 0.005)
    let closestLine: "10_EMA" | "20_SMA" | "50_SMA" | null = null;
    let closestFloorPrice: number | null = null;
    let minDistanceFraction = Infinity;

    const candidates: Array<{ line: "10_EMA" | "20_SMA" | "50_SMA"; val: number | null }> = [
      { line: "10_EMA", val: ema10 },
      { line: "20_SMA", val: sma20 },
      { line: "50_SMA", val: sma50 },
    ];

    for (const c of candidates) {
      if (c.val && c.val > 0 && price > 0) {
        const frac = Math.abs(price - c.val) / c.val;
        if (frac < minDistanceFraction) {
          minDistanceFraction = frac;
          closestLine = c.line;
          closestFloorPrice = c.val;
        }
      }
    }

    // STAGE 2: Price pulled back within 0.5% of 10-EMA, 20-SMA, or 50-SMA
    if (minDistanceFraction <= 0.005 && closestFloorPrice != null) {
      const floorStr = closestFloorPrice.toFixed(2);
      const info: SetupStageInfo = {
        stage: 2,
        stageBadge: "[ ⏳ TESTING SUPPORT / AWAITING 1H CLOSE ]",
        distanceToSma20Pct: dist20Pct,
        supportFloorPrice: closestFloorPrice,
        testedLine: closestLine,
        minsRemaining,
        statusText: `Testing Support Floor ($${floorStr}) | Countdown: Awaiting 1H Bar Close (${minsRemaining} mins remaining)`,
        isInitializing: false,
      };
      this.state.stages[sym] = info;
      this.notify();
      return info;
    }

    // STAGE 1: Price > 1.0% away from moving averages
    const distText = dist20Pct != null ? (dist20Pct >= 0 ? `+${dist20Pct}%` : `${dist20Pct}%`) : "+1.50%";
    const info: SetupStageInfo = {
      stage: 1,
      stageBadge: "[ WATCH / PENDING RETEST ]",
      distanceToSma20Pct: dist20Pct,
      supportFloorPrice: sma20,
      testedLine: "20_SMA",
      minsRemaining,
      statusText: `Current Distance to 20-SMA: ${distText} | Status: WAITING FOR PULLBACK`,
      isInitializing: false,
    };
    this.state.stages[sym] = info;
    this.notify();
    return info;
  }

  public getStage(symbol: string): SetupStageInfo | null {
    return this.state.stages[symbol.trim().toUpperCase()] ?? null;
  }
}

export const tradeSetupStore = new TradeSetupStore();

export function useTradeSetupStore<T = TradeSetupStoreState>(
  selector?: (state: TradeSetupStoreState) => T
): T {
  const slice = useSyncExternalStore(
    tradeSetupStore.subscribe.bind(tradeSetupStore),
    () => {
      const state = tradeSetupStore.getState();
      return selector ? selector(state) : (state as any);
    },
    () => {
      const state = tradeSetupStore.getState();
      return selector ? selector(state) : (state as any);
    }
  );
  return slice;
}
