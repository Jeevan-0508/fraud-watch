/* Slice 62 -- the register of what the display refusals actually refuse.

   Six functions in this codebase refuse to render a value nobody derived:
   moEngine.formatIndex, moEngine.confidenceLabel, moEngine.bandTone,
   signalEngine.formatDecay, signalEngine.formatReliability and
   entityEngine.formatStatus. Each throws a carefully worded sentence when it is
   handed nothing. Two things were measured about them, and both mattered.

   FIRST: every one of them checked that a value EXISTS, and not one checked
   that the value is on the scale its own output string states. So formatIndex
   printed "250 / 100" -- a numerator over a denominator it had just violated --
   formatReliability printed "type reliability 5 (a multiplier on 0-1)", and
   confidenceLabel banded an index of 1000 as STRONG and an index of -50 as
   MINIMAL without a word. The output string is the claim: "x / 100" asserts
   that 100 is the scale x sits on, and "a multiplier on 0-1" asserts that the
   number in front of it is one. A formatter that does not check that is itself
   the thing printing the false statement, and no caller can be blamed for it.
   A refusal that only detects absence is not a refusal to render an underived
   value; it is a null check with a sentence attached.

   SECOND, and this is the part that changes how the first should be read:
   nothing the app itself does can reach any of these six refusals with a bad
   value. Measured over a twenty-day run -- 5 cases, 13 evidence rows, 318
   derived signals, 49 entities -- every caller passes a value that was clamped,
   copied off a validated table, or checked by the caller itself. So these are
   boundary checks on public functions, not run-time protections, and there is
   deliberately no RUNTIME kind declared below. Their never having fired is not
   evidence about this program. It was worth finding out which of the two
   sentences applies, because "this guard has never fired" reads as reassurance
   and here it means nothing at all.

   This module is the register, not the fix -- the scale checks live in the
   formatters, where the string is built and where the scale is named. What
   lives here is the measurement: what each one printed before its scale was
   checked, why no app path can trip it, and the two call sites where a CALLER
   supplied a value the guard would have refused. */
