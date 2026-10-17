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
      const res = await apiRequest("
