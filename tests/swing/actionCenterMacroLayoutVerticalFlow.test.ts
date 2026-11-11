import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const rootDir = path.resolve(__dirname, "../..");
const actionCenterPath = path.resolve(rootDir, "client/src/components/swing/ActionCenter.tsx");

describe("Action Center Macro-Layout Vertical Flow (Full-Width Top-to-Bottom)", () => {
  const actionCenterSrc = fs.readFileSync(actionCenterPath, "utf-8").replace(/\r\n/g, "\n");

  it("Task 1: Removes sidebar split layout (no lg:grid-cols-12) and uses full-width vertical container", () => {
    expect(actionCenterSrc).not.toContain("grid grid-cols-1 lg:grid-cols-12");
    expect(actionCenterSrc).toContain('id="ac-body" className="flex flex-col gap-8 w-full max-w-[1600px] mx-auto"');
  });

  it("Task 2: Zone 1 (Ready to Execute) is placed at the top in a responsive grid", () => {
    const readyZoneIdx = actionCenterSrc.indexOf('data-testid="active-execution-zone"');
    const pendingZoneIdx = actionCenterSrc.indexOf('data-testid="zone-pending-waiting"');
    const watchlistZoneIdx = actionCenterSrc.indexOf('data-testid="section-watchlist-and-chart"');

    // Strict vertical flow order: Zone 1 (Top) < Zone 2 (Middle) < Zone 3 (Bottom)
    expect(readyZoneIdx).toBeGreaterThan(0);
    expect(pendingZoneIdx).toBeGreaterThan(readyZoneIdx);
    expect(watchlistZoneIdx).toBeGreaterThan(pendingZoneIdx);

    // Responsive grid
    expect(actionCenterSrc).toContain("grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3");
    expect(actionCenterSrc).toContain('data-testid="ready-cards-grid"');

    // Strict filtering logic
    expect(actionCenterSrc).toContain('d.setupStatus === "READY_TO_TRADE" && !d.isStandbyDay && !d.hasHardBlock');
  });

  it("Task 3: Zone 2 (Pending & Waiting) renders ultra-compact single-line rows in the middle", () => {
    expect(actionCenterSrc).toContain('data-testid="zone-pending-waiting"');
    expect(actionCenterSrc).toContain('data-testid="waiting-room-rows"');
    expect(actionCenterSrc).toContain('data-testid={`waiting-row-${d.symbol}`}');
  });

  it("Task 4: Zone 3 (Watchlist & Universal Chart) is placed at the bottom with 1-col Watchlist and 2-col Chart", () => {
    expect(actionCenterSrc).toContain('grid grid-cols-1 lg:grid-cols-3 gap-6');
    expect(actionCenterSrc).toContain('lg:col-span-1 bg-[#101827]');
    expect(actionCenterSrc).toContain('lg:col-span-2 bg-[#101827]');
    expect(actionCenterSrc).toContain('data-testid="section-watchlist-and-chart"');
    expect(actionCenterSrc).toContain('data-testid="section-watchlist-chart"');
    expect(actionCenterSrc).toContain('data-testid="input-watchlist-ticker"');
    expect(actionCenterSrc).toContain('data-testid="button-add-watchlist-ticker"');
  });
});
