// Global safety net: every outbound fetch() without its own AbortSignal gets a
// 10 s timeout. A single hung market-data vendor call used to stall the shared
// Yahoo queue (and every chart behind it) for minutes.
const DEFAULT_MS = Number(process.env.FETCH_TIMEOUT_MS || 10_000);
const orig = globalThis.fetch;
if (orig && !(orig as any).__timeoutWrapped) {
  const wrapped = ((input: any, init?: any) => {
    if (init?.signal) return orig(input, init);
    return orig(input, { ...(init || {}), signal: AbortSignal.timeout(DEFAULT_MS) });
  }) as typeof fetch;
  (wrapped as any).__timeoutWrapped = true;
  globalThis.fetch = wrapped;
}
export {};
