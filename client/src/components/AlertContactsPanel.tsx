import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Mail, Phone, Trash2, Plus, Send, CheckCircle2, XCircle, Clock } from "lucide-react";

interface AlertContact {
  id: number;
  channel: "email" | "sms";
  destination: string;
  label: string;
  enabled: boolean;
  triggerForming: boolean;
  triggerConfirmed: boolean;
  createdAt: string;
}

interface AlertLogRow {
  id: number;
  signalKey: string;
  ticker: string;
  phase: "forming" | "confirmed";
  mode: "conservative" | "aggressive";
  channel: "email" | "sms";
  destination: string;
  status: "sent" | "failed" | "skipped_dedupe" | "stubbed";
  errorMessage: string;
  payload: string;
  sentAt: string;
}

interface AlertConfig {
  resendConfigured: boolean;
  twilioConfigured: boolean;
  resendFromEmail: string;
  twilioFromNumber: string | null;
}

const STATUS_COLOR: Record<string, string> = {
  sent: "text-emerald-400",
  failed: "text-rose-400",
  skipped_dedupe: "text-zinc-500",
  stubbed: "text-amber-400",
};

function StatusIcon({ status }: { status: string }) {
  if (status === "sent") return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />;
  if (status === "failed") return <XCircle className="w-3.5 h-3.5 text-rose-400" />;
  if (status === "stubbed") return <Clock className="w-3.5 h-3.5 text-amber-400" />;
  return <Clock className="w-3.5 h-3.5 text-zinc-500" />;
}

