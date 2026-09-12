/* simulation-independent module publication.

   Every module in this app is declared `const FWSomething = (() => {...})()`
   in a classic <script>. A top-level `const` binding lives in the realm's
   global LEXICAL environment: a later script can read it as a bare
   identifier, but it never becomes a property of `window`. `var` would;
   `const` does not.

   Fifty-six places in this codebase guard an optional dependency with
   `window.FWShiftEngine`, `window.FWFacilityEngine`, `window.FWMoEngine`
   and so on. In a browser every one of those reads `undefined`, so every
   guard took its fallback branch -- while the DOM-shim test harness ended
   its combined source with `window.FWx = FWx` for each module, which made
   every guard true under test. The suite was therefore measuring a program
   the browser never ran. Measured on seed 12345 over 20 sim-days:

     shiftTracker / facilityTracker   created under test, null as shipped
     movements attached to a site     8 of 8 under test, 0 of 8 as shipped
     site mean coverage (Yard 1)      0.9075 under test, 0.97 as shipped
                                      (0.97 is the unweighted archetype
                                      fallback, i.e. the shift model was
                                      never consulted)
     events emitted in the run        35,450 under test, 38,939 as shipped
                                      (lifecycle events plus disruptions,
                                      not disruptions alone)

   So the whole site/shift dimension -- several slices of work, and the
   coverage figures the facility panel prints -- was inert in the shipped
   app, and no test could see it, because the harness was patching the
   program under test.

   This file is the one place that publishes the bindings, loaded after
   every module and before main.js. It does not change any guard: it makes
   the guards mean in the browser what they already meant in the tests. The
   test harness no longer injects anything, so the suite now measures this
   file's work along with everything else.

   A module missing here is a silent fallback again, so the publication is
   checked and throws with the names it could not resolve. */
const FWGlobals = (() => {
  const MODULE_NAMES = [
    'FW', 'FWWorld', 'FWCamera', 'FWVehicle',
    'FWScenario', 'FWScoring', 'FWPortUI', 'FWCoreGame',
    'FWRng', 'FWSimClock', 'FWReconcile', 'FWCopyRules', 'FWRenderGuards', 'FWEntityTruck', 'FWEntityDriver',
    'FWEntityTrailer', 'FWEntityShipment', 'FWEntityCarrier', 'FWEntityFacility',
    'FWWorldGraph', 'FWJourneyEngine', 'FWShiftEngine', 'FWFacilityEngine', 'FWEntityEngine', 'FWEventEngine',
    'FWFalsePositiveEngine', 'FWIntentEngine', 'FWBehaviorEngine', 'FWSignalEngine', 'FWMoEngine', 'FWActEngine',
    'FWInvestigationEngine', 'FWAdviceEngine', 'FWOutcomeEngine', 'FWExposureModel',
    'FWAnalyticsEngine', 'FWSimRunner', 'FWSimDebug', 'FWMoIntelligence',
    'FWEntityInspector', 'FWNetworkEngine', 'FWAwayReportEngine', 'FWAwayReport',
    'FWNetworkView', 'FWCalibrationView', 'FWShiftView', 'FWExposureView',
    'FWFacilityView', 'FWAnalyticsView', 'FWGame', 'FWTraining',
    'FWCharts'
  ];

  // Each binding is named explicitly rather than looked up dynamically:
  // a dynamic lookup of a lexical binding needs eval, which a content
  // policy can refuse, and a missing module must be reported by name
  // instead of discovered later as a quiet fallback. `resolve` returns
  // undefined instead of throwing so one absent file cannot stop the rest
  // from being published.
  function resolve(fn) {
    try { return fn(); } catch (e) { return undefined; }
  }

  const BINDINGS = {
    FW: () => FW,
    FWWorld: () => FWWorld,
    FWCamera: () => FWCamera,
    FWVehicle: () => FWVehicle,
    FWScenario: () => FWScenario,
    FWScoring: () => FWScoring,
    FWPortUI: () => FWPortUI,
    FWCoreGame: () => FWCoreGame,
    FWRng: () => FWRng,
    FWSimClock: () => FWSimClock,
    FWReconcile: () => FWReconcile,
    FWCopyRules: () => FWCopyRules,
    FWRenderGuards: () => FWRenderGuards,
    FWEntityTruck: () => FWEntityTruck,
    FWEntityDriver: () => FWEntityDriver,
    FWEntityTrailer: () => FWEntityTrailer,
    FWEntityShipment: () => FWEntityShipment,
    FWEntityCarrier: () => FWEntityCarrier,
    FWEntityFacility: () => FWEntityFacility,
    FWWorldGraph: () => FWWorldGraph,
    FWJourneyEngine: () => FWJourneyEngine,
    FWShiftEngine: () => FWShiftEngine,
    FWFacilityEngine: () => FWFacilityEngine,
    FWEntityEngine: () => FWEntityEngine,
    FWEventEngine: () => FWEventEngine,
    FWFalsePositiveEngine: () => FWFalsePositiveEngine,
    FWIntentEngine: () => FWIntentEngine,
    FWBehaviorEngine: () => FWBehaviorEngine,
    FWSignalEngine: () => FWSignalEngine,
    FWMoEngine: () => FWMoEngine,
    FWActEngine: () => FWActEngine,
    FWInvestigationEngine: () => FWInvestigationEngine,
    FWAdviceEngine: () => FWAdviceEngine,
    FWOutcomeEngine: () => FWOutcomeEngine,
    FWExposureModel: () => FWExposureModel,
    FWAnalyticsEngine: () => FWAnalyticsEngine,
    FWSimRunner: () => FWSimRunner,
    FWSimDebug: () => FWSimDebug,
    FWMoIntelligence: () => FWMoIntelligence,
    FWEntityInspector: () => FWEntityInspector,
    FWNetworkEngine: () => FWNetworkEngine,
    FWAwayReportEngine: () => FWAwayReportEngine,
    FWAwayReport: () => FWAwayReport,
    FWNetworkView: () => FWNetworkView,
    FWCalibrationView: () => FWCalibrationView,
    FWShiftView: () => FWShiftView,
    FWExposureView: () => FWExposureView,
    FWFacilityView: () => FWFacilityView,
    FWAnalyticsView: () => FWAnalyticsView,
    FWGame: () => FWGame,
    FWTraining: () => FWTraining,
    FWCharts: () => FWCharts
  };

  function publish(scope) {
    const target = scope || window;
    const published = [], missing = [];
    MODULE_NAMES.forEach(name => {
      const value = resolve(BINDINGS[name]);
      if (value === undefined || value === null) { missing.push(name); return; }
      target[name] = value;
      published.push(name);
    });
    return { published, missing, expected: MODULE_NAMES.length };
  }

  function assertPublished(result) {
    if (result.missing.length) {
      throw new Error('FWGlobals: ' + result.missing.length + ' of ' + result.expected +
        ' modules were not published to window (' + result.missing.join(', ') +
        '). Every window.FWx guard in the app reads undefined for those, so they would ' +
        'silently take their fallback branch.');
    }
    return true;
  }

  const result = publish(typeof window !== 'undefined' ? window : null);
  assertPublished(result);

  return { MODULE_NAMES, publish, assertPublished, published: result.published };
})();

// The publisher publishes itself last, outside its own factory: inside it the
// binding is still in its temporal dead zone, so it cannot be one of
// MODULE_NAMES without the resolve() guard reporting it as missing.
window.FWGlobals = FWGlobals;
