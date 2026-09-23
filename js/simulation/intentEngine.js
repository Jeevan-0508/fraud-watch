/* simulation/intentEngine.js — SOME ACTORS HAVE A PLAN (Slice 73, Phase F).

   THE GAP THIS CLOSES. Until this module, every disruption in this build was
   `p = 0.015` rolled independently for every truck on every tick. There was no
   actor, no plan and no memory: a truck that deviated its route at 04:00 was no
   likelier to lose GPS at 04:20 than any other truck, and the same truck the
   next day started from nothing. Phase A's audit named that on day one -- "today
   it is p=0.015 -> event -> hidden label, so the first two links of the brief's
   causal chain do not exist" -- and Slices 70 to 72 built what a plan needs to
   unfold over: a typed node/edge graph, a journey with a real position, and a
   lifecycle stage that is a function of that position.

   WHAT A PLAN IS HERE. A named actor holds an ordered list of steps. Each step
   pairs one of behaviorEngine's existing disruption types with a POSITION TEST
   over the world graph -- at this node, on the leg into this node, at any node
   of this type. A step fires only when the truck the actor is driving is
   actually in that position, and only on an opportunity behaviorEngine's
   existing gate has already granted. The KIND, the TARGET and (for a
   composite) the two kinds composed are chosen once, at boot, from a seeded
   stream, and none of those three ever change. The VARIANT may change exactly
   once per actor, and only in one direction -- see adapt() (Slice 89) below.

   WHAT A PLAN IS NOT.

   1. It is not a second disruption system. This module issues no type of its
      own: PLAN_KINDS is written entirely in behaviorEngine.DISRUPTION_TYPES,
      reconciled against that list at load, and behaviorEngine remains the only
      module that applies a disruption or emits an event. A plan changes WHICH
      of the fourteen types a granted opportunity spends itself on, and nothing
      else.
   2. It is not an extra disruption budget. behaviorEngine still rolls
      DISRUPTION_CHANCE_PER_TICK exactly once per truck per tick and still draws
      the unplanned type from the same stream before consulting this module (see
      behaviorEngine.step, which draws and discards). One granted opportunity is
      one recorded trace whether the actor has a plan or not, so the count of
      disruption opportunities in a run is a property of behaviorEngine's rate
      and is unchanged by anything here. That is deliberate: the forbidden
      shortcut in this project is raising the rate until cases stick, and a
      redistribution cannot be mistaken for one.
   3. It is not guilt, and it is not a taxonomy verdict. An actor with a plan is
      an actor with a plan. falsePositiveEngine still annotates every trace the
      plan produces independently at LEGITIMATE_CHANCE, so a planned act can and
      does carry a documented benign cause on record -- which is the point: the
      investigator's job is to infer that a plan existed from the record, and the
      record does not know. moEngine still classifies from its own keyword table
      and has never heard of this module. `resembles` below names the taxonomy
      pattern each step vocabulary was generalized FROM; it is documentation of
      where the shape came from, it is never read by the classifier, and a guard
      in the suite pins that no engine downstream of this one references it.

   GROUND TRUTH, AND WHO MAY READ IT. A plan is causal truth the simulation acts
   on. It is not evidence and no player-facing surface may render it. The rule
   and its readers are declared in GROUND_TRUTH below and enforced by a source
   scan in the suite, the same way falsePositiveEngine's answer key is.

   ACTOR = DRIVER, and the argument for it. The candidates were the truck, the
   driver, and the driver/trailer pair.
     - The TRUCK is the wrong holder because a truck is equipment that changes
       both its crew and its route continuously: journeyEngine draws a new route
       at every terminus and DRIVER_CHANGED reassigns truck.driverId outright, so
       a truck-held plan would be a plan held by whichever stranger is behind the
       wheel this hour.
     - The PAIR is the shape a collusion MO actually has, and it is not stable in
       this build: TRAILER_SWAPPED is one of the fourteen disruption types, so a
       pair-keyed plan would dissolve the moment one of its own steps fired.
     - The DRIVER is the only entity that persists across that churn, is already
       recorded on every case moEngine opens (mo.entities.driverId, so a
       driver-keyed plan is inferable from the existing data model without adding
       a field anywhere), and matches the ROC/TIO narratives these types were
       generalized from, which are about people and operators acting rather than
       about chassis.
   A consequence, kept rather than papered over: if an unplanned DRIVER_CHANGED
   moves a planned driver off a truck, the plan goes DORMANT -- the actor is not
   driving, so the actor cannot act -- and resumes if that driver is assigned to
   a truck again. A plan attached to the vehicle would have carried on with a
   different person driving, which is the fault this choice avoids. */
