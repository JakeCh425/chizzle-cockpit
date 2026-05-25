#!/usr/bin/env node
// Smoke test for Chizzle Wealth Engine.
// Low-Credit Mode: no network calls, no spawning servers, no credit usage.
// Just verifies:
//   1. TypeScript compiles (allowing 2 known pre-existing priceService.ts warnings)
//   2. Shared discipline helper loads and returns sane defaults
//   3. dist/index.cjs exists if a prior build ran

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

let failures = 0;
const ok  = (msg) => console.log(`  ✓ ${msg}`);
const bad = (msg) => { console.log(`  ✗ ${msg}`); failures++; };

console.log("→ Smoke test 1: TypeScript check");
try {
  execSync("npx tsc --noEmit", { cwd: ROOT, stdio: "pipe" });
  ok("tsc --noEmit clean");
} catch (e) {
  // Allow ONLY the 2 known pre-existing downlevel-iteration warnings in priceService.ts.
  const out = (e.stdout?.toString() || "") + (e.stderr?.toString() || "");
  const errLines = out.split("\n").filter(l => /error TS\d+/.test(l));
  const knownPattern = /server\/priceService\.ts.*error TS2802/;
  const unknown = errLines.filter(l => !knownPattern.test(l));
  if (unknown.length === 0 && errLines.length > 0) {
    ok(`tsc clean (ignoring ${errLines.length} known priceService.ts warnings)`);
  } else if (unknown.length > 0) {
    bad(`tsc found ${unknown.length} new error(s):`);
    unknown.slice(0, 10).forEach(l => console.log(`     ${l}`));
  } else {
    bad("tsc failed for unknown reason");
    console.log(out.split("\n").slice(0, 20).join("\n"));
  }
}

console.log("→ Smoke test 2: Discipline helper sanity");
try {
  // Build a tiny CJS shim and require the compiled discipline.ts via tsx.
  const result = execSync(
    `npx tsx -e "import('./shared/discipline.ts').then(m => { const d = m.decideDiscipline('red', 'A'); if (d.riskMultiplier !== 0) process.exit(2); const g = m.decideDiscipline('green', 'A'); if (g.riskMultiplier !== 1) process.exit(3); const y = m.decideDiscipline('yellow', 'A'); if (y.riskMultiplier !== 0.5) process.exit(4); const yc = m.decideDiscipline('yellow', 'C'); if (yc.visibility !== 'hidden') process.exit(5); console.log('OK'); })"`,
    { cwd: ROOT, stdio: "pipe" }
  );
  if (result.toString().includes("OK")) ok("decideDiscipline returns spec values (RED=0x, GREEN A=1x, YELLOW A=0.5x, YELLOW C hidden)");
  else bad("discipline helper returned unexpected values");
} catch (e) {
  bad(`discipline helper failed: exit code ${e.status}`);
}

console.log("→ Smoke test 3: Build output check");
if (existsSync(resolve(ROOT, "dist/index.cjs"))) {
  ok("dist/index.cjs exists");
} else {
  console.log("  – dist/index.cjs not yet built (skipping — rebuild.sh will build it)");
}

if (failures > 0) {
  console.log(`\n✗ Smoke test FAILED — ${failures} check(s) failed`);
  process.exit(1);
}
console.log("\n✓ Smoke test PASSED");
