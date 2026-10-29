import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { CYBER_THEMES } from "@/components/swing/ActionCenter";

const actionCenterPath = path.resolve(__dirname, "../../client/src/components/swing/ActionCenter.tsx");
const aiEnginePath = path.resolve(__dirname, "../../client/src/components/swing/AIExecutionEngine.tsx");
const tradingCardPath = path.resolve(__dirname, "../../client/src/components/swing/TradingCard.tsx");
const indexCssPath = path.resolve(__dirname, "../../client/src/index.css");

describe("Theme Expansion, Action Center Routing, AI Context Panel, and Layout Optimization", () => {
  const actionCenterSrc = fs.readFileSync(actionCenterPath, "utf-8").replace(/\r\n/g, "\n");
  const aiEngineSrc = fs.readFileSync(aiEnginePath, "utf-8").replace(/\r\n/g, "\n");
  const tradingCardSrc = fs.readFileSync(tradingCardPath, "utf-8").replace(/\r\n/g, "\n");
  const indexCssSrc = fs.readFileSync(indexCssPath, "utf-8").replace(/\r\n/g, "\n");

  describe("1. Theme Engine Expansion (6 New Modern Palettes)", () => {
    it("expands CYBER_THEMES to include 9 distinct themes (3 original + 6 new modern palettes)", () => {
      const ids = CYBER_THEMES.map((t) => t.id);
      expect(ids).toEqual([
        "cyber-neon",
        "midnight-ocean",
        "stealth",
        "bloomberg-classic",
        "solarized-dark",
        "nord",
        "dracula",
        "high-contrast-light",
        "monochrome-slate",
      ]);
    });

    it("verifies Bloomberg Classic theme specifications", () => {
      const t = CYBER_THEMES.find((x) => x.id === "bloomberg-classic")!;
      expect(t).toBeDefined();
      expect(t.name).toBe("Bloomberg Classic");
      expect(t.badgeLabel).toBe("TERMINAL");
      expect(t.description).toContain("#000000");
      expect(t.containerBg).toContain("bg-black");
      expect(t.accentText).toContain("text-amber-400");
    });

    it("verifies Solarized Dark theme specifications", () => {
      const t = CYBER_THEMES.find((x) => x.id === "solarized-dark")!;
      expect(t).toBeDefined();
      expect(t.name).toBe("Solarized Dark");
      expect(t.badgeLabel).toBe("SOLAR");
      expect(t.description).toContain("#002b36");
      expect(t.containerBg).toContain("#002b36");
      expect(t.accentText).toContain("text-[#2aa198]");
    });

    it("verifies Nord Aesthetic theme specifications", () => {
      const t = CYBER_THEMES.find((x) => x.id === "nord")!;
      expect(t).toBeDefined();
      expect(t.name).toBe("Nord Aesthetic");
      expect(t.badgeLabel).toBe("NORD");
      expect(t.description).toContain("#2E3440");
      expect(t.containerBg).toContain("#2E3440");
      expect(t.previewGradient).toContain("#88C0D0");
    });

    it("verifies Dracula theme specifications", () => {
      const t = CYBER_THEMES.find((x) => x.id === "dracula")!;
      expect(t).toBeDefined();
      expect(t.name).toBe("Dracula");
      expect(t.badgeLabel).toBe("VAMP");
      expect(t.description).toContain("#282a36");
      expect(t.containerBg).toContain("#282a36");
      expect(t.previewGradient).toContain("#ff79c6");
    });

    it("verifies High-Contrast Light theme specifications", () => {
      const t = CYBER_THEMES.find((x) => x.id === "high-contrast-light")!;
      expect(t).toBeDefined();
      expect(t.name).toBe("High-Contrast Light");
      expect(t.badgeLabel).toBe("DAYLIGHT");
      expect(t.containerBg).toContain("bg-white");
      expect(t.accentText).toContain("text-blue-600");
    });

    it("verifies Monochrome Slate theme specifications", () => {
      const t = CYBER_THEMES.find((x) => x.id === "monochrome-slate")!;
      expect(t).toBeDefined();
      expect(t.name).toBe("Monochrome Slate");
      expect(t.badgeLabel).toBe("SLATE");
      expect(t.containerBorder).toContain("border-slate-700");
    });

    it("includes CSS variable mappings in index.css for all 6 new themes", () => {
      expect(indexCssSrc).toContain('[data-cyber-theme="bloomberg-classic"]');
      expect(indexCssSrc).toContain('[data-cyber-theme="solarized-dark"]');
      expect(indexCssSrc).toContain('[data-cyber-theme="nord"]');
      expect(indexCssSrc).toContain('[data-cyber-theme="dracula"]');
      expect(indexCssSrc).toContain('[data-cyber-theme="high-contrast-light"]');
      expect(indexCssSrc).toContain('[data-cyber-theme="monochrome-slate"]');
    });

    it("renders horizontal pill buttons inside CyberThemeSwitcher", () => {
      expect(actionCenterSrc).toContain('data-testid="theme-switcher-deck"');
      expect(actionCenterSrc).toContain("data-testid={`button-theme-${t.id}`}");
    });
  });

  describe("2. Action Center Routing (The 'Confirmed' Top Row)", () => {
    it("renders the dedicated visual row labeled [ ACTIVE EXECUTION ZONE - CONFIRMED TRADES ]", () => {
      expect(actionCenterSrc).toContain('data-testid="active-execution-zone"');
      expect(actionCenterSrc).toContain("[ ACTIVE EXECUTION ZONE - CONFIRMED TRADES ]");
    });

    it("applies visually dominant glowing green styling to active execution cards", () => {
      expect(actionCenterSrc).toContain("border-2 border-emerald-500 bg-emerald-950/40");
      expect(actionCenterSrc).toContain("shadow-[0_0_15px_rgba(16,185,129,0.5)]");
      expect(actionCenterSrc).toContain('data-testid={`active-execution-card-${d.symbol}`}');
    });

    it("enforces lifecycle state routing: confirmed cards unmount from general board and decks", () => {
      // isConfirmedSetup detection
      expect(actionCenterSrc).toContain("const isConfirmedSetup = (d: SwingDecision)");
      expect(actionCenterSrc).toContain('actionGroupOf(d) === "CONFIRMED"');
      expect(actionCenterSrc).toContain('(d as any).setupStatus === "SETUP_CONFIRMED"');
      expect(actionCenterSrc).toContain("Boolean(global?.confirmedSetups?.[d.symbol])");

      // Segregation of rows
      expect(actionCenterSrc).toContain("const confirmedRows = rows.filter(isConfirmedSetup);");
      expect(actionCenterSrc).toContain("const confirmedSymSet = new Set(confirmedRows.map((d) => d.symbol));");
      expect(actionCenterSrc).toContain("const generalPriorityRows = rows.filter((d) => !confirmedSymSet.has(d.symbol));");
      expect(actionCenterSrc).toContain("const generalLoud = loud.filter((d) => !confirmedSymSet.has(d.symbol));");

      // General PriorityBoard and general card grid use segregated arrays
      expect(actionCenterSrc).toContain("<PriorityBoard rows={generalPriorityRows}");
      expect(actionCenterSrc).toContain("{generalLoud.map((d) => {");
    });
  });

  describe("3. Dedicated AI Context Sidebar (Step-by-Step Execution)", () => {
    it("renders dedicated AI Context Sidebar container with data-testid='ai-context-sidebar-${d.symbol}'", () => {
      expect(actionCenterSrc).toContain('data-testid={`ai-context-sidebar-${d.symbol}`}');
      expect(aiEngineSrc).toContain("AI Execution Engine");
    });

    it("renders execution Steps 1 through 4 formatted as requested", () => {
      expect(aiEngineSrc).toContain("Step 1:");
      expect(aiEngineSrc).toContain("1H Candle Confirmed ✅");

      expect(aiEngineSrc).toContain("Step 2:");
      expect(aiEngineSrc).toContain("Place Limit Buy at");

      expect(aiEngineSrc).toContain("Step 3:");
      expect(aiEngineSrc).toContain("Set Hard Stop at");
      expect(aiEngineSrc).toContain("(-1R)");

      expect(aiEngineSrc).toContain("Step 4:");
      expect(aiEngineSrc).toContain("Once filled, queue OCO Target 1 at");
      expect(aiEngineSrc).toContain("(+1.5R)");
    });

    it("renders massive pulsing [ ARM TRADE ] execution button", () => {
      expect(aiEngineSrc).toContain('data-testid={`button-massive-arm-${d.symbol}`}');
      expect(aiEngineSrc).toContain("[ ARM TRADE ]");
      expect(aiEngineSrc).toContain("animate-pulse");
      expect(aiEngineSrc).toContain("bg-emerald-500 hover:bg-emerald-400");
    });

    it("wires direct execution routing to tradeApi.arm, tradeApi.fill, and state clearance", () => {
      expect(actionCenterSrc).toContain("handleDirectArmExecute");
      expect(actionCenterSrc).toContain("tradeApi.arm");
      expect(actionCenterSrc).toContain("tradeApi.fill");
      expect(actionCenterSrc).toContain("invalidateTrades()");
    });
  });

  describe("4. Typography & Spatial Layout Optimization", () => {
    it("uses compact vertical padding and gaps to prevent excessive scrolling", () => {
      expect(actionCenterSrc).toContain("p-3 sm:p-4");
      expect(actionCenterSrc).toContain("gap-3.5");
      expect(actionCenterSrc).toContain("gap-3.5 sm:gap-4");
    });

    it("configures grid to fit 3 to 4 cards cleanly across a 1080p monitor without awkward line breaks", () => {
      expect(actionCenterSrc).toContain('"grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"');
    });

    it("enhances typography font size and weight on prices and targets in PriceTile and TradingCard", () => {
      expect(tradingCardSrc).toContain("text-xl sm:text-2xl font-mono font-black tabular-nums text-soft-white tracking-tight");
      expect(tradingCardSrc).toContain("text-sm sm:text-base font-mono font-extrabold tabular-nums text-neon-blue");
      expect(tradingCardSrc).toContain('font-extrabold text-sm truncate">{targetRMultiple}R');
    });
  });
});

