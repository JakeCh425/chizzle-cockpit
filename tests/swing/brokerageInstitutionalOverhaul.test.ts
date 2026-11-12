import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

describe("Institutional Brokerage Platform Overhaul & Quick Actions", () => {
  const rootDir = path.resolve(__dirname, "../../");
  const acPath = path.resolve(rootDir, "client/src/components/swing/ActionCenter.tsx");
  const wsPath = path.resolve(rootDir, "client/src/components/CockpitWorkspace.tsx");
  const scannerPath = path.resolve(rootDir, "client/src/components/swing/SwingScanner.tsx");
  const swingWsPath = path.resolve(rootDir, "client/src/components/swing/SwingWorkspace.tsx");
  const appShellPath = path.resolve(rootDir, "client/src/components/AppShell.tsx");
  const collapsiblePath = path.resolve(rootDir, "client/src/components/CollapsibleSection.tsx");

  const acSrc = fs.readFileSync(acPath, "utf-8");
  const wsSrc = fs.readFileSync(wsPath, "utf-8");
  const scannerSrc = fs.readFileSync(scannerPath, "utf-8");
  const swingWsSrc = fs.readFileSync(swingWsPath, "utf-8");
  const appShellSrc = fs.readFileSync(appShellPath, "utf-8");
  const collapsibleSrc = fs.readFileSync(collapsiblePath, "utf-8");

  it("Task 1: Enforces Institutional Typography & Header Hierarchy", () => {
    // ActionCenter main title upgraded to true page header
    expect(acSrc).toContain("text-2xl font-extrabold tracking-tight text-white uppercase");

    // SwingScanner header upgraded to true page header
    expect(scannerSrc).toContain("text-2xl font-extrabold tracking-tight text-white uppercase");
    expect(scannerSrc).toContain("SWING SCANNER");

    // CollapsibleSection sub-headers and secondary labels
    expect(collapsibleSrc).toContain("text-sm font-semibold text-white uppercase tracking-wider");
    expect(collapsibleSrc).toContain("text-xs font-semibold text-slate-300 uppercase tracking-wider");

    // Top Navigation links scaled with distinct border-b border-slate-700
    expect(appShellSrc).toContain("border-b border-slate-700");
    expect(appShellSrc).toContain("text-sm font-mono font-bold uppercase tracking-wider");
    expect(appShellSrc).toContain("Dashboard");
    expect(appShellSrc).toContain("Wealth Studio");
    expect(appShellSrc).toContain("Live Scanner");
  });

  it("Task 2: Enforces High-Contrast Palette & Solid Filter Pills", () => {
    // High-contrast dark surfaces
    expect(appShellSrc).toContain("bg-[#0B1220]");
    expect(acSrc).toContain("bg-[#0B1220]");
    expect(acSrc).toContain("bg-[#151E2E]");
    expect(wsSrc).toContain("bg-[#0B1220]");
    expect(collapsibleSrc).toContain("bg-[#151E2E]");
    expect(scannerSrc).toContain("bg-[#151E2E]");

    // Solid highly visible pill filter buttons
    expect(acSrc).toContain("bg-slate-800 text-slate-200 px-4 py-2 rounded-md shadow-sm");

    // High-contrast warning banner for no fresh setups
    expect(acSrc).toContain("bg-amber-500/20 border border-amber-500/50 text-amber-200");
    expect(acSrc).toContain("[ ⚠️ NO FRESH SETUPS RIGHT NOW ]");
  });

  it("Task 3: Swing Scanner Quick Actions & Row Layout", () => {
    // Row layout: flex justify-between items-center group
    expect(scannerSrc).toContain("flex justify-between items-center group");
    expect(swingWsSrc).toContain("flex justify-between items-center group");

    // Numerical data in scanner: font-mono tabular-nums text-base font-bold text-white
    expect(scannerSrc).toContain("font-mono tabular-nums text-base font-bold text-white");

    // Quick Manage Actions with Plus [+] and Trash [x]
    expect(scannerSrc).toContain("button-quick-add-");
    expect(scannerSrc).toContain("button-quick-remove-");
    expect(scannerSrc).toContain("text-slate-500 hover:text-white transition-colors cursor-pointer");
    expect(swingWsSrc).toContain("text-slate-500 hover:text-white transition-colors cursor-pointer");
  });

  it("Task 4: Grouped System Status & Action Center Toolbar Row", () => {
    // Toolbar mounted right below main header with bg-[#1E293B] border border-slate-700 p-3 rounded-lg
    expect(acSrc).toContain('data-testid="cockpit-grid-toolbar"');
    expect(acSrc).toContain("bg-[#1E293B] border border-slate-700 p-3 rounded-lg shadow-sm");

    // System Status indicators grouped inside toolbar
    expect(acSrc).toContain("SYSTEM STATUS");
    expect(acSrc).toContain('data-testid="status-console-websocket"');
    expect(acSrc).toContain('data-testid="status-console-latency"');
    expect(acSrc).toContain('data-testid="status-console-market-state"');

    // Right-aligned STATIC: LAST CLOSE button and theme switchers
    expect(acSrc).toContain('data-testid="status-console-static-last-close"');
    expect(acSrc).toContain("<CardThemeSwitcher />");
    expect(acSrc).toContain('data-testid="grid-size-toggle"');
  });
});
