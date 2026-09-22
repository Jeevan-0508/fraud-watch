/* ui/freight-map.js — Slice 75: the network this simulation already moves
   trucks over, drawn.

   WHAT THIS MODULE IS FOR, stated before any code.

   Everything needed to see a freight network operating has existed since
   Slice 70-72 and none of it was ever drawn. worldGraph declares eleven
   nodes, eleven road edges and four routes; journeyEngine puts every truck
   at a named node or a stated fraction along a named leg, and Slice 72 made
   the lifecycle stage a function of that position. The Live Sim tab showed
   all of it as a table of statuses. A reader could learn that a simulation
   exists; they could not see a port, a road, or a truck on one.

   So this module owns one thing and nothing else: WHERE THE WORLD AND THE
   TRUCKS ARE ON THE SCREEN. It is a projection of two existing facts and it
   produces no new ones.

     buildLayout(graph)      a point for every worldGraph node and a line for
                             every worldGraph edge
     placementFor(truck)     the screen point of ONE truck, read off
                             journeyEngine.positionOf(truck.journey)
     frame(state)            those two, plus the counts a header can state,
                             assembled once per tick for the DOM writer

   THE LAYOUT IS TOPOLOGICAL, NOT GEOGRAPHIC, AND THAT IS NOT A SHORTCUT.
   worldGraph.DISTANCE_SCALE says it outright: "There are no coordinates in
   this graph at all -- only edges and their lengths." A map with coordinates
   would therefore have to invent them. This module invents no per-node
   position either: a node's column is its hop distance from the port node
   over the real adjacency, and its row is a barycentre ordering within that
   column. Nothing here is a hand-written x/y, so a node added to worldGraph
   tomorrow gets drawn without this file being edited, and a node removed
   cannot leave a stale point behind. The consequence, stated rather than
   hidden: the drawn length of a road says nothing about its distanceKm. The
   distance is printed on the road instead, from the graph.

   THE TRUCK POSITION IS NOT THIS MODULE'S. It is journeyEngine's, unchanged:
   AT_NODE draws at the node's point, ON_LEG interpolates between the two
   nodes of the leg by the fraction journeyEngine already computes. There is
   no animation loop, no tween and no eased motion between ticks, because an
   interpolated position between two simulation states is a position the
   simulation never had. A truck moves when, and only when, the sim advances.

   WHAT THIS MODULE DELIBERATELY DOES NOT DO.

   - It reads no ground truth, and it is not a reader of any. Slice 73's plan
     book (intentEngine.GROUND_TRUTH names simRunner and behaviorEngine as
     its only two readers) and Slice 74's composite-act linkage are invisible
     here: this file never names the plan book, a plan, a planned step, an
     actor's intent, a companion record, or the per-event answer key
     falsePositiveEngine writes. See GROUND_TRUTH_SEPARATION, and the source
     scan in the suite that checks the claim against this file's own text
     rather than trusting the sentence.
   - It never labels a truck as fraud. An active signal is an observation
     with a decay, and the ladder from an observation to a confirmed finding
     is the whole product; a marker that turns red on a signal collapses it.
     A truck with active signals is drawn as WATCHED, and the word for what
     that means travels with it.
   - It writes nothing to any entity, journey, registry, tracker or engine.
     Selection is one module-local id.
   - It invents no state the simulation does not have. DELAYED is in no
     table here: nothing in this build models a delay -- a completed leg took
     exactly its derived traverseSeconds (journeyEngine.ELAPSED_SCALE says
     so) -- and a "delayed" badge would be the renderer making up a fact. See
     NOT_RENDERED.
   - It does not drive the clock. It is called by simRunner.onTick and reads
     the clock the same way every other panel does.

   ONE WORD IN THIS PANEL'S COPY IS A BANNED WORD, AND IT IS RENDERED ON
   PURPOSE. "hub" is on js/ui/copy-rules.js's ban list for a good reason --
   it turns a node with a high edge count into an organising role -- and
   worldGraph declares a node type REGIONAL_HUB and a node labelled "Regional
   Hub West". A view that draws the topology cannot avoid its vocabulary
   without renaming a place in the simulation model to suit a copy rule. So
   copy-rules grew a checked, per-token exemption for exactly that collision
   (DOMAIN_SENSES / inspectTopology), this panel is scanned through it, and
   every other banned token still applies to it. The static copy in
   index.html carries no node type name at all: the legend is rendered here,
   so the exemption never has to cover hand-written page copy. */
