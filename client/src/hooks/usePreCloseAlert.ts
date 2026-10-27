import { useState, useEffect, useRef, useCallback } from "react";
import { useToast } from "@/hooks/use-toast";

export const PRE_CLOSE_ALERT_MESSAGE =
  "[ ACTION REQUIRED: 1H Candle closing in 3 minutes - Prepare to Arm ]";

export const PRE_CLOSE_TRIGGER_MINUTE = 57; // 60 - 3 = 57 (e.g., 9:57 AM, 10:57 AM)

export interface PreCloseWindowEvaluation {
  shouldAlert: boolean;
  isThreeMinuteWindow: boolean;
  minutesRemaining: number;
  secondsRemaining: number;
  hourKey: string;
  alertMessage: string;
}

export interface PreCloseAlertOptions {
  symbol?: string;
  isSetupForming: boolean;
  entryPrice?: number;
  audioEnabledByDefault?: boolean;
  checkIntervalMs?: number;
}

export interface PreCloseAlertResult {
  isPreCloseAlertActive: boolean;
  alertMessage: string;
  minutesRemaining: number;
  secondsRemaining: number;
  audioEnabled: boolean;
  setAudioEnabled: (enabled: boolean) => void;
  dismissPreCloseAlert: () => void;
  triggerPreCloseAlertNow: () => void;
}

/**
 * Pure helper synced to system clock to evaluate whether we are at the 3-minute pre-close mark (e.g. :57)
 * while a setup is actively forming.
 */
export function evaluatePreCloseAlertWindow(
  now: Date | number,
  isSetupForming: boolean
): PreCloseWindowEvaluation {
  const date = typeof now === "number" ? new Date(now) : now;
  const minutes = date.getMinutes();
  const seconds = date.getSeconds();
  const minutesRemaining = Math.max(0, 60 - minutes);
  const secondsRemaining = Math.max(0, (59 - minutes) * 60 + (60 - seconds));
  const isThreeMinuteWindow = minutes === PRE_CLOSE_TRIGGER_MINUTE;
  const shouldAlert = Boolean(isSetupForming && isThreeMinuteWindow);
  const hourKey = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}-${date.getHours()}`;

  return {
    shouldAlert,
    isThreeMinuteWindow,
    minutesRemaining,
    secondsRemaining,
    hourKey,
    alertMessage: PRE_CLOSE_ALERT_MESSAGE,
  };
}

/**
 * Plays a clean, institutional two-tone Web Audio API chime when the 1H pre-close alert fires.
 * Safe in headless/SSR/test environments where AudioContext is unavailable.
 */
export function playPreCloseAudioChime(): boolean {
  try {
    if (typeof window === "undefined") return false;
    const AudioCtx =
      (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return false;

    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    // First tone (880 Hz A5)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = "sine";
    osc1.frequency.setValueAtTime(880, now);
    gain1.gain.setValueAtTime(0.08, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.18);

    // Second tone (1174.66 Hz D6)
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = "sine";
    osc2.frequency.setValueAtTime(1174.66, now + 0.2);
    gain2.gain.setValueAtTime(0.09, now + 0.2);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.2);
    osc2.stop(now + 0.45);

    return true;
  } catch {
    return false;
  }
}

/**
 * Timer hook synced to the system clock.
 * Exactly 3 minutes before the top of the hour (e.g., 9:57 AM, 10:57 AM), if a setup is forming,
 * triggers a high-visibility UI toast and optional audio chime:
 * `[ ACTION REQUIRED: 1H Candle closing in 3 minutes - Prepare to Arm ]`
 */
export function usePreCloseAlert(
  options: PreCloseAlertOptions
): PreCloseAlertResult {
  const {
    symbol = "ACTIVE",
    isSetupForming,
    entryPrice,
    audioEnabledByDefault = true,
    checkIntervalMs = 1000,
  } = options;

  const { toast } = useToast();
  const [audioEnabled, setAudioEnabled] = useState<boolean>(audioEnabledByDefault);
  const [isPreCloseAlertActive, setIsPreCloseAlertActive] = useState<boolean>(false);
  const [clockState, setClockState] = useState(() =>
    evaluatePreCloseAlertWindow(new Date(), isSetupForming)
  );
  const lastFiredHourKeyRef = useRef<string | null>(null);

  const fireAlert = useCallback(
    (hourKey?: string) => {
      if (hourKey) {
        lastFiredHourKeyRef.current = hourKey;
      }
      setIsPreCloseAlertActive(true);
      if (audioEnabled) {
        playPreCloseAudioChime();
      }
      toast({
        title: PRE_CLOSE_ALERT_MESSAGE,
        description: entryPrice
          ? `${symbol} 1H confirmation bar closes in 3m. Review Buy Limit at $${entryPrice.toFixed(2)}.`
          : `${symbol} 1H confirmation bar closes in 3m. Prepare to arm setup if candle closes green above 20-SMA.`,
      });
    },
    [audioEnabled, entryPrice, symbol, toast]
  );

  useEffect(() => {
    const checkClock = () => {
      const evalResult = evaluatePreCloseAlertWindow(new Date(), isSetupForming);
      setClockState(evalResult);

      if (
        evalResult.shouldAlert &&
        lastFiredHourKeyRef.current !== evalResult.hourKey
      ) {
        fireAlert(evalResult.hourKey);
      }
    };

    checkClock();
    const timer = setInterval(checkClock, checkIntervalMs);
    return () => clearInterval(timer);
  }, [isSetupForming, checkIntervalMs, fireAlert]);

  const dismissPreCloseAlert = useCallback(() => {
    setIsPreCloseAlertActive(false);
  }, []);

  const triggerPreCloseAlertNow = useCallback(() => {
    fireAlert();
  }, [fireAlert]);

  return {
    isPreCloseAlertActive,
    alertMessage: PRE_CLOSE_ALERT_MESSAGE,
    minutesRemaining: clockState.minutesRemaining,
    secondsRemaining: clockState.secondsRemaining,
    audioEnabled,
    setAudioEnabled,
    dismissPreCloseAlert,
    triggerPreCloseAlertNow,
  };
}
