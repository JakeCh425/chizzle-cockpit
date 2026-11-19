import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RefreshCw, Trash2 } from "lucide-react";

interface AppErrorBoundaryProps {
  children: ReactNode;
  moduleName?: string;
  fullPage?: boolean;
}

interface AppErrorBoundaryState {
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { error: null, errorInfo: null };

  static getDerivedStateFromError(error: Error): Partial<AppErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({ errorInfo });
    if (typeof console !== "undefined") {
      console.error(
        `[AppErrorBoundary${this.props.moduleName ? `:${this.props.moduleName}` : ""}]`,
        error,
        errorInfo.componentStack
      );
    }
  }

  private handleRetry = (): void => {
    this.setState({ error: null, errorInfo: null });
  };

  private handleClearCacheAndReload = (): void => {
    if (typeof window !== "undefined") {
      try {
        localStorage.clear();
        sessionStorage.clear();
      } catch {}
      window.location.reload();
    }
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div
        role="alert"
        data-testid={`app-error-boundary${this.props.moduleName ? `-${this.props.moduleName}` : ""}`}
        className={
          this.props.fullPage
            ? "w-full min-h-screen bg-[#070B14] text-white p-6 flex items-center justify-center font-mono"
            : "w-full min-h-[320px] bg-[#0B101D] border border-rose-500/40 rounded-xl p-6 flex items-center justify-center font-mono my-4"
        }
      >
        <div className="max-w-lg w-full bg-[#0D1322] border border-rose-500/40 rounded-2xl p-6 shadow-2xl flex flex-col gap-4">
          <div className="flex items-center gap-2.5 text-rose-400">
            <AlertTriangle className="w-5 h-5 shrink-0" />
            <h2 className="text-sm font-black uppercase tracking-wider">
              {this.props.moduleName ? `${this.props.moduleName} — Module Recovery` : "Module Recovery"}
            </h2>
          </div>

          <div className="p-3 rounded-lg bg-black/60 border border-rose-900/50 text-xs text-rose-300 break-words">
            {error?.message || "An unexpected rendering error occurred."}
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <button
              type="button"
              onClick={this.handleRetry}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-400/60 text-cyan-300 text-xs font-bold uppercase tracking-wider cursor-pointer transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>[ ↻ Retry Module ]</span>
            </button>

            <button
              type="button"
              onClick={this.handleClearCacheAndReload}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/50 text-rose-300 text-xs font-bold uppercase tracking-wider cursor-pointer transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>[ 🧹 Clear Cache &amp; Reload ]</span>
            </button>
          </div>
        </div>
      </div>
    );
  }
}

export default AppErrorBoundary;