const FWFreightMap = (() => {
  'use strict';

  const WG = (() => { try { return FWWorldGraph; } catch (e) { return null; } })();
  const JE = (() => { try { return FWJourneyEngine; } catch (e) { return null; } })();
  const BE = (() => { try { return FWBehaviorEngine; } catch (e) { return null; } })();

  function need(mod, name, what) {
    if (!mod) {
      throw new Error('freightMap: ' + what + ' needs ' + name + ', which is not loaded. This module is a ' +
        'projection of that module\'s facts and has no second copy of them to fall back on -- drawing a network ' +
        'without the graph that declares it would be inventing one.');
    }
    return mod;
  }

  /* THE ONLY NUMBERS THIS FILE OWNS, and they are all drawing units. Declared
     with a scale register like every other number in this codebase, because
     the one mistake available here is reading a screen distance as a real
     one. */
  const LAYOUT_SCALE = {
    kind: 'VIEW',
    scope: 'positions in the SVG user space of the freight map',
    unit: 'SVG user units',
    means: 'where a node or a truck is DRAWN.',
    doesNotMean: 'a distance, a position, a coordinate or a direction in the simulation. worldGraph has no ' +
      'coordinates at all, so nothing here can be converted back into one. The drawn length of a road is a ' +
      'function of the column spacing and the two rows it joins, and carries no information about its ' +
      'distanceKm -- which is why the distance is printed on the road, straight from the graph.',
    notInterchangeableWith: 'worldGraph.DISTANCE_SCALE (kilometres) and js/world/port.js pixel coordinates ' +
      '(Phaser drawing positions inside one facility, with no simulation meaning either)',
    derivedFrom: 'the graph structure alone: a node\'s column is its hop count from the port node over the real ' +
      'adjacency, and its row is a barycentre ordering inside that column. No node has a hand-written position.'
  };

  const LAYOUT = {
    colGap: 168,      // horizontal distance between two hop columns
    rowGap: 82,       // vertical distance between two nodes of one column
    padX: 96,
    padY: 74,
    minHeight: 430,
    stackRadius: 17,  // how far a truck is nudged off a node when several stand there
    stackPoints: 8
  };

  /* The separation this slice is most likely to be accused of breaking, stated
     as a register so the suite can check it against this file's text. */
  const GROUND_TRUTH_SEPARATION = {
    readsGroundTruth: false,
    /* NONE OF THESE IS SPELLED AS AN IDENTIFIER ANYWHERE IN THIS FILE, and that
       is the point of the wording rather than an accident of it. The suite
       scans this file's own code for each one and requires ZERO occurrences,
       which is a check with one answer; a register that named them would make
       the same scan report "several, all of them promises" and would need a
       reader to agree that every occurrence was harmless. Two existing guards
       already work this way for the per-event answer key: test_slice55 and
       test_slice57 assert that exactly one view in js/ui mentions its field
       name at all. */
    neverRead: [
      'the plan book Slice 73 draws at boot and hangs on the sim state. intentEngine declares simRunner and ' +
        'behaviorEngine its only two readers; this module adds no third, and the lookup that answers "what is ' +
        'this driver\'s next step" is never called from here',
      'a plan, a plan step, a planned disruption or an actor\'s intent',
      /* the per-event answer key falsePositiveEngine writes onto an event\'s metadata. Its field name is
         deliberately not spelled anywhere in this file: two existing guards (test_slice55 and test_slice57)
         assert that exactly ONE view in js/ui mentions that identifier at all, and sim-debug -- the engine
         inspector, which renders the key on purpose and says so -- is that one. Naming it here to promise not
         to read it would have made this file the second, and weakening a live guard to make room for a
         promise is a bad trade. */
      'the per-event answer key falsePositiveEngine annotates an event with',
      'Slice 74\'s act linkage -- the two metadata fields that say two records belong to one act, and are ' +
        'therefore an answer about the act rather than an observation of it',
      'the tracker Slice 74 keeps of those acts on the sim state'
    ],
    rendersOnly: [
      'the worldGraph node and edge a journey names',
      'journeyEngine\'s position: AT_NODE with a node id, or ON_LEG with a from, a to and a fraction',
      'the truck\'s lifecycle status, which is an observable operational state',
      'the count of currently active signals on the truck, which is what an analyst can see',
      'the clock'
    ],
    why: 'a marker that knew which trucks were planned would BE the answer key, and the analyst would be reading ' +
      'it instead of the evidence. The whole point of the signal ladder is that what happened has to be inferred.',
    checkedBy: 'test_slice75 scans this file\'s own source for each of the forbidden identifiers rather than ' +
      'taking this list\'s word for it. A register nothing compares to the code is a promise.'
  };

  /* Things a control-tower map is expected to show that this build cannot
     honestly show. Named, because the alternative is a renderer quietly
     inventing them and the screen looking better for it. */
  const NOT_RENDERED = [
    { thing: 'DELAYED', why: 'no delay is modelled. A leg always takes exactly its derived traverseSeconds ' +
        '(journeyEngine.ELAPSED_SCALE), so there is no late truck to draw.' },
    { thing: 'congestion, weather, queue length at a gate', why: 'worldGraph.NOT_MODELLED declares all three ' +
        'absent. A queue drawn at a gate would be a number this simulation does not have.' },
    { thing: 'a truck\'s speed', why: 'FWEntityTruck.speed is never written by anything; the only speed in the ' +
        'model is the edge\'s declared speed class, which is a property of the road and not of the vehicle.' },
    { thing: 'DEPARTING as a state distinct from standing at a node', why: 'journeyEngine has one dwelling flag ' +
        'and no departure phase: a truck is at a node or on a leg. Splitting it in the renderer would be a ' +
        'state the simulation never enters.' },
    { thing: 'which road a truck took last', why: 'a journey holds one current leg and no history of legs. The ' +
        'route it is ON is drawn for a selected truck; where it has been is not stored.' },
    { thing: 'anything about a case beyond its existence and status', why: 'the case panels in this tab already ' +
        'render investigations, and a second rendering of them here would be a second vocabulary for the same ' +
        'facts. Item 12 of the brief -- truck to event to signal to case, in the map -- is a follow-on slice.' }
  ];

  /* One entry per worldGraph node type, checked against worldGraph's own list
     at load: a type with no style would draw as nothing, and a style for a type
     the graph does not declare is a place that cannot exist. Shape carries the
     type as well as colour, because a control screen read in greyscale or by a
     colour-blind reader must still separate a port from a gate. */
  const NODE_STYLE = {
    PORT:               { shape: 'square',   size: 15, fill: '#082f49', stroke: '#38bdf8', label: 'Port' },
    FULFILLMENT_CENTER: { shape: 'square',   size: 13, fill: '#042f2e', stroke: '#2dd4bf', label: 'Fulfilment centre' },
    REGIONAL_HUB:       { shape: 'diamond',  size: 14, fill: '#1e1b4b', stroke: '#818cf8', label: 'Regional hub' },
    DEPOT:              { shape: 'circle',   size: 12, fill: '#1c1917', stroke: '#a3a3a3', label: 'Inland depot' },
    WAREHOUSE:          { shape: 'circle',   size: 11, fill: '#0f172a', stroke: '#64748b', label: 'Yard' },
    CHECKPOINT:         { shape: 'triangle', size: 11, fill: '#1c1917', stroke: '#fbbf24', label: 'Gate' }
  };

  /* THE SCENERY (Slice 82).

     Everything in this table is DECORATION and carries no simulation meaning
     whatsoever. The grid is not a coordinate system, the glow is not a
     measurement, the road casing is not a width and the ground tint is not
     terrain, weather, land, water or a region. worldGraph has no coordinates
     at all (see LAYOUT_SCALE), so nothing drawn here could be converted back
     into one even in principle.

     It is declared as a table rather than written inline for the same reason
     every other number in this build is: a reader who finds `r + 9` inside a
     template string has no way to tell a halo radius from a distance. */
  const DECOR = {
    kind: 'VIEW',
    scope: 'purely cosmetic SVG drawn under the roads and places',
    means: 'nothing. It exists so twenty places and twenty-six roads read as a network at a glance.',
    doesNotMean: 'terrain, land, water, geography, a coordinate grid, a scale bar, a road width, a region, ' +
      'weather, time of day, congestion, risk, or any quantity the simulation holds.',
    grid: { step: 48, stroke: '#0d1622', width: 0.5 },
    ground: { top: '#080f18', bottom: '#04070b' },
    portGlow: { radius: 210, colour: '#0ea5e9', opacity: 0.1 },
    casing: { extra: 5.5, stroke: '#0a1220' },
    centreline: { stroke: '#2c4a70', width: 0.7, dash: '7 11', appliesTo: 'ROAD' },
    halo: { ringExtra: 9, ringOpacity: 0.2, fillExtra: 4, fillOpacity: 0.07 }
  };

  /* A TRUCK MARKER IS A SILHOUETTE, AND IT POINTS THE WAY IT IS GOING.

     It used to be a 12x8 rectangle, which at twenty-four trucks on twenty-six
     roads read as identical dots and gave a reader no way to see which way any
     of them was travelling. The parts below are drawn in a local space facing
     +x and the whole group is rotated to the heading of the leg the truck is
     on -- and the heading comes from the two DRAWN node positions, so it is a
     fact about the picture and not a direction the simulation stated. A truck
     standing at a node has no leg and is drawn unrotated. */
  const TRUCK_ART = {
    kind: 'VIEW',
    scope: 'the shape of one truck marker, in SVG user units, facing +x before rotation',
    doesNotMean: 'a size, a length, a load, a speed or a bearing in the simulation. journeyEngine owns the ' +
      'position; the rotation is derived from where two places are DRAWN and nothing else.',
    trailer: { x: -7, y: -3.6, w: 9, h: 7.2, rx: 1 },
    cab: { x: 2, y: -3, w: 4.6, h: 6, rx: 1.2 },
    wheels: [-4.6, 0.4, 4],
    wheelR: 1.25,
    unrotatedWhen: 'the truck is AT_NODE, so there is no leg to take a heading from'
  };

  /* Road styling by the edge's DECLARED speed class, so the two kinds of road
     in this graph read differently without a second table saying which is
     which. SITE edges are yard moves of a few hundred metres; ROAD edges are
     regional legs of tens of kilometres. */
  const EDGE_STYLE = {
    SITE: { width: 1.4, dash: '3 4', stroke: '#334155', label: 'site move' },
    ROAD: { width: 2.6, dash: '', stroke: '#1e3a5f', label: 'public road' }
  };

  function assertNodeStyles(nodeTypes, styles) {
    const types = nodeTypes || need(WG, 'FWWorldGraph', 'the node style check').NODE_TYPES;
    const st = styles || NODE_STYLE;
    types.forEach(t => {
      if (!st[t]) {
        throw new Error('freightMap: worldGraph declares node type ' + t + ' and this map has no style for it, ' +
          'so a node of that type would be drawn as nothing at all -- a place in the network invisible on the ' +
          'map of it.');
      }
      ['shape', 'size', 'fill', 'stroke', 'label'].forEach(f => {
        if (!st[t][f]) throw new Error('freightMap: node style ' + t + ' declares no ' + f);
      });
    });
    Object.keys(st).forEach(t => {
      if (types.indexOf(t) < 0) {
        throw new Error('freightMap: this map styles a node type "' + t + '" that worldGraph does not declare. ' +
          'A style for a type the graph has no node of is a place this map is prepared to draw and the ' +
          'simulation can never put anything at.');
      }
    });
    const shapes = {};
    types.forEach(t => { shapes[st[t].shape + '/' + st[t].size] = (shapes[st[t].shape + '/' + st[t].size] || 0) + 1; });
    const collided = Object.keys(shapes).filter(k => shapes[k] > 1);
    if (collided.length) {
      throw new Error('freightMap: node types share a shape and size (' + collided.join(', ') + '), so two kinds ' +
        'of place are indistinguishable without colour. Colour alone is not a distinction on a control screen.');
    }
    return { state: 'CHECKED', types: types.length, styles: Object.keys(st).length };
  }

  function assertEdgeStyles(speedClasses, styles) {
    const classes = Object.keys(speedClasses || need(WG, 'FWWorldGraph', 'the road style check').SPEED_CLASSES);
    const st = styles || EDGE_STYLE;
    classes.forEach(c => {
      if (!st[c]) {
        throw new Error('freightMap: worldGraph declares speed class ' + c + ' and this map has no road style ' +
          'for it, so an edge of that class would draw with no width and no stroke.');
      }
    });
    Object.keys(st).forEach(c => {
      if (classes.indexOf(c) < 0) {
        throw new Error('freightMap: this map styles speed class "' + c + '", which worldGraph does not declare.');
      }
    });
    return { state: 'CHECKED', classes: classes.length };
  }

  /* THE VISUAL STATES, and each one is a restatement of something already in
     the simulation. Nothing here is a new fact about a truck: a state is a
     function of the lifecycle stage the truck already has and whether
     journeyEngine says it is standing at a node or moving along a leg.

     `from` says which of the two produced it, because a label whose source is
     unstated is a label a later reader will trust further than it deserves. */
  const VIEW_STATES = {
    QUEUED:     { from: 'STAGE',         means: 'dispatched and standing at a node, not yet moving.' },
    GATE_CHECK: { from: 'STAGE',         means: 'at a checkpoint node, in the stage that happens there.' },
    LOADING:    { from: 'STAGE',         means: 'in the LOADING stage at the node it is standing at.' },
    UNLOADING:  { from: 'STAGE',         means: 'in the DELIVERY stage at the node it is standing at.' },
    DWELLING:   { from: 'STAGE',         means: 'standing at a node in a stage that happens on the road, i.e. it has arrived and nothing has dispatched it onwards yet. journeyEngine calls this dwelling and it is an explicit field, not an inferred one.' },
    IN_TRANSIT: { from: 'STAGE',         means: 'on a public road between two named nodes.' },
    ARRIVING:   { from: 'LEG_REMAINING', means: 'on a leg with less than ARRIVING_WINDOW_SECONDS of its DERIVED duration left. A display window over a number the graph declares, not an observed or estimated arrival time.' },
    IDLE:       { from: 'STAGE',         means: 'the journey is complete and the truck is standing at its destination.' }
  };

  /* A window over the leg's own remaining time. Declared here rather than
     inlined, and named as a display threshold: nothing in the simulation
     changes at 300 seconds from a node. */
  const ARRIVING_WINDOW_SECONDS = 300;

  /* Lifecycle stage -> what to call a truck in it, once at a node and once on a
     leg. `onLeg: null` is a claim, not a gap: worldGraph declares which stages
     happen on a public road, and a truck in any other stage cannot be on one.
     assertViewStates checks every row of this table against
     journeyEngine.isRoadStage, so the two cannot drift, and placementFor
     reports POSITION_STAGE_DISAGREES rather than quietly picking a label if it
     ever happens. Since Slice 72 it cannot: journeyEngine.stageAgreement
     measures 0 disagreements per run. */
  const STAGE_VIEW = {
    DISPATCHED:       { atNode: 'QUEUED',    onLeg: null },
    EN_ROUTE_TO_PORT: { atNode: 'DWELLING',  onLeg: 'IN_TRANSIT' },
    CHECKPOINT:       { atNode: 'GATE_CHECK', onLeg: null },
    LOADING:          { atNode: 'LOADING',   onLeg: null },
    DEPARTURE:        { atNode: 'GATE_CHECK', onLeg: null },
    TRANSIT:          { atNode: 'DWELLING',  onLeg: 'IN_TRANSIT' },
    DEPOT:            { atNode: 'DWELLING',  onLeg: null },
    DELIVERY:         { atNode: 'UNLOADING', onLeg: null },
    /* COMPLETED is one of the three stages worldGraph attaches to no node
       type at all (with EN_ROUTE_TO_PORT and TRANSIT), so a truck in it can be
       on a road, and the on-leg label has to exist. It describes the position,
       not the paperwork: standing at the last node of its route is IDLE, and
       still moving is still moving. */
    COMPLETED:        { atNode: 'IDLE',      onLeg: 'IN_TRANSIT' }
  };

  /* An active signal is drawn as attention, never as a finding. The ladder --
     an observation, then a signal, then correlated signals, then a case, then a
     hypothesis, then a confirmed finding -- is the product, and one red marker
     collapses all six rungs into the first. */
  const ATTENTION = {
    flag: 'WATCHED',
    means: 'this truck currently carries at least one active signal.',
    doesNotMean: 'that fraud occurred, that a case exists, or that anything has been confirmed. A signal is an ' +
      'observation with a lifetime; most of them expire without ever being correlated with a second one.',
    caseIsSeparate: 'whether a case exists is moEngine\'s answer and is counted separately in the header.',
    supersededBy: 'ATTENTION_LEVELS. The flag above is still what one truck marker draws, and it is still one '
      + 'boolean; the ladder below is the ORDER a reader is asked to look in, and it is a presentation of state '
      + 'this module already had rather than a second opinion about any of it.'
  };

  /* THE ATTENTION LADDER, and the four things it is not.

     One boolean told a reader that a truck carried a signal. It could not tell
     them which of twenty-four trucks to look at first, because with a boolean
     they are all either on or off. This ladder orders them. It is a DISPLAY
     ORDER and nothing else: every rung is read from a value another module
     already wrote, no rung computes a score, and no rung is a probability, a
     risk rating, a priority assigned by anyone, or a queue that anything works
     through.

     The rungs, and whose answer each one is:

       NORMAL          signalEngine says no signal is active on this truck, and
                       moEngine names it in no open case.
       WATCH           signalEngine says at least one signal is active.
       ACTIVE          moEngine names it in a case whose status is in that
                       module's own OPEN_STATUSES set.
       HIGH_ATTENTION  the same, and EITHER an analyst has escalated that case
                       (moEngine's own ESCALATED status) OR the band moEngine put
                       on it is one of the two highest its confidenceLabel can
                       return.

     WHY THE TOP RUNG HAS TWO DOORS, AND WHAT MEASURING IT FOUND.

     It was first written with the band door only, and the band door is EMPTY.
     Measured at seed 12345 over 20 sim-days: 36 cases, banded MINIMAL 24,
     WATCH 8, ELEVATED 4, and SUBSTANTIAL and STRONG never once. Of those 36,
     exactly ONE was open, banded MINIMAL. So a four-rung ladder built on the
     band alone advertises a rung that this world cannot light -- a legend with a
     colour in it a reader will never see, which is the precise fault this whole
     pass exists to remove.

     Lowering the threshold to ELEVATED does not fix it: the four ELEVATED cases
     were all closed, and a dismissed case raising a truck's rung would be the
     ladder pointing at a movement this simulation has already finished with.

     So the second door is the analyst's own. ESCALATED is a status moEngine
     already has and only a reader's press ever sets. In an untouched run nothing
     is escalated and the rung is legitimately empty; the moment a reader
     escalates a case, the truck it names climbs to the top of the ladder and the
     map says so. That is a rung a reader can reach, driven by state that already
     existed, and it is the correct behaviour for the surface: the top of a
     control tower's attention order should be what its operator put there.

     The band is moEngine's word, off mo.confidenceBand, which only
     confidenceLabel ever writes. This module does not re-band anything and does
     not know what the thresholds are.

     WHY A HIGHER RUNG IS NOT A WORSE TRUCK. A case exists because two signal
     types were correlated. A band is high because the index moEngine keeps ran
     high. Neither is a finding, neither is a confirmation, and a truck sitting
     at HIGH_ATTENTION has had nothing established about it -- it has been
     looked at by more of this simulation's machinery than its neighbours, which
     is a fact about the machinery. Most cases in a run end DISMISSED, and a
     dismissed case is a case this world opened and then could not support. */
  const ATTENTION_LEVELS = {
    NORMAL:         { rank: 0, from: 'signalEngine and moEngine, both negative',
      means: 'no signal is active on this truck and no open case names it.' },
    WATCH:          { rank: 1, from: 'signalEngine.getActiveSignals',
      means: 'at least one signal is active on this truck. Most expire without ever meeting a second one.' },
    ACTIVE:         { rank: 2, from: 'moEngine.OPEN_STATUSES',
      means: 'a case that names this truck is open. A case is a correlation of signal types, not a finding.' },
    HIGH_ATTENTION: { rank: 3,
      from: 'mo.status === ESCALATED, or mo.confidenceBand in the two highest bands moEngine declares',
      means: 'an open case naming this truck has been escalated by an analyst, or carries one of the two '
        + 'highest bands moEngine declares.',
      measured: { seed: 12345, days: 20, cases: 36, openCases: 1,
        bands: { MINIMAL: 24, WATCH: 8, ELEVATED: 4, SUBSTANTIAL: 0, STRONG: 0 },
        reachedByBandInAnUntouchedRun: 0,
        note: 'the band door is empty in an untouched run and that is a fact about how readily moEngine '
          + 'dismisses, not a display fault. The escalation door is what a reader can actually reach.' } }
  };

  /* The one status that lifts an open case to the top rung on its own. It is
     moEngine's word and only an analyst press writes it, and it is checked
     against that module's own open set at first frame -- a status this map
     treated as escalated that moEngine considers closed would be a rung lit for
     a case nobody is working. */
  const ESCALATED_STATUS = 'ESCALATED';

  /* The two bands that lift ACTIVE to HIGH_ATTENTION, named rather than
     inlined, and checked against moEngine's own list at load by
     assertAttentionLadder -- so a sixth band, or a rename, fails here instead
     of quietly demoting every case to ACTIVE for the rest of the project. */
  const HIGH_ATTENTION_BANDS = ['SUBSTANTIAL', 'STRONG'];

  const ATTENTION_TONE = {
    NORMAL:         { ring: null,      label: null,             stroke: null },
    WATCH:          { ring: 'dashed',  label: 'WATCH',          stroke: '#f59e0b' },
    ACTIVE:         { ring: 'solid',   label: 'ACTIVE',         stroke: '#fb923c' },
    HIGH_ATTENTION: { ring: 'double',  label: 'HIGH ATTENTION', stroke: '#f87171' }
  };

  function assertAttentionLadder(levels, tones, bands, declaredBands, openStatuses) {
    const L = levels || ATTENTION_LEVELS;
    const T = tones || ATTENTION_TONE;
    const B = bands || HIGH_ATTENTION_BANDS;
    const names = Object.keys(L);
    const ranks = names.map(n => L[n].rank);
    if (new Set(ranks).size !== ranks.length) {
      throw new Error('freight-map: two attention rungs share a rank, so the order a reader is asked to look in ' +
        'is not an order');
    }
    names.forEach(n => {
      if (!T[n]) {
        throw new Error('freight-map: attention rung ' + n + ' has no declared tone, so it would draw as the rung ' +
          'below it while claiming to be a rung of its own');
      }
      if (!L[n].means || !L[n].from) {
        throw new Error('freight-map: attention rung ' + n + ' does not say what it means or whose answer it is');
      }
    });
    /* The bands are moEngine's, so they are checked against moEngine's list and
       not against a copy kept here. A band named here that module cannot return
       is a rung nothing will ever reach. */
    const declared = declaredBands || (window.FWMoEngine && FWMoEngine.CONFIDENCE_BAND &&
      FWMoEngine.CONFIDENCE_BAND.tone ? Object.keys(FWMoEngine.CONFIDENCE_BAND.tone) : null);
    if (declared) {
      B.forEach(b => {
        if (declared.indexOf(b) === -1) {
          throw new Error('freight-map: "' + b + '" is not a band moEngine declares (' + declared.join(', ') +
            '), so no case can ever reach HIGH_ATTENTION through it');
        }
      });
    }
    /* The escalated status has to be one moEngine calls OPEN. If it were ever
       moved to the closed set, this map would be lifting trucks to the top rung
       for cases nobody is working on. */
    const open = openStatuses || (window.FWMoEngine && FWMoEngine.OPEN_STATUSES ? FWMoEngine.OPEN_STATUSES : null);
    if (open && !open.has(ESCALATED_STATUS)) {
      throw new Error('freight-map: "' + ESCALATED_STATUS + '" is not a status moEngine treats as open, so the top ' +
        'attention rung would be lit for cases nobody is working on');
    }
    return { rungs: names.length, escalatedStatusChecked: !!open, bandsChecked: declared ? B.length : 0,
      bandsUnchecked: declared ? 0 : B.length,
      whyUnchecked: declared ? null : 'moEngine was not loaded when this module initialised, so the bands were ' +
        'taken as written rather than checked against the module that writes them' };
  }

  /* THE RUNG LADDER the journey strip labels rows with.

     The brief this was built for asked that a reader never be shown a signal
     that looks like a finding, and the way to do that is to name the rung on
     every row. Five rungs, and the last two share one timestamp on purpose:

       OBSERVATION  an event eventEngine stamped with a severity its own
                    severityBasis calls routine.
       EVENT        an event whose severity that same module calls a disruption.
       SIGNAL       a signal signalEngine currently holds as active, at its
                    createdAt.
       CORRELATED   two or more signal types were correlated.
       CASE         a case exists.

     CORRELATED AND CASE ARE THE SAME INSTANT IN THIS SIMULATION. moEngine opens
     a case AT the correlation -- there is no state between the two, and no
     timestamp that separates them. So the strip draws ONE row for both and says
     so, rather than drawing two rows a reader would read as two things that
     happened at two times. Inventing a gap to make a prettier ladder would be
     inventing a step in an investigation.

     mo.firstObserved is NOT that instant: it is the earliest of the case's own
     signals, which is always earlier, and it is already covered by the SIGNAL
     rows. Drawing it again as a case row would double-count one moment. */
  const RUNGS = {
    OBSERVATION: { rank: 0, from: 'FWEventEngine.severityBasis === ROUTINE',
      means: 'something was recorded. Nothing about it was flagged.' },
    EVENT:       { rank: 1, from: 'FWEventEngine.severityBasis === DISRUPTION',
      means: 'what was recorded carried a severity eventEngine declares a disruption.' },
    SIGNAL:      { rank: 2, from: 'FWSignalEngine.getActiveSignals, at signal.createdAt',
      means: 'an observation with a lifetime is attached to this entity. It is not a finding and most expire.' },
    CORRELATED:  { rank: 3, from: 'mo.openedAt -- the instant moEngine correlated the signal types',
      means: 'more than one signal type was seen on the same entity inside one window.',
      sharesTimestampWith: 'CASE' },
    CASE:        { rank: 4, from: 'mo.openedAt and mo.status',
      means: 'a case is on the record with a status. A status is a state of an examination, not a verdict.' }
  };

  const RUNG_TONE = {
    OBSERVATION: 'border-slate-700 text-slate-500',
    EVENT:       'border-amber-500/60 text-amber-200',
    SIGNAL:      'border-sky-500/60 text-sky-200',
    CORRELATED:  'border-orange-500/70 text-orange-200',
    CASE:        'border-rose-500/70 text-rose-200'
  };

  const RUNG_LADDER = {
    order: ['OBSERVATION', 'EVENT', 'SIGNAL', 'CORRELATED', 'CASE'],
    doesNotMean: 'A row further up this ladder is not stronger evidence of anything. The ladder is the ORDER '
      + 'this simulation\'s machinery touched a movement in, and a movement can reach the top of it and be '
      + 'dismissed -- most are.',
    sharedTimestamp: 'CORRELATED and CASE are one instant here, drawn as one row, because moEngine opens a case '
      + 'at the correlation and nothing separates them.'
  };

  function assertRungLadder(rungs, tones, ladder) {
    const R = rungs || RUNGS;
    const T = tones || RUNG_TONE;
    const L = ladder || RUNG_LADDER;
    const names = Object.keys(R);
    if (L.order.length !== names.length) {
      throw new Error('freight-map: the rung ladder lists ' + L.order.length + ' rungs but ' + names.length +
        ' are declared, so a reader would be shown a row on a rung the ladder does not order');
    }
    L.order.forEach((n, i) => {
      if (!R[n]) throw new Error('freight-map: ladder names rung ' + n + ', which is not declared');
      if (R[n].rank !== i) {
        throw new Error('freight-map: rung ' + n + ' has rank ' + R[n].rank + ' but sits at position ' + i +
          ' in the ladder');
      }
      if (!T[n]) throw new Error('freight-map: rung ' + n + ' has no declared tone');
    });
    const shared = names.filter(n => R[n].sharesTimestampWith);
    if (!shared.length) {
      throw new Error('freight-map: no rung declares the shared timestamp, but the strip draws one row for two ' +
        'rungs; the reason has to be on the register a reader can find, not only in a comment');
    }
    return { rungs: names.length, sharedTimestampRungs: shared.length };
  }

  /* WHAT THE IN-MAP CARD IS, AND WHAT IT MUST NOT BECOME.

     Slice 75 wired a truck click straight through to the full-screen entity
     panel. That answered "what is this truck" by covering over the network the
     question was asked from, and every click cost the reader their place on the
     map. So the click now does the smaller thing: it selects, and the read-out
     appears inside this panel, beside the drawing. The full panel is one
     deliberate press away and nothing was removed from it.

     The card is a SUMMARY and says so on itself. It holds no detail the full
     panel does not already derive, and it derives nothing differently: the
     links come from entityEngine, the active signals from signalEngine with
     that module's own reliability wording and its own decay clause, and the
     case split is moEngine's open/closed partition rather than a second
     opinion about which cases are open. Where the two surfaces would disagree
     this one defers -- which is why the per-case detail is a press away instead
     of being restated here in a shorter form that could drift from it.

     It reads nothing about a truck that the full panel does not already show
     an analyst, and it writes nothing anywhere. */
  const ENTITY_CARD = {
    shows: [
      'the linked driver, trailer and carrier, by id and by declared status',
      'active signals, with the reliability wording and the decay clause each type carries',
      'how many correlated cases name this truck, split into open and closed'
    ],
    defersTo: [
      'how far each case was actually examined, and whose hand closed it',
      'the outcome history, which is deliberately never compressed into one score',
      'the recorded event history of the truck itself'
    ],
    doesNotMean: 'A truck with a card open is not the subject of anything. A selection is a reader pointing ' +
      'at a movement; it is not a case, an allegation, or a step towards either.',
    writes: 'nothing. The selection is one id held in this module and the card is read-only.',
    supersedes: 'the Slice 75 behaviour of opening the full-screen panel on every click, which hid the map ' +
      'behind the answer.'
  };

  /* THE EVENT STRIP UNDER THE MAP, and the one thing it will not reach for.

     The simulation publishes a rolling list of the events it has just recorded,
     and the engine inspector already renders from it. That list is the channel
     this strip reuses. No second path out of the event log was opened for this
     panel, because a second path is a second chance to read something the first
     one was careful not to.

     A row carries four things and exactly four: when, what type, which entity
     it was recorded against, and whether the severity it was stamped with is
     one eventEngine declares a disruption. That last classification is
     eventEngine.severityBasis -- the module that stamps the severity owns the
     question -- and not a comparison written here against an inline literal.

     What a row does not carry is the note this simulation keeps beside an event
     for its own pacing checks. The engine inspector prints that note in
     brackets and labels it for what it is, because judging pacing is
     impossible without it. This strip is a player-facing surface: it reads the
     row's own four fields and never descends into what an event carries beside
     them. `neverRead` names it, and the suite for this slice poisons that door
     and then takes a frame, so the claim is checked against the code rather
     than believed. */
  const TIMELINE_VIEW = {
    rows: ['timestamp', 'type', 'entityId', 'severity basis'],
    classifiedBy: 'FWEventEngine.severityBasis, the module that stamps the severity in the first place',
    channel: 'the rolling recent-event list the simulation state already publishes -- the same one the engine ' +
      'inspector reads, not a new one',
    neverRead: 'the note kept beside an event for this simulation\'s own pacing checks. This panel does not ' +
      'open an event\'s side channel at all, so there is nothing here to leak from it.',
    doesNotMean: 'A row here is a record that something was observed, never a statement that it was ' +
      'anything. The climb from an observation to a finding runs through the case panels below, and no rung ' +
      'of it is drawn on this strip.',
    /* WHAT THE STRIP IS ACTUALLY LIKELY TO SHOW, measured rather than hoped for.
       The published list is a 40-row ring buffer over a stream that is
       overwhelmingly routine traffic, so a 14-row window onto it is mostly
       routine traffic. Sampled at seed 12345 over 200 hourly frames: 2800 rows,
       of which 23 carried the disruption severity -- 0.8% of rows, and 10% of
       windows held at least one, never more than two. That is the honest
       shape of this surface and it is not a fault to be tuned away: a strip
       that reliably showed a disruption would be a strip that had stopped being
       chronological. Which is exactly why every caption states how many of the
       shown rows carried one, instead of leaving a reader to assume the visible
       rows are the interesting ones.

       RE-MEASURED AFTER SLICES 81 AND 83, and it has moved the wrong way twice
       on purpose-free grounds: 42 -> 38 -> 23 disruption rows, 32 -> 27 -> 20
       windows, most-in-one-window 3 -> 2. The world got three times bigger and
       then half again, so the event stream grew with it -- but the ring buffer
       and this window are both FIXED sizes, so the same 14 rows now cover a
       small fraction of the simulated time they used to and catch far fewer of
       the rare rows. A bigger world made this surface LESS likely to show a
       disruption, not more, and the caption is the only reason a reader is not
       misled by that. Tuning the cap to make the strip look busier would be
       tuning the strip to stop being chronological, so it is left alone and the
       number is restated instead. */
    measured: { seed: 12345, frames: 200, rowsSampled: 2800, disruptionRows: 28,
      windowsWithADisruption: 22, mostInOneWindow: 2 },
    cap: 14
  };

  function assertViewStates(lifecycle, isRoadStage, table, states) {
    const cycle = lifecycle || need(BE, 'FWBehaviorEngine', 'the view state check').LIFECYCLE;
    const roadTest = isRoadStage || ((s) => need(JE, 'FWJourneyEngine', 'the view state check').isRoadStage(s));
    const t = table || STAGE_VIEW;
    const st = states || VIEW_STATES;
    cycle.forEach(stage => {
      const row = t[stage];
      if (!row) {
        throw new Error('freightMap: lifecycle stage ' + stage + ' has no visual state, so a truck in it would ' +
          'be drawn with no label at all.');
      }
      if (!st[row.atNode]) {
        throw new Error('freightMap: stage ' + stage + ' names visual state "' + row.atNode + '" at a node, ' +
          'which is not declared in VIEW_STATES.');
      }
      const road = roadTest(stage);
      if (road && !row.onLeg) {
        throw new Error('freightMap: worldGraph says stage ' + stage + ' happens on a public road, and this ' +
          'table gives it no on-leg visual state. A truck driving between two nodes would be drawn as though it ' +
          'were standing at one.');
      }
      if (!road && row.onLeg) {
        throw new Error('freightMap: stage ' + stage + ' is declared to happen at a node type, and this table ' +
          'gives it an on-leg visual state anyway. That prepares the renderer to draw a position the ' +
          'simulation cannot produce, which is how a renderer starts asserting things.');
      }
      if (row.onLeg && !st[row.onLeg]) {
        throw new Error('freightMap: stage ' + stage + ' names on-leg visual state "' + row.onLeg + '", which ' +
          'is not declared in VIEW_STATES.');
      }
    });
    Object.keys(t).forEach(stage => {
      if (cycle.indexOf(stage) < 0) {
        throw new Error('freightMap: this map declares a visual state for stage "' + stage + '", which is not in ' +
          'behaviorEngine.LIFECYCLE. A row for a stage no truck can be in is a row nothing keeps honest.');
      }
    });
    // Every declared state must be producible, or it is a label nothing can show.
    const produced = {};
    Object.keys(t).forEach(stage => {
      produced[t[stage].atNode] = true;
      if (t[stage].onLeg) produced[t[stage].onLeg] = true;
    });
    Object.keys(st).forEach(s => {
      if (st[s].from === 'STAGE' && !produced[s]) {
        throw new Error('freightMap: visual state ' + s + ' is declared to come from the stage table and no row ' +
          'of that table produces it, so nothing in the simulation can ever be drawn in it.');
      }
      if (st[s].from !== 'STAGE' && st[s].from !== 'LEG_REMAINING') {
        throw new Error('freightMap: visual state ' + s + ' does not say which simulation fact it restates.');
      }
    });
    return { state: 'CHECKED', stages: cycle.length, visualStates: Object.keys(st).length,
      roadStages: cycle.filter(roadTest).length };
  }

  /* ---------------------------------------------------------------------- */
  /* THE LAYOUT                                                             */
  /* ---------------------------------------------------------------------- */

  /* Hop distance from the root over the REAL adjacency, breadth first, with
     neighbours walked in the graph's own node order so the result is the same
     on every load and in every browser. worldGraph asserts the graph is one
     component, so every node gets a depth; it is checked here anyway, because
     a node with no depth would silently not be drawn. */
  function hopDepths(graph, rootId) {
    const order = {};
    graph.nodes.forEach((n, i) => { order[n.id] = i; });
    const byOrder = (a, b) => order[a] - order[b];
    const depth = {};
    depth[rootId] = 0;
    let frontier = [rootId];
    while (frontier.length) {
      const next = [];
      frontier.forEach(id => {
        graph.adjacency[id].slice().sort(byOrder).forEach(nb => {
          if (depth[nb] === undefined) { depth[nb] = depth[id] + 1; next.push(nb); }
        });
      });
      frontier = next.sort(byOrder);
    }
    const unplaced = graph.nodes.filter(n => depth[n.id] === undefined).map(n => n.id);
    if (unplaced.length) {
      throw new Error('freightMap: ' + unplaced.length + ' node(s) are not reachable from ' + rootId + ' (' +
        unplaced.join(', ') + ') and would therefore not be drawn at all. worldGraph asserts one component, so ' +
        'either that assert or this walk is wrong -- and a place missing from the map of a network reads as a ' +
        'network that does not have it.');
    }
    return { depth, order };
  }

  function buildLayout(graph, opts) {
    const g = graph || need(WG, 'FWWorldGraph', 'the map layout').graph();
    const o = opts || {};
    const rootId = o.rootNodeId || need(WG, 'FWWorldGraph', 'the map layout').portNode().id;
    if (!g.byId[rootId]) {
      throw new Error('freightMap: the layout root ' + rootId + ' is not a node of this graph.');
    }
    const { depth, order } = hopDepths(g, rootId);
    const maxDepth = g.nodes.reduce((m, n) => Math.max(m, depth[n.id]), 0);

    const columns = [];
    for (let d = 0; d <= maxDepth; d++) {
      columns[d] = g.nodes.filter(n => depth[n.id] === d).map(n => n.id).sort((a, b) => order[a] - order[b]);
    }
    /* One barycentre pass per column, in depth order: a node sits at the mean
       row of the neighbours it is already joined to in the column before it.
       This is a readability pass over the real adjacency and it moves nothing
       between columns -- the hop count decides that -- so it cannot make the
       drawing disagree with the graph. Ties fall back to the graph's node
       order, so the result is deterministic. */
    const row = {};
    columns.forEach((col, d) => {
      if (d === 0) { col.forEach((id, i) => { row[id] = i; }); return; }
      const bary = (id) => {
        const back = g.adjacency[id].filter(nb => depth[nb] === d - 1);
        if (!back.length) return 0;
        return back.reduce((s, nb) => s + row[nb], 0) / back.length;
      };
      const arranged = col.slice().sort((a, b) => (bary(a) - bary(b)) || (order[a] - order[b]));
      arranged.forEach((id, i) => { row[id] = i; });
      columns[d] = arranged;
    });

    const widest = columns.reduce((m, c) => Math.max(m, c.length), 1);
    const height = Math.max(LAYOUT.minHeight, LAYOUT.padY * 2 + (widest - 1) * LAYOUT.rowGap);
    const width = LAYOUT.padX * 2 + maxDepth * LAYOUT.colGap;

    const byId = {};
    const nodes = g.nodes.map(n => {
      const d = depth[n.id];
      const col = columns[d];
      const y = height / 2 + (row[n.id] - (col.length - 1) / 2) * LAYOUT.rowGap;
      const placed = {
        id: n.id, type: n.type, label: n.label,
        facilityNames: (n.facilityNames || []).slice(),
        depth: d, row: row[n.id],
        x: LAYOUT.padX + d * LAYOUT.colGap,
        y: Math.round(y * 100) / 100,
        style: NODE_STYLE[n.type]
      };
      byId[n.id] = placed;
      return placed;
    });

    const edgeByKey = {};
    const edges = g.edges.map(e => {
      const a = byId[e.from], b = byId[e.to];
      const drawn = {
        key: e.key, from: e.from, to: e.to,
        x1: a.x, y1: a.y, x2: b.x, y2: b.y,
        distanceKm: e.distanceKm, speedClass: e.speedClass, traverseSeconds: e.traverseSeconds,
        style: EDGE_STYLE[e.speedClass]
      };
      edgeByKey[e.key] = drawn;
      return drawn;
    });

    const layout = {
      rootId, nodes, edges, byId, edgeByKey, columns,
      width: Math.round(width), height: Math.round(height),
      viewBox: '0 0 ' + Math.round(width) + ' ' + Math.round(height),
      unit: LAYOUT_SCALE.unit,
      note: 'Columns are hop distance from ' + rootId + ' over the real adjacency; rows are a barycentre ordering ' +
        'inside a column. No node carries a hand-written position, and no drawn length means a distance.'
    };
    assertLayoutCoversGraph(layout, g);
    return layout;
  }

  /* The first four checks the brief asks for, at load rather than in a test:
     every drawn facility is a real node, every drawn road is a real edge, in
     both directions, and no two places share a point. */
  function assertLayoutCoversGraph(layout, graph) {
    const g = graph || need(WG, 'FWWorldGraph', 'the layout check').graph();
    if (layout.nodes.length !== g.nodes.length) {
      throw new Error('freightMap: the layout holds ' + layout.nodes.length + ' nodes and the graph has ' +
        g.nodes.length + '. A map with a different number of places than the world is a second topology.');
    }
    layout.nodes.forEach(n => {
      if (!g.byId[n.id]) {
        throw new Error('freightMap: the layout draws a facility "' + n.id + '" that is not a node of worldGraph.');
      }
      if (g.byId[n.id].type !== n.type) {
        throw new Error('freightMap: the layout draws ' + n.id + ' as a ' + n.type + ' and worldGraph declares ' +
          'it a ' + g.byId[n.id].type + '.');
      }
      if (!isFinite(n.x) || !isFinite(n.y)) {
        throw new Error('freightMap: node ' + n.id + ' has no finite position, so it would be drawn nowhere.');
      }
    });
    g.nodes.forEach(n => {
      if (!layout.byId[n.id]) {
        throw new Error('freightMap: worldGraph node ' + n.id + ' has no place on the map, so the network would ' +
          'be drawn with a place missing from it.');
      }
    });
    if (layout.edges.length !== g.edges.length) {
      throw new Error('freightMap: the layout draws ' + layout.edges.length + ' roads and the graph declares ' +
        g.edges.length + '.');
    }
    layout.edges.forEach(e => {
      if (!g.edgeIndex[e.key]) {
        throw new Error('freightMap: the layout draws a road ' + e.key + ' that is not an edge of worldGraph. A ' +
          'drawn road nothing can be driven on invites a route that does not exist.');
      }
      const a = layout.byId[e.from], b = layout.byId[e.to];
      if (e.x1 !== a.x || e.y1 !== a.y || e.x2 !== b.x || e.y2 !== b.y) {
        throw new Error('freightMap: road ' + e.key + ' does not end at the two places it joins, so the picture ' +
          'and the graph disagree about what is connected to what.');
      }
    });
    const seen = {};
    layout.nodes.forEach(n => {
      const p = n.x + ',' + n.y;
      if (seen[p]) {
        throw new Error('freightMap: ' + n.id + ' and ' + seen[p] + ' are drawn at the same point, so two ' +
          'places in the network appear as one.');
      }
      seen[p] = n.id;
    });
    return { state: 'CHECKED', nodes: layout.nodes.length, edges: layout.edges.length,
      columns: layout.columns.length };
  }

  /* ---------------------------------------------------------------------- */
  /* WHERE ONE TRUCK IS DRAWN                                              */
  /* ---------------------------------------------------------------------- */

  /* Why a truck is not on the map, when it is not. Absence has four different
     causes here and merging them into "no marker" would hide the only one that
     is a fault. */
  const NOT_DRAWN = {
    NO_JOURNEY: 'the truck has no journey, so journeyEngine can state no position for it. A marker for it would ' +
      'be a place invented by the renderer. entityEngine assigns a journey at seed time, so this is not expected.',
    JOURNEY_UNREADABLE: 'journeyEngine.assertJourney refused the journey. The renderer does not repair it and does ' +
      'not guess a position from the truck\'s status fields, which are a copy of the journey rather than a ' +
      'second source for it.'
  };

  /* THE ONE PLACE A TRUCK'S POSITION COMES FROM. positionOf() is
     journeyEngine's, the interpolation is over the two nodes it names, and the
     fraction is the one it computed. */
  function placementFor(truck, layout, opts) {
    const o = opts || {};
    const lay = layout || defaultLayout();
    if (!truck.journey) return { truckId: truck.id, drawn: false, reason: 'NO_JOURNEY', why: NOT_DRAWN.NO_JOURNEY };
    let pos;
    try {
      pos = need(JE, 'FWJourneyEngine', 'a truck position').positionOf(truck.journey);
    } catch (e) {
      return { truckId: truck.id, drawn: false, reason: 'JOURNEY_UNREADABLE',
        why: NOT_DRAWN.JOURNEY_UNREADABLE, detail: e.message };
    }
    const stageRow = STAGE_VIEW[truck.status];
    if (!stageRow) {
      throw new Error('freightMap: truck ' + truck.id + ' is in status "' + truck.status + '", which is not a ' +
        'lifecycle stage this map has a visual state for. assertViewStates checks the table against ' +
        'behaviorEngine.LIFECYCLE at load, so this means the status came from somewhere else.');
    }

    let x, y, viewState, disagrees = false;
    if (pos.kind === 'AT_NODE') {
      const node = lay.byId[pos.nodeId];
      if (!node) {
        throw new Error('freightMap: truck ' + truck.id + ' is at node "' + pos.nodeId + '", which is not a place ' +
          'on this map. Drawing it somewhere would put a truck at a facility the network does not have.');
      }
      x = node.x; y = node.y;
      viewState = stageRow.atNode;
    } else {
      const a = lay.byId[pos.from], b = lay.byId[pos.to];
      if (!a || !b) {
        throw new Error('freightMap: truck ' + truck.id + ' is on a leg between "' + pos.from + '" and "' +
          pos.to + '", and at least one of them is not a place on this map.');
      }
      const key = need(WG, 'FWWorldGraph', 'a truck position').edgeKey(pos.from, pos.to);
      if (!lay.edgeByKey[key]) {
        throw new Error('freightMap: truck ' + truck.id + ' is on a leg ' + key + ' that is not a road on this ' +
          'map, so it would be drawn crossing open ground between two places with no road between them.');
      }
      x = a.x + (b.x - a.x) * pos.fraction;
      y = a.y + (b.y - a.y) * pos.fraction;
      if (stageRow.onLeg) {
        viewState = (pos.remainingSeconds <= ARRIVING_WINDOW_SECONDS) ? 'ARRIVING' : stageRow.onLeg;
      } else {
        /* The table says this stage cannot be on a road, and the journey says it
           is. Since Slice 72 that is impossible -- journeyEngine.stageAgreement
           reads 0 disagreements per run -- so this branch is a change detector,
           and it reports rather than picking a label. */
        viewState = 'IN_TRANSIT';
        disagrees = true;
      }
    }

    return {
      truckId: truck.id, drawn: true,
      kind: pos.kind,
      nodeId: pos.kind === 'AT_NODE' ? pos.nodeId : null,
      from: pos.from, to: pos.to,
      legIndex: pos.legIndex, legSeconds: pos.legSeconds, legElapsed: pos.legElapsed,
      remainingSeconds: pos.remainingSeconds, fraction: pos.fraction,
      complete: !!pos.complete,
      status: truck.status, viewState,
      positionStageDisagrees: disagrees,
      routeId: truck.journey.routeId, direction: truck.journey.direction,
      destinationNodeId: JE ? JE.destinationOf(truck.journey) : null,
      signalCount: o.signalCount === undefined ? null : o.signalCount,
      watched: o.signalCount ? true : false,
      x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100,
      // Where the marker is actually painted: identical to x/y unless several
      // trucks stand at one node, in which case frame() nudges them apart so
      // eight markers are not one. The nudge is drawing, never position.
      drawX: Math.round(x * 100) / 100, drawY: Math.round(y * 100) / 100,
      stacked: false
    };
  }

  /* Several trucks standing at one node are one marker unless they are nudged
     apart. The nudge is deterministic (the order is the registry's), it is
     applied to drawX/drawY only, and `stacked` says it happened -- so nobody
     reads a ring of markers around a node as eight positions the simulation
     stated. */
  function stackAtNodes(placements) {
    const groups = {};
    placements.forEach(p => {
      if (!p.drawn || p.kind !== 'AT_NODE') return;
      (groups[p.nodeId] = groups[p.nodeId] || []).push(p);
    });
    Object.keys(groups).forEach(nodeId => {
      const group = groups[nodeId];
      if (group.length < 2) return;
      group.forEach((p, i) => {
        const angle = (i % LAYOUT.stackPoints) * (2 * Math.PI / LAYOUT.stackPoints);
        const radius = LAYOUT.stackRadius * (1 + Math.floor(i / LAYOUT.stackPoints) * 0.6);
        p.drawX = Math.round((p.x + Math.cos(angle) * radius) * 100) / 100;
        p.drawY = Math.round((p.y + Math.sin(angle) * radius) * 100) / 100;
        p.stacked = true;
        p.stackIndex = i;
        p.stackOf = group.length;
      });
    });
    return placements;
  }

  /* The route a SELECTED truck is on, for the origin -> position ->
     destination line. Read out of journeyEngine's own route walk; the journey
     is not touched. */
  function selectedRoute(truck, layout) {
    if (!truck || !truck.journey) return null;
    const lay = layout || defaultLayout();
    const je = need(JE, 'FWJourneyEngine', 'the selected route');
    const ordered = je.orderedNodes(truck.journey.routeId, truck.journey.direction);
    const route = je.routeOf(truck.journey.routeId);
    const pos = je.positionOf(truck.journey);
    const legs = je.legsOf(truck.journey.routeId, truck.journey.direction);
    return {
      routeId: route.id, label: route.label, direction: truck.journey.direction,
      originNodeId: ordered[0], destinationNodeId: ordered[ordered.length - 1],
      legIndex: pos.legIndex, legs: legs.length,
      nodes: ordered.map((id, i) => ({
        id, label: lay.byId[id] ? lay.byId[id].label : id,
        x: lay.byId[id] ? lay.byId[id].x : null, y: lay.byId[id] ? lay.byId[id].y : null,
        passed: i < pos.legIndex, current: pos.kind === 'AT_NODE' && pos.nodeId === id
      })),
      legKeys: legs.map(l => need(WG, 'FWWorldGraph', 'the selected route').edgeKey(l.from, l.to)),
      currentLegKey: pos.kind === 'ON_LEG'
        ? need(WG, 'FWWorldGraph', 'the selected route').edgeKey(pos.from, pos.to) : null,
      fraction: pos.fraction,
      distanceKm: route.distanceKm
    };
  }

  /* ONE PASS over the case register, for every question this frame asks of it.

     Three surfaces used to walk mos.values() separately -- the header for its
     open count, the entity card for the cases naming one truck, and now the
     attention ladder for every truck at once. Three walks of the same map on
     every tick is three times the work and, worse, three chances to partition
     it differently. This walks it once and every reader on the frame takes its
     answer from the same object.

     `derived: false` is a real state and not an empty result: if moEngine is not
     loaded there is nothing to say about cases, and saying "no cases" would be a
     claim. Every caption downstream distinguishes the two. */
  let BANDS_VERIFIED = null;
  function bandsVerified() { return BANDS_VERIFIED; }

  function caseIndexOf(state) {
    const idx = { byTruck: {}, openTotal: 0, total: 0, derived: false };
    if (!state || !state.moEngine || !state.moEngine.mos || !window.FWMoEngine || !FWMoEngine.OPEN_STATUSES) {
      return idx;
    }
    idx.derived = true;
    /* THE BAND CHECK, RUN ONCE, HERE, AND NOT AT LOAD TIME.

       assertAttentionLadder wanted to compare HIGH_ATTENTION_BANDS against
       moEngine's own declared band list at module load, and could not: at the
       moment this file is evaluated the case module has been evaluated but has
       not yet been published on window, so the check took the bands as written
       and said so on LADDER_CHECK.bandsUnchecked. A guard that reports itself
       unchecked is honest but it is not a guard.

       So it runs on the first frame that actually finds a case register, which is
       the first moment the answer exists, and it runs once. If a future edit
       renames a band or adds a sixth, this throws on the first frame instead of
       quietly holding every case at ACTIVE for the rest of the project. */
    if (!BANDS_VERIFIED) {
      BANDS_VERIFIED = assertAttentionLadder(null, null, null,
        FWMoEngine.CONFIDENCE_BAND && FWMoEngine.CONFIDENCE_BAND.tone
          ? Object.keys(FWMoEngine.CONFIDENCE_BAND.tone) : null,
        FWMoEngine.OPEN_STATUSES);
    }
    state.moEngine.mos.forEach(m => {
      idx.total++;
      const open = FWMoEngine.OPEN_STATUSES.has(m.status);
      if (open) idx.openTotal++;
      const tid = m.entities && m.entities.truckId;
      if (!tid) return;
      const e = idx.byTruck[tid] || (idx.byTruck[tid] = { open: 0, closed: 0, high: 0, openIds: [], caseIds: [] });
      e.caseIds.push(m.id);
      if (!open) { e.closed++; return; }
      e.open++;
      e.openIds.push(m.id);
      if (m.status === ESCALATED_STATUS || HIGH_ATTENTION_BANDS.indexOf(m.confidenceBand) >= 0) e.high++;
    });
    return idx;
  }

  /* The rung one truck sits on. Reads two answers and computes nothing. A truck
     whose signals were not derived at all returns null rather than NORMAL --
     NORMAL asserts signalEngine looked and found none, and a surface with no
     signalEngine has not looked. */
  function attentionOf(p, entry) {
    if (entry && entry.high > 0) return 'HIGH_ATTENTION';
    if (entry && entry.open > 0) return 'ACTIVE';
    if (p.signalCount === null || p.signalCount === undefined) return null;
    return p.signalCount > 0 ? 'WATCH' : 'NORMAL';
  }

  /* WHAT IS IN A CASE'S PART OF THE NETWORK, and how little of it is guessed.

     Case Focus dims the world and leaves one case's part of it lit. Everything
     it lights comes from a relationship that already exists:

       the truck        mo.entities.truckId, written by moEngine when it opened
       the route        that truck's OWN journey, read through selectedRoute --
                        the route it was assigned, not a path chosen here
       the places       the nodes of that route, in that route's order
       the roads        that route's leg keys, which are worldGraph's edge keys
       the site         mo.entities.facilityId, and ONLY when moEngine attached
                        one, which it does only when every signal in the case
                        was seen at the same place

     NOTHING ELSE IS LIT. Not the other trucks of the same carrier, not the
     other cases at the same place, not the neighbouring roads. Every one of
     those is a relationship a reader would take as this simulation's claim that
     the two are connected, and none of them is.

     A site is matched to a node by the facility NAME, because that is the only
     link worldGraph and entityEngine share -- worldGraph lists facilityNames at
     each node and entityEngine seeds facilities with those names. When the name
     matches no node the site is reported unplaced rather than dropped: a case
     attached to a place the map cannot find is worth knowing about. */
  function focusOf(state, lay, caseId) {
    if (!caseId) return null;
    if (!state || !state.moEngine || !state.moEngine.mos) {
      return { caseId, resolved: false, why: 'NO_CASE_REGISTER', truckIds: [], nodeIds: [], edgeKeys: [] };
    }
    const mo = state.moEngine.mos.get(caseId);
    if (!mo) {
      return { caseId, resolved: false, why: 'CASE_NOT_ON_RECORD', truckIds: [], nodeIds: [], edgeKeys: [] };
    }
    const ent = mo.entities || {};
    const EE = window.FWEntityEngine || null;
    const truck = ent.truckId && EE ? EE.get(state.registry, 'truck', ent.truckId) : null;
    let route = null;
    try { route = truck ? selectedRoute(truck, lay) : null; } catch (e) { route = null; }
    let siteNodeId = null, siteName = null, sitePlaced = null;
    if (ent.facilityId && EE) {
      const fac = EE.get(state.registry, 'facility', ent.facilityId);
      if (fac && fac.name) {
        siteName = fac.name;
        const hit = lay.nodes.filter(n => (n.facilityNames || []).indexOf(fac.name) >= 0)[0];
        siteNodeId = hit ? hit.id : null;
        sitePlaced = !!hit;
      }
    }
    const nodeIds = route ? route.nodes.map(n => n.id) : [];
    if (siteNodeId && nodeIds.indexOf(siteNodeId) === -1) nodeIds.push(siteNodeId);
    const open = window.FWMoEngine && FWMoEngine.OPEN_STATUSES
      ? FWMoEngine.OPEN_STATUSES.has(mo.status) : null;
    return {
      caseId, resolved: true, why: null,
      status: mo.status, open,
      band: mo.confidenceBand || null,
      classification: mo.classification || null,
      title: mo.title || null,
      openedAt: mo.openedAt === undefined ? null : mo.openedAt,
      firstObserved: mo.firstObserved === undefined ? null : mo.firstObserved,
      signalTypes: Array.from(new Set((mo.evidence || []).map(e => e.signalType).filter(Boolean))),
      truckIds: ent.truckId ? [ent.truckId] : [],
      driverId: ent.driverId || null,
      trailerId: ent.trailerId || null,
      carrierId: ent.carrierId || null,
      facilityId: ent.facilityId || null,
      siteName, siteNodeId, sitePlaced,
      route: route ? { routeId: route.routeId, label: route.label, legs: route.legs } : null,
      nodeIds,
      edgeKeys: route ? route.legKeys.slice() : [],
      /* Named on the object a reader can print, not only in the comment above. */
      lightsOnly: 'the case truck, that truck\'s own assigned route, the places on it, and the one site '
        + 'moEngine attached if it attached one',
      neverLights: 'other trucks of the same carrier, other cases at the same place, and roads the route does '
        + 'not use -- each of those would be a connection this simulation has not made'
    };
  }

  /* ---------------------------------------------------------------------- */
  /* ONE FRAME                                                              */
  /* ---------------------------------------------------------------------- */

  let LAYOUT_CACHE = null;
  function defaultLayout() {
    if (!LAYOUT_CACHE) LAYOUT_CACHE = buildLayout();
    return LAYOUT_CACHE;
  }

  function absoluteNow(clock) {
    if (window.FWSimRunner && FWSimRunner.absoluteNow) return FWSimRunner.absoluteNow(clock);
    return (clock.day - 1) * FWSimClock.SECONDS_PER_DAY + clock.simSeconds;
  }

  /* Every number in the header, with the population it was counted over.
     Nothing is estimated and nothing is a rate: they are counts of things the
     simulation is holding right now. `openCases` is moEngine's own status
     partition, not a second opinion about which cases are open. */
  function clockLabel(absSeconds) {
    const day = Math.floor(absSeconds / 86400) + 1;
    const s = Math.floor(absSeconds % 86400);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return 'D' + day + ' ' + String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
  }

  /* The card's data, assembled here rather than in the DOM writer so a suite can
     read every field of it without a document. Each field is fetched from the
     module that owns it, and a module that is absent produces a stated absence
     rather than a zero -- because "no cases" and "cases not counted here" are
     different facts and printing the first for the second would be a claim. */
  function entityCardFor(truck, state, now) {
    if (!truck) return null;
    const EE = window.FWEntityEngine || null;
    const SE = window.FWSignalEngine || null;
    const get = (kind, id) => (EE && id ? EE.get(state.registry, kind, id) : null);
    const status = (kind, v) => (EE && EE.formatStatus ? EE.formatStatus(kind, v) : v);
    const driver = get('driver', truck.driverId);
    const trailer = get('trailer', truck.trailerId);
    const carrier = get('carrier', truck.carrierId);

    const active = SE ? SE.getActiveSignals(truck, now) : null;
    const signals = active ? active.map(sg => ({
      type: sg.type,
      reliability: SE.formatReliability ? SE.formatReliability(sg.reliability) : null,
      decay: SE.decayClause ? SE.decayClause(sg.type, sg.expiresAt - sg.createdAt).text : null
    })) : null;

    let cases = null;
    if (state.moEngine && window.FWMoEngine && FWMoEngine.OPEN_STATUSES) {
      const mine = Array.from(state.moEngine.mos.values())
        .filter(m => m.entities && m.entities.truckId === truck.id);
      const open = mine.filter(m => FWMoEngine.OPEN_STATUSES.has(m.status)).length;
      cases = { total: mine.length, open, closed: mine.length - open };
    }

    return {
      truckId: truck.id,
      statusLabel: EE && EE.statusLabel ? EE.statusLabel('truck', truck.status) : truck.status,
      driver: driver ? { id: driver.id, name: driver.name, status: status('driver', driver.status) } : null,
      trailer: trailer ? { id: trailer.id, sealId: trailer.sealId || null, status: status('trailer', trailer.status) } : null,
      carrier: carrier ? { id: carrier.id, name: carrier.name, scac: carrier.scac || null } : null,
      signals,
      signalCount: signals ? signals.length : null,
      reliabilityNote: signals && signals.length && SE.reliabilityNote ? SE.reliabilityNote() : null,
      cases,
      expandable: !!window.FWEntityInspector
    };
  }

  /* The strip's rows. Four fields off each row of the published list, plus the
     classification the stamping module makes of the fifth. `shown` and `held`
     are both stated because the list is a ring buffer: the strip is a window on
     a window, and a count with the wrong denominator behind it reads as a total. */
  function timelineOf(state, limit) {
    const cap = limit === undefined ? TIMELINE_VIEW.cap : limit;
    const feed = state.recentEvents || [];
    const rows = feed.slice(0, cap).map(ev => ({
      t: ev.timestamp,
      type: ev.type,
      entityId: ev.entityId,
      severity: ev.severity,
      basis: window.FWEventEngine ? FWEventEngine.severityBasis(ev.severity).basis : 'UNDECLARED'
    }));
    return {
      rows,
      shown: rows.length,
      held: feed.length,
      totalSoFar: state.totalEvents === undefined ? null : state.totalEvents,
      disruptions: rows.filter(r => r.basis === 'DISRUPTION').length,
      undeclared: rows.filter(r => r.basis === 'UNDECLARED').length
    };
  }

  /* Which rung an event row sits on. Two of the three answers eventEngine's own
     severityBasis can give map onto a rung; the third does not and returns null.
     A severity this program does not declare is not known to be routine, and
     putting it on the routine rung would be the exact claim BASIS_TONE already
     refuses to make in colour. */
  function rungOf(basis) {
    if (basis === 'DISRUPTION') return 'EVENT';
    if (basis === 'ROUTINE') return 'OBSERVATION';
    return null;
  }

  /* THE SELECTED JOURNEY'S OWN LADDER, and the two things it cannot show.

     One truck, everything this simulation currently holds about it, in time
     order, each row named for its rung. Three sources, all already open:

       events   the published rolling list, filtered to this entity
       signals  signalEngine's active set for this truck, at each createdAt
       cases    the cases whose entities.truckId is this truck, at openedAt

     WHAT IT CANNOT SHOW, stated on the object rather than left as a gap:

     1. OLDER EVENTS. The published list is a ring buffer of a few dozen rows
        over a stream that records tens of thousands per run. One truck's events
        leave it within seconds of sim-time. So the event section here is
        usually EMPTY, and that emptiness is the buffer having moved on -- not a
        truck nothing happened to. `eventsAreAWindow` says so and every caption
        repeats it, because a reader who takes an empty section for a quiet
        truck has been misled by a data structure.

     2. EXPIRED SIGNALS. getActiveSignals returns what is active NOW. A signal
        that expired is gone from it, including signals that were correlated into
        a case that is still open. So the SIGNAL rows can be fewer than the
        signal types the CASE row was built from, and that is not a
        contradiction -- it is a case outliving its evidence's lifetime, which is
        the normal shape of this simulation.

     Sorted ASCENDING. The world strip runs newest-first because it is a feed;
     a journey is a story and reads forwards. */
  function journeyTimelineOf(state, truckId, opts) {
    const o = opts || {};
    const out = { truckId: truckId || null, rows: [], eventRows: 0, signalRows: 0, caseRows: 0,
      undeclaredRows: 0, feedHeld: 0, signalsDerived: false, casesDerived: false,
      eventsAreAWindow: 'the event rows are whatever of this truck\'s events are still in the short rolling list '
        + 'the simulation publishes. Older ones have left it. An empty event section is that list having moved '
        + 'on, not a truck nothing was recorded against.',
      signalsAreActiveOnly: 'only signals still active are listed. A case can name signal types whose signals '
        + 'have since expired, so a case row is not required to have a signal row behind it here.' };
    if (!state || !truckId) return out;
    const now = o.now === undefined ? absoluteNow(state.clock) : o.now;

    const feed = state.recentEvents || [];
    out.feedHeld = feed.length;
    feed.filter(ev => ev.entityId === truckId).forEach(ev => {
      const basis = window.FWEventEngine ? FWEventEngine.severityBasis(ev.severity).basis : 'UNDECLARED';
      const rung = rungOf(basis);
      if (rung === null) out.undeclaredRows++; else out.eventRows++;
      out.rows.push({ t: ev.timestamp, rung, basis, kind: 'EVENT_RECORD',
        label: String(ev.type).replace(/_/g, ' '), detail: null });
    });

    const EE = window.FWEntityEngine || null;
    const truck = EE ? EE.get(state.registry, 'truck', truckId) : null;
    if (truck && window.FWSignalEngine) {
      out.signalsDerived = true;
      FWSignalEngine.getActiveSignals(truck, now).forEach(sg => {
        out.signalRows++;
        out.rows.push({ t: sg.createdAt, rung: 'SIGNAL', basis: null, kind: 'SIGNAL',
          label: String(sg.type).replace(/_/g, ' '),
          detail: FWSignalEngine.formatReliability ? FWSignalEngine.formatReliability(sg.reliability) : null });
      });
    }

    if (state.moEngine && state.moEngine.mos && window.FWMoEngine && FWMoEngine.OPEN_STATUSES) {
      out.casesDerived = true;
      state.moEngine.mos.forEach(m => {
        if (!m.entities || m.entities.truckId !== truckId) return;
        out.caseRows++;
        const types = Array.from(new Set((m.evidence || []).map(e => e.signalType).filter(Boolean)));
        out.rows.push({ t: m.openedAt, rung: 'CASE', alsoRung: 'CORRELATED', basis: null, kind: 'CASE',
          caseId: m.id, status: m.status, band: m.confidenceBand || null,
          open: FWMoEngine.OPEN_STATUSES.has(m.status),
          label: types.length + ' signal type' + (types.length === 1 ? '' : 's') + ' correlated',
          detail: types.map(t => String(t).replace(/_/g, ' ')).join(', ') || null });
      });
    }

    out.rows.sort((a, b) => (a.t - b.t) || (RUNGS[a.rung] ? RUNGS[a.rung].rank : -1) -
      (RUNGS[b.rung] ? RUNGS[b.rung].rank : -1));
    out.shown = out.rows.length;
    return out;
  }

  function frame(state, opts) {
    if (!state) return null;
    const o = opts || {};
    const lay = o.layout || defaultLayout();
    const now = absoluteNow(state.clock);
    const trucks = window.FWEntityEngine ? FWEntityEngine.all(state.registry, 'truck') : [];
    const selectedId = o.selectedTruckId !== undefined ? o.selectedTruckId : selectedTruckId;

    const placements = trucks.map(t => {
      const signalCount = window.FWSignalEngine
        ? FWSignalEngine.getActiveSignals(t, now).length
        : undefined;
      const p = placementFor(t, lay, { signalCount });
      p.selected = t.id === selectedId;
      return p;
    });
    stackAtNodes(placements);

    /* One walk of the case register, before anything reads it. */
    const cases = caseIndexOf(state);
    placements.forEach(p => {
      const entry = cases.derived ? (cases.byTruck[p.truckId] || null) : null;
      p.attention = attentionOf(p, entry);
      p.openCaseCount = entry ? entry.open : (cases.derived ? 0 : null);
      p.openCaseIds = entry ? entry.openIds.slice() : [];
    });

    const drawn = placements.filter(p => p.drawn);
    const atNode = drawn.filter(p => p.kind === 'AT_NODE');
    const onLeg = drawn.filter(p => p.kind === 'ON_LEG');
    const watched = drawn.filter(p => p.watched);
    const signalTotal = drawn.reduce((s, p) => s + (p.signalCount || 0), 0);

    const here = {};
    atNode.forEach(p => { here[p.nodeId] = (here[p.nodeId] || 0) + 1; });
    const nodes = lay.nodes.map(n => ({
      id: n.id, type: n.type, label: n.label, x: n.x, y: n.y, style: n.style,
      facilityNames: n.facilityNames,
      trucksHere: here[n.id] || 0,
      // A node this build seeds no facility at observes nothing that happens
      // there. worldGraph.nodeCoverage measures it; the map says it out loud
      // instead of drawing an unwatched place exactly like a watched one.
      sited: n.facilityNames.length > 0
    }));

    const openCases = cases.derived ? cases.openTotal : null;

    /* The census the header reads. Counted over the DRAWN trucks, because that
       is the population a reader can see, and stated with that denominator. */
    const attentionCounts = { NORMAL: 0, WATCH: 0, ACTIVE: 0, HIGH_ATTENTION: 0, NOT_DERIVED: 0 };
    drawn.forEach(p => {
      const k = p.attention === null || p.attention === undefined ? 'NOT_DERIVED' : p.attention;
      attentionCounts[k] = (attentionCounts[k] || 0) + 1;
    });

    const selectedTruck = selectedId ? trucks.filter(t => t.id === selectedId)[0] || null : null;

    return {
      layout: lay,
      clock: { day: state.clock.day, timeOfDay: state.clock.timeOfDay(), shift: state.clock.shift(),
        speed: state.clock.speed, running: state.clock.running, absoluteNow: now },
      nodes,
      trucks: placements,
      selectedTruckId: selectedId,
      selectedRoute: selectedTruck ? selectedRoute(selectedTruck, lay) : null,
      selectedEntity: selectedTruck ? entityCardFor(selectedTruck, state, now) : null,
      /* WHAT THIS SIMULATION CALLS A JOURNEY, and what it does not give one.

         A journey here is a route id, a direction, a leg index and the seconds
         elapsed ON THAT LEG. There is NO journey id and NO journey start
         timestamp anywhere in journeyEngine, so this object reports neither and
         says so instead. The Journey Inspector prints the route and direction
         as the journey's identity, because that is the identity the simulation
         actually has, and prints the elapsed time as what it is -- time on the
         current leg, not time since departure. Summing the declared durations
         of the completed legs would produce a plausible total that is a PLAN,
         not an elapsed time, and it would be read as the second. */
      selectedJourney: !selectedTruck || !selectedTruck.journey ? null : {
        routeId: selectedTruck.journey.routeId,
        direction: selectedTruck.journey.direction,
        legIndex: selectedTruck.journey.legIndex,
        legElapsedSeconds: selectedTruck.journey.legElapsed,
        dwelling: !!selectedTruck.journey.dwelling,
        hasJourneyId: false,
        hasStartTimestamp: false,
        whyNoElapsedTotal: 'journeyEngine records elapsed time per leg and no departure timestamp, so the time '
          + 'since this journey began is not a number this simulation holds. The figure shown is time on the '
          + 'current leg.'
      },
      selectedJourneyTimeline: selectedId ? journeyTimelineOf(state, selectedId, { now }) : null,
      timeline: timelineOf(state),
      focus: focusOf(state, lay, o.focusCaseId !== undefined ? o.focusCaseId : focusCaseId),
      attentionCounts,
      counts: {
        trucks: trucks.length,
        drawn: drawn.length,
        notDrawn: placements.length - drawn.length,
        atNode: atNode.length,
        inTransit: onLeg.length,
        watchedTrucks: watched.length,
        activeSignals: signalTotal,
        openCases: openCases,
        facilitiesOnMap: nodes.length,
        nodesWithNoSite: nodes.filter(n => !n.sited).length,
        roads: lay.edges.length,
        routes: window.FWWorldGraph ? FWWorldGraph.routes().length : null,
        eventsSoFar: state.totalEvents
      },
      disagreements: drawn.filter(p => p.positionStageDisagrees).map(p => p.truckId)
    };
  }

  /* ---------------------------------------------------------------------- */
  /* THE DOM WRITER                                                         */
  /* ---------------------------------------------------------------------- */

  /* Marker colour per visual state. Restrained on purpose: eight states that
     all shout are eight states nobody can tell apart, and the only colour that
     means "look here" is the one on the attention ring. */
  const VIEW_STATE_STYLE = {
    QUEUED:     { fill: '#475569', stroke: '#94a3b8' },
    GATE_CHECK: { fill: '#78350f', stroke: '#fbbf24' },
    LOADING:    { fill: '#155e75', stroke: '#22d3ee' },
    UNLOADING:  { fill: '#134e4a', stroke: '#2dd4bf' },
    DWELLING:   { fill: '#1e293b', stroke: '#64748b' },
    IN_TRANSIT: { fill: '#0369a1', stroke: '#7dd3fc' },
    ARRIVING:   { fill: '#0e7490', stroke: '#a5f3fc' },
    IDLE:       { fill: '#111827', stroke: '#4b5563' }
  };

  /* THE CAMERA. Slices 75 and 76 drew the whole network into one fixed
     rectangle. That is the right default -- a reader arrives and sees the whole
     network, which is the only view that tells them what the network IS -- and it
     was also the only option, so a reader who wanted to watch one truck was
     reading a marker twelve pixels wide.

     This is a transform over which rectangle of the drawing reaches the screen.
     It is not a second position source and it is not a filter: it chooses no
     coordinate, removes nothing that exists, and cannot put a marker anywhere
     other than where the position it was handed puts it. summary().positionSource
     is unchanged by this addition and stays true.

     The rectangle is kept inside the drawing on purpose. An unclamped pan lets a
     reader drag into blank space and conclude the map has broken, and the map has
     no way to tell them otherwise. */
  const CAMERA = {
    isA: 'a rectangle of the layout, in layout units, mapped onto the whole viewport.',
    minScale: 1,
    maxScale: 6,
    step: 1.5,
    followScale: 2.5,
    clampedTo: 'the drawing, so no press, scroll or drag can leave a reader looking at empty space.',
    doesNotMean: 'Magnifying the view does not bring two places closer together. The drawn length ' +
      'of a road is a consequence of the layout and never a distance, at every magnification -- ' +
      'the real figure stays printed on the road.',
    followMeans: 'Following re-centres the rectangle on the position a truck already has, each time ' +
      'the simulation advances. It moves the view and never the truck.',
    offScreenMeans: 'A truck outside the rectangle is still on the network and still counted by the ' +
      'line above. It is off the screen, not out of the simulation, which is why every figure here ' +
      'states which of the two it counts.'
  };

  /* THE DENOMINATOR AXES OF THIS PANEL, declared before the panel that uses
     them. Every count on the occupancy panel is a count of trucks, and until
     Slice 77b there were two things a truck count could be about: one named
     place, or the whole network. The camera added a third -- what is inside the
     rectangle currently on screen -- and that one is dangerous in a way the
     other two are not, because it looks exactly like the others and changes
     when a reader scrolls a wheel. So no figure below is printed without the
     population it was counted over, and the three are never added together.

     PER_ROAD is listed as its own axis rather than folded into PER_PLACE. Both
     are "one named element of the network", but a truck standing at a place and
     a truck part-way along a road are different facts, and one heading over
     both would invite a reader to add 3 and 5 into a total that counts nothing. */
  const HEALTH_SCOPES = {
    PER_PLACE: {
      counts: 'trucks standing at ONE named place, right now.',
      doesNotMean: 'trucks that place has handled, trucks heading for it, or its capacity. It is an ' +
        'occupancy at this instant and it changes on the next tick.'
    },
    PER_ROAD: {
      counts: 'trucks part-way along ONE named road, right now.',
      doesNotMean: 'traffic over that road, or how busy it usually is. Nothing here holds a history of a road.'
    },
    PER_NETWORK: {
      counts: 'every truck the simulation is holding, wherever it is and whether or not it is on screen.',
      doesNotMean: 'every truck that exists in the world being modelled. It is this run\'s registry.'
    },
    PER_VIEW: {
      counts: 'only what falls inside the rectangle the camera is currently showing.',
      doesNotMean: 'anything at all about the network. Scrolling the wheel changes every figure on this axis ' +
        'and changes nothing in the simulation; a truck off screen is off the screen, not out of the run.'
    }
  };

  /* The panel is called an occupancy panel and not a health score on purpose.
     It grades nothing: there is no threshold in this file above which a place is
     "congested" or a network is "unhealthy", because no module in this build
     declares one, and a renderer inventing one would be inventing a finding. */
  const OCCUPANCY = {
    is: 'four counts of where trucks are right now, each stated against the population it was counted over.',
    doesNotMean: 'a health score, a grade, a capacity or a congestion level. Nothing in this build declares a ' +
      'threshold for any of those, so this panel has none to draw.'
  };

  /* THE ONE LINK OFF THIS PANEL, and it is a link and nothing else.

     The port this map draws as a square is the same facility the Port Meridian
     mode plays inside, and until now a reader could see the square, watch trucks
     arrive at it, and have no idea the other tab existed. So the square carries a
     press that switches tab.

     What it is NOT is the important half. It hands nothing over. No truck, no
     selection, no clock and no case crosses between the two modes; Port Meridian
     goes on deriving everything it shows from its own modules exactly as it did
     before this existed, and this map goes on deriving everything from
     journeyEngine. The press calls the SAME world switch the tab strip calls --
     main.js publishes it for that reason rather than this file re-implementing the
     show/hide arithmetic, which would make a second writer of which world is on
     screen and is precisely what Slice 77a removed. */
  const PORT_DRILL = {
    is: 'a navigation link from the port place on this map to the Port Meridian tab.',
    doesNotMean: 'that the two modes share state. Nothing is handed over, nothing is merged, and neither mode ' +
      'reads the other. The reader is moved to a different tab and that is the whole effect.',
    via: 'window.FWWorlds.select, which is the same function the tab strip calls -- there is one writer of ' +
      'which world is on screen and this is not it.',
    targetNodeType: 'PORT',
    targetWorld: 'port'
  };

  /* The node the link belongs to, found by the graph's own node TYPE rather than
     by an id written down here. A build with no port, or with two, is reported
     instead of guessed at: drawing a "go to the port" press on one of two ports
     would be this file choosing which port the other mode is about. */
  function portDrillTarget(layout) {
    const lay = layout || defaultLayout();
    const ports = lay.nodes.filter(n => n.type === PORT_DRILL.targetNodeType);
    if (ports.length !== 1) {
      return { node: null, drawn: false,
        why: ports.length === 0 ? 'NO_PORT_IN_GRAPH' : 'MORE_THAN_ONE_PORT', found: ports.length };
    }
    return { node: ports[0], drawn: true, why: null, found: 1 };
  }

  /* Asks main.js's published switch for a world. Returns what it did rather than
     nothing, so the wiring is checkable without a tab strip, and reports an
     absent switch instead of failing silently. */
  function openWorld(world) {
    if (world !== PORT_DRILL.targetWorld) return { navigated: false, why: 'UNKNOWN_WORLD', world: world };
    const W = window.FWWorlds;
    if (!W || typeof W.select !== 'function') return { navigated: false, why: 'NAVIGATION_ABSENT', world: world };
    W.select(world);
    return { navigated: true, world: world, via: 'FWWorlds.select' };
  }

  const SVG_NS = 'http://www.w3.org/2000/svg';

  let els = {};
  let staticBuilt = false;
  let selectedTruckId = null;
  let focusCaseId = null;
  const markers = new Map();      // truck id -> { g, state, watched, selected }
  let lastActivitySig = '';
  let lastRouteSig = '';
  // Sentinels, not empty strings: the no-selection card's own signature IS the
  // empty string, so an empty-string seed made the first render of it a no-op
  // and the card stayed blank until something was selected.
  let lastCardSig = null;
  let lastTimelineSig = null;
  let lastCameraSig = null;
  let lastHealthSig = null;
  let lastFocusSig = null;
  /* cx/cy null means "the centre of the drawing", so an untouched camera holds no
     coordinate of its own that could drift out of step with the layout. */
  let camera = { scale: CAMERA.minScale, cx: null, cy: null };
  let followTruckId = null;
  let followState = 'OFF';        // OFF | FOLLOWING | UNPLACEABLE
  let suppressNextClick = false;  // set by a drag, so a pan does not also select

  function r2(v) { return Math.round(v * 100) / 100; }

  /* The entire camera as one pure function of a layout and a camera state.
     Nothing here touches the document, so every rectangle the controls can
     produce is checkable without rendering anything. */
  function viewBoxFor(layout, cam) {
    const c = cam || camera;
    const scale = Math.min(CAMERA.maxScale, Math.max(CAMERA.minScale, c.scale || CAMERA.minScale));
    const w = layout.width / scale, h = layout.height / scale;
    const wantX = (c.cx === null || c.cx === undefined) ? layout.width / 2 : c.cx;
    const wantY = (c.cy === null || c.cy === undefined) ? layout.height / 2 : c.cy;
    const x = Math.min(Math.max(wantX - w / 2, 0), layout.width - w);
    const y = Math.min(Math.max(wantY - h / 2, 0), layout.height - h);
    return {
      scale: Math.round(scale * 1000) / 1000,
      x: r2(x), y: r2(y), w: r2(w), h: r2(h),
      viewBox: r2(x) + ' ' + r2(y) + ' ' + r2(w) + ' ' + r2(h),
      wholeDrawing: scale <= CAMERA.minScale,
      centre: { x: r2(x + w / 2), y: r2(y + h / 2) },
      clamped: r2(x) !== r2(wantX - w / 2) || r2(y) !== r2(wantY - h / 2)
    };
  }

  /* How many of the things that ARE drawn fall inside the rectangle. Both
     figures are reported against the drawn total and never against the registry
     total: "3 trucks" on a magnified view would otherwise read as a claim about
     the network when it is a fact about the screen. */
  function inView(box, placements, nodes) {
    const inside = (px, py) => px >= box.x && px <= box.x + box.w && py >= box.y && py <= box.y + box.h;
    const drawn = (placements || []).filter(p => p.drawn);
    const truckIds = drawn.filter(p => inside(p.drawX, p.drawY)).map(p => p.truckId);
    const placeIds = (nodes || []).filter(n => inside(n.x, n.y)).map(n => n.id);
    return {
      trucksDrawn: drawn.length, trucksInView: truckIds.length,
      trucksOffScreen: drawn.length - truckIds.length, truckIds: truckIds,
      places: (nodes || []).length, placesInView: placeIds.length, placeIds: placeIds
    };
  }

  /* Trucks per road, keyed on the graph's OWN edge key so a road with no truck
     on it appears as a zero rather than as an absent row -- "no truck on this
     road" and "this road was not counted" are different facts, and a panel that
     silently omitted the first would be reporting the second. */
  function roadOccupancy(f) {
    const lay = f.layout;
    const on = {};
    f.trucks.forEach(p => {
      if (!p.drawn || p.kind !== 'ON_LEG') return;
      const key = WG ? WG.edgeKey(p.from, p.to) : p.from + '->' + p.to;
      on[key] = (on[key] || 0) + 1;
    });
    return lay.edges.map(e => ({
      key: e.key,
      scope: 'PER_ROAD',
      fromLabel: lay.byId[e.from] ? lay.byId[e.from].label : e.from,
      toLabel: lay.byId[e.to] ? lay.byId[e.to].label : e.to,
      distanceKm: e.distanceKm,
      speedClass: e.speedClass,
      trucks: on[e.key] || 0
    }));
  }

  /* The whole panel as a pure function of a frame and, optionally, the camera
     rectangle. `view` is null when no rectangle was passed, and that is rendered
     as a stated absence: a per-view figure with no view behind it would be a
     figure about nothing. */
  function healthOf(f, box) {
    const places = f.nodes.map(n => ({
      id: n.id, label: n.label, type: n.type, scope: 'PER_PLACE',
      trucksHere: n.trucksHere, sited: n.sited
    }));
    const roads = roadOccupancy(f);
    const occupiedPlaces = places.filter(pl => pl.trucksHere > 0);
    const carryingRoads = roads.filter(r => r.trucks > 0);
    const c = f.counts;
    const network = {
      scope: 'PER_NETWORK',
      trucks: c.trucks,
      placeable: c.drawn,
      unplaceable: c.notDrawn,
      atNode: c.atNode,
      inTransit: c.inTransit,
      places: places.length,
      placesOccupied: occupiedPlaces.length,
      placesEmpty: places.length - occupiedPlaces.length,
      placesWithNoSite: c.nodesWithNoSite,
      roads: roads.length,
      roadsCarrying: carryingRoads.length,
      roadsClear: roads.length - carryingRoads.length
    };
    /* Checked here rather than trusted: the two per-element axes must partition
       the placeable trucks exactly, or one of them is counting something twice. */
    const placedAtPlaces = occupiedPlaces.reduce((s, pl) => s + pl.trucksHere, 0);
    const placedOnRoads = carryingRoads.reduce((s, r) => s + r.trucks, 0);
    const reconciles = placedAtPlaces + placedOnRoads === network.placeable;
    let view = null;
    if (box) {
      const v = inView(box, f.trucks, f.nodes);
      view = {
        scope: 'PER_VIEW',
        wholeDrawing: box.wholeDrawing,
        scale: box.scale,
        placesInView: v.placesInView, places: v.places,
        trucksInView: v.trucksInView, trucksDrawn: v.trucksDrawn,
        trucksOffScreen: v.trucksOffScreen
      };
    }
    return {
      scopes: HEALTH_SCOPES,
      places, roads, occupiedPlaces, carryingRoads, network, view,
      placedAtPlaces, placedOnRoads, reconciles,
      busiestPlace: occupiedPlaces.slice().sort((a, b) => b.trucksHere - a.trucksHere)[0] || null
    };
  }

  function setCamera(scale, aboutX, aboutY) {
    camera = {
      scale: Math.min(CAMERA.maxScale, Math.max(CAMERA.minScale, scale)),
      cx: aboutX === undefined ? camera.cx : aboutX,
      cy: aboutY === undefined ? camera.cy : aboutY
    };
    return camera.scale;
  }
  function zoomBy(factor, aboutX, aboutY) { return setCamera(camera.scale * factor, aboutX, aboutY); }
  function zoomIn(aboutX, aboutY) { return zoomBy(CAMERA.step, aboutX, aboutY); }
  function zoomOut(aboutX, aboutY) { return zoomBy(1 / CAMERA.step, aboutX, aboutY); }

  /* A pan is expressed in layout units, so a caller converts pixels once and the
     camera never has to know how large the viewport happens to be. Panning by
     hand ends any following, because a view that snapped back to a truck on the
     next tick would be undoing the reader's own drag. */
  function panBy(dx, dy, layout) {
    const lay = layout || defaultLayout();
    const box = viewBoxFor(lay, camera);
    camera = { scale: camera.scale, cx: box.centre.x + dx, cy: box.centre.y + dy };
    followTruckId = null; followState = 'OFF';
    return viewBoxFor(lay, camera);
  }

  function resetCamera() {
    camera = { scale: CAMERA.minScale, cx: null, cy: null };
    followTruckId = null; followState = 'OFF';
    return cameraState();
  }

  /* Follow stores an id and never a coordinate. A stored coordinate would be this
     module remembering a position, which is the one thing it does not do -- the
     centring is resolved fresh in render() from the frame's own placement. */
  function follow(truckId) {
    followTruckId = truckId || null;
    followState = followTruckId ? 'FOLLOWING' : 'OFF';
    if (followTruckId && camera.scale <= CAMERA.minScale) {
      camera = { scale: CAMERA.followScale, cx: camera.cx, cy: camera.cy };
    }
    return followTruckId;
  }
  function following() { return { truckId: followTruckId, state: followState }; }
  function cameraState() { return { scale: camera.scale, cx: camera.cx, cy: camera.cy }; }

  function nodeShape(n) {
    const s = n.style, x = n.x, y = n.y, k = s.size;
    if (s.shape === 'square') {
      return '<rect x="' + (x - k) + '" y="' + (y - k) + '" width="' + (k * 2) + '" height="' + (k * 2) +
        '" rx="3" fill="' + s.fill + '" stroke="' + s.stroke + '" stroke-width="1.6"/>';
    }
    if (s.shape === 'diamond') {
      return '<polygon points="' + [x, y - k, x + k, y, x, y + k, x - k, y].join(' ') +
        '" fill="' + s.fill + '" stroke="' + s.stroke + '" stroke-width="1.6"/>';
    }
    if (s.shape === 'triangle') {
      return '<polygon points="' + [x, y - k, x + k, y + k * 0.8, x - k, y + k * 0.8].join(' ') +
        '" fill="' + s.fill + '" stroke="' + s.stroke + '" stroke-width="1.6"/>';
    }
    return '<circle cx="' + x + '" cy="' + y + '" r="' + k + '" fill="' + s.fill + '" stroke="' + s.stroke +
      '" stroke-width="1.6"/>';
  }

  function esc(v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* The scenery, built from DECOR. Drawn once, under everything, and it is
     never consulted again -- nothing reads it back. */
  function terrainDefs(layout) {
    const port = layout.byId[need(WG, 'FWWorldGraph', 'the scenery').portNode().id];
    return '<defs>' +
      '<linearGradient id="fm-ground" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="' + DECOR.ground.top + '"/>' +
      '<stop offset="1" stop-color="' + DECOR.ground.bottom + '"/></linearGradient>' +
      '<pattern id="fm-grid" width="' + DECOR.grid.step + '" height="' + DECOR.grid.step +
      '" patternUnits="userSpaceOnUse">' +
      '<path d="M ' + DECOR.grid.step + ' 0 L 0 0 0 ' + DECOR.grid.step + '" fill="none" stroke="' +
      DECOR.grid.stroke + '" stroke-width="' + DECOR.grid.width + '"/></pattern>' +
      '<radialGradient id="fm-port-glow">' +
      '<stop offset="0" stop-color="' + DECOR.portGlow.colour + '" stop-opacity="' + DECOR.portGlow.opacity + '"/>' +
      '<stop offset="1" stop-color="' + DECOR.portGlow.colour + '" stop-opacity="0"/></radialGradient>' +
      '</defs>' +
      '<g id="fm-terrain" aria-hidden="true">' +
      '<rect x="0" y="0" width="' + layout.width + '" height="' + layout.height + '" fill="url(#fm-ground)"/>' +
      '<rect x="0" y="0" width="' + layout.width + '" height="' + layout.height + '" fill="url(#fm-grid)"/>' +
      (port ? '<circle cx="' + port.x + '" cy="' + port.y + '" r="' + DECOR.portGlow.radius +
        '" fill="url(#fm-port-glow)"/>' : '') +
      '</g>';
  }

  function roadCasing(layout) {
    return '<g id="fm-road-casing" aria-hidden="true">' + layout.edges.map(e =>
      '<line x1="' + e.x1 + '" y1="' + e.y1 + '" x2="' + e.x2 + '" y2="' + e.y2 + '" stroke="' +
      DECOR.casing.stroke + '" stroke-width="' + (e.style.width + DECOR.casing.extra) +
      '" stroke-linecap="round"/>').join('') + '</g>';
  }

  function roadCentrelines(layout) {
    const c = DECOR.centreline;
    return '<g id="fm-road-centrelines" aria-hidden="true">' +
      layout.edges.filter(e => e.speedClass === c.appliesTo).map(e =>
        '<line x1="' + e.x1 + '" y1="' + e.y1 + '" x2="' + e.x2 + '" y2="' + e.y2 + '" stroke="' + c.stroke +
        '" stroke-width="' + c.width + '" stroke-dasharray="' + c.dash + '"/>').join('') + '</g>';
  }

  function placeHalos(layout) {
    const h = DECOR.halo;
    return '<g id="fm-place-halos" aria-hidden="true">' + layout.nodes.map(n =>
      '<circle cx="' + n.x + '" cy="' + n.y + '" r="' + (n.style.size + h.fillExtra) + '" fill="' +
      n.style.stroke + '" opacity="' + h.fillOpacity + '"/>' +
      '<circle cx="' + n.x + '" cy="' + n.y + '" r="' + (n.style.size + h.ringExtra) + '" fill="none" stroke="' +
      n.style.stroke + '" stroke-width="0.8" opacity="' + h.ringOpacity + '"/>').join('') + '</g>';
  }

  /* The heading of the leg a truck is on, in degrees, from the two DRAWN node
     positions. Returns null when there is no leg -- an AT_NODE truck points
     nowhere, and guessing a direction for it would be inventing one. */
  function headingOf(p, byId) {
    if (!p || p.kind !== 'ON_LEG' || !p.from || !p.to || !byId) return null;
    const a = byId[p.from], b = byId[p.to];
    if (!a || !b) return null;
    const dx = b.x - a.x, dy = b.y - a.y;
    if (dx === 0 && dy === 0) return null;
    return Math.round(Math.atan2(dy, dx) * 180 / Math.PI);
  }

  function truckBody(st) {
    const t = TRUCK_ART.trailer, c = TRUCK_ART.cab;
    return '<rect x="' + t.x + '" y="' + t.y + '" width="' + t.w + '" height="' + t.h + '" rx="' + t.rx +
      '" fill="' + st.fill + '" stroke="' + st.stroke + '" stroke-width="1.2"/>' +
      '<rect x="' + c.x + '" y="' + c.y + '" width="' + c.w + '" height="' + c.h + '" rx="' + c.rx +
      '" fill="' + st.stroke + '" opacity="0.85"/>' +
      TRUCK_ART.wheels.map(cx => '<circle cx="' + cx + '" cy="' + (TRUCK_ART.trailer.h / 2 + 0.6) + '" r="' +
        TRUCK_ART.wheelR + '" fill="#0b1220" stroke="' + st.stroke + '" stroke-width="0.6"/>').join('');
  }

  /* Drawn once. Roads, places and the legend do not change while the app runs,
     because worldGraph is built at load and nothing mutates it -- so rebuilding
     them every tick would be work with no result. Only the three live groups
     (activity, route highlight, trucks) are touched after this. */
  function staticSvg(layout) {
    const roads = layout.edges.map(e =>
      '<line x1="' + e.x1 + '" y1="' + e.y1 + '" x2="' + e.x2 + '" y2="' + e.y2 + '" stroke="' + e.style.stroke +
      '" stroke-width="' + e.style.width + '"' + (e.style.dash ? ' stroke-dasharray="' + e.style.dash + '"' : '') +
      ' data-edge-key="' + esc(e.key) + '"/>').join('');
    const roadLabels = layout.edges.filter(e => e.speedClass === 'ROAD').map(e =>
      '<text x="' + ((e.x1 + e.x2) / 2) + '" y="' + ((e.y1 + e.y2) / 2 - 5) + '" text-anchor="middle" ' +
      'font-size="8.5" fill="#475569">' + e.distanceKm + ' km</text>').join('');
    const places = layout.nodes.map(n => nodeShape(n)).join('');
    const placeLabels = layout.nodes.map(n =>
      '<text x="' + n.x + '" y="' + (n.y + n.style.size + 13) + '" text-anchor="middle" font-size="10" ' +
      'fill="#cbd5e1">' + esc(n.label) + '</text>' +
      '<text x="' + n.x + '" y="' + (n.y + n.style.size + 23) + '" text-anchor="middle" font-size="8" ' +
      'fill="#64748b">' + esc(n.style.label) + (n.facilityNames.length ? '' : ' · no site here') + '</text>'
    ).join('');
    const legend = Object.keys(NODE_STYLE).map((t, i) =>
      '<g transform="translate(' + (14 + i * 118) + ',' + (layout.height - 14) + ')">' +
      nodeShape({ x: 6, y: -4, style: Object.assign({}, NODE_STYLE[t], { size: 6 }) }) +
      '<text x="18" y="-1" font-size="8.5" fill="#64748b">' + esc(NODE_STYLE[t].label) + '</text></g>').join('');
    /* The press, drawn with the static geometry because the port does not move.
       It is a sibling of the place it belongs to and not part of the marker layer,
       so a truck can never end up on top of it or under it depending on a tick. */
    const drill = portDrillTarget(layout);
    const drillSvg = drill.drawn
      ? '<g id="fm-port-drill" data-world-link="' + PORT_DRILL.targetWorld + '" style="cursor:pointer">' +
        '<title>Open the Port Meridian mode. This switches tab and hands nothing over: the two modes share ' +
        'no state.</title>' +
        /* Sat 15 units higher than the obvious spot. renderActivity draws this
           node's occupancy count at (x + size + 9, y - size - 4) with r=7.5, which
           reaches to y - size - 11.5; a badge ending at y - size - 24 clipped it.
           Both are derived from the same size, so the clearance holds for a port
           of any drawn size rather than only for this one. */
        '<rect x="' + (drill.node.x - 34) + '" y="' + (drill.node.y - drill.node.style.size - 39) + '" ' +
        'width="68" height="15" rx="7.5" fill="#082f49" stroke="#38bdf8" stroke-width="1"/>' +
        '<text x="' + drill.node.x + '" y="' + (drill.node.y - drill.node.style.size - 28) + '" ' +
        'text-anchor="middle" font-size="8" fill="#7dd3fc">INSIDE THIS PORT \u203a</text></g>'
      : '';
    return '<rect x="0" y="0" width="' + layout.width + '" height="' + layout.height + '" fill="#05070a"/>' +
      terrainDefs(layout) +
      roadCasing(layout) +
      '<g id="fm-roads">' + roads + '</g>' +
      roadCentrelines(layout) +
      '<g id="fm-road-labels">' + roadLabels + '</g>' +
      '<g id="fm-route"></g>' +
      '<g id="fm-focus-chain"></g>' +
      placeHalos(layout) +
      '<g id="fm-places">' + places + '</g>' +
      '<g id="fm-place-labels">' + placeLabels + '</g>' +
      '<g id="fm-activity"></g>' +
      '<g id="fm-trucks"></g>' +
      '<g id="fm-legend">' + legend + '</g>' +
      drillSvg;
  }

  function init() {
    els = {
      root: document.getElementById('freight-map-root'),
      svg: document.getElementById('freight-map-svg'),
      clock: document.getElementById('freight-map-clock'),
      stats: document.getElementById('freight-map-stats'),
      selection: document.getElementById('freight-map-selection'),
      entityCard: document.getElementById('fm-entity-card'),
      expand: document.getElementById('fm-entity-expand'),
      timeline: document.getElementById('fm-timeline'),
      health: document.getElementById('fm-health'),
      cameraLine: document.getElementById('fm-camera'),
      zoomIn: document.getElementById('fm-zoom-in'),
      zoomOut: document.getElementById('fm-zoom-out'),
      zoomReset: document.getElementById('fm-zoom-reset'),
      followBtn: document.getElementById('fm-follow')
    };
    if (els.svg) {
      els.svg.addEventListener('click', (e) => {
        // A pan ends in a click. Without this a reader who dragged the view would
        // also have selected or deselected whatever happened to be under the
        // pointer when they let go.
        if (suppressNextClick) { suppressNextClick = false; return; }
        /* The tab link is checked first and returns: a press on it must not also
           select or deselect whatever the pointer happened to be over, and it
           must not leave this panel mid-render of a world it is leaving. */
        const link = e.target && e.target.closest ? e.target.closest('[data-world-link]') : null;
        /* Read the same defensive way the truck branch below has always read its
           id: dataset first, getAttribute if there is one, and fall through if the
           thing closest() handed back carries neither. Only a press that actually
           names a world navigates -- otherwise a click is still a selection. */
        const linkWorld = !link ? null
          : (link.dataset && link.dataset.worldLink) ||
            (link.getAttribute ? link.getAttribute('data-world-link') : null);
        if (linkWorld) {
          openWorld(linkWorld);
          return;
        }
        const target = e.target && e.target.closest ? e.target.closest('[data-truck-id]') : null;
        /* A press anywhere on the map leaves Case Focus. A reader pointing at the
           network is no longer pointing at the case, and leaving the world dimmed
           around a case they have navigated away from would be the interface
           holding an opinion after the reader changed theirs. */
        if (focusCaseId) clearFocus();
        if (!target) { select(null); if (window.FWSimRunner) render(FWSimRunner.getState()); return; }
        const id = target.dataset ? target.dataset.truckId : target.getAttribute('data-truck-id');
        select(id === selectedTruckId ? null : id);
        // Following something that is no longer named anywhere on screen would
        // leave the view locked to a truck the reader has just let go of.
        if (followTruckId && followTruckId !== selectedTruckId) follow(null);
        // A click selects. It no longer throws the full-screen panel over the
        // map, because a reader who has to dismiss a modal to see the network
        // again has been charged for asking. The read-out lands in the card
        // beside the drawing and the full panel is one press away -- see
        // ENTITY_CARD.supersedes.
        if (window.FWSimRunner) render(FWSimRunner.getState());
      });
    }
    if (els.expand) {
      els.expand.addEventListener('click', () => { expandSelected(); });
    }
    /* Delegated on the panel, not bound to the button: the banner is rewritten on
       every frame that changes it, and a listener bound to the element would be
       bound to an element that no longer exists one tick later. */
    if (els.selection) {
      els.selection.addEventListener('click', (e) => {
        const btn = e.target && e.target.closest ? e.target.closest('#fm-focus-clear') : null;
        if (!btn) return;
        clearFocus();
        if (window.FWSimRunner) render(FWSimRunner.getState());
      });
    }
    wireCamera();
    return els;
  }

  /* The camera controls. Every one of them ends the same way: change the camera
     state, then re-render from simulation state. None advances the clock, and
     none redraws the roads and places -- that geometry is static and only the
     rectangle over it moves. */
  function wireCamera() {
    const redraw = () => { if (window.FWSimRunner) render(FWSimRunner.getState()); };
    if (els.zoomIn) els.zoomIn.addEventListener('click', () => { zoomIn(); redraw(); });
    if (els.zoomOut) els.zoomOut.addEventListener('click', () => { zoomOut(); redraw(); });
    if (els.zoomReset) els.zoomReset.addEventListener('click', () => { resetCamera(); redraw(); });
    if (els.followBtn) {
      els.followBtn.addEventListener('click', () => {
        follow(followTruckId ? null : selectedTruckId);
        redraw();
      });
    }
    if (!els.svg || !els.svg.addEventListener) return;

    /* Pixels to layout units. The SVG is width-responsive, so the ratio is
       measured from the live box rather than assumed; a viewport that cannot be
       measured (a headless run reports zero) falls back to a centred operation
       instead of dividing by nothing. */
    const perPixel = () => {
      const lay = defaultLayout();
      const box = viewBoxFor(lay, camera);
      const r = els.svg.getBoundingClientRect ? els.svg.getBoundingClientRect() : null;
      if (!r || !r.width || !r.height) return null;
      return { kx: box.w / r.width, ky: box.h / r.height, rect: r, box: box };
    };

    els.svg.addEventListener('wheel', (e) => {
      if (e.preventDefault) e.preventDefault();
      const factor = e.deltaY < 0 ? CAMERA.step : 1 / CAMERA.step;
      const m = perPixel();
      if (!m) { zoomBy(factor); redraw(); return; }
      /* Zoom about the pointer: the layout point under the cursor stays under the
         cursor, which is the only zoom that does not lose the reader's place. */
      const lx = m.box.x + (e.clientX - m.rect.left) * m.kx;
      const ly = m.box.y + (e.clientY - m.rect.top) * m.ky;
      zoomBy(factor, lx, ly);
      followTruckId = null; followState = 'OFF';
      redraw();
    });

    let drag = null;
    els.svg.addEventListener('mousedown', (e) => {
      if (camera.scale <= CAMERA.minScale) return;   // at full fit there is nothing to pan to
      drag = { x: e.clientX, y: e.clientY, moved: 0 };
    });
    els.svg.addEventListener('mousemove', (e) => {
      if (!drag) return;
      const m = perPixel();
      if (!m) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.moved += Math.abs(dx) + Math.abs(dy);
      drag.x = e.clientX; drag.y = e.clientY;
      panBy(-dx * m.kx, -dy * m.ky);
      redraw();
    });
    const endDrag = () => {
      if (drag && drag.moved > 3) suppressNextClick = true;
      drag = null;
    };
    els.svg.addEventListener('mouseup', endDrag);
    els.svg.addEventListener('mouseleave', endDrag);
  }

  /* The press that opens the full panel. It passes an id and nothing else: the
     panel derives a truck from simulation state exactly as it did before this
     slice, so there is one derivation of a truck's detail and this module is not
     it. Returns what it did, so a suite can check the wiring without a modal. */
  function expandSelected() {
    if (!selectedTruckId) return { opened: false, why: 'NO_SELECTION' };
    if (!window.FWEntityInspector) return { opened: false, why: 'INSPECTOR_ABSENT' };
    FWEntityInspector.show('truck', selectedTruckId);
    return { opened: true, kind: 'truck', truckId: selectedTruckId };
  }

  function select(id) { selectedTruckId = id || null; return selectedTruckId; }
  function selected() { return selectedTruckId; }

  /* CASE FOCUS. Entering it selects the case's truck as well, because the panel
     beside the map answers "what is this movement" and a reader who has just
     asked about a case is asking about that movement. Leaving it does not
     deselect: the truck is still a fair thing to be pointing at once the rest of
     the network comes back up.

     This writes two ids in this module and nothing else anywhere. It does not
     touch the case, does not change its status, does not advance the clock, and
     does not ask the simulation for anything -- everything the focus draws is
     re-derived from simulation state on the next frame, so a case whose truck
     finishes its journey mid-focus is drawn where the simulation now says it is
     rather than where it was when the reader pressed. */
  function focus(caseId, opts) {
    const o = opts || {};
    focusCaseId = caseId || null;
    if (focusCaseId && o.select !== false && window.FWSimRunner) {
      const st = FWSimRunner.getState();
      const fo = st ? focusOf(st, defaultLayout(), focusCaseId) : null;
      if (fo && fo.truckIds.length) selectedTruckId = fo.truckIds[0];
    }
    return focusCaseId;
  }
  function focused() { return focusCaseId; }
  function clearFocus() { focusCaseId = null; return null; }

  function markerFor(p) {
    let m = markers.get(p.truckId);
    if (!m) {
      const g = document.createElementNS(SVG_NS, 'g');
      g.setAttribute('data-truck-id', p.truckId);
      if (g.dataset) g.dataset.truckId = p.truckId;
      g.setAttribute('class', 'fm-truck');
      m = { g, state: null, watched: null, selected: null };
      markers.set(p.truckId, m);
      const host = document.getElementById('fm-trucks');
      if (host && host.appendChild) host.appendChild(g);
    }
    return m;
  }

  /* Per tick this writes one transform per truck, and the marker's body only
     when its visual state, attention flag or selection actually changed. No
     element is destroyed and recreated, nothing queries the document for a
     list of markers, and the roads and places are never touched. */
  function renderTrucks(f) {
    const byId = {};
    (f.nodes || []).forEach(n => { byId[n.id] = n; });
    f.trucks.forEach(p => {
      if (!p.drawn) return;
      const m = markerFor(p);
      m.g.setAttribute('transform', 'translate(' + p.drawX + ',' + p.drawY + ')');
      const heading = headingOf(p, byId);
      /* The heading is part of the signature. Without it a truck that turned a
         corner kept the body it was drawn with on the previous leg, because
         nothing else about it had changed. */
      /* The chain flag is an attribute, not a redraw: entering Case Focus dims
         the world with ONE class on the svg and this attribute is what the
         stylesheet keeps lit. No marker is rebuilt to be dimmed, which is why a
         focus costs the same whether four trucks are drawn or forty. */
      const inChain = !!(f.focus && f.focus.resolved && f.focus.truckIds.indexOf(p.truckId) >= 0);
      if (m.chain !== inChain) {
        m.chain = inChain;
        /* Written as "1" or "0" rather than set and removed. The stylesheet keys
           on [data-chain="1"], so "0" is off just as absence is, and one method
           on one element is a smaller surface than two -- attribute removal is
           the one DOM call this module would otherwise make that its own test
           harness does not implement, and a render path that only works in a real
           browser is a render path nothing checks. */
        m.g.setAttribute('data-chain', inChain ? '1' : '0');
      }
      const sig = p.viewState + '|' + (p.attention || 'x') + '|' + (p.selected ? 'S' : '-') +
        '|' + (heading === null ? 'x' : heading);
      if (m.sig === sig) return;
      m.sig = sig;
      const st = VIEW_STATE_STYLE[p.viewState];
      /* One ring per rung, and the rung is read off the frame. A dashed ring is
         a signal with a lifetime, a solid ring is an open case, and a doubled
         ring is an open case in one of moEngine's two highest bands. NORMAL
         draws no ring at all -- the quiet majority stays quiet, which is the
         only reason the loud minority reads as loud. */
      const tone = p.attention ? ATTENTION_TONE[p.attention] : null;
      let ring = '';
      if (tone && tone.ring === 'dashed') {
        ring = '<circle r="10" fill="none" stroke="' + tone.stroke + '" stroke-width="1.2" stroke-dasharray="2 2"/>';
      } else if (tone && tone.ring === 'solid') {
        ring = '<circle r="10" fill="none" stroke="' + tone.stroke + '" stroke-width="1.4"/>';
      } else if (tone && tone.ring === 'double') {
        ring = '<circle r="10" fill="none" stroke="' + tone.stroke + '" stroke-width="1.4"/>' +
          '<circle r="13.5" fill="none" stroke="' + tone.stroke + '" stroke-width="1" opacity="0.5"/>';
      }
      const halo = p.selected
        ? '<circle r="17" fill="none" stroke="#e2e8f0" stroke-width="1" opacity="0.85"/>' : '';
      /* The rings and the label are OUTSIDE the rotation. A watched ring that
         turned with the truck would still be a circle, but the id label would
         have ended up upside down on every westbound leg. */
      const body = heading === null
        ? '<g>' + truckBody(st) + '</g>'
        : '<g transform="rotate(' + heading + ')">' + truckBody(st) + '</g>';
      m.g.innerHTML =
        halo + ring + body +
        (p.selected ? '<text x="0" y="-21" text-anchor="middle" font-size="9" fill="#e2e8f0">' + esc(p.truckId) +
          '</text>' : '');
    });
  }

  function renderActivity(f) {
    const sig = f.nodes.map(n => n.trucksHere).join(',');
    if (sig === lastActivitySig) return;
    lastActivitySig = sig;
    const host = document.getElementById('fm-activity');
    if (!host) return;
    host.innerHTML = f.nodes.filter(n => n.trucksHere > 0).map(n =>
      '<g><circle cx="' + (n.x + n.style.size + 9) + '" cy="' + (n.y - n.style.size - 4) + '" r="7.5" ' +
      'fill="#0b1220" stroke="' + n.style.stroke + '" stroke-width="1"/>' +
      '<text x="' + (n.x + n.style.size + 9) + '" y="' + (n.y - n.style.size - 1) + '" text-anchor="middle" ' +
      'font-size="8.5" fill="#e2e8f0">' + n.trucksHere + '</text></g>').join('');
  }

  function renderRoute(f) {
    const r = f.selectedRoute;
    const sig = r ? (f.selectedTruckId + '|' + r.routeId + '|' + r.direction + '|' + r.legIndex) : '';
    if (sig === lastRouteSig) return;
    lastRouteSig = sig;
    const host = document.getElementById('fm-route');
    if (!host) return;
    if (!r) { host.innerHTML = ''; return; }
    const lay = f.layout;
    host.innerHTML = r.legKeys.map(k => {
      const e = lay.edgeByKey[k];
      if (!e) return '';
      const active = k === r.currentLegKey;
      return '<line x1="' + e.x1 + '" y1="' + e.y1 + '" x2="' + e.x2 + '" y2="' + e.y2 + '" stroke="' +
        (active ? '#38bdf8' : '#0e7490') + '" stroke-width="' + (active ? 4 : 3) + '" opacity="' +
        (active ? 0.95 : 0.5) + '" stroke-linecap="round"/>';
    }).join('');
  }

  /* CASE FOCUS, drawn in two moves and no more.

     MOVE ONE is a class on the svg element. The stylesheet drops the opacity of
     the road layer, the place layer, both label layers, the occupancy badges and
     the legend in one declaration, and drops every truck marker except the ones
     carrying data-chain. That is the whole dim: no element is rebuilt, no list
     of markers is queried out of the document, and the cost does not grow with
     the size of the world. A world of four hundred trucks would dim in the same
     one attribute write.

     MOVE TWO is this small layer. The dim takes the chain's PLACES and their
     LABELS down with everything else -- they live in the shared layers -- so the
     ones that belong to the case are re-asserted here, brightly, and nowhere
     else. The route's roads are not re-asserted because renderRoute already
     draws them into a layer the dim does not touch, and drawing them twice would
     be two paths to one road.

     The layer holds at most one ring and one label per node on one route, plus
     one site marker. It is rewritten only when the focused case, or the route
     under it, actually changes. */
  function renderFocus(f) {
    const fo = f.focus;
    const on = !!(fo && fo.resolved);
    if (els.svg && els.svg.classList) {
      els.svg.classList.toggle('fw-focus', on);
      /* A plain selection dims too, but far less: a reader who clicked a truck
         is asking about it, not investigating a case, and burying the network
         they clicked it out of would answer a question they did not ask. */
      els.svg.classList.toggle('fw-select', !on && !!f.selectedTruckId);
    }
    const host = document.getElementById('fm-focus-chain');
    if (!host) return;
    const sig = !on ? '' : [fo.caseId, fo.status, fo.siteNodeId, fo.nodeIds.join('>')].join('|');
    if (sig === lastFocusSig) return;
    lastFocusSig = sig;
    if (!on) { host.innerHTML = ''; return; }
    const byId = f.layout.byId;
    const parts = fo.nodeIds.map(id => {
      const n = byId[id];
      if (!n) return '';
      const isSite = id === fo.siteNodeId;
      return '<circle cx="' + n.x + '" cy="' + n.y + '" r="' + (n.style.size + (isSite ? 9 : 5)) + '" ' +
        'fill="none" stroke="' + (isSite ? '#f87171' : '#38bdf8') + '" stroke-width="' + (isSite ? 1.6 : 1) +
        '" opacity="' + (isSite ? 0.9 : 0.55) + '"/>' +
        '<text x="' + n.x + '" y="' + (n.y + n.style.size + 13) + '" text-anchor="middle" font-size="10" ' +
        'fill="#e2e8f0">' + esc(n.label) + '</text>' +
        (isSite ? '<text x="' + n.x + '" y="' + (n.y - n.style.size - 13) + '" text-anchor="middle" ' +
          'font-size="8" fill="#fca5a5">SIGNALS SEEN HERE</text>' : '');
    }).join('');
    host.innerHTML = parts;
  }

  function renderHeader(f) {
    if (els.clock) {
      /* The shift chip came from the second clock this page used to carry, in
         sim-debug. That clock is gone -- it printed this same day, time, shift and
         speed a few hundred pixels above -- and the chip came here rather than
         being dropped with it, so removing a duplicate cost the page nothing. */
      els.clock.innerHTML = '<b class="text-white">Day ' + f.clock.day + '</b> · ' + f.clock.timeOfDay +
        ' · <span class="uppercase shift-chip shift-chip-' + esc(f.clock.shift) + '">' +
        esc(f.clock.shift) + '</span> · <span class="text-sky-400">' +
        (f.clock.running ? f.clock.speed + 'x' : 'PAUSED') + '</span>';
    }
    if (els.stats) {
      const c = f.counts;
      const cases = c.openCases === null ? 'open cases not derived here' : c.openCases + ' open case' +
        (c.openCases === 1 ? '' : 's');
      /* WHERE TO LOOK, before what there is. The census used to open on how many
         trucks were drawn, which is a fact about the drawing. It now opens on the
         rungs, because that is the question a reader arriving at this map has --
         and it is stated over the DRAWN trucks, which is the population they can
         see, rather than over the fleet, which it is not. */
      const a = f.attentionCounts || {};
      const rungs = [
        a.HIGH_ATTENTION ? a.HIGH_ATTENTION + ' at high attention' : null,
        a.ACTIVE ? a.ACTIVE + ' named by an open case' : null,
        a.WATCH ? a.WATCH + ' carrying an active signal' : null,
        a.NOT_DERIVED ? a.NOT_DERIVED + ' whose rung was not derived' : null
      ].filter(Boolean);
      const ladderLine = rungs.length
        ? 'Of the ' + c.drawn + ' trucks drawn: ' + rungs.join(', ') + '. The rest are on no rung.'
        : 'None of the ' + c.drawn + ' trucks drawn is on a rung above normal right now.';
      els.stats.textContent = ladderLine + ' A rung is an order to look in, not a finding — ' +
        c.drawn + ' of ' + c.trucks + ' trucks on the network · ' + c.inTransit + ' on a road · ' +
        c.atNode + ' standing at a place · ' + c.activeSignals + ' active signals · ' + cases +
        ' · ' + c.facilitiesOnMap + ' places · ' + c.roads + ' roads · ' + c.routes + ' routes';
    }
  }

  function renderSelection(f) {
    if (!els.selection) return;
    const p = f.trucks.filter(t => t.truckId === f.selectedTruckId)[0];
    if (!p || !p.drawn) {
      els.selection.innerHTML = '<p class="text-[10px] text-slate-500 italic">Click a truck to follow its ' +
        'journey. Everything shown for it is read out of the journey the simulation is already running -- ' +
        'origin, current leg and destination come from the route it was assigned, not from this panel.</p>';
      return;
    }
    const r = f.selectedRoute;
    const chain = r ? r.nodes.map(n => {
      const dot = n.current ? '<span class="text-sky-300">◉</span>' : (n.passed ? '<span class="text-slate-600">●</span>' : '<span class="text-slate-500">○</span>');
      return dot + ' ' + esc(n.label);
    }).join(' <span class="text-slate-700">—</span> ') : '';
    const where = p.kind === 'AT_NODE'
      ? 'standing at ' + esc(f.layout.byId[p.nodeId].label)
      : 'on the road ' + esc(f.layout.byId[p.from].label) + ' to ' + esc(f.layout.byId[p.to].label) +
        ', ' + Math.round(p.fraction * 100) + '% of the leg (' + Math.round(p.remainingSeconds / 60) +
        ' min of its declared duration left)';
    const sig = p.signalCount === null
      ? 'signal count not derived here'
      : (p.signalCount === 0
        ? 'no active signal'
        : p.signalCount + ' active signal' + (p.signalCount === 1 ? '' : 's') + ' — ' + ATTENTION.doesNotMean);
    /* The rung, as a word beside the marker's ring, so the two cannot be read as
       different things. Both are p.attention. */
    const at = p.attention;
    const tone = at ? ATTENTION_TONE[at] : null;
    const badge = !at
      ? '<span class="fm-rung-badge text-slate-500">RUNG NOT DERIVED</span>'
      : (tone && tone.label
        ? '<span class="fm-rung-badge" style="color:' + tone.stroke + ';border-color:' + tone.stroke + '33">' +
          tone.label + '</span>'
        : '<span class="fm-rung-badge text-slate-500">NORMAL</span>');

    const j = f.selectedJourney;
    const journeyLine = !j
      ? '<div class="text-[10px] text-slate-600">This truck is running no journey, so it has no route, no origin ' +
        'and no destination to report.</div>'
      : '<div class="text-[10px] text-slate-400">' + esc(j.routeId) + ' · ' + esc(j.direction) +
        (r ? ' · leg ' + (p.legIndex + 1) + ' of ' + r.legs + ' · ' + r.distanceKm + ' km end to end' : '') +
        '</div>' +
        '<div class="text-[10px] text-slate-600">' + Math.round(j.legElapsedSeconds / 60) + ' min elapsed on this ' +
        'leg. There is no journey id and no departure timestamp in this simulation, so the route and direction ' +
        'above are the journey\'s identity and the figure is leg time, not time since departure.</div>';

    const fo = f.focus;
    const focusBanner = !fo ? '' : (fo.resolved
      ? '<div class="fm-focus-banner">' +
        '<div class="flex items-center justify-between gap-2">' +
        '<span class="text-[10px] tracking-widest text-rose-300 uppercase">Case focus</span>' +
        '<button id="fm-focus-clear" class="text-[10px] text-slate-400 hover:text-white underline">' +
        'Show the whole network</button></div>' +
        '<div class="text-[10px] text-slate-300 font-mono mt-0.5">' + esc(fo.caseId) + '</div>' +
        '<div class="text-[10px] text-slate-400">' + esc(fo.status) +
        (fo.band ? ' · band ' + esc(fo.band) : '') +
        (fo.classification ? ' · ' + esc(String(fo.classification).replace(/_/g, ' ')) : '') + '</div>' +
        '<div class="text-[9px] text-slate-500 mt-0.5">Lit: ' + esc(fo.lightsOnly) + '. Never lit: ' +
        esc(fo.neverLights) + '.</div>' +
        (fo.siteName && fo.sitePlaced === false
          ? '<div class="text-[9px] text-fuchsia-300 mt-0.5">This case names the site "' + esc(fo.siteName) +
            '", which matches no place on the map, so the site is not lit anywhere.</div>' : '') +
        '</div>'
      : '<div class="fm-focus-banner"><div class="text-[10px] text-slate-400">A case was focused (' +
        esc(fo.caseId) + ') but it is not on the record this frame was read from (' + esc(fo.why) +
        '), so nothing is lit for it. <button id="fm-focus-clear" class="underline hover:text-white">Clear' +
        '</button></div></div>');

    els.selection.innerHTML = focusBanner +
      '<div class="flex items-baseline justify-between gap-2 mb-1">' +
      '<span class="text-[11px] text-white font-mono">' + esc(p.truckId) + '</span>' + badge + '</div>' +
      '<div class="text-[10px] text-slate-300 mb-1">' + esc(p.viewState) + ' — ' + where + '</div>' +
      journeyLine +
      '<div class="text-[10px] text-slate-500 my-1">' + chain + '</div>' +
      '<div class="text-[10px] text-amber-300/80">' + sig + '</div>' +
      '<div class="text-[9px] text-slate-600 mt-1">Lifecycle stage: ' + esc(p.status) + '. The visual state above ' +
      'is that stage restated for where the truck is, not a second opinion about it. ' +
      esc(ATTENTION_LEVELS[at] ? ATTENTION_LEVELS[at].means : 'The rung was not derived on this surface.') +
      '</div>';
  }

  /* Tone per severity basis, keyed on the three answers eventEngine's own
     severityBasis can give. UNDECLARED gets its own colour rather than falling
     back to routine, for the reason sim-debug already found: a row carrying a
     severity this program does not declare is not known to be ordinary traffic,
     and drawing it as ordinary traffic is a claim. */
  const BASIS_TONE = {
    DISRUPTION: 'border-amber-500/60 text-amber-200',
    ROUTINE: 'border-slate-700 text-slate-400',
    UNDECLARED: 'border-fuchsia-500/60 text-fuchsia-200'
  };

  function renderEntityCard(f) {
    if (!els.entityCard) return;
    const e = f.selectedEntity;
    if (els.expand && els.expand.classList) els.expand.classList.toggle('hidden', !e);
    const sig = e
      ? [e.truckId, e.statusLabel, e.signalCount, e.driver && e.driver.id, e.trailer && e.trailer.id,
        e.carrier && e.carrier.id, e.cases && e.cases.total, e.cases && e.cases.open].join('|')
      : '';
    if (sig === lastCardSig) return;
    lastCardSig = sig;
    if (!e) {
      els.entityCard.innerHTML = '<div class="text-[10px] font-semibold text-slate-400 uppercase mb-1">' +
        'Entities and signals</div><p class="text-[10px] text-slate-500 italic">Nothing is selected. Choosing a ' +
        'truck on the map reads out what it is linked to right now and what is currently observed about it, ' +
        'without leaving the network.</p>';
      return;
    }
    const absent = '<span class="text-slate-600">not linked</span>';
    const links = '<div class="text-[10px] text-slate-300 space-y-0.5">' +
      '<div>Driver: ' + (e.driver ? esc(e.driver.id) + ' (' + esc(e.driver.name) + ') — ' + esc(e.driver.status) : absent) + '</div>' +
      '<div>Trailer: ' + (e.trailer ? esc(e.trailer.id) + ' — seal ' +
        (e.trailer.sealId ? esc(e.trailer.sealId) : '<span class="text-slate-600">none recorded</span>') +
        ' — ' + esc(e.trailer.status) : absent) + '</div>' +
      '<div>Carrier: ' + (e.carrier ? esc(e.carrier.name) + ' (' + esc(e.carrier.scac || e.carrier.id) + ')' : absent) + '</div>' +
      '</div>';

    let signalsHtml;
    if (e.signals === null) {
      signalsHtml = '<p class="text-[10px] text-slate-600 italic">Signals are not derived on this surface, so ' +
        'nothing is known here about what is currently observed.</p>';
    } else if (!e.signals.length) {
      signalsHtml = '<p class="text-[10px] text-slate-600 italic">Nothing is under observation on this truck ' +
        'right now. That is an absence of active signals, which is not a statement that nothing happened.</p>';
    } else {
      signalsHtml = '<ul class="list-disc list-inside text-[10px] text-slate-400 space-y-0.5">' +
        e.signals.map(sg => '<li>' + esc(String(sg.type).replace(/_/g, ' ')) +
          (sg.reliability ? ' — ' + esc(sg.reliability) : '') +
          (sg.decay ? ' · ' + esc(sg.decay) : '') + '</li>').join('') + '</ul>' +
        '<p class="text-[9px] text-amber-300/80 mt-1">An active signal does not mean ' +
        esc(ATTENTION.doesNotMean) + '</p>' +
        (e.reliabilityNote ? '<p class="text-[9px] text-slate-500 italic mt-1">' + esc(e.reliabilityNote) + '</p>' : '');
    }

    const casesLine = e.cases === null
      ? 'Case counts are not derived on this surface.'
      : (e.cases.total
        ? e.cases.total + ' correlated case' + (e.cases.total === 1 ? '' : 's') + ' name' +
          (e.cases.total === 1 ? 's' : '') + ' this truck — ' + e.cases.open + ' still open, ' +
          e.cases.closed + ' closed'
        : 'No correlated case names this truck.');

    /* The id and the lifecycle state used to be repeated here. They are three
       lines above, in the inspector head, and the same fact printed twice a
       hand's width apart reads as two facts. */
    const head = '<div class="text-[10px] font-semibold text-slate-400 uppercase mb-1">Entities and signals</div>';
    const sub = k => '<div class="text-[10px] font-semibold text-slate-400 uppercase mt-2 mb-1">' + k + '</div>';
    els.entityCard.innerHTML = head +
      sub('Currently linked to') + links +
      sub('Active signals (' + (e.signalCount === null ? 'not counted here' : e.signalCount) + ')') + signalsHtml +
      sub('Cases naming it') +
      '<div class="text-[10px] text-slate-400">' + casesLine + '</div>' +
      '<p class="text-[9px] text-slate-500 mt-2">' + esc(ENTITY_CARD.doesNotMean) + '</p>' +
      '<p class="text-[9px] text-slate-600 mt-1">A summary, not the whole file. Left to the full entity ' +
      'panel: ' + esc(ENTITY_CARD.defersTo.join('; ')) + '. The button above opens it against the same ' +
      'simulation state this card was read from.</p>';
  }

  /* One row of either strip. The rung is a WORD on the row and a border colour
     beside it, never a colour alone: a reader who cannot tell sky from orange is
     otherwise being shown a ladder they cannot climb. */
  function rungRow(r, label) {
    const rung = r.rung || 'UNDECLARED';
    const tone = RUNG_TONE[rung] || 'border-fuchsia-500/60 text-fuchsia-200';
    return '<div class="shrink-0 border-l-2 ' + tone + ' pl-1.5 pr-2 py-0.5">' +
      '<div class="text-[9px] text-slate-500 font-mono">' + clockLabel(r.t) + '</div>' +
      '<div class="text-[8px] tracking-widest uppercase opacity-80">' +
      (r.alsoRung ? esc(r.alsoRung) + ' → ' + esc(rung) : esc(rung)) + '</div>' +
      '<div class="text-[10px] leading-tight whitespace-nowrap text-slate-300">' + esc(label) + '</div>' +
      (r.detail ? '<div class="text-[9px] text-slate-500 whitespace-nowrap">' + esc(r.detail) + '</div>' : '') +
      '</div>';
  }

  /* The selected journey's ladder. Replaces the world strip while something is
     selected, in the same box, because two strips side by side would be two
     things a reader has to work out the difference between. Deselecting brings
     the world strip straight back. */
  function renderJourneyTimeline(f) {
    const jt = f.selectedJourneyTimeline;
    const head = '<div class="text-[10px] font-semibold text-slate-400 uppercase mb-1">' +
      'Journey ladder · ' + esc(jt.truckId) + '</div>';
    if (!jt.shown) {
      els.timeline.innerHTML = head + '<p class="text-[10px] text-slate-500 italic">Nothing is currently held ' +
        'about this movement on any rung. ' + esc(jt.eventsAreAWindow) + '</p>';
      return;
    }
    const rows = jt.rows.map(r => rungRow(r, r.label)).join('');
    const ladder = RUNG_LADDER.order.map(k =>
      '<span class="' + (RUNG_TONE[k] || '').split(' ').slice(1).join(' ') + '">' + k + '</span>').join(
      ' <span class="text-slate-700">›</span> ');
    els.timeline.innerHTML = head +
      '<div class="text-[9px] mb-1">' + ladder + '</div>' +
      '<div class="flex items-stretch gap-2 overflow-x-auto scrollbar-thin pb-1">' + rows + '</div>' +
      '<p class="text-[9px] text-slate-500 mt-1">' + jt.eventRows + ' recorded event' +
      (jt.eventRows === 1 ? '' : 's') + ', ' + (jt.signalsDerived ? jt.signalRows + ' active signal' +
        (jt.signalRows === 1 ? '' : 's') : 'signals not derived here') + ', ' +
      (jt.casesDerived ? jt.caseRows + ' case' + (jt.caseRows === 1 ? '' : 's') : 'cases not derived here') +
      ', oldest first.' +
      (jt.undeclaredRows ? ' ' + jt.undeclaredRows + ' row' + (jt.undeclaredRows === 1 ? '' : 's') +
        ' carry a severity this program does not declare, so they sit on no rung.' : '') +
      ' ' + esc(jt.eventsAreAWindow) + ' ' + esc(jt.signalsAreActiveOnly) + ' ' + esc(RUNG_LADDER.doesNotMean) +
      ' ' + esc(RUNG_LADDER.sharedTimestamp) + '</p>';
  }

  function renderTimeline(f) {
    if (!els.timeline) return;
    const jt = f.selectedJourneyTimeline;
    if (jt && jt.truckId) {
      const jsig = 'J|' + jt.truckId + '|' + jt.shown + '|' + jt.eventRows + '|' + jt.signalRows + '|' +
        jt.caseRows + '|' + (jt.rows[0] ? jt.rows[0].t + '/' + jt.rows[0].rung : '-');
      if (jsig === lastTimelineSig) return;
      lastTimelineSig = jsig;
      renderJourneyTimeline(f);
      return;
    }
    const tl = f.timeline;
    const first = tl.rows[0];
    const sig = 'W|' + tl.shown + '|' + tl.held + '|' + tl.totalSoFar + '|' +
      (first ? first.t + '/' + first.type + '/' + first.entityId : '-');
    if (sig === lastTimelineSig) return;
    lastTimelineSig = sig;
    const head = '<div class="text-[10px] font-semibold text-slate-400 uppercase mb-1">Recorded events</div>';
    if (!tl.shown) {
      els.timeline.innerHTML = head + '<p class="text-[10px] text-slate-500 italic">Nothing has been recorded ' +
        'yet in this run. An empty strip is an empty record, not a quiet network.</p>';
      return;
    }
    const rows = tl.rows.map(r => rungRow({ t: r.t, rung: rungOf(r.basis), detail: r.entityId },
      String(r.type).replace(/_/g, ' '))).join('');
    const totalClause = tl.totalSoFar === null ? ''
      : ', out of ' + tl.totalSoFar + ' recorded since this run began';
    const undeclaredClause = tl.undeclared
      ? ' ' + tl.undeclared + ' carr' + (tl.undeclared === 1 ? 'ies' : 'y') + ' a severity this program does ' +
        'not declare at all, so whether those recorded a disruption is not known here and they are not drawn ' +
        'as ordinary traffic.'
      : '';
    els.timeline.innerHTML = head +
      '<div class="flex items-stretch gap-2 overflow-x-auto scrollbar-thin pb-1">' + rows + '</div>' +
      '<p class="text-[9px] text-slate-500 mt-1">The ' + tl.shown + ' most recent of the ' + tl.held +
      ' this simulation is currently holding' + totalClause + '. ' + tl.disruptions + ' of the ' + tl.shown +
      ' shown carry a severity eventEngine declares a disruption.' + undeclaredClause + ' ' +
      esc(TIMELINE_VIEW.doesNotMean) + '</p>';
  }

  function render(state) {
    if (!state || !els.svg) return null;
    if (els.root && els.root.classList && els.root.classList.contains('hidden')) return null;
    const f = frame(state);
    if (!f) return null;
    if (!staticBuilt) {
      els.svg.innerHTML = staticSvg(f.layout);
      staticBuilt = true;
    }
    /* Following is resolved HERE, once per frame, from the placement this frame
       already carries -- so the camera never holds a coordinate of its own and a
       followed truck cannot be centred on a position the simulation has moved on
       from. A truck with no placeable position is said so rather than silently
       dropping the instruction. */
    if (followTruckId) {
      const fp = f.trucks.filter(t => t.truckId === followTruckId)[0];
      if (fp && fp.drawn) {
        camera = { scale: Math.max(camera.scale, CAMERA.followScale), cx: fp.drawX, cy: fp.drawY };
        followState = 'FOLLOWING';
      } else {
        followState = 'UNPLACEABLE';
      }
    }
    const box = viewBoxFor(f.layout, camera);
    els.svg.setAttribute('viewBox', box.viewBox);
    renderRoute(f);
    renderActivity(f);
    renderFocus(f);
    renderTrucks(f);
    renderHeader(f);
    renderSelection(f);
    renderEntityCard(f);
    renderTimeline(f);
    renderCamera(f, box);
    renderHealth(f, box);
    return f;
  }

  /* What the camera is currently showing, in the same terms as everything else on
     this panel: a figure and what it is a figure OF. A magnified view hides
     trucks, and a line that said "3 trucks" without saying "of the 8 drawn" would
     be a claim about the network made out of a screen size. */
  function renderCamera(f, box) {
    if (!els.cameraLine) return;
    const v = inView(box, f.trucks, f.nodes);
    const fol = following();
    const sig = box.viewBox + '|' + v.trucksInView + '/' + v.trucksDrawn + '|' + v.placesInView +
      '|' + fol.state + '|' + (fol.truckId || '');
    if (els.followBtn) {
      const on = !!fol.truckId;
      els.followBtn.textContent = on ? 'Stop following' : 'Follow the selected truck';
      els.followBtn.disabled = !on && !f.selectedTruckId;
    }
    if (sig === lastCameraSig) return;
    lastCameraSig = sig;

    let lead;
    if (box.wholeDrawing) {
      lead = 'Showing the whole network: all ' + v.places + ' places and all ' + v.trucksDrawn +
        ' placeable truck' + (v.trucksDrawn === 1 ? '' : 's') + ' are on screen.';
    } else {
      lead = 'Magnified ' + box.scale + 'x. ' + v.placesInView + ' of ' + v.places + ' places and ' +
        v.trucksInView + ' of the ' + v.trucksDrawn + ' placeable trucks are inside the view' +
        (v.trucksOffScreen ? '; ' + v.trucksOffScreen + ' placeable truck' +
          (v.trucksOffScreen === 1 ? ' is' : 's are') + ' off screen and still on the network' : '') + '.';
    }
    let followClause = '';
    if (fol.state === 'FOLLOWING') {
      followClause = ' Following ' + esc(fol.truckId) + ' \u2014 the view re-centres on it whenever the ' +
        'simulation advances, which moves the view and never the truck.';
    } else if (fol.state === 'UNPLACEABLE') {
      followClause = ' ' + esc(fol.truckId) + ' has no position this simulation can place right now, so ' +
        'there is nothing to centre on and the view has not moved.';
    }
    els.cameraLine.innerHTML = '<span class="text-slate-400">' + esc(lead) + '</span>' + followClause +
      ' <span class="text-slate-600">' + esc(CAMERA.doesNotMean) + '</span>';
  }

  /* The occupancy panel's DOM. Every line opens with the axis it is counted on,
     as a visible label and not only as a field name, because the axis is the
     only thing that makes the number mean anything. A place or a road with
     nothing on it is summarised as a count of empties rather than printed as
     eleven rows of zero -- the zero is still stated, it is just stated once. */
  function renderHealth(f, box) {
    if (!els.health) return;
    const h = healthOf(f, box);
    const n = h.network;
    const sig = [n.placeable, n.atNode, n.inTransit, n.placesOccupied, n.roadsCarrying,
      h.occupiedPlaces.map(p => p.id + ':' + p.trucksHere).join(','),
      h.carryingRoads.map(r => r.key + ':' + r.trucks).join(','),
      h.view ? h.view.scale + '/' + h.view.placesInView + '/' + h.view.trucksInView : '-'].join('|');
    if (sig === lastHealthSig) return;
    lastHealthSig = sig;

    const axis = (k, text) => '<div class="text-[9px] font-semibold uppercase tracking-wide text-slate-500 ' +
      'mt-1.5">' + k.replace(/_/g, ' ') + '</div><div class="text-[10px] text-slate-300">' + text + '</div>';
    const plural = (v, one, many) => v + ' ' + (v === 1 ? one : many);

    const netLine =
      n.placeable + ' of ' + plural(n.trucks, 'truck', 'trucks') + ' in this run can be placed on the drawing' +
      (n.unplaceable ? ', ' + n.unplaceable + ' cannot and is listed as such rather than drawn somewhere' : '') +
      ' &mdash; ' + n.inTransit + ' part-way along a road, ' + n.atNode + ' standing at a place. ' +
      n.placesOccupied + ' of the ' + n.places + ' places ' + (n.placesOccupied === 1 ? 'has' : 'have') +
      ' a truck standing at ' + (n.placesOccupied === 1 ? 'it' : 'them') + ', ' + n.placesEmpty +
      ' ' + (n.placesEmpty === 1 ? 'has' : 'have') + ' none. ' + n.roadsCarrying + ' of the ' + n.roads +
      ' roads ' + (n.roadsCarrying === 1 ? 'is' : 'are') + ' carrying a truck, ' + n.roadsClear +
      ' ' + (n.roadsClear === 1 ? 'is' : 'are') + ' clear.' +
      /* Counted over all eleven places, not over the empty ones -- "3 of those"
         after a sentence about the empty places would have read as 3 of THOSE. */
      (n.placesWithNoSite ? ' Separately, ' + n.placesWithNoSite + ' of the ' + n.places + ' places seed no ' +
        'facility in this build, so an occupancy of zero at one of them is also a place nothing observes.' : '');

    const placeRows = h.occupiedPlaces.length
      ? '<ul class="text-[10px] text-slate-300 space-y-0.5 mt-0.5">' +
        h.occupiedPlaces.slice().sort((a, b) => b.trucksHere - a.trucksHere).map(pl =>
          '<li><span class="font-mono text-slate-400">' + esc(pl.label) + '</span> &mdash; ' +
          plural(pl.trucksHere, 'truck', 'trucks') + ' standing there' +
          (pl.sited ? '' : ' <span class="text-amber-300/70">(no facility seeded here)</span>') +
          '</li>').join('') + '</ul>' +
        '<p class="text-[9px] text-slate-600">The other ' + n.placesEmpty + ' of ' + n.places +
        ' places have no truck standing at them at this instant.</p>'
      : '<p class="text-[10px] text-slate-500 italic">No truck is standing at any of the ' + n.places +
        ' places right now; every placeable truck is on a road.</p>';

    const roadRows = h.carryingRoads.length
      ? '<ul class="text-[10px] text-slate-300 space-y-0.5 mt-0.5">' +
        h.carryingRoads.slice().sort((a, b) => b.trucks - a.trucks).map(r =>
          '<li><span class="font-mono text-slate-400">' + esc(r.fromLabel) + ' &rarr; ' + esc(r.toLabel) +
          '</span> &mdash; ' + plural(r.trucks, 'truck', 'trucks') + ' on it, ' + r.distanceKm + ' km ' +
          '(' + esc(EDGE_STYLE[r.speedClass] ? EDGE_STYLE[r.speedClass].label : r.speedClass) + ')</li>').join('') +
        '</ul>' +
        '<p class="text-[9px] text-slate-600">The other ' + n.roadsClear + ' of ' + n.roads +
        ' roads are carrying nothing at this instant. The kilometre figure is the graph\u2019s own ' +
        'declared distance, never the drawn length.</p>'
      : '<p class="text-[10px] text-slate-500 italic">None of the ' + n.roads + ' roads is carrying a truck ' +
        'right now; every placeable truck is standing at a place.</p>';

    let viewLine;
    if (!h.view) {
      viewLine = '<p class="text-[10px] text-slate-500 italic">No camera rectangle was passed to this panel, so ' +
        'nothing here is claimed about what is on screen.</p>';
    } else if (h.view.wholeDrawing) {
      viewLine = '<div class="text-[10px] text-slate-300">The whole drawing is on screen, so all ' +
        h.view.places + ' places and all ' + h.view.trucksDrawn + ' placeable trucks are visible. On this axis ' +
        'the figures happen to equal the per-network ones; that is a fact about the current magnification and ' +
        'not a rule.</div>';
    } else {
      viewLine = '<div class="text-[10px] text-slate-300">Magnified ' + h.view.scale + 'x: ' +
        h.view.placesInView + ' of ' + h.view.places + ' places and ' + h.view.trucksInView + ' of the ' +
        h.view.trucksDrawn + ' placeable trucks are inside the view, ' + h.view.trucksOffScreen +
        ' off screen and still on the network. Every figure above this line is unaffected by it.</div>';
    }

    const mismatch = h.reconciles ? '' :
      '<p class="text-[9px] text-rose-300 mt-1">The per-place and per-road counts add to ' +
      (h.placedAtPlaces + h.placedOnRoads) + ' and the network says ' + n.placeable + ' are placeable. Those ' +
      'should be the same number; this line exists so a disagreement is visible instead of averaged away.</p>';

    els.health.innerHTML =
      '<div class="text-[10px] font-semibold text-slate-400 uppercase mb-1">Network occupancy</div>' +
      axis('PER_NETWORK', netLine) +
      axis('PER_PLACE', '') + placeRows +
      axis('PER_ROAD', '') + roadRows +
      axis('PER_VIEW (in camera)', '') + viewLine +
      mismatch +
      '<p class="text-[9px] text-slate-500 mt-1.5">This panel is ' + esc(OCCUPANCY.is) + ' It is not ' +
      esc(OCCUPANCY.doesNotMean) + ' The last block is the one to be careful with: a per-view figure means ' +
      esc(HEALTH_SCOPES.PER_VIEW.counts) + ' It says nothing about the network, which is why it is kept in its ' +
      'own block and never added to the three above it.</p>';
  }

  function summary() {
    const lay = defaultLayout();
    return {
      places: lay.nodes.length,
      roads: lay.edges.length,
      columns: lay.columns.length,
      columnSizes: lay.columns.map(c => c.length),
      layoutUnit: LAYOUT_SCALE.unit,
      layoutIs: LAYOUT_SCALE.derivedFrom,
      positionSource: 'FWJourneyEngine.positionOf — this module produces no position of its own',
      readsGroundTruth: GROUND_TRUTH_SEPARATION.readsGroundTruth,
      visualStates: Object.keys(VIEW_STATES).length,
      notRendered: NOT_RENDERED.map(x => x.thing),
      entityCardShows: ENTITY_CARD.shows.length,
      entityCardDefersTo: ENTITY_CARD.defersTo.length,
      timelineFields: TIMELINE_VIEW.rows.slice(),
      timelineChannel: TIMELINE_VIEW.channel,
      cameraIs: CAMERA.isA,
      cameraRange: CAMERA.minScale + 'x to ' + CAMERA.maxScale + 'x',
      cameraChangesPosition: false,
      occupancyAxes: Object.keys(HEALTH_SCOPES),
      occupancyIsAScore: false,
      linksOffThisPanel: [PORT_DRILL.targetWorld],
      linkSharesState: false,
      interpolatesBetweenTicks: false,
      interpolationNote: 'A truck moves only when the simulation advances. There is no tween between two ticks, ' +
        'because a position between two simulation states is one the simulation never held.'
    };
  }

  /* Load-time reconciliation against the modules whose facts this one draws. */
  const STYLE_CHECK = assertNodeStyles();
  const EDGE_CHECK = assertEdgeStyles();
  const VIEW_CHECK = assertViewStates();
  const LADDER_CHECK = assertAttentionLadder();
  const RUNG_CHECK = assertRungLadder();

  return {
    LAYOUT_SCALE, LAYOUT, DECOR, TRUCK_ART, headingOf, truckBody,
    terrainDefs, roadCasing, roadCentrelines, placeHalos,
    GROUND_TRUTH_SEPARATION, NOT_RENDERED, NOT_DRAWN,
    NODE_STYLE, EDGE_STYLE, VIEW_STATES, STAGE_VIEW, VIEW_STATE_STYLE, ATTENTION,
    ENTITY_CARD, TIMELINE_VIEW, BASIS_TONE,
    ARRIVING_WINDOW_SECONDS, STYLE_CHECK, EDGE_CHECK, VIEW_CHECK,
    assertNodeStyles, assertEdgeStyles, assertViewStates, assertLayoutCoversGraph,
    CAMERA, viewBoxFor, inView, zoomIn, zoomOut, zoomBy, panBy, resetCamera, follow, following,
    cameraState,
    HEALTH_SCOPES, OCCUPANCY, roadOccupancy, healthOf,
    PORT_DRILL, portDrillTarget, openWorld,
    hopDepths, buildLayout, defaultLayout, placementFor, stackAtNodes, selectedRoute, frame,
    entityCardFor, timelineOf, clockLabel, expandSelected,
    ATTENTION_LEVELS, ATTENTION_TONE, HIGH_ATTENTION_BANDS, ESCALATED_STATUS,
    assertAttentionLadder, LADDER_CHECK,
    attentionOf, caseIndexOf, focusOf, bandsVerified,
    RUNGS, RUNG_TONE, RUNG_LADDER, assertRungLadder, RUNG_CHECK, rungOf, journeyTimelineOf,
    focus, focused, clearFocus,
    staticSvg, init, render, select, selected, summary
  };
})();
