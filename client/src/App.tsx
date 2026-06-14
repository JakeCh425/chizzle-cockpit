import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { AppShell } from "@/components/AppShell";
import Cockpit from "@/pages/Cockpit";
import Watchlist from "@/pages/Watchlist";
import Trades from "@/pages/Trades";
import Journal from "@/pages/Journal";
import LeapLadder from "@/pages/LeapLadder";
import Analytics from "@/pages/Analytics";
import SettingsPage from "@/pages/Settings";
import SpecReview from "@/pages/SpecReview";
import SignalHistoryPage from "@/pages/SignalHistory";
import TradePlanner from "@/pages/TradePlanner";

function AppRouter() {
  return (
    <AppShell>
      <Switch>
        <Route path="/" component={Cockpit} />
        <Route path="/watchlist" component={Watchlist} />
        <Route path="/trades" component={Trades} />
        <Route path="/trade-planner" component={TradePlanner} />
        <Route path="/journal" component={Journal} />
        <Route path="/leap" component={LeapLadder} />
        <Route path="/analytics" component={Analytics} />
        <Route path="/signals" component={SignalHistoryPage} />
        <Route path="/settings" component={SettingsPage} />
        <Route path="/spec" component={SpecReview} />
        <Route component={NotFound} />
      </Switch>
    </AppShell>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router hook={useHashLocation}>
          <AppRouter />
        </Router>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
