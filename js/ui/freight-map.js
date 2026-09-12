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
    caseIsSeparate: 'whether a case exists is moEngine\'s answer and is counted separately in the header.'
  };

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
       of which 42 carried the disruption severity -- 1.5% of rows, and 16.0% of
       windows held at least one, never more than three. That is the honest
       shape of this surface and it is not a fault to be tuned away: a strip
       that reliably showed a disruption would be a strip that had stopped being
       chronological. Which is exactly why every caption states how many of the
       shown rows carried one, instead of leaving a reader to assume the visible
       rows are the interesting ones. */
    measured: { seed: 12345, frames: 200, rowsSampled: 2800, disruptionRows: 42,
      windowsWithADisruption: 32, mostInOneWindow: 3 },
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

    let openCases = null;
    if (state.moEngine && window.FWMoEngine && FWMoEngine.OPEN_STATUSES) {
      openCases = Array.from(state.moEngine.mos.values()).filter(m => FWMoEngine.OPEN_STATUSES.has(m.status)).length;
    }

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
      timeline: timelineOf(state),
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

  const SVG_NS = 'http://www.w3.org/2000/svg';

  let els = {};
  let staticBuilt = false;
  let selectedTruckId = null;
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
    return '<rect x="0" y="0" width="' + layout.width + '" height="' + layout.height + '" fill="#05070a"/>' +
      '<g id="fm-roads">' + roads + '</g>' +
      '<g id="fm-road-labels">' + roadLabels + '</g>' +
      '<g id="fm-route"></g>' +
      '<g id="fm-places">' + places + '</g>' +
      '<g id="fm-place-labels">' + placeLabels + '</g>' +
      '<g id="fm-activity"></g>' +
      '<g id="fm-trucks"></g>' +
      '<g id="fm-legend">' + legend + '</g>';
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
        const target = e.target && e.target.closest ? e.target.closest('[data-truck-id]') : null;
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
    f.trucks.forEach(p => {
      if (!p.drawn) return;
      const m = markerFor(p);
      m.g.setAttribute('transform', 'translate(' + p.drawX + ',' + p.drawY + ')');
      const sig = p.viewState + '|' + (p.watched ? 'W' : '-') + '|' + (p.selected ? 'S' : '-');
      if (m.sig === sig) return;
      m.sig = sig;
      const st = VIEW_STATE_STYLE[p.viewState];
      const ring = p.watched
        ? '<circle r="10" fill="none" stroke="#f59e0b" stroke-width="1.2" stroke-dasharray="2 2"/>' : '';
      const halo = p.selected
        ? '<circle r="14" fill="none" stroke="#e2e8f0" stroke-width="1" opacity="0.85"/>' : '';
      m.g.innerHTML =
        halo + ring +
        '<rect x="-6" y="-4" width="12" height="8" rx="1.5" fill="' + st.fill + '" stroke="' + st.stroke +
        '" stroke-width="1.2"/>' +
        (p.selected ? '<text x="0" y="-18" text-anchor="middle" font-size="9" fill="#e2e8f0">' + esc(p.truckId) +
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

  function renderHeader(f) {
    if (els.clock) {
      els.clock.innerHTML = '<b class="text-white">Day ' + f.clock.day + '</b> · ' + f.clock.timeOfDay +
        ' · <span class="uppercase">' + esc(f.clock.shift) + '</span> · <span class="text-sky-400">' +
        (f.clock.running ? f.clock.speed + 'x' : 'PAUSED') + '</span>';
    }
    if (els.stats) {
      const c = f.counts;
      const cases = c.openCases === null ? 'open cases not derived here' : c.openCases + ' open case' +
        (c.openCases === 1 ? '' : 's');
      els.stats.textContent =
        c.drawn + ' of ' + c.trucks + ' trucks on the network · ' + c.inTransit + ' on a road · ' +
        c.atNode + ' standing at a place · ' + c.watchedTrucks + ' carrying an active signal (' +
        c.activeSignals + ' signals) · ' + cases + ' · ' + c.facilitiesOnMap + ' places · ' + c.roads +
        ' roads · ' + c.routes + ' routes';
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
    els.selection.innerHTML =
      '<div class="text-[11px] text-white font-mono mb-1">' + esc(p.truckId) + ' · ' + esc(p.viewState) + '</div>' +
      '<div class="text-[10px] text-slate-400 mb-1">' + where + '</div>' +
      '<div class="text-[10px] text-slate-500 mb-1">' + chain + '</div>' +
      (r ? '<div class="text-[10px] text-slate-600 mb-1">' + esc(r.label) + ' · ' + r.distanceKm + ' km end to end · leg ' + (p.legIndex + 1) + ' of ' + r.legs + '</div>' : '') +
      '<div class="text-[10px] text-amber-300/80">' + sig + '</div>' +
      '<div class="text-[10px] text-slate-600 mt-1">Lifecycle stage: ' + esc(p.status) + '. The visual state above ' +
      'is that stage restated for where the truck is, not a second opinion about it.</div>';
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
        'Selected movement</div><p class="text-[10px] text-slate-500 italic">Nothing is selected. Choosing a ' +
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

    const head = '<div class="text-[10px] font-semibold text-slate-400 uppercase mb-1">Selected movement</div>';
    const sub = k => '<div class="text-[10px] font-semibold text-slate-400 uppercase mt-2 mb-1">' + k + '</div>';
    els.entityCard.innerHTML = head +
      '<div class="text-[11px] text-white font-mono">' + esc(e.truckId) + '</div>' +
      '<div class="text-[10px] text-slate-400">' + esc(e.statusLabel) + '</div>' +
      sub('Currently linked to') + links +
      sub('Active signals (' + (e.signalCount === null ? 'not counted here' : e.signalCount) + ')') + signalsHtml +
      sub('Cases naming it') +
      '<div class="text-[10px] text-slate-400">' + casesLine + '</div>' +
      '<p class="text-[9px] text-slate-500 mt-2">' + esc(ENTITY_CARD.doesNotMean) + '</p>' +
      '<p class="text-[9px] text-slate-600 mt-1">A summary, not the whole file. Left to the full entity ' +
      'panel: ' + esc(ENTITY_CARD.defersTo.join('; ')) + '. The button above opens it against the same ' +
      'simulation state this card was read from.</p>';
  }

  function renderTimeline(f) {
    if (!els.timeline) return;
    const tl = f.timeline;
    const first = tl.rows[0];
    const sig = tl.shown + '|' + tl.held + '|' + tl.totalSoFar + '|' +
      (first ? first.t + '/' + first.type + '/' + first.entityId : '-');
    if (sig === lastTimelineSig) return;
    lastTimelineSig = sig;
    const head = '<div class="text-[10px] font-semibold text-slate-400 uppercase mb-1">Recorded events</div>';
    if (!tl.shown) {
      els.timeline.innerHTML = head + '<p class="text-[10px] text-slate-500 italic">Nothing has been recorded ' +
        'yet in this run. An empty strip is an empty record, not a quiet network.</p>';
      return;
    }
    const rows = tl.rows.map(r =>
      '<div class="shrink-0 border-l-2 ' + (BASIS_TONE[r.basis] || BASIS_TONE.ROUTINE) + ' pl-1.5 pr-2 py-0.5">' +
      '<div class="text-[9px] text-slate-500 font-mono">' + clockLabel(r.t) + '</div>' +
      '<div class="text-[10px] leading-tight whitespace-nowrap">' + esc(String(r.type).replace(/_/g, ' ')) + '</div>' +
      '<div class="text-[9px] text-slate-500 font-mono">' + esc(r.entityId) + '</div></div>').join('');
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
      interpolatesBetweenTicks: false,
      interpolationNote: 'A truck moves only when the simulation advances. There is no tween between two ticks, ' +
        'because a position between two simulation states is one the simulation never held.'
    };
  }

  /* Load-time reconciliation against the modules whose facts this one draws. */
  const STYLE_CHECK = assertNodeStyles();
  const EDGE_CHECK = assertEdgeStyles();
  const VIEW_CHECK = assertViewStates();

  return {
    LAYOUT_SCALE, LAYOUT, GROUND_TRUTH_SEPARATION, NOT_RENDERED, NOT_DRAWN,
    NODE_STYLE, EDGE_STYLE, VIEW_STATES, STAGE_VIEW, VIEW_STATE_STYLE, ATTENTION,
    ENTITY_CARD, TIMELINE_VIEW, BASIS_TONE,
    ARRIVING_WINDOW_SECONDS, STYLE_CHECK, EDGE_CHECK, VIEW_CHECK,
    assertNodeStyles, assertEdgeStyles, assertViewStates, assertLayoutCoversGraph,
    CAMERA, viewBoxFor, inView, zoomIn, zoomOut, zoomBy, panBy, resetCamera, follow, following,
    cameraState,
    HEALTH_SCOPES, OCCUPANCY, roadOccupancy, healthOf,
    hopDepths, buildLayout, defaultLayout, placementFor, stackAtNodes, selectedRoute, frame,
    entityCardFor, timelineOf, clockLabel, expandSelected,
    staticSvg, init, render, select, selected, summary
  };
})();
