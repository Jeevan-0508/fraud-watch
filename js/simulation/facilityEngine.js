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

  // The population both this panel and the shift panel count, named once so
  // the two headlines can be recognised as the same quantity.
  const RECORDED_SCOPE = 'recorded disruptions in this run';

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
      figure: 'Whether a site was open when a movement passed through it',
      why: 'A facility declares OPERATING, REDUCED and CLOSED and this build only ever issues OPERATING, so closure and reduced running are not modelled at all. The eligibility test in sitesForStage tests for CLOSED and therefore excludes nothing — see siteEligibility() for the count — and every figure here is over a site population that is fully operating by construction.'
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

  /* Site eligibility, and what the test actually excludes.

     This filter used to read `f.status !== 'CLOSED'` inline, which looks
     like an operational rule: closed sites do not take movements. CLOSED is
     a real member of the facility vocabulary, so it is not Slice 48's
     typo -- but entityEngine now measures that nothing in this build ever
     writes it, so the clause is true of every site ever created and
     excludes nothing. It is kept (a closure state is the right rule to
     have) and it is now stated: the literal is checked against the owning
     vocabulary, and the count it excludes is printed rather than implied. */
  const SITE_INELIGIBLE_STATUSES = ['CLOSED'];
  let literalsChecked = false;

  function assertSiteStatusLiterals() {
    if (literalsChecked) return true;
    SITE_INELIGIBLE_STATUSES.forEach(lit => {
      FWEntityEngine.assertStatusLiteral('facility', lit, 'facilityEngine.sitesForStage');
    });
    literalsChecked = true;
    return true;
  }

  function siteEligible(facility) {
    return SITE_INELIGIBLE_STATUSES.indexOf(facility.status) < 0;
  }

  // MEASURED per registry: how many sites the eligibility test removes.
  function siteEligibility(registry) {
    const facs = FWEntityEngine.all(registry, 'facility');
    const eligible = facs.filter(siteEligible);
    const unreachable = SITE_INELIGIBLE_STATUSES
      .filter(lit => FWEntityEngine.writableStatuses('facility').indexOf(lit) < 0);
    return {
      pool: facs.length,
      eligible: eligible.length,
      excluded: facs.length - eligible.length,
      testedStatuses: SITE_INELIGIBLE_STATUSES.slice(),
      unreachableStatuses: unreachable,
      note: 'Eligibility excluded ' + (facs.length - eligible.length) + ' of ' + facs.length +
        ' sites' + (unreachable.length
          ? ' and cannot exclude any: the states it tests for (' + unreachable.join(', ') +
            ') are declared for a facility and never issued in this build, so every coverage figure below is over the whole site population, not over the sites that were open that day.'
          : '.')
    };
  }

  function sitesForStage(registry, stage) {
    assertSiteStatusLiterals();
    const kinds = STAGE_SITES[stage];
    if (!kinds) return [];
    return FWEntityEngine.all(registry, 'facility')
      .filter(f => kinds.indexOf(f.kind) >= 0 && siteEligible(f));
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

    /* THE TABLE ABOVE DOES NOT ACCOUNT FOR ALL OF THEM. A disruption is
       recorded either at one of the sites in this list or out on the public
       road where no site can be charged with it, and until Slice 29 this
       panel's own headline reported the whole-run total against the phrase
       "across N sites" while the rows beneath it summed to the sited part
       only. Two disjoint buckets, asserted to sum, and labelled, because
       the shift panel partitions this same population by shift and includes
       the road records -- so the two headlines are the same quantity cut
       two different ways, and neither of them said so. */
    const atSites = rows.reduce((a, r) => a + r.recorded, 0);
    const total = (tracker && tracker.totalRecorded) || 0;
    if (atSites + un.recorded !== total) {
      throw new Error(
        'facilityEngine: site records do not reconcile (' + atSites + ' at sites + ' +
        un.recorded + ' on the public road vs ' + total + ' recorded). Every recorded ' +
        'disruption happened either at one site or at none.'
      );
    }

    return {
      reconciliation: {
        atSites,
        unsited: un.recorded,
        total,
        siteCount: rows.length,
        scope: RECORDED_SCOPE,
        note: atSites + ' of the ' + total + ' ' + RECORDED_SCOPE + ' happened at one of the ' +
          rows.length + ' sites below. The other ' + un.recorded + ' happened on the public road, ' +
          'attributable to no site, and are not in the table or its ordering.'
      },
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
    ARCHETYPES, KIND_ORDER, STAGE_SITES, ASSUMPTIONS, NOT_MODELLED, RECORDED_SCOPE,
    UNSITED_LABEL, COVERAGE_MIN, COVERAGE_MAX,
    SITE_INELIGIBLE_STATUSES, siteEligible, siteEligibility, assertSiteStatusLiterals,
    archetype, clampCoverage, coverage, meanCoverage,
    sitesForStage, assignForStage,
    createTracker, record, siteSummary, hiddenLedger
  };
})();
