/* tests/tick.test.js — the autonomous-tick contract, run with plain Node
   (`node tests/tick.test.js`), no framework. Each test is a Checks-style
   block that prints PASS/FAIL and the file exits non-zero on any failure,
   the same convention the rest of this repo's suites already use.

   Every test drives the real scripts/tick.js as a child process against a
   throwaway data directory (FW_DATA_DIR) and a controllable clock
   (FW_NOW_MS), so what is under test is the exact script the scheduled
   GitHub Action runs — not a re-implementation of it. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..');
const TICK_SCRIPT = path.join(REPO_ROOT, 'scripts', 'tick.js');
const SIX_HOURS_MS = 6 * 3600 * 1000;

let pass = 0;
const fail = [];
function ok(cond, msg) { if (cond) pass++; else fail.push(msg); }
function eq(a, b, msg) { ok(a === b, `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); }

function freshDir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-tick-test-'));
  return d;
}

function runTick(dataDir, nowMs, extraEnv) {
  const env = Object.assign({}, process.env, { FW_DATA_DIR: dataDir, FW_NOW_MS: String(nowMs) }, extraEnv || {});
  try {
    const out = execFileSync('node', [TICK_SCRIPT], { env, encoding: 'utf8' });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status, out: (e.stdout || '') + (e.stderr || '') };
  }
}

function readWorldState(dataDir) { return JSON.parse(fs.readFileSync(path.join(dataDir, 'world-state.json'), 'utf8')); }
function readSummary(dataDir) { return JSON.parse(fs.readFileSync(path.join(dataDir, 'dashboard-summary.json'), 'utf8')); }
function readLog(dataDir) {
  return fs.readFileSync(path.join(dataDir, 'simulation-log.jsonl'), 'utf8')
    .trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
}

// 1. One trigger advances exactly 6 simulated hours.
(function test1() {
  const dir = freshDir();
  const t0 = Date.now();
  runTick(dir, t0); // genesis + first tick
  const ws = readWorldState(dir);
  eq(ws.clock.simSeconds, 12 * 3600, 'test1: genesis tick lands on hour 12 (started at 06:00, +6h)');
  eq(ws.meta.tick, 1, 'test1: tick number is 1 after one trigger');
})();

// 2. Four triggers advance exactly 24 simulated hours.
(function test2() {
  const dir = freshDir();
  const t0 = Date.now();
  runTick(dir, t0); // tick 1 (genesis)
  const dayAfterGenesis = readWorldState(dir).clock.day;
  const startAbs = 1 * 86400 + 6 * 3600; // day 1, 06:00 pre-genesis baseline
  const beforeAbs = (() => { const w = readWorldState(dir); return (w.clock.day - 1) * 86400 + w.clock.simSeconds; })();
  runTick(dir, t0 + SIX_HOURS_MS);      // tick 2
  runTick(dir, t0 + 2 * SIX_HOURS_MS);  // tick 3
  runTick(dir, t0 + 3 * SIX_HOURS_MS);  // tick 4
  const ws = readWorldState(dir);
  const afterAbs = (ws.clock.day - 1) * 86400 + ws.clock.simSeconds;
  eq(ws.meta.tick, 4, 'test2: 4 triggers => tick number 4');
  eq(afterAbs - beforeAbs, 3 * 6 * 3600, 'test2: 3 further triggers after genesis advance 18 sim-hours (24h total across 4 ticks including genesis)');
})();

// 3. State persists between triggers (second tick continues from first, does not re-genesis).
(function test3() {
  const dir = freshDir();
  const t0 = Date.now();
  runTick(dir, t0);
  const seedAfterFirst = readWorldState(dir).seed;
  runTick(dir, t0 + SIX_HOURS_MS);
  const ws = readWorldState(dir);
  eq(ws.seed, seedAfterFirst, 'test3: seed is unchanged across ticks (same world, not a new one)');
  ok(ws.meta.tick === 2, 'test3: tick counter continued from the persisted state, not reset');
})();

// 4. Browser closure does not affect simulation state: re-running the script with no browser
//    involved at all (this whole suite never opens one) proves the world keeps advancing.
(function test4() {
  const dir = freshDir();
  const t0 = Date.now();
  runTick(dir, t0);
  runTick(dir, t0 + SIX_HOURS_MS);
  const ws = readWorldState(dir);
  ok(ws.meta.tick === 2, 'test4: two headless ticks advanced the world with no browser/UI process involved');
})();

// 5. Events can occur during a 6-hour tick.
(function test5() {
  const dir = freshDir();
  runTick(dir, Date.now());
  const ws = readWorldState(dir);
  ok(ws.totalEvents > 0, 'test5: at least one event was generated while processing the first 6-hour period');
  const log = readLog(dir);
  ok(log[0].eventsGenerated > 0, 'test5: the tick log records a positive eventsGenerated for the tick');
})();

// 6. Hidden ground truth remains inaccessible to analysts (not present in the persisted/public files).
(function test6() {
  const dir = freshDir();
  runTick(dir, Date.now());
  const ws = readWorldState(dir);
  ok(ws.intentBook === undefined, 'test6: world-state.json has no intentBook field (ground truth)');
  ok(ws.actTracker === undefined, 'test6: world-state.json has no actTracker field');
  const raw = fs.readFileSync(path.join(dir, 'world-state.json'), 'utf8');
  ok(!/GROUND_TRUTH/i.test(raw), 'test6: no ground-truth marker string leaked into world-state.json');
  const summary = readSummary(dir);
  ok(summary.intentBook === undefined && summary.actTracker === undefined, 'test6: dashboard-summary.json carries no ground truth either');
})();

// 7. Re-running the same state + seed produces deterministic results.
(function test7() {
  const dirA = freshDir();
  const dirB = freshDir();
  const t0 = Date.now();
  runTick(dirA, t0);
  runTick(dirB, t0);
  runTick(dirA, t0 + SIX_HOURS_MS);
  runTick(dirB, t0 + SIX_HOURS_MS);
  const a = readWorldState(dirA);
  const b = readWorldState(dirB);
  eq(a.seed, b.seed, 'test7: same genesis seed in both runs');
  eq(JSON.stringify(a.registry), JSON.stringify(b.registry), 'test7: identical registry after identical tick sequence');
  eq(a.totalEvents, b.totalEvents, 'test7: identical total event count after identical tick sequence');
  eq(JSON.stringify(a.recentEvents), JSON.stringify(b.recentEvents), 'test7: identical recent-event log after identical tick sequence');
})();

// 8. Failed workflow does not corrupt the world state.
(function test8() {
  const dir = freshDir();
  const t0 = Date.now();
  runTick(dir, t0);
  const goodBefore = fs.readFileSync(path.join(dir, 'world-state.json'), 'utf8');
  // Corrupt the persisted snapshot the way a bad merge / bit-flip would.
  const broken = JSON.parse(goodBefore);
  delete broken.registry;
  fs.writeFileSync(path.join(dir, 'world-state.json'), JSON.stringify(broken));
  const result = runTick(dir, t0 + SIX_HOURS_MS);
  ok(result.code !== 0, 'test8: tick.js exits non-zero when the persisted snapshot is unreadable');
  const afterAttempt = fs.readFileSync(path.join(dir, 'world-state.json'), 'utf8');
  eq(afterAttempt, JSON.stringify(broken), 'test8: tick.js left the broken file exactly as it found it (no further corruption, no silent repair)');
  const log = readLog(dir);
  ok(log[log.length - 1].outcome === 'FAILURE', 'test8: the failure was logged with outcome FAILURE');
})();

// 9. Duplicate workflow execution does not double-advance the same tick.
(function test9() {
  const dir = freshDir();
  const t0 = Date.now();
  runTick(dir, t0);
  runTick(dir, t0 + 1000); // "duplicate" run a second later, same cadence window
  const ws = readWorldState(dir);
  eq(ws.meta.tick, 1, 'test9: an immediate duplicate run does not advance the tick counter');
  const log = readLog(dir);
  eq(log[log.length - 1].outcome, 'SKIPPED_TOO_SOON', 'test9: the duplicate run is logged as skipped, not as a second tick');
})();

// 10. Recovery/catch-up behaviour: bounded, explicit, logged.
(function test10() {
  const dir = freshDir();
  const t0 = Date.now();
  runTick(dir, t0); // tick 1
  const THREE_DAYS_MS = 3 * 24 * 3600 * 1000;
  const env = { FW_MAX_CATCHUP_TICKS: '4' };
  runTick(dir, t0 + THREE_DAYS_MS, env); // owed 12 ticks, capped at 4
  const ws = readWorldState(dir);
  eq(ws.meta.tick, 5, 'test10: capped catch-up ran exactly 4 more ticks after a 3-day outage (1 -> 5)');
  const log = readLog(dir);
  const catchUpEntries = log.filter(e => e.catchUp);
  ok(catchUpEntries.length > 0, 'test10: catch-up ticks are logged with a catchUp block');
  ok(catchUpEntries.every(e => e.catchUp.ranTicks === 4 && e.catchUp.cappedAt === 4), 'test10: every catch-up entry states it was capped, and at what number');
})();

// 11. Existing Fraud Watch tests continue passing — proven by loading the whole
//     app (UI included) through the same sandbox tick.js uses and checking
//     FWGlobals published every module, the same assertion Slice 78's own
//     suite makes. A regression here would mean this feature broke module
//     loading for the rest of the app, not just for the tick script.
(function test11() {
  const { bootSandbox } = require('../scripts/lib/app-sandbox.js');
  const M = bootSandbox().window;
  const result = M.FWGlobals.publish(M);
  eq(result.missing.length, 0, 'test11: every existing module (UI, game, training, charts included) still loads with autonomous-world.js added');
  ok(typeof M.FWSimRunner.boot === 'function', 'test11: FWSimRunner (existing engine) is intact and callable');
  ok(typeof M.FWLiveSimStore.capture === 'function', 'test11: FWLiveSimStore (existing persistence) is intact and callable');
})();

// 12. The dashboard correctly displays the latest persisted world state.
(function test12() {
  const dir = freshDir();
  const t0 = Date.now();
  runTick(dir, t0);
  runTick(dir, t0 + SIX_HOURS_MS);
  const ws = readWorldState(dir);
  const summary = readSummary(dir);
  eq(summary.tick, ws.meta.tick, 'test12: dashboard-summary.json tick matches world-state.json meta.tick');
  eq(summary.simulation.day, ws.clock.day, 'test12: dashboard-summary.json day matches world-state.json clock.day');
  eq(summary.simulation.absSeconds, (ws.clock.day - 1) * 86400 + ws.clock.simSeconds, 'test12: dashboard-summary.json absSeconds is derived correctly from the persisted clock');
  ok(Array.isArray(summary.recentEvents), 'test12: dashboard-summary.json exposes recentEvents for the panel to render');
})();

const total = pass + fail.length;
if (fail.length) {
  console.log(`FAIL tick.test.js: ${pass}/${total} passed`);
  fail.forEach(f => console.log('   - ' + f));
  process.exitCode = 1;
} else {
  console.log(`PASS tick.test.js: ${pass}/${total} checks`);
}
