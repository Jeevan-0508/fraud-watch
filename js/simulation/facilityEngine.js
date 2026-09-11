/* simulation/facilityEngine.js — Phase 5, part 1: sites as the
   observation surface, and the observation bias that follows.

   THE POINT OF THIS MODULE, stated before any code:

     A site that watches itself carefully records more disruptions than
     a site that watches itself badly. Rank sites by recorded count and
     the best-run site in the port comes out on top of the list. That is
     not a subtle statistical caveat -- it is the single most likely way
     for a real site-level fraud dashboard to get a good operation
     audited and a bad one left alone.

   So this module reports, side by side and never separately:
     - the raw recorded count per site
     - the coverage the model assumed for that site
     - the count grossed up by that coverage
     - whether the two orderings disagree

   And it refuses, loudly, to call either ordering a risk ranking. The
   grossed-up figure is computed from the same stated coverage parameter
   that generated the records in the first place, so it demonstrates the
   direction and rough size of the bias and CANNOT correct for it. A
   model cannot validate itself with its own assumption. That is in
   NOT_MODELLED, at the same weight as the numbers, following the
   register vocabulary established in exposureModel.js.

   Two further honesties baked into the numbers:
     - Coverage is clamped below 1.0. No site in this model is fully
       observed, because no site anywhere is.
     - Some stages of a trip happen on a public road, attributable to no
       site at all. Those disruptions are counted in an UNSITED bucket
       and reported, never dropped and never silently reassigned to the
       last site the vehicle touched. */
