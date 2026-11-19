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
  useLocation();

  return (
    <AppShell>
      <div className="w-full h-full" data-testid="route-transition-container">
        <AppErrorBoundary moduleName="MainRouteNavigation">
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
        </AppErrorBoundary>
      </div>
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
import { MarketDataProvider } from "@/services/MarketDataEngine";
import { TerminalThemeProvider } from "@/lib/terminalTheme";

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
              <MarketDataProvider>
                <Toaster />
                <WakeSyncRoot />
                <UniversalTradeModal />
                <Router hook={useHashLocation}>
                  <AppRouter />
                </Router>
              </MarketDataProvider>
            </GlobalStateProvider>
          </TerminalThemeProvider>
        </TooltipProvider>
      </QueryClientProvider>
    </AppErrorBoundary>
  );
}

export default App;
