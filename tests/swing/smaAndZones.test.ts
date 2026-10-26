import { describe, it, expect } from "vitest";
process.env.DATABASE_URL ||= "postgres://x:y@127.0.0.1:1/none";
import { DEFAULT_SMA_COLORS, DEFAULT_SMA_WIDTHS, SMA_META } from "../../client/src/components/swing/SwingChart";
import { DEFAULT_SPARK_SMA_COLORS } from "../../client/src/components/swing/TradingCard";

describe("Chart Upgrades — SMA Visibility, S/R Shading Removal & Line Thickness", () => {
  it("DEFAULT_SMA_WIDTHS defaults to 2px for SMA 20, 50, and 200", () => {
    expect(DEFAULT_SMA_WIDTHS.sma20).toBe(2);
    expect(DEFAULT_SMA_WIDTHS.sma50).toBe(2);
    expect(DEFAULT_SMA_WIDTHS.sma200).toBe(2);
  });

  it("DEFAULT_SMA_COLORS matches the terminal neon theme", () => {
    expect(DEFAULT_SMA_COLORS.sma20).toBe("#22D3EE");
    expect(DEFAULT_SMA_COLORS.sma50).toBe("#F43F5E");
    expect(DEFAULT_SMA_COLORS.sma200).toBe("#FFD700");
  });

  it("Sparkline chart defaults align with SwingChart theme", () => {
    expect(DEFAULT_SPARK_SMA_COLORS.sma20).toBe("#22D3EE");
    expect(DEFAULT_SPARK_SMA_COLORS.sma50).toBe("#F43F5E");
    expect(DEFAULT_SPARK_SMA_COLORS.sma200).toBe("#FFD700");
  });

  it("SMA_META contains 20, 50, and 200 period configurations", () => {
    const periods = SMA_META.map((m) => m.n);
    expect(periods).toEqual([20, 50, 200]);
  });
});
