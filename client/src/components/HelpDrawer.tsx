import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { HelpCircle, BookOpen, LineChart } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { A_SCORE_REGIME_CHEAT_SHEET } from "@/help/aScoreRegime";
import { MINI_CHARTS_CHEAT_SHEET } from "@/help/miniCharts";

// Cockpit-styled markdown renderer — reuses the design tokens
// (neon-blue, signal-amber, soft-white, ink-line, ink-panel) so the
// drawer matches the rest of the UI without any new CSS.
const mdComponents = {
  h1: ({ node, ...props }: any) => (
    <h1
      className="font-display text-[14px] tracking-[0.2em] uppercase text-neon-blue border-b border-ink-line/60 pb-2 mt-2 mb-3"
      {...props}
    />
  ),
  h2: ({ node, ...props }: any) => (
    <h2
      className="font-display text-[12px] tracking-widest uppercase text-signal-amber mt-6 mb-2"
      {...props}
    />
  ),
  h3: ({ node, ...props }: any) => (
    <h3
      className="font-display text-[11px] tracking-wider uppercase text-soft-white mt-4 mb-1.5"
      {...props}
    />
  ),
  p: ({ node, ...props }: any) => (
    <p className="text-[12px] leading-relaxed text-soft-white/90 my-2" {...props} />
  ),
  ul: ({ node, ...props }: any) => (
    <ul className="text-[12px] leading-relaxed text-soft-white/90 list-disc pl-5 space-y-1 my-2" {...props} />
  ),
  ol: ({ node, ...props }: any) => (
    <ol className="text-[12px] leading-relaxed text-soft-white/90 list-decimal pl-5 space-y-1 my-2" {...props} />
  ),
  li: ({ node, ...props }: any) => <li className="text-[12px]" {...props} />,
  strong: ({ node, ...props }: any) => (
    <strong className="text-soft-white font-semibold" {...props} />
  ),
  em: ({ node, ...props }: any) => (
    <em className="text-slate-gray italic" {...props} />
  ),
  hr: ({ node, ...props }: any) => (
    <hr className="border-0 border-t border-ink-line/60 my-5" {...props} />
  ),
  blockquote: ({ node, ...props }: any) => (
    <blockquote
      className="border-l-2 border-neon-blue/60 bg-neon-blue/5 pl-3 pr-2 py-2 my-3 text-[12px] text-soft-white"
      {...props}
    />
  ),
  code: ({ node, className, children, ...props }: any) => {
    const isInline = !className;
    if (isInline) {
      return (
        <code
          className="bg-ink-deep/80 text-neon-blue px-1 py-px rounded-sm font-mono text-[11px]"
          {...props}
        >
          {children}
        </code>
      );
    }
    return (
      <code className={`${className || ""} font-mono text-[11px]`} {...props}>
        {children}
      </code>
    );
  },
  pre: ({ node, ...props }: any) => (
    <pre
      className="bg-ink-deep/80 border border-ink-line/60 rounded-sm p-3 overflow-auto my-3 font-mono text-[11px] text-soft-white"
      {...props}
    />
  ),
  table: ({ node, ...props }: any) => (
    <div className="overflow-x-auto my-3">
      <table className="w-full border-collapse text-[11.5px]" {...props} />
    </div>
  ),
  thead: ({ node, ...props }: any) => (
    <thead className="bg-ink-panel/60" {...props} />
  ),
  th: ({ node, ...props }: any) => (
    <th
      className="border border-ink-line/60 px-2.5 py-1.5 text-left text-signal-amber font-display uppercase tracking-wider text-[10px]"
      {...props}
    />
  ),
  td: ({ node, ...props }: any) => (
    <td className="border border-ink-line/60 px-2.5 py-1.5 text-soft-white/90 align-top" {...props} />
  ),
  a: ({ node, ...props }: any) => (
    <a className="text-neon-blue hover:underline" target="_blank" rel="noreferrer" {...props} />
  ),
};

function CheatSheet({ markdown }: { markdown: string }) {
  return (
    <div className="font-sans" data-testid="help-cheatsheet-body">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
        {markdown}
      </ReactMarkdown>
    </div>
  );
}

interface HelpDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Tab to open by default. */
  initialTab?: "ascore" | "minicharts";
}

export default function HelpDrawer({ open, onOpenChange, initialTab = "ascore" }: HelpDrawerProps) {
  const [tab, setTab] = useState<string>(initialTab);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-2xl bg-ink-black border-l border-ink-line/60 overflow-y-auto"
        data-testid="help-drawer-content"
      >
        <SheetHeader className="border-b border-ink-line/60 pb-3 mb-4">
          <SheetTitle className="font-display text-[13px] tracking-[0.2em] uppercase text-soft-white flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-neon-blue" />
            Cockpit Cheat Sheets
          </SheetTitle>
          <SheetDescription className="text-[11px] text-slate-gray">
            Reference guides for the A‑score model, regime engine, and mini‑chart radar.
          </SheetDescription>
        </SheetHeader>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="bg-ink-panel/60 border border-ink-line/60 rounded-sm h-auto p-1 flex gap-1">
            <TabsTrigger
              value="ascore"
              data-testid="help-tab-ascore"
              className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-display data-[state=active]:bg-neon-blue/15 data-[state=active]:text-neon-blue"
            >
              <BookOpen className="w-3 h-3" />
              A‑Score · Regime
            </TabsTrigger>
            <TabsTrigger
              value="minicharts"
              data-testid="help-tab-minicharts"
              className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-display data-[state=active]:bg-neon-blue/15 data-[state=active]:text-neon-blue"
            >
              <LineChart className="w-3 h-3" />
              Mini‑Charts
            </TabsTrigger>
          </TabsList>

          <TabsContent value="ascore" className="mt-4">
            <CheatSheet markdown={A_SCORE_REGIME_CHEAT_SHEET} />
          </TabsContent>
          <TabsContent value="minicharts" className="mt-4">
            <CheatSheet markdown={MINI_CHARTS_CHEAT_SHEET} />
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}

/** Compact button suitable for the cockpit header. */
export function HelpDrawerButton({
  onClick,
  label = "Help",
}: {
  onClick: () => void;
  label?: string;
}) {
  return (
    <button
      onClick={onClick}
      data-testid="button-help-drawer"
      title="Open cockpit cheat sheets"
      className="flex items-center gap-1.5 px-2.5 py-1 border border-signal-amber/60 text-signal-amber bg-signal-amber/10 text-[11px] uppercase tracking-wider rounded-sm hover:bg-signal-amber/20"
    >
      <HelpCircle className="w-3 h-3" />
      {label}
    </button>
  );
}
