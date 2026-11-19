import React, { Suspense, lazy } from "react";
import { useWakeRefresh, WakeSyncLoader } from "@/lib/wakeRefresh";
import { Switch, Route, Router, useLocation } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { AnimatePresence, motion } from "framer-motion";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { AppShell } from "@/components/AppShell";
import PipelineCockpit from "@/pages/PipelineCockpit";
import ErrorBoundary from "@/components/ErrorBoundary";
import AppErrorBoundary from "@/components/AppErrorBoundary";
import SkeletonDashboardLoader from "@/components/SkeletonDashboardLoader";

// Code-split heavy views so initial Cockpit load downloads minimal JS
const WealthEngineDashboard = lazy(() => import("@/pages/WealthEngineDashboard"));
const Cockpit = lazy(() => import("@/pages/Cockpit"));
const LegacyPipelineArchive = lazy(() => import("@/pages/LegacyPipelineArchive"));
const Watchlist = lazy(() => import("@/pages/Watchlist"));
const Trades = lazy(() => import("@/pages/Trades"));
const Journal = lazy(() => import("@/pages/Journal"));
const LeapLadder = lazy(() => import("@/pages/LeapLadder"));
const Analytics = lazy(() => import("@/pages/Analytics"));
const SettingsPage = lazy(() => import("@/pages/Settings"));
const SpecReview = lazy(() => import("@/pages/SpecReview"));
const SignalHistoryPage = lazy(() => import("@/pages/SignalHistory"));
const TradePlanner = lazy(() => import("@/pages/TradePlanner"));
const TradeDetail = lazy(() => import("@/pages/TradeDetail"));
const TagsPage = lazy(() => import("@/pages/TagsPage"));

function WealthStudioRoute() {
  return (
    <AppErrorBoundary moduleName="WealthStudio" fullPage>
      <WealthEngineDashboard />
    </AppErrorBoundary>
  );
}

function CockpitRoute() {
  return (
    <AppErrorBoundary moduleName="Cockpit" fullPage>
      <Cockpit />
    </AppErrorBoundary>
  );
}

function PipelineCockpitRoute() {
  return (
    <AppErrorBoundary moduleName="Cockpit">
      <PipelineCockpit />
    </AppErrorBoundary>
  );
}

function WatchlistRoute() {
  return (
    <AppErrorBoundary moduleName="Watchlist">
      <Watchlist />
    </AppErrorBoundary>
  );
}

function TradesRoute() {
  return (
    <AppErrorBoundary moduleName="Trades">
      <Trades />
    </AppErrorBoundary>
  );
}

function AppRouter() {
  const [location] = useLocation();

  if (typeof window !== "undefined") {
    console.log("[Boot:AppRouter] Initializing route navigation, current hash:", window.location.hash || "#/");
  }
  return (
    <AppShell>
      <AnimatePresence mode="wait">
        <motion.div
          key={location}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          className="w-full h-full"
          data-testid="route-transition-container"
        >
          <ErrorBoundary
            label="Main Route Navigation"
            fullPage={false}
            fallback={(err, reset) => (
              <div className="w-full min-h-[60vh] flex flex-col items-center justify-center p-6 text-center font-mono" data-testid="route-crash-recovery">
                <div className="p-6 rounded-2xl border border-amber-500/50 bg-[#0B101D] text-white shadow-2xl max-w-lg flex flex-col items-center gap-4">
                  <span className="text-amber-400 font-bold text-sm tracking-wider uppercase">[ ⚠️ UI Crash Recovered - Reloading Module ]</span>
                  <p className="text-xs text-slate-300">Navigation state was safely caught. Click below to resume your trading session.</p>
                  <button
                    onClick={() => { reset(); window.location.hash = "#/"; }}
                    className="px-4 py-2 rounded-lg bg-cyan-500/20 border border-cyan-400 text-cyan-300 hover:bg-cyan-500/30 font-mono text-xs uppercase font-bold cursor-pointer transition-colors"
                  >
                    [ ↻ Reload Dashboard ]
                  </button>
                </div>
              </div>
            )}
          >
            <Suspense fallback={<SkeletonDashboardLoader />}>
              <Switch>
                <Route path="/" component={PipelineCockpitRoute} />
                <Route path="/cockpit" component={PipelineCockpitRoute} />
                <Route path="/pipeline" component={PipelineCockpitRoute} />
                <Route path="/engine" component={WealthStudioRoute} />
                <Route path="/dashboard" component={WealthStudioRoute} />
                <Route path="/advanced" component={CockpitRoute} />
                <Route path="/archive/pipeline" component={LegacyPipelineArchive} />
                <Route path="/watchlist" component={WatchlistRoute} />
                <Route path="/trades" component={TradesRoute} />
                <Route path="/trade-planner" component={TradePlanner} />
                <Route path="/trade/:id" component={TradeDetail} />
                <Route path="/tags" component={TagsPage} />
                <Route path="/journal" component={Journal} />
                <Route path="/leap" component={LeapLadder} />
                <Route path="/analytics" component={Analytics} />
                <Route path="/signals" component={SignalHistoryPage} />
                <Route path="/settings" component={SettingsPage} />
                <Route path="/spec" component={SpecReview} />
                <Route component={NotFound} />
              </Switch>
            </Suspense>
          </ErrorBoundary>
        </motion.div>
      </AnimatePresence>
    </AppShell>
  );
}

function WakeSyncRoot() {
  useWakeRefresh();
  return <WakeSyncLoader />;
}

import { useEffect } from "react";
import { GlobalStateProvider } from "@/lib/globalState";
import { purgeStaleLocalStorageOnBoot } from "@/lib/useMarketDataStore";
import { UniversalTradeModal } from "@/components/UniversalTradeModal";
import { useMarketDataPipeline } from "@/hooks/useMarketDataPipeline";
import { TerminalThemeProvider } from "@/lib/terminalTheme";

function MarketDataPipelineRoot() {
  useMarketDataPipeline();
  return null;
}

function App() {
  useEffect(() => {
    purgeStaleLocalStorageOnBoot();
  }, []);

  if (typeof window !== "undefined") {
    console.log("[Boot:App] Mounting Chizzle Cockpit root application container");
  }
  return (
    <AppErrorBoundary moduleName="ApplicationRoot" fullPage>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <TerminalThemeProvider>
            <GlobalStateProvider>
              <Toaster />
              <WakeSyncRoot />
              <MarketDataPipelineRoot />
              <UniversalTradeModal />
              <Router hook={useHashLocation}>
                <AppRouter />
              </Router>
            </GlobalStateProvider>
          </TerminalThemeProvider>
        </TooltipProvider>
      </QueryClientProvider>
    </AppErrorBoundary>
  );
}

export default App;
