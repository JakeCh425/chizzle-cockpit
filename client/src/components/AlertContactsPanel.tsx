import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Mail, Phone, Trash2, Plus, Send, CheckCircle2, XCircle, Clock, MessageCircle, RefreshCw } from "lucide-react";

type Channel = "email" | "sms" | "telegram";

interface AlertContact {
  id: number;
  channel: Channel;
  destination: string;
  label: string;
  enabled: boolean;
  triggerForming: boolean;
  triggerConfirmed: boolean;
  tickerFilter: string;
  createdAt: string;
}

const ALERT_TICKER_OPTIONS = [
  "SMH", "QQQ", "SPY", "AAPL", "IWM", "META", 
  "AMD", "NVDA", "TSM", "MSFT", "GOOG", "TSLA", 
  "VTI", "VOO", "SCHD", "JEPQ"
] as const;

interface AlertLogRow {
  id: number;
  signalKey: string;
  ticker: string;
  phase: "forming" | "confirmed";
  mode: "conservative" | "aggressive";
  channel: Channel;
  destination: string;
  status: "sent" | "failed" | "skipped_dedupe" | "stubbed";
  errorMessage: string;
  payload: string;
  sentAt: string;
}

interface AlertConfig {
  resendConfigured: boolean;
  twilioConfigured: boolean;
  telegramConfigured: boolean;
  resendFromEmail: string;
  twilioFromNumber: string | null;
}

interface TelegramChat {
  chatId: string;
  username: string | null;
  firstName: string | null;
  lastMessage: string | null;
}

const STATUS_COLOR: Record<string, string> = {
  sent: "text-emerald-400",
  failed: "text-rose-400",
  skipped_dedupe: "text-zinc-500",
  stubbed: "text-amber-400",
};

function StatusIcon({ status }: { status: string }) {
  if (status === "sent") return <CheckCircle2 className="w-4 h-4 text-emerald-400" />;
  if (status === "failed") return <XCircle className="w-4 h-4 text-rose-400" />;
  if (status === "stubbed") return <Clock className="w-4 h-4 text-amber-400" />;
  return <Clock className="w-4 h-4 text-zinc-500" />;
}

function channelIcon(ch: Channel) {
  if (ch === "email") return <Mail className="w-4 h-4 text-emerald-400" />;
  if (ch === "sms") return <Phone className="w-4 h-4 text-cyan-400" />;
  return <MessageCircle className="w-4 h-4 text-sky-400" />;
}

