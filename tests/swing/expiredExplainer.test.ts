import { describe, it, expect } from "vitest";
import { expiredExplainer, nextClosed1H } from "../../shared/tradeSummary";

const base: any = { setupStatus: "SIGNAL_EXPIRED", setupType: "STRONG_BULL_BAR", whyNotReady: ["Expired Sep 24, 3:00 PM CT: no closed 1H above trigger $610.00 within 2 closed 4H bar(s) of the setup"], failedRules: [] };
describe("expiredExplainer", () => {
  it("only for expired cards", () => { expect(expiredExplainer({ ...base, setupStatus: "SETUP_FORMING" }, Date.now())).toBeNull(); });
  it("explains missing confirmation and event-driven reset", () => {
    const e = expiredExplainer(base, Date.UTC(2026, 8, 25, 13, 45))!; // Fri 8:45 CT
    expect(e.why).toMatch(/CLOSED 1H/);
    expect(e.reset).toMatch(/no timer/i);
    expect(e.reset).toMatch(/9:30/);
  });
  it("invalidated wording", () => {
    const e = expiredExplainer({ ...base, whyNotReady: ["Setup invalidated — closed 1H $540 < structure $545 (x)"] }, Date.now())!;
    expect(e.why).toMatch(/invalidated/);
  });
  it("skips weekends", () => {
    const t = nextClosed1H(Date.UTC(2026, 8, 25, 21, 0)); // Fri 4:00 PM CT
    expect(new Date(t).toISOString()).toBe("2026-09-28T14:30:00.000Z"); // Mon 9:30 CT
  });
});
