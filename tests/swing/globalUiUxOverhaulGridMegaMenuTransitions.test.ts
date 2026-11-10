import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const appPath = path.resolve(__dirname, "../../client/src/App.tsx");
const appShellPath = path.resolve(__dirname, "../../client/src/components/AppShell.tsx");
const megaMenuPath = path.resolve(__dirname, "../../client/src/components/MegaMenu.tsx");
const actionCenterPath = path.resolve(__dirname, "../../client/src/components/swing/ActionCenter.tsx");
const tradingCardPath = path.resolve(__dirname, "../../client/src/components/swing/TradingCard.tsx");

describe("Global UI/UX Overhaul: Spatial Grid, Mega Menus & Animated Transitions", () => {
  const appSrc = fs.readFileSync(appPath, "utf-8").replace(/\r\n/g, "\n");
  const appShellSrc = fs.readFileSync(appShellPath, "utf-8").replace(/\r\n/g, "\n");
  const megaMenuSrc = fs.readFileSync(megaMenuPath, "utf-8").replace(/\r\n/g, "\n");
  const actionCenterSrc = fs.readFileSync(actionCenterPath, "utf-8").replace(/\r\n/g, "\n");
  const tradingCardSrc = fs.readFileSync(tradingCardPath, "utf-8").replace(/\r\n/g, "\n");

  describe("1. Spatial Grid & Active Execution Hierarchy", () => {
    it("configures responsive 4-column auto-fitting CSS Grid layout for dashboard cards", () => {
      expect(actionCenterSrc).toContain('data-testid="ac-cards-grid"');
      expect(actionCenterSrc).toContain("grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4");
      expect(actionCenterSrc).toContain("gap-4 items-start w-full");
    });

    it("forces unconfirmed and waiting setup cards into compact/mini state by default, hiding charts & math", () => {
      // TradingCard defaults isExpanded to false
      expect(tradingCardSrc).toContain("const [isExpanded, setIsExpanded] = useState(false);");
      // ScaleOutRLadder and MiniChart are nested inside isExpanded
      const isExpandedBlockIdx = tradingCardSrc.indexOf("{isExpanded && (");
      const ladderIdx = tradingCardSrc.indexOf("<ScaleOutRLadder");
      expect(isExpandedBlockIdx).toBeGreaterThan(0);
      expect(ladderIdx).toBeGreaterThan(isExpandedBlockIdx);
    });

    it("maps confirmed trades to dedicated, visually distinct top row spanning full width of the grid", () => {
      expect(actionCenterSrc).toContain('data-testid="active-execution-zone"');
      expect(actionCenterSrc).toContain("w-full col-span-full");
      expect(actionCenterSrc).toContain("border-2 border-emerald-500/80 bg-emerald-950/30");
      expect(actionCenterSrc).toContain("[ ACTIVE EXECUTION ZONE - CONFIRMED TRADES ]");
    });

    it("sorts grid data array with top-rated priority routing for confirmed and ready setups", () => {
      expect(actionCenterSrc).toContain("const sortedGeneralLoud = useMemo(");
      expect(actionCenterSrc).toContain("aConfirmed = (a as any).isTradeConfirmed || isConfirmedSetup(a)");
      expect(actionCenterSrc).toContain("aReady = a.setupStatus === \"READY_TO_TRADE\"");
    });
  });

  describe("2. Navigation Architecture (Header & Footer Routing)", () => {
    it("houses daily essentials in the top navbar: Dashboard, Wealth Studio, Live Scanner, and Theme Switcher", () => {
      expect(appShellSrc).toContain('data-testid="header-essential-nav"');
      expect(appShellSrc).toContain('data-testid="nav-header-dashboard"');
      expect(appShellSrc).toContain('data-testid="nav-header-wealth-studio"');
      expect(appShellSrc).toContain('data-testid="nav-header-live-scanner"');
      expect(appShellSrc).toContain("<ThemeSwitcher />");
    });

    it("integrates interactive Mega-Menu dropdown with multi-column panel in header", () => {
      expect(appShellSrc).toContain("<MegaMenu />");
      expect(megaMenuSrc).toContain('data-testid="button-mega-menu-trigger"');
      expect(megaMenuSrc).toContain('data-testid="header-mega-menu-panel"');
      expect(megaMenuSrc).toContain("grid grid-cols-1 md:grid-cols-3 gap-6");
      expect(megaMenuSrc).toContain("Screener Criteria");
      expect(megaMenuSrc).toContain("Strategy Parameters");
      expect(megaMenuSrc).toContain("Routing & Accounts");
    });

    it("renders sleek dark-themed global footer with secondary low-frequency tools", () => {
      expect(appShellSrc).toContain('data-testid="global-footer"');
      expect(appShellSrc).toContain('data-testid="footer-link-api-connections"');
      expect(appShellSrc).toContain('data-testid="footer-link-broker-settings"');
      expect(appShellSrc).toContain('data-testid="footer-link-trade-journal"');
      expect(appShellSrc).toContain('data-testid="footer-link-account-management"');
      expect(appShellSrc).toContain('data-testid="footer-link-system-logs"');
    });
  });

  describe("3. Smooth Page Transitions & Micro-Interactions", () => {
    it("wraps page router views in Framer Motion subtle fade-in and slide-up transition", () => {
      expect(appSrc).toContain("<AnimatePresence mode=\"wait\">");
      expect(appSrc).toContain('data-testid="route-transition-container"');
      expect(appSrc).toContain("initial={{ opacity: 0, y: 10 }}");
      expect(appSrc).toContain("animate={{ opacity: 1, y: 0 }}");
      expect(appSrc).toContain("exit={{ opacity: 0, y: -10 }}");
      expect(appSrc).toContain('transition={{ duration: 0.2, ease: "easeOut" }}');
    });

    it("animates card mounting when docking into Execution Zone and entering grid", () => {
      // In ActionCenter, cards are wrapped with motion.div entrance transitions
      expect(actionCenterSrc).toContain("import { motion } from \"framer-motion\";");
      expect(actionCenterSrc).toMatch(/<motion\.div[^>]*key=\{`hero-\$\{trade\.symbol\}`\}[^>]*initial=\{\{ opacity: 0, y: -10 \}\}/);
      expect(actionCenterSrc).toMatch(/<motion\.div[^>]*key=\{d\.symbol\}[^>]*initial=\{\{ opacity: 0, y: 10 \}\}/);
    });

    it("enforces fluid CSS transitions (transition-all duration-200) on buttons and navigation items", () => {
      expect(megaMenuSrc).toContain("transition-all duration-200");
      expect(appShellSrc).toContain("transition-all duration-200");
    });
  });
});
