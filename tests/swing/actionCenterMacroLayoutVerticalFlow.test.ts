import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const rootDir = path.resolve(__dirname, "../..");
const actionCenterPath = path.resolve(rootDir, "client/src/components/swing/ActionCenter.tsx");
const heroCardPath = path.resolve(rootDir, "client/src/components/swing/ActiveExecutionHeroCard.tsx");
const tradingCardPath = path.resolve(rootDir, "client/src/components/swing/TradingCard.tsx");

describe("Action Center Master Layout Cleanup: Full-Width Responsive Grid, Single Chart Consolidation & AI Tips", () => {
  const actionCenterSrc = fs.readFileSync(actionCenterPath, "utf-8").replace(/\r\n/g, "\n");
  const heroCardSrc = fs.readFileSync(heroCardPath, "utf-8").replace(/\r\n/g, "\n");
  const tradingCardSrc = fs.readFileSync(tradingCardPath, "utf-8").replace(/\r\n/g, "\n");

  it("Task 1: Removes sidebar split layout and uses fluid w-full px-4 lg:px-6 container with 4-col auto-fit grid", () => {
    expect(actionCenterSrc).not.toContain("grid grid-cols-1 lg:grid-cols-12");
    expect(actionCenterSrc).toContain('id="ac-body" className="flex flex-col gap-8 w-full px-4 lg:px-6"');
    expect(actionCenterSrc).toContain("grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4 w-full");

    // Position sizing truncation prevention
    expect(heroCardSrc).toContain("min-w-[120px] flex-shrink-0 text-right whitespace-nowrap");
    expect(tradingCardSrc).toContain("min-w-[120px] flex-shrink-0");
  });

  it("Task 2: Zone 1 (Ready to Execute) is placed at the top with strict filtering", () => {
    const readyZoneIdx = actionCenterSrc.indexOf('data-testid="active-execution-zone"');
    const pendingZoneIdx = actionCenterSrc.indexOf('data-testid="zone-pending-waiting"');
    const watchlistZoneIdx = actionCenterSrc.indexOf('data-testid="section-watchlist-and-chart"');

    // Strict vertical flow order: Zone 1 (Top) < Zone 2 (Middle) < Zone 3 (Bottom)
    expect(readyZoneIdx).toBeGreaterThan(0);
    expect(pendingZoneIdx).toBeGreaterThan(readyZoneIdx);
    expect(watchlistZoneIdx).toBeGreaterThan(pendingZoneIdx);

    // Responsive grid
    expect(actionCenterSrc).toContain('data-testid="ready-cards-grid"');

    // Strict filtering logic
    expect(actionCenterSrc).toContain('d.setupStatus === "READY_TO_TRADE" && !d.isStandbyDay && !d.hasHardBlock');
  });

  it("Task 3: Zone 2 (Pending & Waiting) renders AI Predictive Tips with dynamic distance calculation", () => {
    expect(actionCenterSrc).toContain('data-testid="zone-pending-waiting"');
    expect(actionCenterSrc).toContain('data-testid="waiting-room-rows"');
    expect(actionCenterSrc).toContain('data-testid={`waiting-row-${d.symbol}`}');
    expect(actionCenterSrc).toContain('data-testid={`badge-waiting-ai-tip-${d.symbol}`}');

    // Dynamic distance & readiness calculations
    expect(actionCenterSrc).toContain("distancePercent =");
    expect(actionCenterSrc).toContain("isHardBlock =");

    // Actionable AI Tips
    expect(actionCenterSrc).toContain("[ 🔒 AI Tip: Trend Red. 4H 20-SMA below 50-SMA. Stand down. ]");
    expect(actionCenterSrc).toContain("[ ⏳ AI Tip: Extended. Waiting for pullback to 20-SMA");
    expect(actionCenterSrc).toContain("[ ⚡ AI Tip: Pullback Testing Support!");

    // High contrast pill styling
    expect(actionCenterSrc).toContain("bg-slate-900 border border-slate-700 text-slate-300 text-xs font-mono px-3 py-1.5 rounded-lg flex items-center gap-2");
  });

  it("Task 4: Zone 3 (Watchlist Manager) consolidates to Single Master Chart", () => {
    expect(actionCenterSrc).toContain('data-testid="section-watchlist-and-chart"');
    expect(actionCenterSrc).toContain('Watchlist Manager');
    expect(actionCenterSrc).toContain('data-testid="input-watchlist-ticker"');
    expect(actionCenterSrc).toContain('placeholder="Search/Add Symbol... [ + ]"');
    expect(actionCenterSrc).toContain('data-testid="button-add-watchlist-ticker"');
    expect(actionCenterSrc).toContain('data-testid="watchlist-items-list"');

    // Clicking ticker binds directly to global.setActiveTicker
    expect(actionCenterSrc).toContain("global?.setActiveTicker?.(sym)");
  });
});
