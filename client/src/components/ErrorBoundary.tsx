// ─────────────────────────────────────────────────────────────────────────────
// ErrorBoundary.tsx
// Generic class-based error boundary. Catches rendering exceptions, preventing
// blank/black screens, and displays detailed error info and stack traces with recovery actions.
// ─────────────────────────────────────────────────────────────────────────────

import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RefreshCw, Home, Trash2 } from "lucide-react";

interface Props {
  children: ReactNode;
  /** Optional label shown in the fallback header (e.g. "Wealth Studio"). */
  label?: string;
  /** If true, renders a full-page styled diagnostic error screen */
  fullPage?: boolean;
  /** Custom fallback renderer overrides the default. */
  fallback?: (err: Error, reset: () => void) => ReactNode;
}

interface State {
  err: Error | null;
  info: ErrorInfo | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { err: null, info: null };

  static getDerivedStateFromError(err: Error): Partial<State> {
    return { err };
  }

  componentDidCatch(err: Error, info: ErrorInfo) {
    this.setState({ info });
    if (typeof console !== "undefined") {
      console.error(`[ErrorBoundary${this.props.label ? `:${this.props.label}` : ""}] Fatal error:`, err, info.componentStack);
    }
  }

  reset = () => this.setState({ err: null, info: null });

  handleReload = () => {
    if (typeof window !== "undefined") {
      window.location.reload();
    }
  };

  handleResetStorage = () => {
    if (typeof window !== "undefined") {
      try {
        localStorage.clear();
        sessionStorage.clear();
      } catch {}
      window.location.reload();
    }
  };

  handleGoHome = () => {
    if (typeof window !== "undefined") {
      window.location.hash = "#/";
      this.reset();
    }
  };

  render() {
    const { err, info } = this.state;
    if (!err) return this.props.children;
    if (this.props.fallback) return this.props.fallback(err, this.reset);

    const isFull = this.props.fullPage;

    return (
      <div
        role="alert"
        data-testid={`error-boundary${this.props.label ? `-${this.props.label}` : ""}`}
        className={
          isFull
            ? "w-full min-h-screen bg-slate-950 text-white p-6 flex flex-col items-center justify-center font-mono selection:bg-rose-500/30 select-text"
            : "border border-rose-500/40 bg-rose-950/20 rounded-xl p-5 flex flex-col items-center justify-center gap-3 text-center my-4 mx-2 font-mono selection:bg-rose-500/30 select-text"
        }
      >
        <div className="flex items-center gap-2 text-rose-400 mb-1">
          <AlertTriangle className="w-6 h-6 text-rose-500 animate-pulse flex-shrink-0" aria-hidden="true" />
          <h2 className="text-sm md:text-base font-bold uppercase tracking-wider">
            {this.props.label ? `${this.props.label} — Fatal Render Error` : "Application Component Crashed"}
          </h2>
        </div>

        <p className="text-xs text-slate-300 max-w-xl text-center mb-2">
          An unhandled error occurred while rendering this view. The exact error details and stack trace are captured below:
        </p>

        {/* Error Message Box */}
        <div
          data-testid="error-message-box"
          className="w-full max-w-2xl bg-black/60 border border-rose-900/60 rounded-lg p-3 text-left font-mono text-xs text-rose-300 overflow-x-auto shadow-inner"
        >
          <div className="text-[10px] uppercase font-bold text-rose-500 tracking-wider mb-1">Error Message:</div>
          <div className="font-bold text-white break-all">{err.name}: {err.message}</div>
        </div>

        {/* Stack Trace Box */}
        {(err.stack || info?.componentStack) && (
          <div
            data-testid="error-stack-trace"
            className="w-full max-w-2xl bg-black/80 border border-slate-800 rounded-lg p-3 text-left font-mono text-[11px] text-slate-400 max-h-56 overflow-y-auto overflow-x-auto shadow-inner mt-2 whitespace-pre-wrap leading-relaxed"
          >
            <div className="text-[10px] uppercase font-bold text-slate-500 tracking-wider mb-1">Stack Trace:</div>
            {err.stack || info?.componentStack}
          </div>
        )}

        {/* Action Controls */}
        <div className="flex flex-wrap items-center justify-center gap-2 mt-4">
          <button
            type="button"
            onClick={this.reset}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold uppercase tracking-wider transition-colors shadow-sm cursor-pointer"
            aria-label="Retry render"
            data-testid="button-error-boundary-retry"
          >
            <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Retry Component</span>
          </button>

          <button
            type="button"
            onClick={this.handleReload}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold uppercase tracking-wider border border-slate-700 transition-colors shadow-sm cursor-pointer"
            data-testid="button-error-boundary-reload"
          >
            <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Reload Page</span>
          </button>

          <button
            type="button"
            onClick={this.handleGoHome}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold uppercase tracking-wider border border-slate-700 transition-colors shadow-sm cursor-pointer"
            data-testid="button-error-boundary-home"
          >
            <Home className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Go to Cockpit</span>
          </button>

          <button
            type="button"
            onClick={this.handleResetStorage}
            title="Clears localStorage caches and reloads"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-amber-950/40 hover:bg-amber-900/40 text-amber-300 text-xs font-bold uppercase tracking-wider border border-amber-800/40 transition-colors shadow-sm cursor-pointer"
            data-testid="button-error-boundary-clear"
          >
            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Clear Cache & Reload</span>
          </button>
        </div>
      </div>
    );
  }
}
