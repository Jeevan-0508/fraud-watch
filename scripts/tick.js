#!/usr/bin/env node
/* scripts/tick.js — the autonomous world's heartbeat.

   Run on a schedule (see .github/workflows/tick.yml), never by the
   browser. Each invocation:
     1. loads the last persisted world snapshot (or creates the world, on
        the very first run, from a fixed documented seed);
     2. figures out how many 6-simulated-hour ticks are owed since the
        last one actually ran, using wall-clock time, bounded so a workflow
        outage cannot make the world sprint forward forever;
     3. advances the SAME simulation engine the browser runs, one 6-hour
        chunk at a time, through FWSimRunner.fastForward — never by just
        setting the clock forward;
     4. writes the new snapshot, a lightweight dashboard summary, and an
        append-only tick log.

   Every step that can go wrong fails loudly and leaves the last good
   snapshot on disk untouched: a broken tick is a bug report, not a
   corrupted world. */
const fs = require('fs');
const path = require('path');
const { bootSandbox } = require('./lib/app-sandbox.js');
const { summarize } = require('./lib/summarize.js');
const { runGeneration } = require('./lib/evolution-runner.js');

const REPO_ROOT = path.join(__dirname, '..');
const DATA_DIR = process.env.FW_DATA_DIR || path.join(REPO_ROOT, 'data');
const WORLD_STATE_PATH = process.env.FW_WORLD_STATE_PATH || path.join(DATA_DIR, 'world-state.json');
const LOG_PATH = process.env.FW_LOG_PATH || path.join(DATA_DIR, 'simulation-log.jsonl');
const SUMMARY_PATH = process.env.FW_SUMMARY_PATH || path.join(DATA_DIR, 'dashboard-summary.json');
// Synthetic candidate exports are opt-in by location but automatic per tick.
// Point this at a Risk OS intake inbox for a local bridge, or leave the
// default inside data/ so the scheduled workflow can commit the exports.
const CANDIDATE_EXPORT_DIR = process.env.FW_CANDIDATE_EXPORT_DIR || path.join(DATA_DIR, 'candidate-exports');

/* The tick contract, stated as numbers so a test can assert on them by
   name instead of guessing this file's internals.
     TICK_SIM_SECONDS   — how far one tick advances the world. Fixed at
                           6 simulated hours by the product requirement.
     CADENCE_MS         — how often the trigger is INTENDED to run.
     MIN_INTERVAL_MS    — a second invocation inside this window is
                           treated as a duplicate/retry, not a new tick,
                           so two overlapping workflow runs cannot both
                           advance the same period.
     MAX_CATCHUP_TICKS  — the most 6-hour ticks one invocation will ever
                           run, no matter how long the trigger was down.
                           A dead workflow revived after a week still
                           only ever advances the world by this many
                           ticks (default 4 = one full simulated day),
                           logged as CAPPED so the gap is visible instead
                           of silently absorbed. */
const TICK_SIM_SECONDS = Number(process.env.FW_TICK_SIM_SECONDS || 6 * 3600);
const CADENCE_MS = Number(process.env.FW_TICK_CADENCE_MS || 6 * 3600 * 1000);
const MIN_INTERVAL_MS = Number(process.env.FW_MIN_INTERVAL_MS || CADENCE_MS * 0.5);
const MAX_CATCHUP_TICKS = Number(process.env.FW_MAX_CATCHUP_TICKS || 4);
const GENESIS_SEED = Number(process.env.FW_GENESIS_SEED || 424242);

function nowMs() {
  return process.env.FW_NOW_MS ? Number(process.env.FW_NOW_MS) : Date.now();
}