export default function AlertContactsPanel() {
  const { toast } = useToast();
  const [channel, setChannel] = useState<Channel>("email");
  const [destination, setDestination] = useState("");
  const [label, setLabel] = useState("");
  const [newTickerFilter, setNewTickerFilter] = useState<string[]>(["SMH", "QQQ", "SPY"]);
  const [telegramChats, setTelegramChats] = useState<TelegramChat[] | null>(null);
  const [telegramLoading, setTelegramLoading] = useState(false);

  const { data: config } = useQuery<AlertConfig>({
    queryKey: ["/api/alert-config"],
    refetchInterval: 60_000,
  });

  const { data: contacts = [] } = useQuery<AlertContact[]>({
    queryKey: ["/api/alert-contacts"],
  });

  const { data: logRows = [] } = useQuery<AlertLogRow[]>({
    queryKey: ["/api/alert-log"],
    refetchInterval: 15_000,
  });

  const addMutation = useMutation({
    mutationFn: async (body: { channel: string; destination: string; label: string; tickerFilter: string }) => {
      const res = await apiRequest("POST", "/api/alert-contacts", body);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/alert-contacts"] });
      setDestination("");
      setLabel("");
      setNewTickerFilter(["SMH", "QQQ", "SPY"]);
      toast({ title: "Contact added", description: "You'll get alerts on the next signal." });
    },
    onError: async (err: any) => {
      const msg = err?.message || "Failed to add contact";
      toast({ title: "Add failed", description: msg, variant: "destructive" });
    },
  });

  const togglePhase = useMutation({
    mutationFn: async ({ id, patch }: { id: number; patch: Partial<AlertContact> }) => {
      const res = await apiRequest("PATCH", `/api/alert-contacts/${id}`, patch);
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/alert-contacts"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/alert-contacts/${id}`);
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/alert-contacts"] }),
  });

  const testMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/alert-contacts/${id}/test`);
      return (await res.json()) as { ok: boolean; status: string; error?: string };
    },
    onSuccess: (result: { ok: boolean; status: string; error?: string }) => {
      if (result?.ok) {
        toast({ title: "Test sent", description: `Status: ${result.status}` });
      } else if (result?.status === "stubbed") {
        toast({ title: "Stubbed", description: "Provider keys missing — see banner above.", variant: "destructive" });
      } else {
        toast({ title: "Test failed", description: result?.error || "Unknown error", variant: "destructive" });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/alert-log"] });
    },
  });

  async function resolveTelegramChats() {
    setTelegramLoading(true);
    try {
      const res = await apiRequest("GET", "/api/telegram/chats");
      const chats = (await res.json()) as TelegramChat[];
      setTelegramChats(chats);
      if (!chats || chats.length === 0) {
        toast({
          title: "No chats found",
          description: "Open Telegram, search your bot, and send /start. Then click Refresh.",
          variant: "destructive",
        });
      }
    } catch (e: any) {
      toast({ title: "Lookup failed", description: e?.message || "Unknown error", variant: "destructive" });
    } finally {
      setTelegramLoading(false);
    }
  }

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    let dest = destination.trim();
    if (channel === "sms") {
      const digits = dest.replace(/\D/g, "");
      if (digits.length === 10) dest = `+1${digits}`;
      else if (!dest.startsWith("+")) dest = `+${digits}`;
    }
    addMutation.mutate({
      channel,
      destination: dest,
      label,
      tickerFilter: newTickerFilter.join(","),
    });
  }

  const showResendBanner = config && !config.resendConfigured;
  const showTwilioBanner = config && !config.twilioConfigured;
  const showTelegramBanner = config && !config.telegramConfigured;

  return (
    <div className="space-y-6">
      {/* Configuration Status Banners */}
      {(showResendBanner || showTwilioBanner || showTelegramBanner) && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-300">
          <div className="font-semibold mb-2">Provider keys not configured — those channels will be logged but not sent.</div>
          <ul className="space-y-1 text-amber-300/80">
            {showResendBanner && <li>• Set <code className="rounded bg-amber-500/20 px-1 py-0.5 text-amber-200">RESEND_API_KEY</code> to enable email.</li>}
            {showTwilioBanner && <li>• Set <code className="rounded bg-amber-500/20 px-1 py-0.5 text-amber-200">TWILIO_ACCOUNT_SID</code>, <code className="rounded bg-amber-500/20 px-1 py-0.5 text-amber-200">TWILIO_AUTH_TOKEN</code>, <code className="rounded bg-amber-500/20 px-1 py-0.5 text-amber-200">TWILIO_FROM_NUMBER</code> to enable SMS.</li>}
            {showTelegramBanner && <li>• Set <code className="rounded bg-amber-500/20 px-1 py-0.5 text-amber-200">TELEGRAM_BOT_TOKEN</code> to enable Telegram push.</li>}
          </ul>
        </div>
      )}

      {/* Add Contact Form */}
      <form onSubmit={handleAdd} className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <div className="flex overflow-hidden rounded-md border border-zinc-700 bg-zinc-900">
            <button
              type="button"
              onClick={() => setChannel("email")}
              className={`flex items-center gap-2 px-4 py-2 transition-colors ${channel === "email" ? "bg-emerald-500/20 text-emerald-300 font-medium" : "text-zinc-400 hover:bg-zinc-800"}`}
            >
              <Mail className="w-4 h-4" /> Email
            </button>
            <button
              type="button"
              onClick={() => setChannel("sms")}
              className={`flex items-center gap-2 border-l border-zinc-700 px-4 py-2 transition-colors ${channel === "sms" ? "bg-cyan-500/20 text-cyan-300 font-medium" : "text-zinc-400 hover:bg-zinc-800"}`}
            >
              <Phone className="w-4 h-4" /> SMS
            </button>
            <button
              type="button"
              onClick={() => setChannel("telegram")}
              className={`flex items-center gap-2 border-l border-zinc-700 px-4 py-2 transition-colors ${channel === "telegram" ? "bg-sky-500/20 text-sky-300 font-medium" : "text-zinc-400 hover:bg-zinc-800"}`}
            >
              <MessageCircle className="w-4 h-4" /> Telegram
            </button>
          </div>
          <input
            type="text"
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            placeholder={
              channel === "email"
                ? "you@example.com"
                : channel === "sms"
                ? "+1 417 555 1234"
                : "Numeric chat_id (use Resolve →)"
            }
            className="flex-1 min-w-[240px] rounded-md border border-zinc-700 bg-zinc-900 px-4 py-2 text-zinc-100 placeholder-zinc-500 focus:border-zinc-500 focus:outline-none"
            required
          />
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Label (optional)"
            className="w-40 rounded-md border border-zinc-700 bg-zinc-900 px-4 py-2 text-zinc-100 placeholder-zinc-500 focus:border-zinc-500 focus:outline-none"
          />
          <button
            type="submit"
            disabled={addMutation.isPending}
            className="flex items-center gap-2 rounded-md bg-emerald-500/20 px-4 py-2 font-medium text-emerald-300 transition-colors hover:bg-emerald-500/30 disabled:opacity-50"
          >
            <Plus className="w-4 h-4" /> Add
          </button>
        </div>

        {/* Form Ticker Filters */}
        <div className="flex flex-wrap items-center gap-2 rounded-md bg-zinc-900/30 p-3 border border-zinc-800/50">
          <span className="mr-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Send alerts for:</span>
          {ALERT_TICKER_OPTIONS.map((t) => {
            const selected = newTickerFilter.includes(t);
            return (
              <button
                key={t}
                type="button"
                onClick={() =>
                  setNewTickerFilter((prev) =>
                    prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]
                  )
                }
                className={`rounded border px-3 py-1 text-xs font-mono transition-colors ${
                  selected
                    ? "border-emerald-500/60 bg-emerald-500/20 text-emerald-300"
                    : "border-zinc-700 bg-zinc-900 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
                }`}
                aria-pressed={selected}
              >
                {selected ? "✓ " : ""}{t}
              </button>
            );
          })}
          <span className="ml-2 text-xs italic text-zinc-500">
            {newTickerFilter.length === 0 ? "None selected → all tickers will alert" : `Only ${newTickerFilter.join(", ")}`}
          </span>
        </div>
      </form>

      {/* Telegram Chat Resolver */}
      {channel === "telegram" && (
        <div className="flex items-center justify-between gap-4 rounded-lg border border-sky-500/20 bg-sky-500/5 p-4 text-sm">
          <div className="text-sky-200">
            <span className="font-semibold">Telegram setup:</span> Open Telegram, find your bot, send <code className="rounded bg-sky-500/20 px-1 py-0.5 text-sky-300">/start</code>, then click Resolve to pick your chat.
          </div>
          <button
            type="button"
            onClick={resolveTelegramChats}
            disabled={telegramLoading || !config?.telegramConfigured}
            className="flex shrink-0 items-center gap-2 rounded-md border border-sky-500/40 bg-sky-500/10 px-4 py-2 font-medium text-sky-300 transition-colors hover:bg-sky-500/20 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${telegramLoading ? "animate-spin" : ""}`} /> Resolve Chats
          </button>
          
          {telegramChats && telegramChats.length > 0 && (
            <div className="w-full space-y-2 mt-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-sky-400/80">
                Found {telegramChats.length} chat{telegramChats.length === 1 ? "" : "s"} — click to use:
              </div>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                {telegramChats.map((c) => (
                  <button
                    key={c.chatId}
                    type="button"
                    onClick={() => {
                      setDestination(c.chatId);
                      if (!label) setLabel(c.firstName || c.username || "Telegram");
                    }}
                    className="flex w-full items-center gap-3 rounded-md border border-zinc-700 bg-zinc-900/60 p-3 text-left transition-colors hover:bg-zinc-800"
                  >
                    <MessageCircle className="h-4 w-4 shrink-0 text-sky-400" />
                    <span className="font-mono text-sm text-zinc-100">{c.chatId}</span>
                    <span className="text-sm text-zinc-400">{c.firstName || c.username || "—"}</span>
                    {c.lastMessage && <span className="flex-1 truncate text-xs italic text-zinc-500">"{c.lastMessage}"</span>}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Contacts List */}
      {contacts.length === 0 ? (
        <div className="py-4 text-sm italic text-zinc-500">No contacts yet. Add an email, SMS, or Telegram chat above to get alerts when a setup fires.</div>
      ) : (
        <div className="space-y-3">
          {contacts.map((c) => (
            <div key={c.id} className="flex flex-wrap items-center gap-4 rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 text-sm shadow-sm">
              <div className="flex items-center gap-3 w-full md:w-auto md:flex-1 min-w-0">
                {channelIcon(c.channel)}
                <div className="flex-1 min-w-0">
                  <div className="truncate font-medium text-zinc-100">{c.destination}</div>
                  {c.label && <div className="text-xs text-zinc-500">{c.label}</div>}
                </div>
              </div>

              <div className="flex items-center gap-6">
                <label className="flex cursor-pointer items-center gap-2 text-zinc-400 transition-colors hover:text-zinc-200">
                  <input
                    type="checkbox"
                    checked={c.triggerForming}
                    onChange={(e) => togglePhase.mutate({ id: c.id, patch: { triggerForming: e.target.checked } })}
                    className="h-4 w-4 accent-amber-400"
                  />
                  <span>Forming</span>
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-zinc-400 transition-colors hover:text-zinc-200">
                  <input
                    type="checkbox"
                    checked={c.triggerConfirmed}
                    onChange={(e) => togglePhase.mutate({ id: c.id, patch: { triggerConfirmed: e.target.checked } })}
                    className="h-4 w-4 accent-emerald-400"
                  />
                  <span>Confirmed</span>
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-zinc-400 transition-colors hover:text-zinc-200">
                  <input
                    type="checkbox"
                    checked={c.enabled}
                    onChange={(e) => togglePhase.mutate({ id: c.id, patch: { enabled: e.target.checked } })}
                    className="h-4 w-4 accent-cyan-400"
                  />
                  <span>{c.enabled ? "On" : "Off"}</span>
                </label>
              </div>

              <div className="flex flex-wrap items-center gap-2 border-l border-zinc-800 pl-4">
                {ALERT_TICKER_OPTIONS.map((t) => {
                  const current = (c.tickerFilter || "")
                    .split(",")
                    .map((x) => x.trim().toUpperCase())
                    .filter(Boolean);
                  const allTickers = current.length === 0;
                  const selected = allTickers || current.includes(t);
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => {
                        const next = current.includes(t)
                          ? current.filter((x) => x !== t)
                          : [...current, t];
                        togglePhase.mutate({
                          id: c.id,
                          patch: { tickerFilter: next.join(",") },
                        });
                      }}
                      className={`rounded border px-2 py-1 text-xs font-mono transition-colors ${
                        allTickers
                          ? "border-zinc-700 bg-zinc-800/60 text-zinc-400"
                          : selected
                          ? "border-emerald-500/60 bg-emerald-500/20 text-emerald-300"
                          : "border-zinc-800 bg-zinc-900 text-zinc-600 hover:text-zinc-400"
                      }`}
                      title={allTickers ? "All tickers enabled — click to scope to specific ones" : selected ? `Alerts for ${t} are on` : `Alerts for ${t} are off`}
                      aria-pressed={selected}
                    >
                      {t}
                    </button>
                  );
                })}
              </div>

              <div className="flex items-center gap-3 border-l border-zinc-800 pl-4">
                <button
                  onClick={() => testMutation.mutate(c.id)}
                  disabled={testMutation.isPending}
                  className="flex items-center gap-2 rounded-md border border-zinc-700 px-3 py-1.5 text-zinc-300 transition-colors hover:bg-zinc-800 disabled:opacity-50"
                  title="Send a test alert"
                >
                  <Send className="h-4 w-4" /> Test
                </button>
                <button
                  onClick={() => { if (confirm(`Delete ${c.destination}?`)) deleteMutation.mutate(c.id); }}
                  className="p-1.5 text-zinc-500 transition-colors hover:text-rose-400"
                  title="Delete contact"
                >
                  <Trash2 className="h-5 w-5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Delivery Log */}
      <div className="mt-8 border-t border-zinc-800 pt-6">
        <div className="mb-4 text-xs font-semibold uppercase tracking-wide text-zinc-500">Recent alerts ({logRows.length})</div>
        {logRows.length === 0 ? (
          <div className="text-sm italic text-zinc-500">No alerts fired yet. They'll appear here on the next signal.</div>
        ) : (
          <div className="max-h-80 space-y-2 overflow-y-auto pr-2">
            {logRows.slice(0, 30).map((r) => (
              <div key={r.id} className="flex items-center gap-4 rounded-md bg-zinc-900/30 px-4 py-2 text-sm text-zinc-400">
                <StatusIcon status={r.status} />
                <span className="w-16 font-mono font-medium text-zinc-200">{r.ticker}</span>
                <span className="w-20 capitalize text-zinc-400">{r.phase}</span>
                <span className="w-24 capitalize text-zinc-400">{r.mode}</span>
                <span className="flex-1 truncate text-zinc-300">{r.destination}</span>
                <span className={`w-28 text-xs font-semibold uppercase tracking-wide ${STATUS_COLOR[r.status] || "text-zinc-500"}`}>
                  {r.status.replace("_", " ")}
                </span>
                <span className="w-20 text-right font-mono text-xs text-zinc-500">
                  {new Date(r.sentAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}


