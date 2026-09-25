// Flag-OFF regression: compares every read endpoint between a baseline build
// (main) and a candidate build (feature branch), both running with
// ENABLE_UNIFIED_SWING_ENGINE unset. Compares HTTP status + JSON shape
// (keys and value types, recursively). Values like prices are time-varying,
// so shape — not bytes — is the stable comparison.
//   BASE_A=http://localhost:5071 BASE_B=http://localhost:5062 node scripts/flag-off-regression.mjs
const A = process.env.BASE_A || "http://localhost:5071";
const B = process.env.BASE_B || "http://localhost:5062";

const ENDPOINTS = [
  "/", "/api/regime", "/api/regime-v2", "/api/settings", "/api/watchlist",
  "/api/active-setups", "/api/setups/active", "/api/flex-scan-cached", "/api/proximity-watch",
  "/api/mtf/signals", "/api/mtf/universe", "/api/mtf/settings", "/api/mtf/rejections",
  "/api/mtf/webhook-health", "/api/ui-prefs", "/api/trades", "/api/journal",
  "/api/signal-history", "/api/feature-flags",
];
// Allowed, documented differences in PR 3 with the flag OFF.
const EXPECTED_DIFFS = {
  "/api/feature-flags": "adds key ENABLE_UNIFIED_SWING_ENGINE:false (additive)",
};

function shape(v, depth = 0) {
  if (depth > 6) return "…";
  if (v === null) return "null";
  if (Array.isArray(v)) return v.length ? [shape(v[0], depth + 1)] : [];
  if (typeof v === "object") {
    const o = {};
    for (const k of Object.keys(v).sort()) o[k] = shape(v[k], depth + 1);
    return o;
  }
  return typeof v;
}

async function probe(base, ep) {
  try {
    const r = await fetch(base + ep, { signal: AbortSignal.timeout(20000) });
    const text = await r.text();
    let body; try { body = shape(JSON.parse(text)); } catch { body = ep === "/" ? "html" : `text:${text.slice(0, 40)}`; }
    return { status: r.status, body: JSON.stringify(body) };
  } catch (e) { return { status: "ERR", body: String(e.message) }; }
}

let fail = 0;
const rows = [];
for (const ep of ENDPOINTS) {
  const [a, b] = await Promise.all([probe(A, ep), probe(B, ep)]);
  const same = a.status === b.status && a.body === b.body;
  let verdict = same ? "IDENTICAL" : (EXPECTED_DIFFS[ep] ? `EXPECTED (${EXPECTED_DIFFS[ep]})` : "DIFFERENT");
  if (verdict === "DIFFERENT") fail++;
  rows.push(`${String(a.status).padEnd(4)} ${String(b.status).padEnd(4)} ${verdict.padEnd(10)} ${ep}`);
}
console.log("main new  result     endpoint");
console.log(rows.join("\n"));
console.log(fail ? `\nFAIL: ${fail} unexpected difference(s)` : `\nPASS: ${ENDPOINTS.length} endpoints, no unexpected differences`);
process.exit(fail ? 1 : 0);