const FWRenderGuards = (() => {
  'use strict';

  /* Two kinds, and the absence of a third is a declared finding rather than an
     omission. A guard nothing can reach from the app is not a broken guard --
     but it is also not evidence about the running program, and it must not be
     counted as though it were. */
  const KINDS = {
    CALLER_ONLY: {
      means: 'no path the app takes can reach this refusal with a bad value; only a hand-written call can',
      doesNotMean: 'that the guard is wrong or redundant -- it is a boundary check on a function other code may call',
      countsAsEvidenceAboutTheRunningApp: false
    },
    CHANGE_DETECTOR: {
      means: 'the fault it names cannot arise at run time at all, only from a future edit to this codebase',
      doesNotMean: 'that anything at run time is being checked',
      countsAsEvidenceAboutTheRunningApp: false
    }
  };

  const WHY_NO_RUNTIME_KIND =
    'A RUNTIME kind -- a refusal a value the app itself carries could trip -- is deliberately not declared, ' +
    'because measurement over a twenty-day seeded run found none. Every confidence is clamped where it is ' +
    'computed, every reliability and lifetime is copied off a table asserted at load, every entity status is ' +
    'written through a checked setter, and the one caller that could have produced an absence was substituting ' +
    'a value instead of passing one. If a later slice finds a real run-time path into one of these, declare the ' +
    'kind then rather than assuming it was always there.';

  /* One row per refusal. checksScale is what this slice changed; printedBefore
     is the exact string measured coming out of the unfixed function, so each row
     records a fault that was real rather than describing a risk. */
  const REFUSALS = [
    {
      site: 'moEngine.formatIndex',
      kind: 'CALLER_ONLY',
      refusesAbsence: 'a value that is not a finite number',
      assertsScale: 'INDEX_MIN-INDEX_MAX, printed as the denominator of the output itself',
      checksScale: true,
      printedBefore: '250 / 100 for formatIndex(250), and -40 / 100 for formatIndex(-40)',
      addedThisSlice: true,
      reachableFrom: ['mo-intelligence', 'sim-debug', 'calibration-view', 'exposureModel.caseSheet'],
      whyNoBadValueArrives: 'every caller passes mo.confidence or a figure copied from it, and mo.confidence is clamped to the scale at both places it is written, so the off-scale branch was latent rather than live',
      firedByMessage: 'test_slice62'
    },
    {
      site: 'moEngine.confidenceLabel',
      kind: 'CALLER_ONLY',
      refusesAbsence: 'a value that is not a finite number',
      assertsScale: 'the same INDEX_MIN-INDEX_MAX scale, since the five bands partition it',
      checksScale: true,
      printedBefore: 'STRONG for confidenceLabel(1000), and MINIMAL for confidenceLabel(-50)',
      addedThisSlice: true,
      reachableFrom: ['moEngine.buildMo', 'moEngine.recompute', 'moEngine.indexReach'],
      whyNoBadValueArrives: 'the same clamp, plus indexReach only ever walks whole numbers inside the scale. The bands are an ordered chain of absolute thresholds, so an off-scale value used to receive the top or bottom band by falling off the end of the chain rather than by being on the scale at all',
      firedByMessage: 'test_slice62'
    },
    {
      site: 'moEngine.bandTone',
      kind: 'CHANGE_DETECTOR',
      refusesAbsence: 'a band with no declared tone',
      assertsScale: 'nothing numeric -- it maps a band name to a colour class',
      checksScale: 'not applicable, the value is categorical',
      printedBefore: 'nothing: it threw correctly for an undeclared band, and this slice changed no behaviour here',
      addedThisSlice: null,
      reachableFrom: ['mo-intelligence badge', 'sim-debug badge'],
      whyNoBadValueArrives: 'measured across the whole index range: every band confidenceLabel can return has a declared tone, and both call sites pass mo.confidenceBand, which is only ever written by confidenceLabel. No value existing at run time can trip it. What it does catch is a future edit that adds a band and forgets a colour',
      firedByMessage: 'test_slice62'
    },
    {
      site: 'signalEngine.formatDecay',
      kind: 'CALLER_ONLY',
      refusesAbsence: 'a lifetime that is absent, non-numeric, or not positive',
      assertsScale: 'seconds in, hours out, rounded to two decimals',
      checksScale: true,
      printedBefore: 'counts for 0h after it is observed, for formatDecay(0.5) -- printing as absent the very lifetime it had just accepted as present',
      addedThisSlice: true,
      reachableFrom: ['mo-intelligence evidence row', 'entity-inspector signal row'],
      whyNoBadValueArrives: 'both callers now go through signalEngine.decayClause, which asks whether the type declares a lifetime before formatting one; and the only condition under which decaySecondsFor could return null for a real signal is now asserted away at load, see VOCABULARY_PAIRS',
      firedByMessage: 'test_slice62'
    },
    {
      site: 'signalEngine.formatReliability',
      kind: 'CALLER_ONLY',
      refusesAbsence: 'a multiplier that is absent or non-numeric',
      assertsScale: 'a multiplier on 0-1, stated in the output string, with the catalog span named separately',
      checksScale: true,
      printedBefore: 'type reliability 5 (a multiplier on 0-1, not a share; the catalog uses 0.5-0.75)',
      addedThisSlice: true,
      reachableFrom: ['mo-intelligence evidence row', 'entity-inspector signal row'],
      whyNoBadValueArrives: 'both callers pass a value copied off the signal, which was copied off the catalog, whose span is asserted at load in both directions. The off-scale branch was latent -- but the sentence printed is a claim about the number, and the number was unchecked',
      firedByMessage: 'test_slice62'
    },
    {
      site: 'entityEngine.formatStatus',
      kind: 'CALLER_ONLY',
      refusesAbsence: 'a status that is absent or not a string',
      assertsScale: 'the declared status vocabulary for that entity kind',
      checksScale: true,
      printedBefore: 'nothing: this one already checked its value against the declared list, and is the shape the other five have been brought to',
      addedThisSlice: false,
      reachableFrom: ['entity-inspector facility row', 'entity-inspector driver row', 'entity-inspector trailer row'],
      whyNoBadValueArrives: 'measured over 49 entities: every status is a declared one, because status writes go through the checked setter. The membership test is the categorical equivalent of a scale check, and it was here before this slice',
      firedByMessage: 'test_slice62'
    }
  ];

  /* The other half of a display refusal: a call site that supplies a value the
     guard would have refused, so the guard never gets the chance to refuse.
     Both were found by planting exactly the failure the guard names. A
     grep-based test asserting that the panel "calls the lifetime owner" passed
     throughout, because it did call it -- with a substitute. */
  const SUBSTITUTIONS = [
    {
      site: 'entity-inspector signal row',
      guard: 'signalEngine.formatDecay',
      was: 'formatDecay(decaySecondsFor(s.type) || (s.expiresAt - s.createdAt))',
      whatThatDid: 'where the type declared no lifetime, it computed one from the observed expiry window and rendered it with the declared-lifetime sentence. Measured: a signal of an undeclared type rendered as counts for 2h after it is observed, indistinguishable character for character from a declared one',
      why: 'the fallback is the exact fault the guard message names -- a signal with no declared lifetime rendered as if it had one -- written into the caller',
      now: 'the row calls signalEngine.decayClause, which states that the type declares no lifetime and that the observed window is not one'
    },
    {
      site: 'mo-intelligence evidence row',
      guard: 'signalEngine.formatDecay',
      was: 'secs == null ? no clause at all : formatDecay(secs)',
      whatThatDid: 'the same absence handled the opposite way: the clause vanished, so the row read as though the lifetime question had not come up',
      why: 'not a false statement, but a silent one -- two panels held two different policies for one absence, and neither said which',
      now: 'the same signalEngine.decayClause owner, so the absence is stated once, in one voice, in both panels'
    }
  ];

  /* Why the substitution above could be reached at all. This is the finding
     underneath it: signalEngine.SIGNAL_CATALOG is keyed by EVENT type, and
     deriveSignal writes signal.type from def.signalType -- a different field.
     decaySecondsFor then indexes the event-keyed catalog with a SIGNAL type.
     The two vocabularies are identical entry for entry, and nothing asserted
     it. Planting one divergence measured the consequence: the run continued for
     195 sim-hours and then died inside moEngine.rankPatterns with a message
     about a gap in the taxonomy -- a true sentence about the wrong thing, since
     the gap was in signalEngine, one field away. */
  const VOCABULARY_PAIRS = [
    {
      table: 'signalEngine.SIGNAL_CATALOG',
      keyedBy: 'event type',
      indexedWith: 'signal type, via decaySecondsFor(signal.type)',
      identityHeldBy: 'convention only, before this slice',
      nowAssertedBy: 'signalEngine.assertCatalogVocabularySingle, at load',
      ifItDiverges: 'decaySecondsFor returns null for every signal of that type, which reads as no declared lifetime',
      measuredConsequence: 'ran on for 195 sim-hours, then threw moEngine.rankPatterns: no declared keyword row -- a taxonomy message for a catalog fault',
      andBeforeThat: 'the entity inspector rendered the invented lifetime as a declared one for every one of those hours'
    }
  ];

  function refusalFor(site) {
    return REFUSALS.filter(r => r.site === site)[0] || null;
  }

  /* The honest helper. The formatters do not call it -- each builds its own
     sentence and must name its own scale in its own words -- but it is the
     shape they were brought to. */
  function onScale(value, min, max, label) {
    if (typeof value !== 'number' || !isFinite(value)) {
      throw new Error('FWRenderGuards.onScale: ' + label + ' is ' + value +
        '; a value that is not a finite number has no place on any scale');
    }
    if (value < min || value > max) {
      throw new Error('FWRenderGuards.onScale: ' + label + ' is ' + value +
        ', off the declared ' + min + '-' + max + ' scale it would be printed against');
    }
    return value;
  }

  /* Reported over the register as its named base, the way FWReconcile.capability
     does, so the figure cannot be read as a share of every guard in the
     codebase. */
  function capability() {
    const base = REFUSALS.length;
    const applicable = REFUSALS.filter(r => r.checksScale === true || r.checksScale === false).length;
    const scaleChecked = REFUSALS.filter(r => r.checksScale === true).length;
    const alreadyDid = REFUSALS.filter(r => r.checksScale === true && r.addedThisSlice === false).length;
    const changeOnly = REFUSALS.filter(r => r.kind === 'CHANGE_DETECTOR').length;
    return {
      base: base,
      baseIs: 'the ' + base + ' display refusals registered here -- the formatter refusals only, not the guards ' +
        'in the engines and not every throw in the codebase',
      reachableWithABadValueFromTheApp: 0,
      callerOnly: base - changeOnly,
      changeDetectorOnly: changeOnly,
      scaleCheckedOfApplicable: scaleChecked + ' of ' + applicable,
      alreadyCheckedBeforeThisSlice: alreadyDid,
      substitutionsFound: SUBSTITUTIONS.length,
      note: 'none of the ' + base + ' display refusals can be reached with a bad value by any path the app takes, ' +
        'so their never having fired is not evidence about this program: ' + (base - changeOnly) + ' are boundary ' +
        'checks on functions other code may call and ' + changeOnly + ' can only be tripped by a future edit. ' +
        scaleChecked + ' of ' + applicable + ' refusals whose output states a scale now check the value against ' +
        'that scale; ' + alreadyDid + ' of them did before this slice and ' + (scaleChecked - alreadyDid) + ' did ' +
        'not. ' + SUBSTITUTIONS.length + ' call sites were supplying a value the guard would have refused, so the ' +
        'guard was never asked.',
      doesNotMean: 'that the rendered figures are correct, or that a refusal which can fire ever has'
    };
  }

  /* Reconciled in both directions, and with no cross-module dependency, so it
     is safe to run at load: every kind a row names must be declared, and every
     declared kind must be used by a row -- an unused kind is a distinction
     nobody is making. */
  function assertRegisterDeclared(refusals, kinds, subs) {
    const rows = refusals || REFUSALS;
    const kk = kinds || KINDS;
    const ss = subs || SUBSTITUTIONS;
    const need = ['site', 'kind', 'refusesAbsence', 'assertsScale', 'checksScale',
      'printedBefore', 'addedThisSlice', 'reachableFrom', 'whyNoBadValueArrives', 'firedByMessage'];
    rows.forEach(r => {
      need.forEach(f => {
        if (!(f in r)) throw new Error('FWRenderGuards: refusal ' + r.site + ' declares no ' + f);
      });
      if (!kk[r.kind]) {
        throw new Error('FWRenderGuards: refusal ' + r.site + ' claims kind ' + r.kind + ', which is not declared');
      }
      if (!r.reachableFrom.length) {
        throw new Error('FWRenderGuards: refusal ' + r.site + ' lists no caller, so nothing can reach it and it should not be registered');
      }
      if ((r.checksScale === true || r.checksScale === false) && typeof r.addedThisSlice !== 'boolean') {
        throw new Error('FWRenderGuards: refusal ' + r.site + ' has a scale to check but does not say whether the check is new, so the capability report cannot tell a fix from a fact');
      }
      if (kk[r.kind].countsAsEvidenceAboutTheRunningApp) {
        throw new Error('FWRenderGuards: refusal ' + r.site + ' claims kind ' + r.kind + ', which claims to be evidence about the running app; no display refusal here has been shown to be, so the claim would have to be measured first');
      }
    });
    Object.keys(kk).forEach(k => {
      if (!rows.filter(r => r.kind === k).length) {
        throw new Error('FWRenderGuards: kind ' + k + ' is declared and used by no refusal; an unused kind is a distinction nobody is making');
      }
    });
    if (!/RUNTIME/.test(WHY_NO_RUNTIME_KIND) || KINDS.RUNTIME) {
      throw new Error('FWRenderGuards: a RUNTIME kind is declared while WHY_NO_RUNTIME_KIND still explains its absence; one of the two is stale');
    }
    ss.forEach(s => {
      ['site', 'guard', 'was', 'whatThatDid', 'why', 'now'].forEach(f => {
        if (!(f in s)) throw new Error('FWRenderGuards: substitution at ' + s.site + ' declares no ' + f);
      });
      if (!rows.filter(r => r.site === s.guard).length) {
        throw new Error('FWRenderGuards: substitution at ' + s.site + ' names guard ' + s.guard + ', which is not in the register');
      }
    });
    VOCABULARY_PAIRS.forEach(v => {
      if (v.keyedBy === v.indexedWith) {
        throw new Error('FWRenderGuards: vocabulary pair for ' + v.table + ' says it is keyed and indexed by the same thing, which is not a pair');
      }
    });
    return true;
  }

  assertRegisterDeclared();

  return { KINDS, WHY_NO_RUNTIME_KIND, REFUSALS, SUBSTITUTIONS, VOCABULARY_PAIRS,
    refusalFor, onScale, capability, assertRegisterDeclared };
})();
