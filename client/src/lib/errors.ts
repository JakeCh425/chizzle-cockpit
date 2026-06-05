// Tiny error-message extractor so callers can write
//   catch (e: unknown) { toast({ description: errMsg(e) }) }
// instead of `(e: any)?.message`. Handles native Error, plain objects with
// a string message field, and falls back to String(e).
export function errMsg(e: unknown, fallback = ""): string {
  if (e instanceof Error) return e.message || fallback;
  if (typeof e === "string") return e || fallback;
  if (e && typeof e === "object" && "message" in e) {
    const m = (e as { message?: unknown }).message;
    if (typeof m === "string" && m) return m;
  }
  try {
    const s = String(e);
    return s && s !== "[object Object]" ? s : fallback;
  } catch {
    return fallback;
  }
}
