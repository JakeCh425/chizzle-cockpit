import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

describe("ActionCenter Institutional Color Palette, Scaled Typography & Live Timestamps", () => {
  const acPath = path.resolve(__dirname, "../../client/src/components/swing/ActionCenter.tsx");
  const content = fs.readFileSync(acPath, "utf-8");

  it("Task 1: Enforces professional modern institutional dark mode palette", () => {
    // Surface backgrounds & borders
    expect(content).toContain("bg-slate-900");
    expect(content).toContain("bg-slate-800");
    expect(content).toContain("border-slate-700");

    // Crisp high-contrast primary text and muted secondary labels
    expect(content).toContain("text-white");
    expect(content).toContain("text-slate-400");

    // Semantic accents for Ready/Success and Pending/Waiting
    expect(content).toContain("text-emerald-400");
    expect(content).toContain("bg-emerald-400/10");
    expect(content).toContain("text-amber-400");
    expect(content).toContain("bg-amber-400/10");
  });

  it("Task 2: Scales typography, metrics, and action buttons", () => {
    // Numerical data uses font-mono tabular-nums text-base or text-lg
    expect(content).toContain("tabular-nums");
    expect(content).toContain("font-mono");
    expect(content).toContain("text-base sm:text-lg");

    // Arm trade button scaled to px-4 py-2.5 rounded-md
    expect(content).toContain("px-4 py-2.5 rounded-md font-mono font-bold text-sm");
  });

  it("Task 3: Live ticker sync and pulsing 'Last Updated' CT timestamps", () => {
    // Dynamic timestamp state hook and Chicago formatter
    expect(content).toContain("tickerUpdateTimes");
    expect(content).toContain("prevFeedValues");
    expect(content).toContain("formatTimeCT");
    expect(content).toContain("getTickerTimestamp");

    // Pulsing emerald indicator dot
    expect(content).toContain("w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse");

    // Ready zone timestamp testid and formatting
    expect(content).toContain('data-testid={`ready-card-timestamp-${d.symbol}`}');
    expect(content).toContain("Updated {formattedLastUpdated} CT");

    // Waiting zone timestamp testid and formatting
    expect(content).toContain('data-testid={`waiting-row-timestamp-${d.symbol}`}');
    expect(content).toContain("Updated {rowTimestamp} CT");
  });
});