function readJson(p) {
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function writeJsonAtomic(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = p + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n');
  fs.renameSync(tmp, p);
}

function candidateRecords(state) {
  const records = state && state.candidateStore && state.candidateStore.records;
  if (!records) return [];
  if (typeof records.values === 'function') return Array.from(records.values());
  return Array.isArray(records) ? records.slice() : [];
}

/* Export only candidateStore records. The underlying moEngine is deliberately
   excluded: it contains simulator observations, not real-world evidence. A
   malformed or incomplete candidate is refused independently so one bad
   hypothesis cannot block the world tick or create a partial export. */
function exportCandidates(M, state, exportedAt) {
  const result = { directory: CANDIDATE_EXPORT_DIR, exported: 0, refused: 0, candidates: [] };
  if (!M.FWCandidateExport) return result;

  for (const record of candidateRecords(state)) {
    const signature = record && typeof record.signature === 'string' ? record.signature : 'unknown';
    try {
      const payload = M.FWCandidateExport.build(record, state, { exportedAt });
      const digest = require('crypto').createHash('sha256').update(payload.candidate.id).digest('hex').slice(0, 32);
      const filename = `candidate-mo-${digest}.json`;
      writeJsonAtomic(path.join(CANDIDATE_EXPORT_DIR, filename), payload);
      result.exported += 1;
      result.candidates.push({ id: payload.candidate.id, lifecycle_state: payload.candidate.lifecycle_state, file: filename });
    } catch (e) {
      result.refused += 1;
      result.candidates.push({ id: 'fraud-watch:' + signature, refused: true, reason: String(e && e.message || e) });
    }
  }

  writeJsonAtomic(path.join(CANDIDATE_EXPORT_DIR, 'manifest.json'), {
    schema_version: 'candidate-export-manifest.v1',
    exported_at: exportedAt,
    source: { repository: 'Jeevan-0508/fraud-watch', authenticity: 'unverified_export', data_class: 'synthetic_simulation' },
    boundary: 'candidate hypotheses only; never real-world evidence or scored risks',
    candidates: result.candidates
  });
  return result;
}

function appendLog(entry) {
  fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
  fs.appendFileSync(LOG_PATH, JSON.stringify(entry) + '\n');
}

function simTimestamp(clock) {
  return { day: clock.day, timeOfDay: clock.timeOfDay(), absSeconds: (clock.day - 1) * 86400 + clock.simSeconds };
}

/* ONE EVOLUTIONARY GENERATION PER INVOCATION, never per 6-hour sub-tick a
   catch-up run advances through -- MAX_GENERATIONS_PER_TICK (evolutionEngine.js,
   section 21) means per tick.js run, and a catch-up run advancing four owed
   ticks in one invocation is still one run of this script. Proposes a
   generation against M's own FWBehaviorEngine.LIFECYCLE/DISRUPTION_ELIGIBLE_STAGES
   (the exact values M.FWIntentEngine.createBook already used to build this
   same state's intentBook) and scratch-simulates every candidate it produced,
   each in its OWN disposable sandbox (scripts/lib/evolution-runner.js), never
   this one. Returns null, doing nothing else, when FWEvolutionEngine or
   state.evolutionStore is not loaded -- the same null-in/null-out discipline
   candidateStore already uses elsewhere in this script's own state object. */
function runEvolutionStep(M, state, execAt) {
  if (!M.FWEvolutionEngine || !state.evolutionStore) return null;
  const lifecycle = M.FWBehaviorEngine.LIFECYCLE;
  const eligibleStages = [...M.FWBehaviorEngine.DISRUPTION_ELIGIBLE_STAGES];
  const sampleSeconds = state.intentBook ? state.intentBook.sampleSeconds : M.FWSimRunner.FF_CHUNK;
  const before = state.evolutionStore.generation;
  const proposed = M.FWEvolutionEngine.proposeGeneration(
    state.evolutionStore, state.seed, lifecycle, eligibleStages, sampleSeconds, { now: execAt }
  );
  const ran = runGeneration(M.FWEvolutionEngine, state.evolutionStore, { now: execAt });
  const nominated = ran.results.filter(r => r.simulated && r.score && r.score.total >= 0.5).length;
  // Logging is the caller's job, not this function's: appendLog() must run after the tick's
  // own GENESIS_TICK/TICK entry so that entry stays log[0] for a single-tick log file.
  return {
    generation: proposed.generation, previousGeneration: before,
    produced: proposed.produced.length, budgetExhausted: proposed.budgetExhausted,
    simulated: ran.count, nominated,
    byState: M.FWEvolutionEngine.summary(state.evolutionStore).byState
  };
}

function main() {
  const M = bootSandbox().window;
  const existing = readJson(WORLD_STATE_PATH);
  const execAt = new Date(nowMs()).toISOString();

  if (!existing) {
    // GENESIS: the world has never run before. Boot from a fixed, documented
    // seed (not Math.random()) so this repository's autonomous history is
    // reproducible from tick #1, and immediately run the first tick rather
    // than waiting a further 6 hours for a world nobody has ever observed.
    const state = M.FWSimRunner.boot(GENESIS_SEED);
    const before = simTimestamp(state.clock);
    const eventsBefore = state.totalEvents;
    M.FWSimRunner.fastForward(TICK_SIM_SECONDS);
    const after = simTimestamp(state.clock);
    const evolution = runEvolutionStep(M, state, execAt);
    const candidateExports = exportCandidates(M, state, execAt);
    const snapshot = M.FWLiveSimStore.capture(state);
    snapshot.meta = { tick: 1, lastTickReal: execAt, seedOrigin: 'GENESIS', seed: GENESIS_SEED,
      tickSimSeconds: TICK_SIM_SECONDS, cadenceMs: CADENCE_MS };
    writeJsonAtomic(WORLD_STATE_PATH, snapshot);
    const summary = summarize(state, {
      tick: 1, lastTickReal: execAt, nextExpectedTickReal: new Date(nowMs() + CADENCE_MS).toISOString()
    });
    summary.candidateExports = candidateExports;
    writeJsonAtomic(SUMMARY_PATH, summary);
    appendLog({
      outcome: 'GENESIS_TICK', tick: 1, triggeredAt: execAt,
      previousSimTimestamp: before, newSimTimestamp: after,
      simSecondsAdvanced: TICK_SIM_SECONDS,
      eventsGenerated: state.totalEvents - eventsBefore, totalEventsAfter: state.totalEvents,
      seed: GENESIS_SEED
    });
    if (evolution) appendLog(Object.assign({ outcome: 'EVOLUTION_GENERATION', triggeredAt: execAt }, evolution));
    appendLog(Object.assign({ outcome: 'CANDIDATE_EXPORT', triggeredAt: execAt }, candidateExports));
    console.log(`GENESIS_TICK #1: day ${before.day} ${before.timeOfDay} -> day ${after.day} ${after.timeOfDay}` +
      (evolution ? ` evolution gen ${evolution.generation}: ${evolution.produced} produced, ${evolution.nominated} nominated.` : ''));
    return;
  }

  const lastTickReal = existing.meta && existing.meta.lastTickReal;
  const lastTick = (existing.meta && existing.meta.tick) || 0;
  const elapsedMs = lastTickReal ? nowMs() - Date.parse(lastTickReal) : CADENCE_MS;

  if (elapsedMs < MIN_INTERVAL_MS) {
    appendLog({
      outcome: 'SKIPPED_TOO_SOON', tick: lastTick, triggeredAt: execAt,
      elapsedMs, minIntervalMs: MIN_INTERVAL_MS,
      reason: 'a tick already ran inside this cadence window; treated as a duplicate/retry trigger, not a new tick.'
    });
    console.log(`SKIPPED_TOO_SOON: last tick ${elapsedMs}ms ago, minimum interval is ${MIN_INTERVAL_MS}ms.`);
    return;
  }

  const owedTicks = Math.max(1, Math.round(elapsedMs / CADENCE_MS));
  const ranTicks = Math.min(owedTicks, MAX_CATCHUP_TICKS);
  const capped = owedTicks > MAX_CATCHUP_TICKS;

  let state;
  try {
    state = M.FWSimRunner.restore(existing);
    if (!state) throw new Error('FWSimRunner.restore refused the persisted snapshot: ' + JSON.stringify(M.FWSimRunner.restoreReport()));
  } catch (e) {
    appendLog({ outcome: 'FAILURE', tick: lastTick, triggeredAt: execAt, phase: 'RESTORE', error: String(e && e.message || e) });
    console.error('FAILURE restoring world-state.json — leaving the persisted snapshot untouched.', e);
    process.exitCode = 1;
    return;
  }

  try {
    let tick = lastTick;
    const eventsAtStart = state.totalEvents;
    for (let i = 0; i < ranTicks; i++) {
      const before = simTimestamp(state.clock);
      const eventsBefore = state.totalEvents;
      M.FWSimRunner.fastForward(TICK_SIM_SECONDS);
      const after = simTimestamp(state.clock);
      tick += 1;
      appendLog({
        outcome: capped && i === ranTicks - 1 ? 'TICK_CAPPED' : (ranTicks > 1 ? 'TICK_CATCHUP' : 'TICK'),
        tick, triggeredAt: execAt,
        previousSimTimestamp: before, newSimTimestamp: after,
        simSecondsAdvanced: TICK_SIM_SECONDS,
        eventsGenerated: state.totalEvents - eventsBefore, totalEventsAfter: state.totalEvents,
        catchUp: ranTicks > 1 ? { owedTicks, ranTicks, cappedAt: capped ? MAX_CATCHUP_TICKS : null, elapsedMs } : undefined
      });
    }

    const nextExpectedTickReal = new Date(nowMs() + CADENCE_MS).toISOString();
    const evolution = runEvolutionStep(M, state, execAt);
    const candidateExports = exportCandidates(M, state, execAt);
    const snapshot = M.FWLiveSimStore.capture(state);
    snapshot.meta = { tick, lastTickReal: execAt, seedOrigin: existing.meta ? existing.meta.seedOrigin : 'UNKNOWN',
      seed: state.seed, tickSimSeconds: TICK_SIM_SECONDS, cadenceMs: CADENCE_MS };
    writeJsonAtomic(WORLD_STATE_PATH, snapshot);
    const summary = summarize(state, { tick, lastTickReal: execAt, nextExpectedTickReal });
    summary.candidateExports = candidateExports;
    writeJsonAtomic(SUMMARY_PATH, summary);
    if (evolution) appendLog(Object.assign({ outcome: 'EVOLUTION_GENERATION', triggeredAt: execAt }, evolution));
    appendLog(Object.assign({ outcome: 'CANDIDATE_EXPORT', triggeredAt: execAt }, candidateExports));

    console.log(`TICK(s) #${lastTick + 1}..#${tick} of ${ranTicks} run (owed ${owedTicks}${capped ? ', capped at ' + MAX_CATCHUP_TICKS : ''}). ` +
      `events this run: ${state.totalEvents - eventsAtStart}. now: day ${state.clock.day} ${state.clock.timeOfDay()}.` +
      (evolution ? ` evolution gen ${evolution.generation}: ${evolution.produced} produced, ${evolution.nominated} nominated.` : ''));
  } catch (e) {
    appendLog({ outcome: 'FAILURE', tick: lastTick, triggeredAt: execAt, phase: 'ADVANCE', error: String(e && e.message || e) });
    console.error('FAILURE advancing the world — leaving the last good world-state.json untouched.', e);
    process.exitCode = 1;
  }
}

main();