const FWIntentEngine = (() => {
  const JE = (() => { try { return FWJourneyEngine; } catch (e) { return null; } })();
  const WG = (() => { try { return FWWorldGraph; } catch (e) { return null; } })();

  function requireGraph(what) {
    if (!JE || !WG) {
      throw new Error('intentEngine: ' + what + ' needs FWJourneyEngine and FWWorldGraph. A plan over a route it ' +
        'cannot read would have to invent the route, and an invented target node is a plan over nowhere.');
    }
    return { JE: JE, WG: WG };
  }

  /* HOW MANY ACTORS. A count, not a share: eight trucks are crewed in this
     build, so a percentage here would imply a distribution over a population
     that had eight members when this was written. The count is chosen so the
     planned population is a minority of the crewed fleet and the unplanned baseline stays the bulk of
     what the signal layer sees -- the same reasoning that keeps
     DISRUPTION_CHANCE_PER_TICK low. It is not a fraud rate: it changes who
     acts with intent, never how often anything happens. */
  /* SCALED BY SLICE 83, NOT RE-BALANCED. Two was chosen against a crewed fleet of
     eight. Slice 81 tripled the fleet to twenty-four and left this at two, which
     quietly cut the planned share of the fleet from 25% to 8% -- and it showed:
     measured over 60 sim-days at 24 trucks, the two actors between them were
     granted 256 opportunities, fired 3 steps, completed no plan, and BOTH ended
     the run dormant (`summary().dormantActorIds`), because an unplanned
     DRIVER_CHANGED moved each of them off the truck they started on and the plan
     goes with the person. Two actors in a fleet of twenty-four is a sample of one
     bad day. Six holds the original 25% share, so the unplanned baseline is still
     the bulk of what the signal layer sees. This still changes who acts with
     intent and never how often anything happens: the opportunity rate is
     behaviorEngine's and is untouched. */
  const PLANNED_ACTOR_COUNT = 6;

  /* Drawn from its own stream, offset from the sim seed, so choosing the actors
     consumes none of the randomness behaviorEngine spends on movement and
     disruption. Same seed -> same actors -> same plans, and the A/B measurement
     against the previous commit is not confounded by a shifted stream. */
  const PLAN_SEED_OFFSET = 977;

  /* HOW OFTEN THE WORLD IS SAMPLED, and why a plan has to know.

     simRunner advances sim-time in FF_CHUNK-sized steps and behaviorEngine rolls
     one disruption opportunity per truck per step, so a truck's position is only
     ever observed once per chunk. A step waiting for a position the truck passes
     THROUGH in less than one chunk is a step the simulation may never sample the
     truck in at all -- not unlikely, unobservable.

     That is not hypothetical here, it is the shape of this graph. worldGraph
     declares as an assumption that moves inside a site and legs between sites
     differ by about two orders of magnitude, and they do: the legs into
     PORT_MERIDIAN, YARD_QUAYSIDE, YARD_EMPTIES and YARD_OVERFLOW take 90 to 240
     sim-seconds, against 2,960 to 5,920 for every road leg. Measured before this
     constant existed, with an approach step staged at YARD_EMPTIES: 1 step fired
     in 20 sim-days, and 72 of the actor's 73 granted opportunities missed with
     NOT_ON_THE_APPROACH. The plan was not unlucky. It was waiting in a doorway.

     The figure is simRunner's FF_CHUNK, quoted. simRunner owns it and passes its
     own value to createBook; this default is what behaviorEngine's load-time
     staging check uses, because behaviorEngine loads before simRunner and cannot
     read it. The suite reconciles the two, so the quote cannot go stale. */
  const MOVEMENT_SAMPLE_SECONDS = 300;

  /* WHERE A STEP CAN BE WAITING TO HAPPEN. Every test is answered from
     journeyEngine.positionOf -- the only producer of a truck's position in this
     codebase -- so a step's precondition is checked against the same fact the
     stage, the site and the movement are all read from. There is no fourth
     position model here. */
  const POSITION_TESTS = {
    AT_NODE: {
      name: 'AT_NODE',
      needs: 'nodeId',
      means: 'the truck is standing at exactly this node.'
    },
    ON_LEG_INTO_NODE: {
      name: 'ON_LEG_INTO_NODE',
      needs: 'nodeId',
      means: 'the truck is travelling the leg whose far end is this node, so it has not arrived yet. This is the only test a step can hold while the truck is on a public road, and worldGraph declares road stages to belong to no node -- which is why an approach step is recorded with no facilityId, exactly as an unplanned road disruption is.'
    },
    AT_NODE_TYPE: {
      name: 'AT_NODE_TYPE',
      needs: 'nodeType',
      means: 'the truck is standing at any node of this type. Used where the plan is about a KIND of place rather than one place -- a stamp cleared at whichever gate comes next -- and it is the weaker claim of the two, so a plan step says which it makes.'
    }
  };
  const POSITION_TEST_NAMES = Object.keys(POSITION_TESTS);

  /* THE ELEVEN PLANS.

     Each is a multi-step act over the graph, written in the vocabulary that
     already exists: the step types are behaviorEngine's, the position tests are
     journeyEngine's, and `resembles` records which of the taxonomy's twelve
     patterns the shape was generalized from. No step invents a disruption type
     and no plan invents a place. Eleven of the twelve taxonomy patterns are
     here: FFT-011 (Insurance Certificate Fraud) has no plan, because every one
     of its indicators is a pre-trip paperwork check against an insurer or
     broker. Nothing about it is a fact a truck's position, a driver or a
     disruption type could ever carry, and inventing a movement trace for it
     would be exactly the kind of unfounded fact this module exists to refuse.

     `targetNodeTypes` narrows where the act is staged; null means any node the
     feasibility check admits. The target is drawn once per actor and is a NODE,
     not a journey: journeyEngine.continuations guarantees a truck keeps taking
     routes out of wherever it parked, so an actor waits for the world to bring
     it back to the place it chose rather than being teleported to it. That is
     what makes this unfold THROUGH the graph rather than being a flag consulted
     once.

     Why the steps are spread over the approach and the place rather than fired
     together: an act with several traces recorded at the same instant would not
     need a graph to express it, and the brief for this slice is a plan that
     unfolds through the journey. The cost of that choice is measured, reported
     and not hidden -- see latencyReport() and the handoff. */
  const PLAN_KINDS = {
    SPOOFED_APPROACH: {
      id: 'SPOOFED_APPROACH',
      label: 'position reporting is broken on the run in, and the asset shows up somewhere it also still is',
      resembles: { id: 'FFT-008', name: 'GPS Spoofing and Telematics Manipulation' },
      targetNodeTypes: null,
      steps: [
        { type: 'GPS_SIGNAL_LOST', test: 'ON_LEG_INTO_NODE' },
        { type: 'ROUTE_DEVIATION', test: 'ON_LEG_INTO_NODE' },
        { type: 'DUPLICATE_ASSET_ID', test: 'AT_NODE' }
      ]
    },
    SEAL_AND_SWAP: {
      id: 'SEAL_AND_SWAP',
      label: 'the seal on the box stops matching the paperwork at a yard, the box changes, and the delivery is stamped at the next gate',
      resembles: { id: 'FFT-007', name: 'Seal Tampering and Reseal Fraud' },
      targetNodeTypes: ['WAREHOUSE', 'PORT'],
      steps: [
        { type: 'SEAL_MISMATCH', test: 'AT_NODE' },
        { type: 'TRAILER_SWAPPED', test: 'AT_NODE' },
        { type: 'FALSE_MILESTONE_STAMP', test: 'AT_NODE_TYPE', nodeType: 'CHECKPOINT' }
      ]
    },
    UNRECORDED_HANDOVER: {
      id: 'UNRECORDED_HANDOVER',
      label: 'a stop short of the destination, a handover nobody confirms, and then the operator stops answering',
      resembles: { id: 'FFT-004', name: 'Fictitious Pickup' },
      targetNodeTypes: null,
      steps: [
        { type: 'UNEXPECTED_STOP', test: 'ON_LEG_INTO_NODE' },
        { type: 'HANDOVER_GAP', test: 'AT_NODE' },
        { type: 'CARRIER_UNRESPONSIVE', test: 'AT_NODE' }
      ]
    },
    DOUBLE_TENDER: {
      id: 'DOUBLE_TENDER',
      label: 'the booking on record is quietly re-tendered to a second carrier, and the manifest stops matching the asset that actually shows up',
      resembles: { id: 'FFT-001', name: 'Double Brokering' },
      targetNodeTypes: null,
      steps: [
        { type: 'MANIFEST_CHANGED', test: 'AT_NODE' },
        { type: 'GPS_SIGNAL_LOST', test: 'ON_LEG_INTO_NODE' },
        { type: 'HANDOVER_GAP', test: 'AT_NODE' }
      ]
    },
    GHOST_ONBOARD: {
      id: 'GHOST_ONBOARD',
      label: 'the vehicle at pickup carries no livery and is not the plate on file, then it goes quiet on the leg out and never answers again',
      resembles: { id: 'FFT-002', name: 'Phantom Carrier' },
      targetNodeTypes: null,
      steps: [
        { type: 'EQUIPMENT_CARRIER_MISMATCH', test: 'AT_NODE' },
        { type: 'GPS_SIGNAL_LOST', test: 'ON_LEG_INTO_NODE' },
        { type: 'CARRIER_UNRESPONSIVE', test: 'AT_NODE' }
      ]
    },
    IDENTITY_SWAP: {
      id: 'IDENTITY_SWAP',
      label: 'a real, dormant licence gets used by someone who is not its holder, and the equipment presenting at pickup is not registered to that holder either',
      resembles: { id: 'FFT-003', name: 'Carrier Identity Takeover' },
      targetNodeTypes: null,
      steps: [
        { type: 'ACCOUNT_TAKEOVER', test: 'AT_NODE' },
        { type: 'EQUIPMENT_CARRIER_MISMATCH', test: 'AT_NODE' },
        { type: 'DUPLICATE_ASSET_ID', test: 'AT_NODE' }
      ]
    },
    PERSISTENT_SHORTAGE: {
      id: 'PERSISTENT_SHORTAGE',
      label: 'the seal recorded at destination does not match the one recorded at origin, and the stop along the way runs longer than the corridor norm',
      resembles: { id: 'FFT-005', name: 'Systematic Pilferage' },
      targetNodeTypes: null,
      steps: [
        { type: 'SEAL_MISMATCH', test: 'AT_NODE' },
        { type: 'UNEXPECTED_STOP', test: 'ON_LEG_INTO_NODE' }
      ]
    },
    CURTAIN_STOP: {
      id: 'CURTAIN_STOP',
      label: 'an unscheduled stop lands somewhere that is not a certified secure yard, and the truck is down there long enough for the curtain to be a problem',
      resembles: { id: 'FFT-006', name: 'Unsecured Parking Theft' },
      targetNodeTypes: null,
      steps: [
        { type: 'UNEXPECTED_STOP', test: 'ON_LEG_INTO_NODE' },
        { type: 'STAGED_BREAKDOWN', test: 'AT_NODE' }
      ]
    },
    GATE_TIPOFF: {
      id: 'GATE_TIPOFF',
      label: 'a driver credential authorises a pickup outside the pattern normal for that shift, and the gate stamp that should have caught it does not',
      resembles: { id: 'FFT-009', name: 'Insider Collusion' },
      targetNodeTypes: null,
      steps: [
        { type: 'DRIVER_CHANGED', test: 'AT_NODE' },
        { type: 'HANDOVER_GAP', test: 'AT_NODE' },
        { type: 'FALSE_MILESTONE_STAMP', test: 'AT_NODE_TYPE', nodeType: 'CHECKPOINT' }
      ]
    },
    PAPER_TRAIL: {
      id: 'PAPER_TRAIL',
      label: 'the manifest changes once, quietly, and the milestone stamp behind it is claimed at a gate the truck did not clear the way the record says',
      resembles: { id: 'FFT-010', name: 'Transport Document Fraud' },
      targetNodeTypes: null,
      steps: [
        { type: 'MANIFEST_CHANGED', test: 'AT_NODE' },
        { type: 'FALSE_MILESTONE_STAMP', test: 'AT_NODE_TYPE', nodeType: 'CHECKPOINT' }
      ]
    },
    CHAIN_HANDOFF: {
      id: 'CHAIN_HANDOFF',
      label: 'the vehicle and driver at pickup belong to an entity that appears nowhere in the shipper\'s own records, one tier below whoever was actually contracted',
      resembles: { id: 'FFT-012', name: 'Undisclosed Subcontracting Chain' },
      targetNodeTypes: null,
      steps: [
        { type: 'EQUIPMENT_CARRIER_MISMATCH', test: 'AT_NODE' },
        { type: 'DRIVER_CHANGED', test: 'AT_NODE' },
        { type: 'CARRIER_UNRESPONSIVE', test: 'AT_NODE' }
      ]
    }
  };
  const PLAN_KIND_NAMES = Object.keys(PLAN_KINDS);

  /* An actor's plan is either armed, running, waiting for a driver, or done a
     lap. Named because "stepIndex 0" means two different things -- never started
     and started again -- and a count that merges them cannot be read. */
  const PLAN_STATES = {
    ARMED: 'chosen and feasible, no step has fired yet.',
    RUNNING: 'at least one step has fired and the plan is waiting for the position its next step needs.',
    DORMANT: 'the actor is not driving any truck right now (an unplanned DRIVER_CHANGED moved them off one), so no step can fire until they are assigned again.',
    CYCLED: 'every step has fired at least once and the plan has re-armed at its first step. The count of laps is kept; a systematic MO is systematic, and the recurrence of one signature is the only thing about a plan the correlation layer could ever notice.',
    RETIRED: 'a signature this actor\'s case contributed to was VALIDATED by an analyst (Slice 93); the plan is permanently stopped and no step will fire again.'
  };

  /* GROUND TRUTH, AND ITS DECLARED READERS.

     A plan is what is actually happening. It is not a signal, not evidence and
     not a finding, and the whole point of the project is that a player infers it
     from the record the same way they infer any other MO. So:

       - behaviorEngine reads it to decide which type a granted opportunity
         spends itself on. That is the simulation acting on its own truth.
       - simRunner holds the book on state so the run has one, and passes it to
         behaviorEngine through ctx alongside the trackers.
       - NOTHING ELSE. No view, no panel, no report, no analytics group, and --
         deliberately -- not sim-debug.js either, which is the declared answer-key
         panel for falsePositiveEngine's per-event label. Whether a plan belongs
         on that panel is a decision about what a debug surface may show, and
         guessing it here would be the leak this block exists to prevent. It is
         named in the handoff as work for a later gating slice.

     The book is reachable from state, exactly as a signal's groundTruth is, and
     the rule is the same rule: reachable is not rendered, and the source scan in
     the suite is what holds the line. */
  const GROUND_TRUTH = {
    holds: 'the plan every planned actor is executing, which step it is on, and every step it has already fired',
    readers: ['js/simulation/behaviorEngine.js', 'js/simulation/simRunner.js'],
    forbidden: 'any file under js/ui/, and any engine downstream of behaviorEngine (signalEngine, moEngine, investigationEngine, candidateEngine, outcomeEngine, exposureModel, analyticsEngine, networkEngine, awayReport, adviceEngine)',
    why: 'a case is supposed to be built out of what was written down. A classifier that could read the plan would be scoring itself, and a panel that could render it would be answering the question the player is here to answer.'
  };

  const ASSUMPTIONS = [
    'An actor is a driver. Six of the twenty-four crewed drivers in this build hold a plan; the other eighteen and every spare driver in the pool of thirty-four hold none, and a truck whose driver holds none behaves exactly as it did before this module existed.',
    'A plan\'s kind, target and (for a composite) composed-from pair are chosen once, at boot, and never change; there is still no recruitment, so no actor ever acquires a plan after boot. Its VARIANT can change exactly once, from adapt() (Slice 89): a single-kind actor whose case reaches moEngine\'s MO_VARIANT or KNOWN_MO steps down to the ABBREVIATED variant if it is not already on it and one exists for its kind, bounded to one step per actor because ABBREVIATED is the only variant quieter than what it replaces; a composite actor never adapts because a composite has no declared variant to step down to. A plan can also be retired outright, from retire() (Slice 93): once a signature an actor\'s case contributed to is VALIDATED by an analyst in the Discovery Lab, that driverId\'s plan stops permanently -- a composite actor retires exactly as a single-kind one does, since retiring needs no quieter variant to exist -- and this is the only way an actor in this build ever abandons a plan.',
    'COMPOSITE_ACTOR_COUNT of the crewed drivers hold a plan built from two kinds at once rather than one. A composite is drawn from the same pool as every other actor, after they are placed, so it is a strictly additional actor, never a substitute for one of the eleven single-kind plans.',
    'A step fires only on an opportunity behaviorEngine has already granted at its own unchanged rate, so a plan redistributes which type a trace carries and never how many traces there are.',
    'Every step is one of behaviorEngine\'s fourteen disruption types and every position test is answered from journeyEngine.positionOf. This module declares no type and no position of its own.',
    'A planned trace is annotated by falsePositiveEngine identically to an unplanned one, so roughly two in three planned traces carry a documented benign cause on record. A plan is not a label.',
    'When a plan has fired all of its steps it re-arms at the first one, because a documented MO is a repeated act rather than a single incident. The lap count is kept.'
  ];

  const NOT_MODELLED = [
    {
      figure: 'Whether the truck physically goes anywhere it should not',
      why: 'journeyEngine.advance still walks the legs of the assigned route in order and can neither skip a leg nor stray off one. A planned ROUTE_DEVIATION is a trace recorded on a leg the actor chose in advance; it is not a departure from the route, and no distance, duration or node in this build differs because of it. Making the truck actually leave the graph is a change to advance() and to the route table, which is Phase D.'
    },
    {
      figure: 'Why this actor and not another',
      why: 'The two are drawn uniformly from the drivers that hold a truck at boot. There is no motive, no pressure, no debt, no coercion and no history behind the draw. Any reading of WHO offends in this simulation is a reading of a uniform draw over eight names.'
    },
    {
      figure: 'Whether the plan succeeds',
      why: 'A plan has no objective beyond its own steps. Nothing is stolen, nothing is worth anything, no cargo is disposed of and no money moves, so there is no success or failure to report and no financial figure of any kind follows from a completed plan.'
    },
    {
      figure: 'Whether the plan is detectable',
      why: 'That is not this module\'s claim to make. The signal, correlation, investigation and outcome layers see the traces and nothing else, and whether the traces are enough is measured in the suite and the handoff rather than asserted here. As of this slice the honest answer is mostly no, and the reason is measured: latencyReport() reports how far apart consecutive planned traces land against the 1,800-10,800 sim-second window signalEngine decays a signal over.'
    }
  ];

  /* ==========================================================================
     WHERE A STEP COULD EVER FIRE.

     A plan over a place a truck can never be observed at is a plan that can
     never happen, and it would read in every report as an actor who did nothing
     -- indistinguishable from an actor with no plan. So the target is drawn from
     a table computed out of the topology rather than from the node list.

     Both halves come from journeyEngine's enumeration of the drive, not from a
     sample: `stagesByNode` for the stages a node can hold, and a walk of every
     route in both directions for the stage held on each leg INTO a node. Both
     are then intersected with the stages behaviorEngine will roll a disruption
     in, which is HANDED IN rather than read -- the two tables live in two
     modules and behaviorEngine loads second, and a guard that reads a private
     constant cannot be made to fire (convention 34).

     A useful consequence, and the tie-in to Slice 72's declared finding: the
     three nodes DISRUPTION_REACH reports as unobservable (both port cross-docks
     and Yard 3, none of which any route passes THROUGH) fall out of this table
     by themselves. An actor cannot plan an act at a place this build would never
     write anything down about.
     ========================================================================== */
  function assertEligibleStages(lifecycle, eligibleStages) {
    const { JE } = requireGraph('the eligible-stage check');
    const list = JE.assertLifecycle(lifecycle);
    const stages = eligibleStages instanceof Set ? Array.from(eligibleStages) : (eligibleStages || []).slice();
    if (!stages.length) {
      throw new Error('intentEngine: no disruption-eligible stages given, so every step of every plan would be ' +
        'reported as impossible and the table would say nothing about this build.');
    }
    const unknown = stages.filter(s => list.indexOf(s) < 0);
    if (unknown.length) {
      throw new Error('intentEngine: stage(s) ' + unknown.join(', ') + ' are not in the lifecycle (' +
        list.join(', ') + '). A plan gated on a stage nothing can hold can never fire while reading like a plan.');
    }
    return { list: list, stages: stages, set: new Set(stages) };
  }

  function nodeAffordances(lifecycle, eligibleStages, sampleSeconds) {
    const { JE, WG } = requireGraph('the target table');
    const checked = assertEligibleStages(lifecycle, eligibleStages);
    const sample = sampleSeconds === undefined ? MOVEMENT_SAMPLE_SECONDS : sampleSeconds;
    if (!(sample > 0)) {
      throw new Error('intentEngine.nodeAffordances: the movement sample interval is ' + JSON.stringify(sample) +
        '. With no interval, an approach of any length reads as long enough to act on, and a step waiting in a ' +
        '90 sim-second doorway would be declared feasible.');
    }
    const byNode = JE.stagesByNode(checked.list);
    const approach = {};
    const approachSeconds = {};
    JE.routes().forEach(r => JE.DIRECTIONS.forEach(d => {
      const pass = JE.routePass(checked.list, r.id, d);
      JE.legsOf(r.id, d).forEach((leg, i) => {
        approach[leg.to] = approach[leg.to] || [];
        if (approach[leg.to].indexOf(pass.onLeg[i]) < 0) approach[leg.to].push(pass.onLeg[i]);
        approachSeconds[leg.to] = Math.max(approachSeconds[leg.to] || 0, leg.traverseSeconds);
      });
    }));
    const rows = Object.keys(byNode).map(id => {
      const held = byNode[id].stages.filter(s => checked.set.has(s));
      const onApproach = (approach[id] || []).filter(s => checked.set.has(s));
      const seconds = approachSeconds[id] || 0;
      const sampled = seconds >= sample;
      return {
        nodeId: id, nodeType: WG.nodeType(id),
        facilities: WG.node(id).facilityNames.slice(),
        atNodeStages: held, approachStages: onApproach,
        approachSeconds: seconds, approachSampled: sampled,
        AT_NODE: held.length > 0,
        ON_LEG_INTO_NODE: onApproach.length > 0 && sampled,
        legsInto: (approach[id] || []).length
      };
    });
    const index = {};
    rows.forEach(r => { index[r.nodeId] = r; });
    const tooShort = rows.filter(r => r.approachStages.length && !r.approachSampled);
    return {
      state: 'MEASURED', nodes: rows.length, rows: rows, index: index,
      eligibleStages: checked.stages.slice(), sampleSeconds: sample,
      plannableAtNode: rows.filter(r => r.AT_NODE).map(r => r.nodeId),
      plannableOnApproach: rows.filter(r => r.ON_LEG_INTO_NODE).map(r => r.nodeId),
      approachTooShort: tooShort.map(r => ({ nodeId: r.nodeId, approachSeconds: r.approachSeconds })),
      unplannable: rows.filter(r => !r.AT_NODE && !r.ON_LEG_INTO_NODE).map(r => r.nodeId),
      note: 'A node is plannable for a step only if the stage a truck holds there, or on the leg into it, is one a ' +
        'disruption is rolled in at all. Computed from the enumerated drive over every route in both directions. ' +
        (tooShort.length
          ? 'An approach also has to last at least one ' + sample + ' sim-second movement sample, and ' +
            tooShort.length + ' node(s) fail that -- ' + tooShort.map(r => r.nodeId + ' (' +
            Math.round(r.approachSeconds) + 's)').join(', ') + ' -- because they are reached only over the ' +
            'intra-site edges worldGraph declares to be two orders of magnitude shorter than a road leg. A step ' +
            'waiting on one of those is a step the simulation may never sample the truck in.'
          : 'Every approach that carries an eligible stage lasts at least one ' + sample +
            ' sim-second movement sample.')
    };
  }

  /* Every node a given plan kind could be staged at: the node-bound tests its
     steps use must all be affordable at the same node, and the type must be one
     the kind stages itself at. AT_NODE_TYPE steps are checked against the type
     they name rather than against the target, because they are deliberately the
     weaker claim -- "whichever gate comes next" is not the target. */
  function candidateTargets(kind, affordances) {
    const k = typeof kind === 'string' ? PLAN_KINDS[kind] : kind;
    if (!k) {
      throw new Error('intentEngine.candidateTargets: "' + kind + '" is not one of the declared plan kinds (' +
        PLAN_KIND_NAMES.join(', ') + ').');
    }
    const needsAtNode = k.steps.some(s => s.test === 'AT_NODE');
    const needsApproach = k.steps.some(s => s.test === 'ON_LEG_INTO_NODE');
    return affordances.rows.filter(r => {
      if (k.targetNodeTypes && k.targetNodeTypes.indexOf(r.nodeType) < 0) return false;
      if (needsAtNode && !r.AT_NODE) return false;
      if (needsApproach && !r.ON_LEG_INTO_NODE) return false;
      return true;
    }).map(r => r.nodeId);
  }

  /* THE FEASIBILITY GUARD. Takes the plan, the lifecycle and the eligible
     stages, so a planted target, a planted test or a planted stage set can each
     make it fire. It throws rather than reports: an infeasible plan is not a gap
     in the world like DISRUPTION_REACH's blind sites, it is a plan this module
     built wrongly, and it would spend the whole run looking exactly like an
     actor who chose not to act. */
  function assertPlanFeasible(plan, lifecycle, eligibleStages, sampleSeconds) {
    const { WG } = requireGraph('the feasibility check');
    const aff = nodeAffordances(lifecycle, eligibleStages, sampleSeconds);
    if (!plan || !Array.isArray(plan.steps) || !plan.steps.length) {
      throw new Error('intentEngine.assertPlanFeasible: a plan with no steps is an actor with an intention and no ' +
        'act, which is indistinguishable in every report from an actor with no plan.');
    }
    plan.steps.forEach((step, i) => {
      const where = 'step ' + (i + 1) + ' of ' + plan.steps.length + ' (' + step.type + ', ' + step.test + ')';
      if (step.test === 'AT_NODE_TYPE') {
        const hits = aff.rows.filter(r => r.nodeType === step.nodeType && r.AT_NODE);
        if (!hits.length) {
          throw new Error('intentEngine.assertPlanFeasible: ' + where + ' of plan ' + plan.kind + ' waits at any ' +
            step.nodeType + ' node, and no node of that type in this graph holds a stage a disruption is rolled in ' +
            '(' + aff.eligibleStages.join('/') + '). That step could never fire.');
        }
        return;
      }
      const row = aff.index[step.nodeId];
      if (!row) {
        throw new Error('intentEngine.assertPlanFeasible: ' + where + ' of plan ' + plan.kind + ' names node "' +
          step.nodeId + '", which no route in this graph visits, so no truck can ever be there or on a leg into it.');
      }
      if (!row[step.test]) {
        throw new Error('intentEngine.assertPlanFeasible: ' + where + ' of plan ' + plan.kind + ' needs ' +
          step.test + ' at ' + step.nodeId + ' (a ' + row.nodeType + '), and the stages a truck holds there (' +
          ((step.test === 'AT_NODE' ? row.atNodeStages : row.approachStages).join('/') || 'none') +
          ') include none a disruption is rolled in. That step could never fire.');
      }
    });
    return { state: 'CHECKED', kind: plan.kind, steps: plan.steps.length, target: plan.targetNodeId,
      eligibleStages: aff.eligibleStages };
  }

  /* ==========================================================================
     THE PLAN UNFOLDING THROUGH THE WORLD.

     positionMatches is the whole difference between a plan and a flag. It reads
     the truck's live journey through journeyEngine.positionOf and answers
     against the step's declared test; it does not consult a counter, a tick
     number, or anything this module wrote down. An actor whose truck never goes
     near the target node never fires a step, and the misses are counted so that
     "the position gate is really gating" is a figure rather than a claim.
     ========================================================================== */
  const MISS_REASONS = {
    NO_PLAN: 'this driver holds no plan.',
    NO_JOURNEY: 'the truck has no journey, so it has no position to test.',
    STAGE_NOT_ELIGIBLE: 'the stage the truck holds is not one a disruption is rolled in, so the opportunity could not have been granted here at all.',
    WRONG_NODE: 'the truck is standing at a node, and it is not the one the step names.',
    WRONG_NODE_TYPE: 'the truck is standing at a node of a different type than the step names.',
    NOT_ON_THE_APPROACH: 'the truck is not on the leg into the node the step names.',
    ON_A_LEG: 'the step waits at a node and the truck is mid-leg on a public road.'
  };

  function positionMatches(step, truck) {
    const { JE, WG } = requireGraph('a position test');
    if (!truck || !truck.journey) return { matches: false, why: 'NO_JOURNEY' };
    const p = JE.positionOf(truck.journey);
    if (step.test === 'ON_LEG_INTO_NODE') {
      if (p.kind !== 'ON_LEG') return { matches: false, why: 'NOT_ON_THE_APPROACH', position: p };
      return { matches: p.to === step.nodeId, why: p.to === step.nodeId ? null : 'NOT_ON_THE_APPROACH', position: p };
    }
    if (p.kind !== 'AT_NODE') return { matches: false, why: 'ON_A_LEG', position: p };
    if (step.test === 'AT_NODE') {
      return { matches: p.nodeId === step.nodeId, why: p.nodeId === step.nodeId ? null : 'WRONG_NODE', position: p };
    }
    if (step.test === 'AT_NODE_TYPE') {
      const t = WG.nodeType(p.nodeId);
      return { matches: t === step.nodeType, why: t === step.nodeType ? null : 'WRONG_NODE_TYPE', position: p, nodeType: t };
    }
    throw new Error('intentEngine.positionMatches: "' + step.test + '" is not one of the declared position tests (' +
      POSITION_TEST_NAMES.join(', ') + '), so what would satisfy it is not a fact this module holds.');
  }

  /* THE VARIANT. A plan kind is a shape declared once in PLAN_KINDS; a variant
     is how one actor's copy of that shape actually gets laid out. Three exist.

       BASE         every step fires in the order PLAN_KINDS declares.
       REORDERED    every step PLAN_KINDS declares still fires -- the same set
                    of traces -- in a different sequence. The steps a plan is
                    written in are already a choice ("why the steps are spread
                    over the approach and the place" above), not a physical
                    law, so a truck's own position gate is still the only thing
                    that decides when a given step can fire; a reordered plan
                    can take longer to complete a lap, and latencyReport()
                    measures that rather than hiding it.
       ABBREVIATED  one step PLAN_KINDS declares never fires. A shorter,
                     quieter version of the same act: still enough distinct
                     types to be correlated, one fewer than the textbook shape
                     moEngine's keyword table was written against.

     This is the module's answer to a question the taxonomy asks and the
     original three plans could not: a real MO is not always executed to the
     letter, and a case that matches a known pattern imperfectly is not
     evidence of nothing, it is what moEngine's own MO_VARIANT class exists to
     name. Before this, that class only ever fired on a coincidence of signal
     reliability; nothing on the adversary side ever actually varied. Nothing
     here KNOWS about MO_VARIANT -- moEngine still classifies from its own
     keyword table over the traces on record and has never heard of this
     module -- but a REORDERED or ABBREVIATED execution is the first thing in
     this build that could earn that classification for a reason grounded in
     what the actor actually did. */
  const VARIANT_KINDS = {
    BASE: { name: 'BASE', means: 'every step fires, in the order PLAN_KINDS declares.' },
    REORDERED: { name: 'REORDERED', means: 'every step fires, in a different order than PLAN_KINDS declares.' },
    ABBREVIATED: { name: 'ABBREVIATED', means: 'one step PLAN_KINDS declares never fires.' }
  };
  const VARIANT_KIND_NAMES = Object.keys(VARIANT_KINDS);

  /* The floor a variant may never cross. Handed to assertPlansCanCorrelate as
     a literal at the call site below; declared here, once, as the number
     ABBREVIATED's own eligibility test is built against, so the two can never
     independently drift. It mirrors moEngine.MIN_SIGNAL_TYPES, which this
     module may not read at load (moEngine loads after it) -- the reconciling
     guard is assertVariantFloorMatchesCorrelation, called by the suite once
     both modules exist, the same arrangement assertSampleMatchesRunner already
     uses for simRunner's FF_CHUNK. */
  const MIN_CORRELATABLE_TYPES = 2;

  function assertVariantFloorMatchesCorrelation(minSignalTypes) {
    if (!(minSignalTypes >= 1)) {
      throw new Error('intentEngine.assertVariantFloorMatchesCorrelation: no minimum given, so the quoted floor ' +
        'would be compared against nothing and reported as agreeing.');
    }
    if (minSignalTypes !== MIN_CORRELATABLE_TYPES) {
      throw new Error('intentEngine: MIN_CORRELATABLE_TYPES is ' + MIN_CORRELATABLE_TYPES + ' and moEngine needs ' +
        minSignalTypes + ' distinct signal types to correlate a case. The ABBREVIATED variant gate has gone stale ' +
        'and may now offer a variant no execution of it could ever be correlated by anything.');
    }
    return { state: 'CHECKED', minCorrelatableTypes: MIN_CORRELATABLE_TYPES };
  }

  /* Every variant a given kind may draw. BASE and REORDERED are always
     available -- every declared kind has at least two steps, so a reorder is
     always a real permutation. ABBREVIATED is available only when dropping one
     step still clears MIN_CORRELATABLE_TYPES; every step within a kind already
     carries a distinct type (assertPlansCanCorrelate proves this at load), so
     "one fewer step" and "one fewer distinct type" are the same fact. */
  function availableVariants(kind) {
    const v = [VARIANT_KIND_NAMES[0], VARIANT_KIND_NAMES[1]];
    if (kind.steps.length - 1 >= MIN_CORRELATABLE_TYPES) v.push(VARIANT_KIND_NAMES[2]);
    return v;
  }

  /* The steps a given variant actually lays out, drawn from the same actor
     stream that chose the kind and the target -- consuming this module's own
     dedicated rng, never behaviorEngine's. BASE returns the declared order
     untouched. REORDERED draws a Fisher-Yates permutation. ABBREVIATED drops
     one step chosen uniformly from the declared list. Both draws are over the
     KIND's declared steps, never the mutated result of a previous draw, so a
     REORDERED plan is a permutation of exactly the same set ABBREVIATED would
     have chosen from. */
  function stepsForVariant(kind, variantName, rng) {
    if (variantName === 'REORDERED') {
      const order = kind.steps.map((s, i) => i);
      for (let i = order.length - 1; i > 0; i--) {
        const j = rng.int(0, i);
        const tmp = order[i]; order[i] = order[j]; order[j] = tmp;
      }
      return order.map(i => kind.steps[i]);
    }
    if (variantName === 'ABBREVIATED') {
      const dropIndex = rng.int(0, kind.steps.length - 1);
      return kind.steps.filter((s, i) => i !== dropIndex);
    }
    if (variantName !== 'BASE') {
      throw new Error('intentEngine.stepsForVariant: "' + variantName + '" is not one of the declared variants (' +
        VARIANT_KIND_NAMES.join(', ') + ').');
    }
    return kind.steps.slice();
  }

  /* HOW MANY ACTORS DRAW TWO KINDS INSTEAD OF ONE. A composite is the one
     construction in this module that does not name a single taxonomy pattern:
     it takes the steps of two declared kinds, together, and stages them as one
     act. Real MOs blend techniques -- a phantom-carrier onboarding that also
     leans on an insider tip, a seal-and-swap that also forges the milestone
     stamp a double-tender would have used -- and moEngine's own
     classifyDiscoveryDetail already has a class for exactly this shape,
     POTENTIAL_NEW_MO, which before this slice could only ever be produced by
     an unlucky spread of ordinary unplanned traces landing together, never by
     an actor whose act genuinely does not resemble one thing. Kept to one: a
     population where blended acts were common would make POTENTIAL_NEW_MO the
     baseline, not the exception it is named for. */
  const COMPOSITE_ACTOR_COUNT = 1;

  /* Merges two declared kinds into one staged act. The step SET is a union:
     both kinds' steps, in the order [A's steps, then B's], with any type both
     kinds already happen to use appearing once, not twice -- a plan cannot
     fire the same disruption type from two different steps in one pass, and a
     duplicate would just be padding that inflates stepsFired without adding a
     type moEngine could see. targetNodeTypes is the INTERSECTION of the two
     kinds' own restrictions (null meaning "no restriction", exactly as
     PLAN_KINDS already uses it), because a node hosting the composite has to
     satisfy both halves at once. Of the eleven declared kinds only
     SEAL_AND_SWAP restricts at all, so in this build the intersection is
     always either "no restriction" or SEAL_AND_SWAP's own WAREHOUSE/PORT --
     but the function does the real set intersection rather than assuming
     that stays true, because a twelfth kind with its own restriction would
     make it false silently otherwise. */
  function combineKinds(kindNameA, kindNameB) {
    const a = PLAN_KINDS[kindNameA], b = PLAN_KINDS[kindNameB];
    if (!a || !b) {
      throw new Error('intentEngine.combineKinds: "' + (a ? kindNameB : kindNameA) + '" is not one of the ' +
        'declared plan kinds (' + PLAN_KIND_NAMES.join(', ') + ').');
    }
    if (kindNameA === kindNameB) {
      throw new Error('intentEngine.combineKinds: a composite needs two DIFFERENT kinds; "' + kindNameA + '" was ' +
        'given twice, which is just that kind again, not a composite of anything.');
    }
    const seenTypes = new Set();
    const steps = [];
    a.steps.concat(b.steps).forEach(s => {
      if (seenTypes.has(s.type)) return;
      seenTypes.add(s.type);
      steps.push(s);
    });
    let targetNodeTypes;
    if (!a.targetNodeTypes) targetNodeTypes = b.targetNodeTypes ? b.targetNodeTypes.slice() : null;
    else if (!b.targetNodeTypes) targetNodeTypes = a.targetNodeTypes.slice();
    else targetNodeTypes = a.targetNodeTypes.filter(t => b.targetNodeTypes.indexOf(t) > -1);
    return {
      composedFrom: [kindNameA, kindNameB],
      resembles: [a.resembles, b.resembles],
      targetNodeTypes: targetNodeTypes,
      steps: steps
    };
  }

  /* THE ADAPTATION STREAM. adapt() (below) needs its own randomness for the
     one draw it can ever make -- which step ABBREVIATED drops, exactly the
     draw stepsForVariant already makes at boot for an actor who rolls
     ABBREVIATED there -- and it must not spend a single number from the
     stream `rng` above uses, or every draw after the first tick an actor
     adapts on would shift, taking every OTHER actor's kind/target/variant
     with it the same way widening PLAN_KINDS did in Slice 86. A second
     stream, offset by a second constant, costs nothing and keeps the two
     concerns (what is chosen at boot, what changes afterward) independent. */
  const ADAPT_SEED_OFFSET = 4133;

  /* THE DRAW. Deterministic in the seed and in nothing else: the actors, the
     kinds, the variants, the composites and the targets all come out of one
     stream created here, so the same seed produces the same actors with the
     same plans over the same nodes on every run and on every machine.

     Actors are drawn from the drivers that HOLD A TRUCK at boot, because a
     driver in the spare pool is not driving anything and a plan they cannot act
     on would be counted as an actor who did nothing. */
  function createBook(registry, seed, lifecycle, eligibleStages, opts) {
    const o = opts || {};
    const wanted = o.actorCount === undefined ? PLANNED_ACTOR_COUNT : o.actorCount;
    const affordances = nodeAffordances(lifecycle, eligibleStages, o.sampleSeconds);
    const rng = FWRng.createRng(((seed | 0) + PLAN_SEED_OFFSET) >>> 0);
    const pool = FWEntityEngine.all(registry, 'driver').filter(d => d.assignedTruckId);
    const book = {
      seed: seed, seedOffset: PLAN_SEED_OFFSET, affordances: affordances,
      sampleSeconds: affordances.sampleSeconds,
      plans: new Map(), actorIds: [], compositeActorIds: [], adaptedActorIds: [], retiredActorIds: [],
      driverPool: pool.length, wantedActors: wanted,
      /* adapt()'s own stream (Slice 89), never rng above -- see ADAPT_SEED_OFFSET. */
      adaptRng: FWRng.createRng(((seed | 0) + ADAPT_SEED_OFFSET) >>> 0),
      stepsFired: 0, misses: {}, opportunities: 0,
      note: pool.length >= wanted ? null
        : wanted + ' actors were wanted and only ' + pool.length + ' drivers hold a truck at boot, so ' +
          pool.length + ' plans were made. The shortfall is recorded rather than filled from the spare pool: a ' +
          'driver with no truck cannot act, and a plan that never fires reads like an actor who chose not to.'
    };
    const remaining = pool.slice();
    /* Kinds are drawn WITHOUT REPLACEMENT while there are kinds left. Two
       independent actors inventing the identical scheme at the identical node is
       the less likely world, and with three declared kinds and two actors,
       drawing with replacement would have left whether a given plan shape occurs
       in a run to a coin flip -- it did, on the first measured run, where both
       actors drew SPOOFED_APPROACH. This changes no rate and no probability the
       signal layer sees; it decides only which of three declared shapes the two
       draws land on. Once the kinds run out the pool refills, so an actor count
       above the number of kinds still works. */
    const kindBag = [];
    const n = Math.min(wanted, remaining.length);
    for (let i = 0; i < n; i++) {
      const driver = remaining.splice(rng.int(0, remaining.length - 1), 1)[0];
      if (!kindBag.length) PLAN_KIND_NAMES.forEach(k => kindBag.push(k));
      const kindName = o.kind || kindBag.splice(rng.int(0, kindBag.length - 1), 1)[0];
      const kind = PLAN_KINDS[kindName];
      const candidates = candidateTargets(kind, affordances);
      if (!candidates.length) {
        throw new Error('intentEngine.createBook: plan kind ' + kindName + ' can be staged at no node in this ' +
          'graph. candidateTargets returned nothing, so the draw would have to pick a place a step could never ' +
          'fire at. The plan vocabulary and the topology have to be reconciled, not worked around.');
      }
      const targetNodeId = o.targetNodeId || rng.pick(candidates);
      const avail = availableVariants(kind);
      const variantName = o.variant || avail[rng.int(0, avail.length - 1)];
      if (avail.indexOf(variantName) < 0) {
        throw new Error('intentEngine.createBook: variant ' + variantName + ' was requested for plan kind ' +
          kindName + ' and is not one of the variants available to it (' + avail.join(', ') + '). A planted ' +
          'variant this kind cannot offer would otherwise reach stepsForVariant and be built anyway.');
      }
      const variantSteps = stepsForVariant(kind, variantName, rng);
      const distinctTypes = new Set(variantSteps.map(s => s.type)).size;
      if (distinctTypes < MIN_CORRELATABLE_TYPES) {
        throw new Error('intentEngine.createBook: the ' + variantName + ' variant of ' + kindName + ' produced ' +
          distinctTypes + ' distinct disruption type(s), fewer than the ' + MIN_CORRELATABLE_TYPES + ' correlation ' +
          'needs. availableVariants should never have offered a combination this thin.');
      }
      const plan = {
        actorDriverId: driver.id,
        kind: kindName,
        variant: variantName,
        resembles: kind.resembles,
        targetNodeId: targetNodeId,
        targetNodeType: affordances.index[targetNodeId].nodeType,
        steps: variantSteps.map(s => (s.test === 'AT_NODE_TYPE'
          ? { type: s.type, test: s.test, nodeType: s.nodeType }
          : { type: s.type, test: s.test, nodeId: targetNodeId })),
        stepIndex: 0,
        state: 'ARMED',
        laps: 0,
        fired: [],
        candidatesConsidered: candidates.length,
        adapted: false, adaptedAt: null, adaptedTrigger: null, adaptedToQuieter: null
      };
      assertPlanFeasible(plan, lifecycle, eligibleStages, affordances.sampleSeconds);
      book.plans.set(driver.id, plan);
      book.actorIds.push(driver.id);
    }

    /* COMPOSITE ACTORS. Drawn from whatever remains of the same pool, after
       every single-kind actor above has already been placed, so a composite
       is never a driver who would otherwise have held an ordinary plan --
       it is a strictly additional, strictly rarer kind of actor. Two DISTINCT
       kinds are drawn uniformly and merged by combineKinds(); everything past
       that point (target draw, feasibility, correlation floor) is the same
       gate every other plan in this book has already passed. */
    const compositeWanted = o.compositeCount === undefined ? COMPOSITE_ACTOR_COUNT : o.compositeCount;
    const compositeN = Math.min(compositeWanted, remaining.length);
    for (let i = 0; i < compositeN; i++) {
      const driver = remaining.splice(rng.int(0, remaining.length - 1), 1)[0];
      let kindNameA, kindNameB;
      if (o.compositeKinds) {
        kindNameA = o.compositeKinds[0];
        kindNameB = o.compositeKinds[1];
      } else {
        kindNameA = PLAN_KIND_NAMES[rng.int(0, PLAN_KIND_NAMES.length - 1)];
        do {
          kindNameB = PLAN_KIND_NAMES[rng.int(0, PLAN_KIND_NAMES.length - 1)];
        } while (kindNameB === kindNameA);
      }
      const composed = combineKinds(kindNameA, kindNameB);
      if (composed.targetNodeTypes && !composed.targetNodeTypes.length) {
        throw new Error('intentEngine.createBook: ' + kindNameA + ' and ' + kindNameB + ' declare node-type ' +
          'restrictions with no overlap, so no node in this graph could host both halves of this composite.');
      }
      const candidates = candidateTargets(composed, affordances);
      if (!candidates.length) {
        throw new Error('intentEngine.createBook: the composite of ' + kindNameA + ' and ' + kindNameB +
          ' can be staged at no node in this graph. The plan vocabulary and the topology have to be reconciled, ' +
          'not worked around.');
      }
      const targetNodeId = o.targetNodeId || rng.pick(candidates);
      const distinctTypes = new Set(composed.steps.map(s => s.type)).size;
      if (distinctTypes < MIN_CORRELATABLE_TYPES) {
        throw new Error('intentEngine.createBook: the composite of ' + kindNameA + ' and ' + kindNameB +
          ' produced ' + distinctTypes + ' distinct disruption type(s), fewer than the ' + MIN_CORRELATABLE_TYPES +
          ' correlation needs. combineKinds should never have offered a pairing this thin.');
      }
      const plan = {
        actorDriverId: driver.id,
        kind: 'COMPOSITE',
        composite: true,
        composedFrom: composed.composedFrom,
        variant: null,
        resembles: composed.resembles,
        targetNodeId: targetNodeId,
        targetNodeType: affordances.index[targetNodeId].nodeType,
        steps: composed.steps.map(s => (s.test === 'AT_NODE_TYPE'
          ? { type: s.type, test: s.test, nodeType: s.nodeType }
          : { type: s.type, test: s.test, nodeId: targetNodeId })),
        stepIndex: 0,
        state: 'ARMED',
        laps: 0,
        fired: [],
        candidatesConsidered: candidates.length,
        /* A composite never adapts (see adapt() below): there is no declared
           variant to step down to, and inventing a fourth "quieter composite"
           shape with no textbook shape behind it is exactly the invented
           figure this codebase's own conventions refuse elsewhere. These
           fields are still declared, at their permanent no-op values, so a
           composite plan and a single-kind plan carry the same shape and
           nothing downstream has to special-case one to read the other. */
        adapted: false, adaptedAt: null, adaptedTrigger: null, adaptedToQuieter: null
      };
      assertPlanFeasible(plan, lifecycle, eligibleStages, affordances.sampleSeconds);
      book.plans.set(driver.id, plan);
      book.actorIds.push(driver.id);
      book.compositeActorIds.push(driver.id);
    }
    return book;
  }

  /* PLANTING AN EVOLVED CANDIDATE (Slice 95). createBook above draws every
     actor once, at genesis, from PLAN_KIND_NAMES -- a closed, hand-authored
     vocabulary. This is the one seam that lets a SPECIFIC plan-shaped object
     evolutionEngine proposed -- never a registered PLAN_KINDS name -- become
     a real actor's plan. It builds the exact plan shape createBook itself
     builds and runs it through the exact same feasibility gate
     (candidateTargets, assertPlanFeasible), so nothing downstream --
     behaviorEngine, signalEngine, moEngine, candidateEngine, Discovery Lab,
     adapt(), retire() -- has to know or care whether a plan came from
     PLAN_KINDS or from a mutation. lifecycle and eligibleStages are taken as
     explicit arguments rather than read off book, because book (see
     createBook above) never stores either -- createBook spends them once, at
     the assertPlanFeasible call, and keeps neither; the caller (evolution-
     runner, never this module) already holds them from its own boot and
     passes them again here, on the same terms createBook required of ITS
     caller. This function only ever refuses a driver who already holds a
     plan or a candidate the graph cannot host, and refuses rather than
     throws for the second reason, the same discipline
     evolutionEngine.checkFeasibility already applies -- an infeasible
     candidate reaching this function is the expected outcome of a search,
     not a bug in this module. */
  function plantCandidateActor(book, driverId, candidateId, kindLike, lifecycle, eligibleStages) {
    if (!book || !book.plans) {
      throw new Error('intentEngine.plantCandidateActor: no book given -- there is nowhere to plant this actor.');
    }
    if (book.plans.has(driverId)) {
      throw new Error('intentEngine.plantCandidateActor: driver "' + driverId + '" already holds a plan (' +
        book.plans.get(driverId).kind + '); planting a second plan over it would silently discard the first.');
    }
    if (!kindLike || !Array.isArray(kindLike.steps) || !kindLike.steps.length) {
      throw new Error('intentEngine.plantCandidateActor: "' + candidateId + '" carries no steps; a plan with no ' +
        'act is not something this function can feasibility-check, let alone run.');
    }
    const affordances = book.affordances;
    const candidates = candidateTargets(kindLike, affordances);
    if (!candidates.length) {
      return { ok: false, why: 'NO_FEASIBLE_TARGET', candidateId: candidateId };
    }
    const targetNodeId = candidates[0];
    const plan = {
      actorDriverId: driverId,
      kind: candidateId,
      evolved: true,
      variant: null,
      resembles: kindLike.resembles || null,
      targetNodeId: targetNodeId,
      targetNodeType: affordances.index[targetNodeId].nodeType,
      steps: kindLike.steps.map(s => (s.test === 'AT_NODE_TYPE'
        ? { type: s.type, test: s.test, nodeType: s.nodeType }
        : { type: s.type, test: s.test, nodeId: targetNodeId })),
      stepIndex: 0,
      state: 'ARMED',
      laps: 0,
      fired: [],
      candidatesConsidered: candidates.length,
      adapted: false, adaptedAt: null, adaptedTrigger: null, adaptedToQuieter: null
    };
    try {
      assertPlanFeasible(plan, lifecycle, eligibleStages, affordances.sampleSeconds);
    } catch (e) {
      return { ok: false, why: 'FEASIBILITY_CHECK_FAILED', detail: String(e && e.message || e), candidateId: candidateId };
    }
    book.plans.set(driverId, plan);
    book.actorIds.push(driverId);
    return { ok: true, plan: plan };
  }

  /* WHAT THE PLAN WANTS TO DO RIGHT NOW, asked once per granted opportunity.

     Returns null only when this driver holds no plan at all -- the ordinary case
     for six of eight trucks -- so the unplanned path stays exactly the code it
     was. Otherwise it returns a pending step with `fires` saying whether the
     world is currently in the state the plan needs. Every no is counted by
     reason, which is what makes the position gate measurable. */
  function nextStepFor(book, truck, eligibleStages) {
    if (!book || !truck) return null;
    const plan = book.plans.get(truck.driverId);
    if (!plan) return null;
    if (plan.retired) return null;
    book.opportunities += 1;
    const miss = (why) => {
      book.misses[why] = (book.misses[why] || 0) + 1;
      return { plan: plan, step: plan.steps[plan.stepIndex], stepIndex: plan.stepIndex, fires: false, why: why,
        type: null };
    };
    const eligible = eligibleStages instanceof Set ? eligibleStages : new Set(eligibleStages || []);
    if (!eligible.has(truck.status)) return miss('STAGE_NOT_ELIGIBLE');
    const step = plan.steps[plan.stepIndex];
    const m = positionMatches(step, truck);
    if (!m.matches) return miss(m.why || 'NO_JOURNEY');
    return { plan: plan, step: step, stepIndex: plan.stepIndex, fires: true, why: null, type: step.type,
      position: m.position };
  }

  /* THE ONLY WRITER of a plan's progress, and it is called AFTER the disruption
     was actually applied and recorded. A step that behaviorEngine could not
     apply (TRAILER_SWAPPED with no spare trailer in storage, say) must not
     advance the plan: the act did not happen, so the actor is still waiting to
     do it. That is why this is a separate call and not part of nextStepFor. */
  function commitStep(book, pending, timestamp, drawnType) {
    if (!book || !pending || !pending.fires) {
      throw new Error('intentEngine.commitStep: nothing fired, so there is no step to advance past. Advancing on a ' +
        'miss would make the plan a counter over ticks instead of a plan over places.');
    }
    const plan = pending.plan;
    plan.fired.push({
      stepIndex: pending.stepIndex, lap: plan.laps, type: pending.step.type, test: pending.step.test,
      nodeId: pending.step.nodeId || null, nodeType: pending.step.nodeType || null,
      atNodeId: pending.position && pending.position.kind === 'AT_NODE' ? pending.position.nodeId : null,
      at: timestamp,
      /* What the unplanned draw would have produced in this slot. Kept because
         the claim that intent is a redistribution and not an addition is only
         checkable if the thing it displaced is recorded: a step that happens to
         name the type the draw already gave changed nothing at all, and that is
         a figure rather than an argument. undefined when the caller did not say,
         which is not the same as "the same type". */
      insteadOf: drawnType === undefined ? null : drawnType,
      substituted: drawnType === undefined ? null : drawnType !== pending.step.type
    });
    plan.stepIndex += 1;
    if (plan.stepIndex >= plan.steps.length) {
      plan.stepIndex = 0;
      plan.laps += 1;
      plan.state = 'CYCLED';
    } else {
      plan.state = 'RUNNING';
    }
    book.stepsFired += 1;
    return plan;
  }

/* ==========================================================================
     THE FEEDBACK LOOP (Slice 89). Every other fact about a plan is fixed at
     boot; this is the one exception, and it exists to answer the mission
     question of whether a detection outcome ever changes what the adversary
     does next, or whether this build's fraud only ever runs open-loop. Before
     this it always ran open-loop: ASSUMPTIONS above said so in as many words.

     WHAT COUNTS AS A DETECTION WORTH REACTING TO. Not a signal on its own
     (falsePositiveEngine already shows two in three of this module's own
     traces carry a documented benign cause, so reacting to a single signal
     would be an actor with certainty no signal in this build ever earns) and
     not a bare case (moEngine opens one from as few as MIN_SIGNAL_TYPES
     distinct traces, which is correlation, not recognition). What this reacts
     to is moEngine's own classification reaching MO_VARIANT or KNOWN_MO for a
     case tied to the actor's driver -- the moment the correlation layer has
     decided the case resembles a documented pattern, whether for the first
     time or the tenth. A POTENTIAL_NEW_MO case (seen too few times for the
     count to say either way) or an EMERGING_BEHAVIOR case (matching no
     documented pattern) is left alone: neither is the correlation layer
     recognizing this actor's own shape, so reacting to either would be the
     actor knowing more than the record does.

     WHAT ADAPTING MEANS. The actor's next lap steps down to the ABBREVIATED
     variant, one fewer step and one fewer type on record, still enough to
     correlate (availableVariants already only offers ABBREVIATED where that
     holds), if it is not on that variant already and its kind has one to
     offer. \`fired\` is never rewritten: the laps already on record stay
     exactly as fired, because the point is that a real investigator would see
     the shape change, not a record with its past quietly edited. Bounded to
     one change for the actor's whole run: ABBREVIATED is the only variant
     quieter than BASE or REORDERED, so a second detection has nowhere
     quieter left to send it, and \`adapted\` being permanently true is itself
     the honest answer for that case (noticed, nothing left to do about it)
     rather than a silent no-op repeated every tick.

     THE READ THIS ADDS, AND WHY IT IS A DIFFERENT DIRECTION FROM THE ONE
     GROUND_TRUTH GUARDS. GROUND_TRUTH (above) forbids moEngine and everything
     downstream of it from ever reading the PLAN; that direction is completely
     unchanged here, moEngine still classifies from its own keyword table
     alone and still cannot see book.plans. This function reads the other
     direction: intentEngine, here, reads moEngine's classification of a case,
     which is derived evidence built from traces already on the record, not
     the plan itself. An adversary reacting to being noticed is not a leak of
     ground truth to a view; the view still never sees the plan or this
     reaction to it, and every trace this produces is exactly as visible, and
     exactly as capable of carrying a documented benign cause, as the trace it
     replaces.

     DETERMINISM. detections is handed in already reduced to plain
     {driverId, classification, caseId} triples, extracted by simRunner from
     moEngine's own state, so this module never reads moEngine's object shape
     directly, the same arm's-length arrangement DISRUPTION_ELIGIBLE_STAGES
     already uses across the behaviorEngine boundary. Which classification a
     given driver's case holds on a given tick is itself a deterministic
     function of the seed, and the ABBREVIATED dropIndex draw spends
     adaptRng, a stream offset from the seed and touched by nothing else, so
     the same seed adapts the same actors at the same tick to the same
     quieter shape on every run. */
  function adapt(book, now, detections) {
    if (!Array.isArray(detections)) {
      throw new Error('intentEngine.adapt: detections must be an array of {driverId, classification, caseId} ' +
        'triples; nothing else in this call would name which actor a case belongs to.');
    }
    const TRIGGERING = new Set(['MO_VARIANT', 'KNOWN_MO']);
    const byDriver = new Map();
    detections.forEach(d => {
      if (d && d.driverId != null && TRIGGERING.has(d.classification) && !byDriver.has(d.driverId)) {
        byDriver.set(d.driverId, d);
      }
    });
    const adaptedNow = [];
    Array.from(book.plans.keys()).sort().forEach(driverId => {
      const plan = book.plans.get(driverId);
      if (plan.adapted || plan.composite || plan.retired) return;
      const hit = byDriver.get(driverId);
      if (!hit) return;
      const kind = PLAN_KINDS[plan.kind];
      const quieterAvailable = availableVariants(kind).indexOf('ABBREVIATED') > -1 && plan.variant !== 'ABBREVIATED';
      if (quieterAvailable) {
        plan.variant = 'ABBREVIATED';
        plan.steps = stepsForVariant(kind, 'ABBREVIATED', book.adaptRng);
        plan.stepIndex = 0;
        plan.state = 'ARMED';
      }
      plan.adapted = true;
      plan.adaptedAt = now;
      plan.adaptedTrigger = { caseId: hit.caseId, classification: hit.classification };
      plan.adaptedToQuieter = quieterAvailable;
      book.adaptedActorIds.push(driverId);
      adaptedNow.push(driverId);
    });
    return adaptedNow;
  }

  /* THE SECOND TIER (Slice 93). adapt() answers one automatic detection with
     one quieter variant; retire() answers a human analyst's VALIDATED decision
     in the Discovery Lab by stopping the plan outright -- permanent, and the
     only way an actor in this build ever abandons a plan.

     SAFE DIRECTION. GROUND_TRUTH still forbids candidateEngine from ever
     reading book.plans; unchanged. This function reads the other way, exactly
     as adapt() already does from moEngine: simRunner reduces a VALIDATED
     record's provenance to plain driverIds via moEngine's own case entities,
     and hands in only those ids -- never candidateEngine's or moEngine's
     object shape. A driverId is already public everywhere else in this build,
     so nothing here leaks the plan.

     BOUNDED. Once retired, never un-retired; calling this again with the same
     id is a no-op, same contract as adapted. Composite actors CAN retire
     (unlike adapt(), retiring needs no quieter variant to exist).

     EFFECT. nextStepFor returns null for a retired driver from here on, same
     as holding no plan at all -- the truck reverts to the unplanned baseline. */
  function retire(book, now, validatedDriverIds) {
    if (!Array.isArray(validatedDriverIds)) {
      throw new Error('intentEngine.retire: validatedDriverIds must be an array of driver ids; nothing else ' +
        'in this call would name which actor a validated signature belongs to.');
    }
    const wanted = new Set(validatedDriverIds.filter(id => id != null));
    const retiredNow = [];
    Array.from(book.plans.keys()).sort().forEach(driverId => {
      const plan = book.plans.get(driverId);
      if (plan.retired || !wanted.has(driverId)) return;
      plan.retired = true;
      plan.retiredAt = now;
      plan.state = 'RETIRED';
      book.retiredActorIds.push(driverId);
      retiredNow.push(driverId);
    });
    return retiredNow;
  }

  /* ==========================================================================
     THE MEASUREMENTS. Both report, neither throws: whether a plan's traces land
     close enough together for the correlation layer to see them is a finding
     about this build, not a fault in this module, and the project convention
     (worldGraph.nodeCoverage, journeyEngine.observability) is that a measured
     gap is named with its numbers rather than turned into a failed load.
     ========================================================================== */

  /* HOW FAR APART CONSECUTIVE PLANNED TRACES LAND, against the window a signal
     survives in. This is the number that decides whether a plan is visible at
     all: moEngine opens a case from two distinct signal types that are ACTIVE at
     the same moment, and signalEngine expires a signal after its type's own
     decay. If an actor's steps land days apart, the first has expired long
     before the second arrives and the plan produces three unrelated singletons.

     The decay bounds are handed in rather than read from signalEngine, so a
     planted span can move this report and so it cannot silently measure against
     a stale copy of somebody else's table. */
  function latencyReport(book, decayBounds) {
    const b = decayBounds || {};
    if (!(b.minSeconds > 0) || !(b.maxSeconds >= b.minSeconds)) {
      throw new Error('intentEngine.latencyReport: no decay window given (minSeconds/maxSeconds). Reporting how ' +
        'far apart traces land without saying what they have to land inside of is a number with no denominator.');
    }
    const gaps = [];
    Array.from(book.plans.values()).forEach(plan => {
      for (let i = 1; i < plan.fired.length; i++) {
        gaps.push({ actorDriverId: plan.actorDriverId, kind: plan.kind,
          from: plan.fired[i - 1].type, to: plan.fired[i].type,
          seconds: plan.fired[i].at - plan.fired[i - 1].at });
      }
    });
    const within = (limit) => gaps.filter(g => g.seconds <= limit).length;
    const sorted = gaps.map(g => g.seconds).sort((x, y) => x - y);
    return {
      state: gaps.length ? 'MEASURED' : 'NO_CONSECUTIVE_TRACES',
      pairs: gaps.length,
      window: { minSeconds: b.minSeconds, maxSeconds: b.maxSeconds },
      withinShortestDecay: within(b.minSeconds),
      withinLongestDecay: within(b.maxSeconds),
      medianSeconds: sorted.length ? sorted[Math.floor(sorted.length / 2)] : null,
      minSeconds: sorted.length ? sorted[0] : null,
      maxSeconds: sorted.length ? sorted[sorted.length - 1] : null,
      gaps: gaps,
      note: gaps.length
        ? within(b.maxSeconds) + ' of ' + gaps.length + ' consecutive planned traces landed within the longest ' +
          'decay this signal catalogue has (' + b.maxSeconds + ' sim-seconds), and ' + within(b.minSeconds) +
          ' within the shortest (' + b.minSeconds + '). A pair outside the window cannot correlate, however ' +
          'deliberate the act behind it was: the second trace arrives after the first has expired.'
        : 'No actor has fired two steps yet, so there is no interval to report. This is a refusal, not a zero.'
    };
  }

  function summary(book, registry) {
    if (!book) return { state: 'NO_BOOK', note: 'this run has no intent book, so no actor in it holds a plan and ' +
      'every disruption in it is the unplanned draw. That is the whole of the pre-Slice-73 behaviour.' };
    const plans = Array.from(book.plans.values());
    const byKind = {};
    const byVariant = {};
    plans.forEach(p => {
      byKind[p.kind] = (byKind[p.kind] || 0) + 1;
      byVariant[p.variant || 'COMPOSITE'] = (byVariant[p.variant || 'COMPOSITE'] || 0) + 1;
    });
    const dormant = registry
      ? plans.filter(p => {
        const d = FWEntityEngine.get(registry, 'driver', p.actorDriverId);
        return !d || !d.assignedTruckId;
      }).map(p => p.actorDriverId)
      : null;
    const firedByType = {};
    let substituted = 0, displacementKnown = 0;
    plans.forEach(p => p.fired.forEach(f => {
      firedByType[f.type] = (firedByType[f.type] || 0) + 1;
      if (f.substituted !== null) { displacementKnown += 1; if (f.substituted) substituted += 1; }
    }));
    return {
      state: 'MEASURED',
      actors: plans.length, driverPool: book.driverPool, wantedActors: book.wantedActors,
      byKind: byKind,
      byVariant: byVariant,
      opportunities: book.opportunities,
      stepsFired: book.stepsFired,
      misses: Object.assign({}, book.misses),
      firedByType: firedByType,
      substitutedTraces: substituted, displacementRecorded: displacementKnown,
      substitutionNote: displacementKnown
        ? substituted + ' of the ' + displacementKnown + ' fired steps whose displaced draw was recorded carried a ' +
          'type the unplanned draw would not have produced. The other ' + (displacementKnown - substituted) +
          ' named the type the draw had already given, so the plan changed nothing observable in that slot.'
        : 'no fired step recorded what the unplanned draw would have been, so no displacement is being claimed.',
      laps: plans.map(p => ({ actorDriverId: p.actorDriverId, kind: p.kind, variant: p.variant,
        composite: !!p.composite, composedFrom: p.composedFrom || null, targetNodeId: p.targetNodeId,
        laps: p.laps, stepIndex: p.stepIndex, state: p.state, fired: p.fired.length, adapted: !!p.adapted, retired: !!p.retired })),
      composites: plans.filter(p => p.composite).length,
      adaptedActorIds: book.adaptedActorIds.slice(),
      adaptedNote: book.adaptedActorIds.length
        ? book.adaptedActorIds.length + ' of ' + plans.length + ' actors stepped down to a quieter variant after ' +
          'their own case reached MO_VARIANT or KNOWN_MO; see adapt().'
        : 'no actor has been detected to MO_VARIANT or KNOWN_MO yet, so none has adapted.',
      retiredActorIds: book.retiredActorIds.slice(),
      retiredNote: book.retiredActorIds.length
        ? book.retiredActorIds.length + ' of ' + plans.length + ' actors were retired after a signature ' +
          'their case contributed to was VALIDATED by an analyst; see retire().'
        : 'no signature has been VALIDATED yet, so none has retired.',
      dormantActorIds: dormant,
      dormantNote: dormant === null
        ? 'not computed: dormancy is a fact about the registry (whether the actor is holding a truck right now) and no registry was given.'
        : dormant.length + ' of ' + plans.length + ' actors are not driving anything right now, so their plans ' +
          'cannot fire until they are assigned a truck again.',
      note: book.stepsFired + ' of ' + book.opportunities + ' disruption opportunities granted to a planned actor ' +
        'were spent on that actor\'s next step; the rest fell where the plan needed a position the truck was not ' +
        'in, and are counted by reason in `misses`. An opportunity is granted by behaviorEngine at its own ' +
        'unchanged rate, so this is a redistribution of which type a trace carries and never an addition to how ' +
        'many traces there are.'
    };
  }

  /* ==========================================================================
     THE LOAD-TIME GUARDS. Each takes its input as an argument so a planted value
     can make it fire (convention 34). The first two run here; the type
     reconciliation and the feasibility sweep are called from behaviorEngine's
     load, because behaviorEngine owns the type list and the eligible-stage set
     and loads after this module -- the same arrangement
     falsePositiveEngine.assertCausesCoverTypes already uses.
     ========================================================================== */

  /* Every step's test must be declared, and every declared test must be
     answerable. A test nobody declared would fall through positionMatches to a
     throw at the first opportunity, hours into a run, instead of at load. */
  function assertPositionTestsDeclared(kinds) {
    const ks = kinds || PLAN_KINDS;
    Object.keys(ks).forEach(name => {
      ks[name].steps.forEach((step, i) => {
        const t = POSITION_TESTS[step.test];
        if (!t) {
          throw new Error('intentEngine: step ' + (i + 1) + ' of plan ' + name + ' uses position test "' +
            step.test + '", which is not declared (' + POSITION_TEST_NAMES.join(', ') + ').');
        }
        if (t.needs === 'nodeType' && !step.nodeType) {
          throw new Error('intentEngine: step ' + (i + 1) + ' of plan ' + name + ' uses ' + step.test +
            ', which needs a nodeType, and names none. A test with nothing to compare against matches everything.');
        }
      });
    });
    return { state: 'CHECKED', kinds: Object.keys(ks).length, tests: POSITION_TEST_NAMES.length };
  }

  /* A plan of one signal type cannot open a case however many times it fires,
     because moEngine requires a chain of at least MIN_SIGNAL_TYPES distinct
     kinds. A plan that structurally cannot be correlated would be intent the
     investigator has no possible route to -- not a hard finding, an impossible
     one. The minimum is handed in because moEngine owns it. */
  function assertPlansCanCorrelate(minDistinctTypes, kinds) {
    const min = minDistinctTypes;
    if (!(min >= 1)) {
      throw new Error('intentEngine.assertPlansCanCorrelate: no minimum given. With none, a one-type plan would ' +
        'pass a check that reads as though it had been compared with the correlation engine.');
    }
    const ks = kinds || PLAN_KINDS;
    const rows = Object.keys(ks).map(name => {
      const distinct = new Set(ks[name].steps.map(s => s.type));
      if (distinct.size < min) {
        throw new Error('intentEngine: plan ' + name + ' has ' + distinct.size + ' distinct disruption type(s) (' +
          Array.from(distinct).join(', ') + ') and correlation needs at least ' + min +
          ' to open a case at all, so no execution of this plan could ever be correlated by anything.');
      }
      return { kind: name, steps: ks[name].steps.length, distinctTypes: distinct.size };
    });
    return { state: 'CHECKED', minDistinctTypes: min, rows: rows };
  }

  /* Called from behaviorEngine's load. The direction that is enforced is
     enforced on purpose and only one way: every step type must be a type
     behaviorEngine can apply, so a plan can never invent a fifteenth kind of
     thing that happens. The reverse -- every type appearing in some plan --
     is not required and was not true before Slice 86, when three plans left
     five of the fourteen types unplanned. It is true now: eleven plans, one
     for each taxonomy pattern this graph can stage a trace for (see
     PLAN_KINDS), between them reach every type behaviorEngine declares. That
     does not fold the unplanned baseline into the plan vocabulary, because
     the baseline is a fact about VOLUME, not about which types are eligible:
     PLANNED_ACTOR_COUNT of the crewed drivers hold any plan at all, a step
     fires only on a position its actor is not usually in, and behaviorEngine
     still draws and discards its own unplanned type first every tick
     regardless of what any plan could have used instead. A type appearing in
     a plan changes what an opportunity CAN be spent on if a planned actor
     happens to be positioned for it; it does not change who is planned or
     how often anything happens. The used/unused split is still reported
     below, now as a figure that reads zero rather than one asserted to stay
     above zero. */
  function assertStepTypesDeclared(disruptionTypes) {
    const types = (disruptionTypes || []).slice();
    if (!types.length) {
      throw new Error('intentEngine.assertStepTypesDeclared: no disruption types given, so every step type would ' +
        'be reported as undeclared and the check would say nothing about this build.');
    }
    const used = [];
    Object.keys(PLAN_KINDS).forEach(name => PLAN_KINDS[name].steps.forEach(s => {
      if (used.indexOf(s.type) < 0) used.push(s.type);
      if (types.indexOf(s.type) < 0) {
        throw new Error('intentEngine: plan ' + name + ' has a step of type "' + s.type + '", which is not one of ' +
          'the ' + types.length + ' disruption types behaviorEngine can apply. A plan cannot introduce a fourteenth ' +
          'kind of thing that happens -- it chooses among the ones that already do.');
      }
    }));
    return { state: 'CHECKED', declaredTypes: types.length, usedByPlans: used.length,
      used: used.slice().sort(), unused: types.filter(t => used.indexOf(t) < 0).sort(),
      note: used.length + ' of the ' + types.length + ' disruption types appear in a plan.' +
        (used.length < types.length
          ? ' The other ' + (types.length - used.length) + ' only ever arrive unplanned.'
          : ' None are plan-exclusive: every type can also arrive from behaviorEngine\'s own unplanned draw, ' +
            'which is what keeps the unplanned baseline a baseline -- a fact about how many drivers hold a plan ' +
            'and how often a step fires, not about which types a plan is allowed to use.') };
  }

  /* Called from behaviorEngine's load: every declared plan kind must be stageable
     somewhere in this graph with these eligible stages, before any actor is
     drawn. Otherwise the draw is the thing that discovers it, mid-boot, for one
     seed and not another. */
  function assertKindsStageable(lifecycle, eligibleStages, sampleSeconds) {
    const aff = nodeAffordances(lifecycle, eligibleStages, sampleSeconds);
    const rows = PLAN_KIND_NAMES.map(name => {
      const candidates = candidateTargets(name, aff);
      if (!candidates.length) {
        throw new Error('intentEngine.assertKindsStageable: plan kind ' + name + ' can be staged at no node in ' +
          'this graph. Of ' + aff.nodes + ' nodes, ' + aff.plannableAtNode.length + ' hold an eligible stage and ' +
          aff.plannableOnApproach.length + ' have an eligible approach.');
      }
      return { kind: name, targets: candidates.length, candidates: candidates.slice() };
    });
    return { state: 'CHECKED', kinds: rows.length, rows: rows, sampleSeconds: aff.sampleSeconds,
      plannableAtNode: aff.plannableAtNode.slice(), unplannable: aff.unplannable.slice(),
      approachTooShort: aff.approachTooShort.slice(),
      note: 'Every plan kind has at least one node it can be staged at. The nodes that afford nothing (' +
        (aff.unplannable.join(', ') || 'none') + ') are the ones journeyEngine.observability already reports as ' +
        'unobservable, so an actor cannot plan an act at a place this build would never write anything down about.' };
  }

  /* Called by the suite once data/fraud-data.json has loaded, not at module load:
     the taxonomy arrives over fetch and this module is parsed before it. Every
     plan kind names the pattern its shape was generalized from, and a name that
     matches nothing in the taxonomy would be a citation to a document that does
     not say it. */
  function assertResemblanceResolves(patterns) {
    const ps = patterns || [];
    if (!ps.length) {
      throw new Error('intentEngine.assertResemblanceResolves: no taxonomy patterns given, so every citation would ' +
        'be reported as unresolvable and the check would say nothing.');
    }
    const rows = PLAN_KIND_NAMES.map(name => {
      const r = PLAN_KINDS[name].resembles;
      const hit = ps.filter(p => p.id === r.id)[0];
      if (!hit) {
        throw new Error('intentEngine: plan ' + name + ' says it resembles ' + r.id + ' ("' + r.name + '"), and ' +
          'the taxonomy holds no pattern with that id. A citation to a pattern that is not there is worse than none.');
      }
      if (hit.name !== r.name) {
        throw new Error('intentEngine: plan ' + name + ' cites ' + r.id + ' as "' + r.name + '" and the taxonomy ' +
          'calls it "' + hit.name + '". A stale name is how a reader ends up checking the wrong pattern.');
      }
      return { kind: name, patternId: r.id, patternName: r.name };
    });
    return { state: 'CHECKED', kinds: rows.length, rows: rows,
      note: 'Each plan names the taxonomy pattern its trace vocabulary was generalized from. This is where the ' +
        'shape came from and it is never a claim about a case: moEngine votes from its own keyword table and has ' +
        'no reference to this module.' };
  }

  /* Reconciles this module's quoted movement-sample figure against the value
     simRunner actually advances time in. Called by the suite, not at load:
     simRunner loads after this module (it is the caller that hands the real value
     to createBook), so reading FF_CHUNK here would be a load-order dependency of
     exactly the kind Slice 72 removed from behaviorEngine. */
  function assertSampleMatchesRunner(ffChunkSeconds) {
    if (!(ffChunkSeconds > 0)) {
      throw new Error('intentEngine.assertSampleMatchesRunner: no runner chunk given, so the quoted sample ' +
        'interval would be compared against nothing and reported as agreeing.');
    }
    if (ffChunkSeconds !== MOVEMENT_SAMPLE_SECONDS) {
      throw new Error('intentEngine: MOVEMENT_SAMPLE_SECONDS is ' + MOVEMENT_SAMPLE_SECONDS + ' and simRunner ' +
        'advances time in ' + ffChunkSeconds + ' sim-second chunks. The quote has gone stale, so the staging check ' +
        'behaviorEngine runs at load is admitting or refusing approaches on the wrong interval.');
    }
    return { state: 'CHECKED', sampleSeconds: MOVEMENT_SAMPLE_SECONDS };
  }

  const POSITION_TEST_DRIVE = assertPositionTestsDeclared();

  return {
    PLANNED_ACTOR_COUNT, PLAN_SEED_OFFSET, MOVEMENT_SAMPLE_SECONDS, assertSampleMatchesRunner, POSITION_TESTS, POSITION_TEST_NAMES, PLAN_KINDS, PLAN_KIND_NAMES,
    VARIANT_KINDS, VARIANT_KIND_NAMES, MIN_CORRELATABLE_TYPES, assertVariantFloorMatchesCorrelation, availableVariants, stepsForVariant,
    COMPOSITE_ACTOR_COUNT, combineKinds,
    ADAPT_SEED_OFFSET, adapt, retire,
    PLAN_STATES, MISS_REASONS, GROUND_TRUTH, ASSUMPTIONS, NOT_MODELLED, POSITION_TEST_DRIVE,
    nodeAffordances, candidateTargets, assertPlanFeasible, positionMatches,
    createBook, plantCandidateActor, nextStepFor, commitStep, latencyReport, summary,
    assertPositionTestsDeclared, assertPlansCanCorrelate, assertStepTypesDeclared, assertKindsStageable,
    assertResemblanceResolves, assertEligibleStages
  };
})();