export default function AlertContactsPanel() {
  const { toast } = useToast();
  const [channel, setChannel] = useState<"email" | "sms">("email");
  const [destination, setDestination] = useState("");
  const [label, setLabel] = useState("");

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
    mutationFn: async (body: { channel: string; destination: string; label: string }) => {
      const res = await apiRequest("POST", "/api/alert-contacts", body);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/alert-contacts"] });
      setDestination("");
      setLabel("");
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

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    let dest = destination.trim();
    if (channel === "sms") {
      // auto-normalize: strip non-digits, prepend + if missing
      const digits = dest.replace(/\D/g, "");
      if (digits.length === 10) dest = `+1${digits}`;
      else if (!dest.startsWith("+")) dest = `+${digits}`;
    }
    addMutation.mutate({ channel, destination: dest, label });
  }

  const showResendBanner = config && !config.resendConfigured;
  const showTwilioBanner = config && !config.twilioConfigured;

  return (
    <div className="space-y-4">
      {/* config status banners */}
      {(showResendBanner || showTwilioBanner) && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-300">
          <div className="font-medium mb-1">Provider keys not configured — alerts will be logged but not sent.</div>
          <ul className="space-y-0.5 text-amber-300/80">
            {showResendBanner && <li>• Set <code className="text-amber-200">RESEND_API_KEY</code> in Render env to enable email.</li>}
            {showTwilioBanner && <li>• Set <code className="text-amber-200">TWILIO_ACCOUNT_SID</code>, <code className="text-amber-200">TWILIO_AUTH_TOKEN</code>, <code className="text-amber-200">TWILIO_FROM_NUMBER</code> in Render env to enable SMS.</li>}
          </ul>
        </div>
      )}

      {/* add contact form */}
      <form onSubmit={handleAdd} className="flex flex-wrap items-center gap-2 text-xs">
        <div className="flex rounded-md border border-zinc-700 overflow-hidden">
          <button
            type="button"
            onClick={() => setChannel("email")}
            className={`px-3 py-1.5 ${channel === "email" ? "bg-emerald-500/20 text-emerald-300" : "text-zinc-400 hover:bg-zinc-800"}`}
            data-testid="button-channel-email"
          >
            <Mail className="w-3.5 h-3.5 inline-block mr-1" /> Email
          </button>
          <button
            type="button"
            onClick={() => setChannel("sms")}
            className={`px-3 py-1.5 border-l border-zinc-700 ${channel === "sms" ? "bg-emerald-500/20 text-emerald-300" : "text-zinc-400 hover:bg-zinc-800"}`}
            data-testid="button-channel-sms"
          >
            <Phone className="w-3.5 h-3.5 inline-block mr-1" /> SMS
          </button>
        </div>
        <input
          type="text"
          value={destination}
          onChange={(e) => setDestination(e.target.value)}
          placeholder={channel === "email" ? "you@example.com" : "+1 417 555 1234"}
          className="flex-1 min-w-[180px] rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-zinc-100 placeholder-zinc-600"
          data-testid="input-alert-destination"
          required
        />
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Label (optional)"
          className="w-32 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-zinc-100 placeholder-zinc-600"
          data-testid="input-alert-label"
        />
        <button
          type="submit"
          disabled={addMutation.isPending}
          className="rounded-md bg-emerald-500/20 text-emerald-300 px-3 py-1.5 hover:bg-emerald-500/30 disabled:opacity-50 flex items-center gap-1"
          data-testid="button-add-contact"
        >
          <Plus className="w-3.5 h-3.5" /> Add
        </button>
      </form>

      {/* contacts list */}
      {contacts.length === 0 ? (
        <div className="text-xs text-zinc-500 italic py-2">No contacts yet. Add an email or SMS above to get alerts when a hammer fires.</div>
      ) : (
        <div className="space-y-1.5">
          {contacts.map((c) => (
            <div key={c.id} className="flex items-center gap-3 rounded-md border border-zinc-800 bg-zinc-900/50 px-3 py-2 text-xs" data-testid={`row-contact-${c.id}`}>
              {c.channel === "email" ? <Mail className="w-3.5 h-3.5 text-emerald-400" /> : <Phone className="w-3.5 h-3.5 text-cyan-400" />}
              <div className="flex-1 min-w-0">
                <div className="text-zinc-100 truncate" data-testid={`text-destination-${c.id}`}>{c.destination}</div>
                {c.label && <div className="text-zinc-500 text-[10px]">{c.label}</div>}
              </div>
              <label className="flex items-center gap-1 text-zinc-400 hover:text-zinc-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={c.triggerForming}
                  onChange={(e) => togglePhase.mutate({ id: c.id, patch: { triggerForming: e.target.checked } })}
                  className="accent-amber-400"
                  data-testid={`checkbox-forming-${c.id}`}
                />
                <span>Forming</span>
              </label>
              <label className="flex items-center gap-1 text-zinc-400 hover:text-zinc-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={c.triggerConfirmed}
                  onChange={(e) => togglePhase.mutate({ id: c.id, patch: { triggerConfirmed: e.target.checked } })}
                  className="accent-emerald-400"
                  data-testid={`checkbox-confirmed-${c.id}`}
                />
                <span>Confirmed</span>
              </label>
              <label className="flex items-center gap-1 text-zinc-400 hover:text-zinc-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={c.enabled}
                  onChange={(e) => togglePhase.mutate({ id: c.id, patch: { enabled: e.target.checked } })}
                  className="accent-cyan-400"
                  data-testid={`checkbox-enabled-${c.id}`}
                />
                <span>{c.enabled ? "On" : "Off"}</span>
              </label>
              <button
                onClick={() => testMutation.mutate(c.id)}
                disabled={testMutation.isPending}
                className="rounded border border-zinc-700 text-zinc-300 hover:bg-zinc-800 px-2 py-1 flex items-center gap-1 disabled:opacity-50"
                data-testid={`button-test-${c.id}`}
                title="Send a test alert"
              >
                <Send className="w-3 h-3" /> Test
              </button>
              <button
                onClick={() => { if (confirm(`Delete ${c.destination}?`)) deleteMutation.mutate(c.id); }}
                className="text-zinc-500 hover:text-rose-400"
                data-testid={`button-delete-${c.id}`}
                title="Delete contact"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* delivery log */}
      <div className="pt-2 border-t border-zinc-800">
        <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1.5">Recent alerts ({logRows.length})</div>
        {logRows.length === 0 ? (
          <div className="text-xs text-zinc-600 italic">No alerts fired yet. They'll appear here on the next signal.</div>
        ) : (
          <div className="max-h-64 overflow-y-auto space-y-1">
            {logRows.slice(0, 30).map((r) => (
              <div key={r.id} className="flex items-center gap-2 text-[11px] text-zinc-400" data-testid={`log-row-${r.id}`}>
                <StatusIcon status={r.status} />
                <span className="text-zinc-300 w-12 truncate">{r.ticker}</span>
                <span className="text-zinc-500 w-16 capitalize">{r.phase}</span>
                <span className="text-zinc-500 w-20 capitalize">{r.mode}</span>
                <span className="text-zinc-500 flex-1 truncate">{r.destination}</span>
                <span className={`${STATUS_COLOR[r.status] || "text-zinc-500"} text-[10px] uppercase`}>{r.status.replace("_", " ")}</span>
                <span className="text-zinc-600 text-[10px] tabular-nums">{new Date(r.sentAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
