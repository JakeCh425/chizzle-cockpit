// ─────────────────────────────────────────────────────────────────────────────
// ErrorBoundary.tsx
// Generic class-based error boundary. Wraps risky subtrees (chart grids, etc.)
// so a single render exception in Recharts doesn't blank the whole page.
// Renders a compact cockpit-styled fallback with a Retry button.
// ─────────────────────────────────────────────────────────────────────────────

import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface Props {
  children: ReactNode;
  /** Optional label shown in the fallback header (e.g. "Mini Charts"). */
  label?: string;
  /** Custom fallback renderer overrides the default. */
  fallback?: (err: Error, reset: () => void) => ReactNode;
}

interface State {
  err: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { err: null };

  static getDerivedStateFromError(err: Error): State {
    return { err };
  }

  componentDidCatch(err: Error, info: ErrorInfo) {
    // Surface in dev console only; production stays quiet.
    if (typeof console !== "undefined") {
      console.error(`[ErrorBoundary${this.props.label ? `:${this.props.label}` : ""}]`, err, info.componentStack);
    }
  }

  reset = () => this.setState({ err: null });

  render() {
    const { err } = this.state;
    if (!err) return this.props.children;
    if (this.props.fallback) return this.props.fallback(err, this.reset);
    return (
      <div
        role="alert"
        className="border border-signal-red/40 bg-signal-red/10 rounded-sm p-4 flex flex-col items-center justify-center gap-2 text-center"
        data-testid={`error-boundary${this.props.label ? `-${this.props.label}` : ""}`}
      >
        <AlertTriangle className="w-5 h-5 text-signal-red" aria-hidden="true" />
        <div className="text-[11px] uppercase tracking-wider text-signal-red">
          {this.props.label ? `${this.props.label} crashed` : "Component crashed"}
        </div>
        <div className="text-[10px] font-mono-num text-slate-gray max-w-md truncate" title={err.message}>
          {err.message.slice(0, 160)}
        </div>
        <button
          type="button"
          onClick={this.reset}
          className="mt-1 inline-flex items-center gap-1 px-2 py-1 border border-ink-line/80 rounded-sm text-[10px] uppercase tracking-wider text-soft-white hover:bg-ink-line/40 transition-colors"
          aria-label="Retry render"
          data-testid="button-error-boundary-retry"
        >
          <RefreshCw className="w-3 h-3" aria-hidden="true" />
          Retry
        </button>
      </div>
    );
  }
}