const FWFacilityEngine = (() => {
  // Stated modeling assumptions. oversightFactor MULTIPLIES the shift's
  // own oversight probability (shiftEngine.SHIFTS[*].oversight).
  const ARCHETYPES = {
    GATEHOUSE: {
      kind: 'GATEHOUSE', label: 'Gatehouse',
      oversightFactor: 1.15,
      rationale: 'Manned barrier with a booking to transact against, so almost every movement leaves a record somebody has to reconcile.'
    },
    CROSS_DOCK: {
      kind: 'CROSS_DOCK', label: 'Cross-dock',
      oversightFactor: 1.0,
      rationale: 'Busy, staffed, and systematised, but the volume and the number of hands on each load mean checks are sampled rather than complete.'
    },
    YARD: {
      kind: 'YARD', label: 'Storage yard',
      oversightFactor: 0.8,
      rationale: 'Wide area, intermittent patrols, equipment stands unattended between movements; a lot happens between two recorded scans.'
    },
    REMOTE_DEPOT: {
      kind: 'REMOTE_DEPOT', label: 'Remote depot',
      oversightFactor: 0.55,
      rationale: 'Off the main site, thin or no permanent staffing, systems reconciled in batch afterwards rather than at the moment of the movement.'
    }
  };

  const KIND_ORDER = ['GATEHOUSE', 'CROSS_DOCK', 'YARD', 'REMOTE_DEPOT'];

  // Nothing is ever perfectly observed, and nothing is ever completely
  // dark either -- both extremes would make the coverage model tell
  // comfortable lies at the edges.
  const COVERAGE_MIN = 0.05;
  const COVERAGE_MAX = 0.97;

  // Which site archetypes a lifecycle stage can occur at. `null` means
  // the stage happens on a public road and belongs to no site.
  const STAGE_SITES = {
    DISPATCHED: ['YARD', 'CROSS_DOCK'],
    EN_ROUTE_TO_PORT: null,
    CHECKPOINT: ['GATEHOUSE'],
    LOADING: ['CROSS_DOCK', 'YARD'],
    DEPARTURE: ['GATEHOUSE'],
    TRANSIT: null,
    DEPOT: ['YARD', 'REMOTE_DEPOT'],
    DELIVERY: ['CROSS_DOCK', 'REMOTE_DEPOT'],
    COMPLETED: null
  };

  const UNSITED_LABEL = 'Public road (no site)';

  const ASSUMPTIONS = [
    'Site oversight factors are stated modeling assumptions chosen to make the simulation behave plausibly. None is a measured detection rate for any real facility.',
    'A site factor multiplies the shift oversight probability, so the same yard is better observed at 09:00 than at 03:00 and a gatehouse at 03:00 can still beat a remote depot at noon.',
    'Combined coverage is clamped to ' + Math.round(COVERAGE_MIN * 100) + '-' + Math.round(COVERAGE_MAX * 100) + '%. No site in this model records everything, and none records nothing.',
    'Recorded counts per site therefore measure observation as much as occurrence. A well-run gatehouse generates records; an unstaffed depot generates silence.',
    'The coverage-adjusted count grosses records up by this model\'s own stated coverage. It shows the direction and rough scale of the bias. It is not a corrected incident count and cannot be one.',
    'Stages that happen on a public road are attributed to no site and reported separately, rather than being charged to whichever site the vehicle last touched.'
  ];

  const NOT_MODELLED = [
    {
      figure: 'True incident rate per site',
      why: 'The records are the output of a coverage process, and this simulation deliberately keeps the occurred-but-unrecorded ledger hidden from the UI. Dividing records by assumed coverage returns the assumption, not the rate — the arithmetic is circular by construction.'
    },
    {
      figure: 'Which site is the riskiest',
      why: 'Both orderings below are orderings of records. The raw one is biased toward well-observed sites and the adjusted one is biased by whatever the oversight factors get wrong. Neither is a risk ranking and naming one as such is how a good operation gets audited in place of a bad one.'
    },
    {
      figure: 'Whether the coverage adjustment recovers the truth',
      why: 'It cannot be checked here. Validating an assumed coverage parameter needs an independent count of what actually happened, which is exactly the thing coverage below 100% means you do not have.'
    },
    {
      figure: 'Site-level exposure or cost',
      why: 'Not computed here on purpose. Money in this project comes only from exposureModel.js, where the measured hours, the stated rate and the refused figures live together. A per-site currency total assembled in this module would escape that discipline.'
    }
  ];

  function archetype(kind) {
    return ARCHETYPES[kind] || ARCHETYPES.YARD;
  }

  function clampCoverage(p) {
    return Math.max(COVERAGE_MIN, Math.min(COVERAGE_MAX, p));
  }

  // Both components are returned alongside the product so a caller can
  // never show a combined coverage number without being able to say
  // which part of it came from the clock and which from the site.
  function coverage(facility, shiftName) {
    const shiftComponent = window.FWShiftEngine
      ? FWShiftEngine.observationProbability(shiftName) : 1;
    const a = facility ? archetype(facility.kind) : null;
    const siteComponent = a ? a.oversightFactor : 1;
    const raw = shiftComponent * siteComponent;
    const combined = clampCoverage(raw);
    return {
      shiftComponent, siteComponent, raw, combined,
      clamped: Math.abs(combined - raw) > 1e-9,
      sited: !!facility,
      facilityId: facility ? facility.id : null,
      kindLabel: a ? a.label : UNSITED_LABEL
    };
  }

  // Mean coverage a site sees across the whole 24h cycle, weighted by
  // how much traffic each shift carries -- an unweighted mean would
  // over-count the quiet night and understate the site's real coverage.
  function meanCoverage(facility) {
    if (!window.FWShiftEngine) return clampCoverage(archetype(facility.kind).oversightFactor);
    const shifts = FWShiftEngine.SHIFT_ORDER;
    let num = 0, den = 0;
    shifts.forEach(s => {
      const w = FWShiftEngine.throughputMultiplier(s);
      num += coverage(facility, s).combined * w;
      den += w;
    });
    return den ? num / den : 0;
  }

  function sitesForStage(registry, stage) {
    const kinds = STAGE_SITES[stage];
    if (!kinds) return [];
    return FWEntityEngine.all(registry, 'facility')
      .filter(f => kinds.indexOf(f.kind) >= 0 && f.status !== 'CLOSED');
  }

  // Where a truck is when it enters `stage`. Returns null for road
  // stages, which is a real answer and not a failure.
  function assignForStage(registry, stage, rng) {
    const candidates = sitesForStage(registry, stage);
    if (!candidates.length) return null;
    return rng ? rng.pick(candidates) : candidates[0];
  }

  function createTracker() {
    return { bySite: {}, unsited: { recorded: 0, unrecorded: 0, byType: {} }, totalRecorded: 0, totalUnrecorded: 0 };
  }

  function row(tracker, facilityId) {
    if (!tracker.bySite[facilityId]) {
      tracker.bySite[facilityId] = { recorded: 0, unrecorded: 0, byType: {}, byShift: {} };
    }
    return tracker.bySite[facilityId];
  }

  function record(tracker, facilityId, type, recorded, shiftName) {
    if (!tracker) return;
    const r = facilityId ? row(tracker, facilityId) : tracker.unsited;
    if (recorded) {
      r.recorded += 1;
      tracker.totalRecorded += 1;
      r.byType[type] = (r.byType[type] || 0) + 1;
      if (r.byShift) r.byShift[shiftName] = (r.byShift[shiftName] || 0) + 1;
    } else {
      r.unrecorded += 1;
      tracker.totalUnrecorded += 1;
    }
  }

  function topTypeOf(byType) {
    const keys = Object.keys(byType);
    if (!keys.length) return null;
    const k = keys.sort((a, b) => byType[b] - byType[a])[0];
    return { type: k, count: byType[k] };
  }

  // UI-facing. Recorded counts only, each one carrying the coverage that
  // produced it, plus both orderings and whether they disagree.
  // Deliberately excludes the unrecorded ledger, same treatment as
  // shiftEngine.summary and falsePositiveEngine's ground truth.
  function siteSummary(registry, tracker) {
    const facilities = FWEntityEngine.all(registry, 'facility');
    const rows = facilities.map(f => {
      const r = (tracker && tracker.bySite[f.id]) || { recorded: 0, byType: {}, byShift: {} };
      const cov = meanCoverage(f);
      const a = archetype(f.kind);
      const top = topTypeOf(r.byType || {});
      return {
        facilityId: f.id,
        name: f.name,
        kind: f.kind,
        kindLabel: a.label,
        oversightFactor: a.oversightFactor,
        rationale: a.rationale,
        recorded: r.recorded,
        meanCoverage: cov,
        // Records divided by the coverage this model assumed. See
        // NOT_MODELLED: this is an illustration of the bias, not a
        // corrected count.
        coverageAdjusted: cov > 0 ? Math.round((r.recorded / cov) * 10) / 10 : null,
        topType: top ? top.type : null,
        topTypeCount: top ? top.count : 0,
        byShift: r.byShift || {}
      };
    });

    const byRaw = rows.slice().sort((a, b) => b.recorded - a.recorded || a.facilityId.localeCompare(b.facilityId));
    const byAdjusted = rows.slice().sort((a, b) => (b.coverageAdjusted || 0) - (a.coverageAdjusted || 0) || a.facilityId.localeCompare(b.facilityId));
    byRaw.forEach((r, i) => { r.rawRank = i + 1; });
    byAdjusted.forEach((r, i) => { r.adjustedRank = i + 1; });
    rows.forEach(r => { r.rankMoved = r.rawRank !== r.adjustedRank; });

    const anyRecords = rows.some(r => r.recorded > 0);
    const orderingsDisagree = anyRecords && byRaw.some((r, i) => r.facilityId !== byAdjusted[i].facilityId);

    const un = (tracker && tracker.unsited) || { recorded: 0, byType: {} };
    const unTop = topTypeOf(un.byType || {});

    return {
      rows,
      byRaw,
      byAdjusted,
      anyRecords,
      orderingsDisagree,
      unsited: {
        label: UNSITED_LABEL,
        recorded: un.recorded,
        topType: unTop ? unTop.type : null,
        topTypeCount: unTop ? unTop.count : 0
      },
      totalRecorded: (tracker && tracker.totalRecorded) || 0
    };
  }

  // The hidden half. Not rendered anywhere: it exists so a later
  // calibration or coverage-cost model has something to ask.
  function hiddenLedger(tracker) {
    if (!tracker) return { totalRecorded: 0, totalUnrecorded: 0, bySite: {}, unsited: null };
    return {
      totalRecorded: tracker.totalRecorded,
      totalUnrecorded: tracker.totalUnrecorded,
      bySite: tracker.bySite,
      unsited: tracker.unsited
    };
  }

  return {
    ARCHETYPES, KIND_ORDER, STAGE_SITES, ASSUMPTIONS, NOT_MODELLED,
    UNSITED_LABEL, COVERAGE_MIN, COVERAGE_MAX,
    archetype, clampCoverage, coverage, meanCoverage,
    sitesForStage, assignForStage,
    createTracker, record, siteSummary, hiddenLedger
  };
})();
