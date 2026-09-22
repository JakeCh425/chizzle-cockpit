// Extension tier classifier — 10 validation cases from the redesign spec.
// Runs with plain `node` (no test framework dependency).
//
// Usage: node server/__tests__/extensionTier.test.mjs
//
// The classifier module is TypeScript; we compile-on-the-fly by pulling it
// through a tiny esbuild shim so this test stays self-contained.

import { fileURLToPath } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";
import { build } from "esbuild";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");

// Bundle the classifier + shared types into an ESM string and load it.
const bundled = await build({
  entryPoints: [path.join(repoRoot, "server/extensionTier.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  write: false,
  logLevel: "silent",
  alias: { "@shared": path.join(repoRoot, "shared") },
});
const dataUrl = "data:text/javascript;base64," + Buffer.from(bundled.outputFiles[0].text).toString("base64");
const mod = await import(dataUrl);
const { classifyExtensionTier, summarizeExtension, mapSetupFamily } = mod;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message}`); }
}

console.log("Extension tier classifier tests\n");

// ─── Tier boundary tests ─────────────────────────────────────────────────────
test("normal: price at SMA20", () => {
  assert.equal(classifyExtensionTier(100, 100, 2), "normal");
});
test("normal: below SMA20 (negative distance)", () => {
  assert.equal(classifyExtensionTier(95, 100, 2), "normal");
});
test("normal: 0.5 ATR above", () => {
  assert.equal(classifyExtensionTier(101, 100, 2), "normal");
});
test("caution: exactly 0.75 ATR above", () => {
  assert.equal(classifyExtensionTier(101.5, 100, 2), "caution");
});
test("caution: 1.0 ATR above", () => {
  assert.equal(classifyExtensionTier(102, 100, 2), "caution");
});
test("extended: exactly 1.25 ATR above (the old hard-block boundary)", () => {
  assert.equal(classifyExtensionTier(102.5, 100, 2), "extended");
});
test("extended: 1.75 ATR above", () => {
  assert.equal(classifyExtensionTier(103.5, 100, 2), "extended");
});
test("severely_extended: exactly 2.0 ATR above", () => {
  assert.equal(classifyExtensionTier(104, 100, 2), "severely_extended");
});
test("severely_extended: 3.5 ATR above", () => {
  assert.equal(classifyExtensionTier(107, 100, 2), "severely_extended");
});
test("null: zero or missing ATR", () => {
  assert.equal(classifyExtensionTier(100, 100, 0), null);
  assert.equal(classifyExtensionTier(NaN, 100, 2), null);
});

// ─── The SPY case from the user's screenshot ─────────────────────────────────
test("SPY 596.03 vs SMA20 559.60 lands in extended, NOT severely_extended", () => {
  // Distance = 36.43. If we back-compute ATR that made the old rule fire at
  // 1.25 ATR: ATR ≈ 36.43 / 1.25 ≈ 29.14. That's an implausibly large ATR for
  // SPY — the OP screenshot used a smaller ATR14. We test both a "just past
  // 1.25" and a "well past 2.0" configuration to confirm behavior:
  // Case A: ATR = 26 → 36.43 / 26 = 1.40 ATR → extended (soft block, visible)
  const tierA = classifyExtensionTier(596.03, 559.60, 26);
  assert.equal(tierA, "extended", `expected extended, got ${tierA}`);
  // Case B: ATR = 10 → 3.64 ATR → severely_extended (hard block)
  const tierB = classifyExtensionTier(596.03, 559.60, 10);
  assert.equal(tierB, "severely_extended", `expected severely_extended, got ${tierB}`);
});

// ─── Setup-aware copy tests ──────────────────────────────────────────────────
test("extended + pullback → 'WAIT FOR PULLBACK'", () => {
  const s = summarizeExtension(103.5, 100, 2, "pullback");
  assert.ok(s.headline.includes("WAIT FOR PULLBACK"), s.headline);
});
test("extended + breakout → 'DO NOT CHASE'", () => {
  const s = summarizeExtension(103.5, 100, 2, "breakout");
  assert.ok(s.headline.includes("DO NOT CHASE"), s.headline);
});
test("extended + bounce → mentions bounce already played", () => {
  const s = summarizeExtension(103.5, 100, 2, "bounce");
  assert.ok(/bounce/i.test(s.headline) || /bounce/i.test(s.detail), s.headline);
});
test("extended + continuation → 'WATCH FOR CONSOLIDATION'", () => {
  const s = summarizeExtension(103.5, 100, 2, "continuation");
  assert.ok(s.headline.includes("WATCH FOR CONSOLIDATION"), s.headline);
});
test("severely_extended → 'NEW ENTRY BLOCKED'", () => {
  const s = summarizeExtension(107, 100, 2, "breakout");
  assert.ok(s.headline.includes("NEW ENTRY BLOCKED"), s.headline);
});
test("caution → non-zero penalty but no block language", () => {
  const s = summarizeExtension(102, 100, 2, "pullback");
  assert.equal(s.tier, "caution");
  assert.equal(s.score_penalty, 10);
  assert.ok(!s.headline.includes("BLOCKED"), s.headline);
});
test("normal → zero penalty", () => {
  const s = summarizeExtension(100.5, 100, 2, "pullback");
  assert.equal(s.tier, "normal");
  assert.equal(s.score_penalty, 0);
});

// ─── mapSetupFamily unit tests ───────────────────────────────────────────────
test("mapSetupFamily maps scanner setup strings correctly", () => {
  assert.equal(mapSetupFamily("Trend continuation"), "continuation");
  assert.equal(mapSetupFamily("Higher-low recovery"), "reclaim");
  assert.equal(mapSetupFamily("Developing recovery"), "reclaim");
  // 'Bounce reclaim' contains both keywords; reclaim wins (checked first).
  assert.equal(mapSetupFamily("Bounce reclaim"), "reclaim");
  assert.equal(mapSetupFamily("Bounce off support"), "bounce");
  assert.equal(mapSetupFamily("Breakout base"), "breakout");
  assert.equal(mapSetupFamily(null), "unknown");
});

// ─── Extension math accuracy ─────────────────────────────────────────────────
test("summary math is correct", () => {
  const s = summarizeExtension(110, 100, 4, "continuation");
  assert.equal(s.atr_distance, 2.5); // (110-100)/4
  assert.equal(s.pct_distance, 10);  // 10/100 * 100
  assert.equal(s.dollar_distance, 10);
  assert.equal(s.tier, "severely_extended");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
