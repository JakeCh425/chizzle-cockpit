import { useState, useEffect } from "react";
import { errMsg } from "@/lib/errors";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { Panel } from "@/components/Panel";
import "highlight.js/styles/github-dark.css";

function formatDistanceToNow(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h`;
}

export default function SpecReview() {
  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleRefresh() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/spec");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      setContent(text);
      setLastUpdated(new Date());
    } catch (e: unknown) {
      setError(errMsg(e, "Failed to load spec"));
    } finally {
      setLoading(false);
    }
  }

  // Load once on mount (manual refresh thereafter — no polling)
  useEffect(() => {
    handleRefresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "16px" }}>
      <Panel title="Spec Review" hint="Discipline logic captured in regime_gate_spec.md">
        <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "12px" }}>
          <button
            onClick={handleRefresh}
            disabled={loading}
            style={{
              background: loading ? "#1a2030" : "#3DA9FC",
              color: loading ? "#5a6070" : "#05070A",
              border: "none",
              padding: "8px 16px",
              borderRadius: "6px",
              fontFamily: "JetBrains Mono, monospace",
              fontSize: "13px",
              fontWeight: 600,
              cursor: loading ? "default" : "pointer",
              letterSpacing: "0.5px",
            }}
          >
            {loading ? "REFRESHING…" : "REFRESH SPEC"}
          </button>
          {lastUpdated && (
            <div style={{ color: "#8a92a3", fontSize: "12px", fontFamily: "JetBrains Mono, monospace" }}>
              Updated {formatDistanceToNow(lastUpdated)} ago
            </div>
          )}
          {error && (
            <div style={{ color: "#ff5b5b", fontSize: "12px", fontFamily: "JetBrains Mono, monospace" }}>
              Error: {error}
            </div>
          )}
        </div>
      </Panel>

      <Panel title="Specification">
        <div
          className="spec-body"
          style={{
            color: "#d8dde6",
            fontFamily: "Inter, system-ui, sans-serif",
            fontSize: "14px",
            lineHeight: 1.6,
            maxWidth: "900px",
          }}
        >
          {content ? (
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeHighlight]}
              components={{
                h1: ({ node, ...props }) => (
                  <h1 style={{ color: "#3DA9FC", fontFamily: "Space Grotesk, sans-serif", borderBottom: "1px solid #1a2030", paddingBottom: "8px", marginTop: "32px" }} {...props} />
                ),
                h2: ({ node, ...props }) => (
                  <h2 style={{ color: "#C8A24B", fontFamily: "Space Grotesk, sans-serif", marginTop: "28px" }} {...props} />
                ),
                h3: ({ node, ...props }) => (
                  <h3 style={{ color: "#d8dde6", fontFamily: "Space Grotesk, sans-serif", marginTop: "20px" }} {...props} />
                ),
                code: ({ node, className, children, ...props }: any) => {
                  const isInline = !className;
                  if (isInline) {
                    return (
                      <code style={{ background: "#0d1320", color: "#3DA9FC", padding: "2px 6px", borderRadius: "3px", fontFamily: "JetBrains Mono, monospace", fontSize: "13px" }} {...props}>
                        {children}
                      </code>
                    );
                  }
                  return <code className={className} {...props}>{children}</code>;
                },
                pre: ({ node, ...props }) => (
                  <pre style={{ background: "#0d1320", border: "1px solid #1a2030", borderRadius: "6px", padding: "12px", overflow: "auto", fontSize: "12px" }} {...props} />
                ),
                table: ({ node, ...props }) => (
                  <table style={{ borderCollapse: "collapse", margin: "12px 0", width: "100%" }} {...props} />
                ),
                th: ({ node, ...props }) => (
                  <th style={{ border: "1px solid #1a2030", padding: "6px 10px", background: "#0d1320", textAlign: "left", color: "#C8A24B" }} {...props} />
                ),
                td: ({ node, ...props }) => (
                  <td style={{ border: "1px solid #1a2030", padding: "6px 10px" }} {...props} />
                ),
                hr: ({ node, ...props }) => (
                  <hr style={{ border: "none", borderTop: "1px solid #1a2030", margin: "24px 0" }} {...props} />
                ),
                a: ({ node, ...props }) => (
                  <a style={{ color: "#3DA9FC" }} {...props} />
                ),
              }}
            >
              {content}
            </ReactMarkdown>
          ) : !loading ? (
            <div style={{ color: "#8a92a3" }}>No spec loaded. Click REFRESH SPEC to load.</div>
          ) : null}
        </div>
      </Panel>
    </div>
  );
}
