import React, { useState } from "react";
import { Bell, HelpCircle, MessageCircle, Phone, Send, CheckCircle2, ShieldCheck } from "lucide-react";
import {
  type OffScreenAlertSettings,
  formatPreEntryAlertMessage,
} from "@/hooks/useOffScreenPreEntryAlerts";

export interface NotificationsAndAlertsPanelProps {
  settings: OffScreenAlertSettings;
  onUpdateSettings: (patch: Partial<OffScreenAlertSettings>) => void;
  onSendTestAlert?: () => Promise<string | void>;
  activeTicker?: string;
  entryPrice?: number;
  target1?: number;
}

export function NotificationsAndAlertsPanel({
  settings,
  onUpdateSettings,
  onSendTestAlert,
  activeTicker = "NVDA",
  entryPrice = 216.0,
  target1 = 222.0,
}: NotificationsAndAlertsPanelProps) {
  const [showTelegramHelp, setShowTelegramHelp] = useState(false);
  const [savedBanner, setSavedBanner] = useState(false);
  const [testSending, setTestSending] = useState(false);

  const previewProximityMsg = formatPreEntryAlertMessage({
    ticker: activeTicker,
    entryPrice,
    target1,
    context: "Price within 0.25% of SMA",
  });

  const previewTimeMsg = formatPreEntryAlertMessage({
    ticker: activeTicker,
    entryPrice,
    target1,
    context: "3 mins to 1H Close",
  });

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    onUpdateSettings(settings);
    setSavedBanner(true);
    setTimeout(() => setSavedBanner(false), 3000);
  };

  const handleTest = async () => {
    if (!onSendTestAlert) return;
    setTestSending(true);
    try {
      await onSendTestAlert();
    } finally {
      setTestSending(false);
    }
  };

  return (
    <div
      className="p-5 rounded-2xl border bg-slate-950/90 border-cyan-500/30 font-mono text-xs space-y-5 shadow-xl"
      data-testid="notifications-and-alerts-panel"
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-white/10">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-xl bg-cyan-500/15 border border-cyan-400/40 text-cyan-400">
            <Bell className="h-4 w-4" />
          </div>
          <div>
            <h4 className="text-sm font-black uppercase tracking-wider text-white">
              Notifications &amp; Alerts (Off-Screen Pre-Entry)
            </h4>
            <p className="text-[11px] text-slate-400">
              Proactive SMS (Twilio) &amp; Telegram Bot push notifications before a trade executes so you have time to open Fidelity.
            </p>
          </div>
        </div>
        <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 uppercase">
          Deduplicated · 1x Per Setup
        </span>
      </div>

      {/* Form Inputs & Independent Toggles */}
      <form onSubmit={handleSave} className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* 1. SMS Phone Number Input & Toggle */}
          <div className="p-4 rounded-xl border border-white/10 bg-black/40 space-y-3">
            <div className="flex items-center justify-between">
              <label
                htmlFor="input-alert-phone-number"
                className="flex items-center gap-1.5 font-bold text-slate-200 uppercase tracking-wider text-[11px]"
              >
                <Phone className="h-3.5 w-3.5 text-cyan-400" />
                <span>Phone Number (SMS)</span>
              </label>

              {/* SMS Alerts Toggle Switch */}
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-slate-400">
                  {settings.smsEnabled ? "SMS ON" : "SMS OFF"}
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={settings.smsEnabled}
                  aria-label="Enable SMS Alerts"
                  data-testid="toggle-sms-alerts"
                  onClick={() => onUpdateSettings({ smsEnabled: !settings.smsEnabled })}
                  className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${
                    settings.smsEnabled ? "bg-[#00E676]" : "bg-slate-700"
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-slate-950 shadow transition duration-200 ease-in-out ${
                      settings.smsEnabled ? "translate-x-4" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>
            </div>

            <input
              id="input-alert-phone-number"
              type="tel"
              data-testid="input-alert-phone-number"
              value={settings.phoneNumber}
              onChange={(e) => onUpdateSettings({ phoneNumber: e.target.value })}
              placeholder="+1 555-555-5555"
              className="w-full px-3 py-2 rounded-lg bg-slate-900/90 border border-slate-700 text-white font-mono text-xs focus:outline-none focus:border-cyan-400"
            />
            <div className="text-[10px] text-slate-400">
              Format: <code className="text-cyan-300">+1 555-555-5555</code> · Delivered via Twilio SMS SDK.
            </div>
          </div>

          {/* 2. Telegram Chat ID Input, Tooltip & Toggle */}
          <div className="p-4 rounded-xl border border-white/10 bg-black/40 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <label
                  htmlFor="input-alert-telegram-chat-id"
                  className="flex items-center gap-1.5 font-bold text-slate-200 uppercase tracking-wider text-[11px]"
                >
                  <MessageCircle className="h-3.5 w-3.5 text-sky-400" />
                  <span>Telegram Chat ID</span>
                </label>
                <button
                  type="button"
                  data-testid="button-telegram-chat-id-help"
                  onClick={() => setShowTelegramHelp((prev) => !prev)}
                  onMouseEnter={() => setShowTelegramHelp(true)}
                  className="text-slate-400 hover:text-cyan-300 transition-colors cursor-pointer"
                  title="How to get your Telegram Chat ID: Message @userinfobot or your setup bot with /start to receive your numeric Chat ID."
                >
                  <HelpCircle className="h-3.5 w-3.5" />
                </button>
              </div>

              {/* Telegram Alerts Toggle Switch */}
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-slate-400">
                  {settings.telegramEnabled ? "TELEGRAM ON" : "TELEGRAM OFF"}
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={settings.telegramEnabled}
                  aria-label="Enable Telegram Alerts"
                  data-testid="toggle-telegram-alerts"
                  onClick={() =>
                    onUpdateSettings({ telegramEnabled: !settings.telegramEnabled })
                  }
                  className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${
                    settings.telegramEnabled ? "bg-sky-400" : "bg-slate-700"
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-slate-950 shadow transition duration-200 ease-in-out ${
                      settings.telegramEnabled ? "translate-x-4" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>
            </div>

            <input
              id="input-alert-telegram-chat-id"
              type="text"
              data-testid="input-alert-telegram-chat-id"
              value={settings.telegramChatId}
              onChange={(e) => onUpdateSettings({ telegramChatId: e.target.value })}
              placeholder="e.g. 123456789"
              className="w-full px-3 py-2 rounded-lg bg-slate-900/90 border border-slate-700 text-white font-mono text-xs focus:outline-none focus:border-sky-400"
            />

            {/* Tooltip / Helper Box explaining how to get Chat ID from setup bot */}
            <div
              data-testid="tooltip-telegram-chat-id-help"
              className={`p-2.5 rounded-lg border text-[10px] leading-relaxed transition-all ${
                showTelegramHelp
                  ? "bg-sky-950/60 border-sky-400/50 text-sky-200"
                  : "bg-slate-900/50 border-white/5 text-slate-400"
              }`}
            >
              <strong className="text-sky-300">How to get your Chat ID:</strong> Open Telegram, message your setup bot (or <code className="text-white">@userinfobot</code>) with <code className="text-white">/start</code>, and paste the numeric Chat ID it replies with above.
            </div>
          </div>
        </div>

        {/* Active Trigger Rules Summary */}
        <div className="p-3.5 rounded-xl border border-white/10 bg-slate-900/60 space-y-2">
          <div className="text-[10.5px] font-bold uppercase tracking-wider text-cyan-300 flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5" />
            <span>Active Pre-Entry Trigger Conditions (Fires 1x Per Setup)</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px] text-slate-300">
            <div className="p-2 rounded bg-black/40 border border-white/5">
              <strong className="text-emerald-400">Trigger 1 (Proximity Warning):</strong> Fires when live price comes within <code className="text-white">0.25%</code> of <code className="text-white">entryPrice</code> (the 20/50 SMA support level).
            </div>
            <div className="p-2 rounded bg-black/40 border border-white/5">
              <strong className="text-amber-400">Trigger 2 (Time-Based Warning):</strong> Fires when setup is <code className="text-white">FORMING</code> and time is exactly <code className="text-white">3 minutes</code> before the 1H candle close (e.g. 9:57 AM, 10:57 AM).
            </div>
          </div>
        </div>

        {/* Lock-Screen Alert Message Formatting Preview */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="p-3 rounded-xl bg-black/60 border border-emerald-500/30 space-y-1.5">
            <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-400">
              Lock-Screen Preview — Proximity Trigger (0.25% of SMA)
            </div>
            <pre
              className="text-[11px] text-slate-200 whitespace-pre-wrap font-mono leading-relaxed"
              data-testid="preview-offscreen-alert-message"
            >
              {previewProximityMsg}
            </pre>
          </div>
          <div className="p-3 rounded-xl bg-black/60 border border-amber-500/30 space-y-1.5">
            <div className="text-[10px] font-bold uppercase tracking-wider text-amber-400">
              Lock-Screen Preview — 1H Pre-Close Trigger (3 Mins)
            </div>
            <pre
              className="text-[11px] text-slate-200 whitespace-pre-wrap font-mono leading-relaxed"
              data-testid="preview-offscreen-time-alert-message"
            >
              {previewTimeMsg}
            </pre>
          </div>
        </div>

        {/* Save & Send Test Buttons */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          <div className="flex items-center gap-2">
            <button
              type="submit"
              data-testid="button-save-offscreen-alert-settings"
              className="px-4 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold uppercase tracking-wider text-xs transition-all cursor-pointer shadow-md"
            >
              Save Notification Settings
            </button>
            <button
              type="button"
              data-testid="button-send-test-offscreen-alert"
              onClick={handleTest}
              disabled={testSending}
              className="px-4 py-2 rounded-xl border border-emerald-500/40 bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 font-bold uppercase tracking-wider text-xs flex items-center gap-1.5 transition-all cursor-pointer"
            >
              <Send className="h-3.5 w-3.5" />
              <span>{testSending ? "Sending..." : "Send Test Pre-Entry Alert"}</span>
            </button>
          </div>

          {savedBanner && (
            <span
              className="text-emerald-400 text-xs font-bold flex items-center gap-1"
              data-testid="banner-alert-settings-saved"
            >
              <CheckCircle2 className="h-4 w-4" />
              <span>Preferences saved to profile &amp; local storage</span>
            </span>
          )}
        </div>
      </form>
    </div>
  );
}

