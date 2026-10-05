// One status vocabulary for the whole cockpit.
// The engine status (READY_TO_TRADE…) says whether a PRACTICE setup qualified; live-risk permission comes
// from the effective market regime (red = Capital Protection). Every label in the app reads both from the
// same sources the server uses, so a card, the scanner, the chart and the banner can never disagree.
import { useQuery } from "@tanstack/react-query";
import { STATUS_LABEL, type SetupStatus } from "@shared/swingDecision";

type RegimeResp = { effective?: { code: string; source: string } };
export function useLiveAllowed(): boolean | null {
  const { data } = useQuery<RegimeResp>({ queryKey: ["/api/regime"], staleTime: 60_000, refetchInterval: 5 * 60_000 });
  return data?.effective ? data.effective.code !== "red" : null;
}
export const PRACTICE_READY_LABEL = "Practice Ready — live entry not permitted";
export function liveStatusLabel(s: SetupStatus, liveAllowed: boolean | null): string {
  return s === "READY_TO_TRADE" && liveAllowed === false ? PRACTICE_READY_LABEL : STATUS_LABEL[s];
}
export function useLiveStatusLabel() {
  const allowed = useLiveAllowed();
  return (s: SetupStatus) => liveStatusLabel(s, allowed);
}
