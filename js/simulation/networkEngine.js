/* simulation/networkEngine.js — builds the fraud/entity co-occurrence
   graph behind the Network View (mega-spec Phase 4/43). Pure logic,
   no DOM, no rendering.

   The graph is deliberately built ONLY from real MOs that already
   exist -- it is a different view of the same case data the MO
   Intelligence Center shows, not a new signal source. An edge between
   two entities means "these two co-occurred in at least one case," a
   fact about the simulation's own history, not an accusation. A truck
   and driver linked by one long-closed FALSE_POSITIVE case looks
   identical in shape to one linked by an open ESCALATED case -- the
   UI layer decides how to color that, this module just counts. */
const FWNetworkEngine = (() => {
  const KIND_LABELS = { truck: 'Truck', driver: 'Driver', trailer: 'Trailer', carrier: 'Carrier', facility: 'Site' };

  // STRUCTURAL KINDS (Phase 5). A site is not a participant in a case the
  // way a driver is. Every movement in the port passes through one of a
  // handful of gates, docks and yards, so a site node is connected to
  // almost everything the moment there are more than a couple of cases.
  // Its degree measures traffic, not involvement, and left unhandled it
  // does something actively misleading: it merges every separate group in
  // this graph into one component via a gatehouse, so the structure list
  // would report a single sprawling cluster and call it informative.
  //
  // This is the same class of error as the single-case clique below -- a
  // shape guaranteed by the construction being read as a finding -- so it
  // gets the same treatment. Sites stay in the graph, drawn and
  // clickable, and are excluded from: repeat-entity callouts, bridge
  // findings, and structure classification. The number of groups they
  // merge is reported instead, because that number describes the port's
  // layout and not these cases.
  const STRUCTURAL_KINDS = ['facility'];

  const STRUCTURAL_NOTE =
    'Sites are shown but excluded from the structure and repeat-entity analysis. Every movement passes through a handful of gates, docks and yards, so a site connects to nearly everything by construction: including them would merge unrelated groups into one cluster and make the port\'s layout look like a relationship.';

  function entitiesOf(mo) {
    const e = mo.entities || {};
    const list = [];
    if (e.truckId) list.push({ kind: 'truck', id: e.truckId });
    if (e.driverId) list.push({ kind: 'driver', id: e.driverId });
    if (e.trailerId) list.push({ kind: 'trailer', id: e.trailerId });
    if (e.carrierId) list.push({ kind: 'carrier', id: e.carrierId });
    // Every site any of this case's signals was observed at, not one
    // chosen site: moEngine deliberately refuses to collapse a case
    // spread across three sites into a single location, so this graph
    // must not do it either.
    (mo.sites || []).forEach(st => {
      if (st && st.facilityId) list.push({ kind: 'facility', id: st.facilityId });
    });
    return list;
  }

  function nodeKey(kind, id) { return `${kind}:${id}`; }

  function kindOfKey(key) { return String(key).split(':')[0]; }

  function isStructuralKind(kind) { return STRUCTURAL_KINDS.indexOf(kind) >= 0; }

  function isStructuralKey(key) { return isStructuralKind(kindOfKey(key)); }

  // The graph with structural nodes and their edges removed -- the
  // subgraph every structural claim below is actually computed on.
  function coreGraph(graph) {
    if (!graph) return { nodes: [], edges: [] };
    return {
      nodes: graph.nodes.filter(n => !isStructuralKind(n.kind)),
      edges: graph.edges.filter(e => !isStructuralKey(e.a) && !isStructuralKey(e.b))
    };
  }

  function structuralNodes(graph) {
    return (graph && graph.nodes ? graph.nodes : []).filter(n => isStructuralKind(n.kind));
  }

  function buildGraph(state) {
    const nodes = new Map(); // key -> {key, kind, id, label, caseCount, openCaseCount, moIds:Set}
    const edges = new Map(); // "keyA|keyB" (sorted) -> {a, b, weight, sharedMoIds:Set}

    if (!state || !state.moEngine) return { nodes: [], edges: [] };
    const mos = Array.from(state.moEngine.mos.values());

    mos.forEach(mo => {
      const ents = entitiesOf(mo);
      const isOpen = FWMoEngine.OPEN_STATUSES.has(mo.status);

      ents.forEach(({ kind, id }) => {
        const key = nodeKey(kind, id);
        if (!nodes.has(key)) {
          nodes.set(key, { key, kind, id, label: id, caseCount: 0, openCaseCount: 0, moIds: new Set(), structural: isStructuralKind(kind) });
        }
        const n = nodes.get(key);
        if (!n.moIds.has(mo.id)) {
          n.moIds.add(mo.id);
          n.caseCount++;
          if (isOpen) n.openCaseCount++;
        }
      });

      // connect every pair present in this MO (a clique for that case)
      for (let i = 0; i < ents.length; i++) {
        for (let j = i + 1; j < ents.length; j++) {
          const keyA = nodeKey(ents[i].kind, ents[i].id);
          const keyB = nodeKey(ents[j].kind, ents[j].id);
          const [lo, hi] = keyA < keyB ? [keyA, keyB] : [keyB, keyA];
          const edgeKey = `${lo}|${hi}`;
          if (!edges.has(edgeKey)) {
            edges.set(edgeKey, { a: lo, b: hi, weight: 0, sharedMoIds: new Set() });
          }
          const edge = edges.get(edgeKey);
          if (!edge.sharedMoIds.has(mo.id)) {
            edge.sharedMoIds.add(mo.id);
            edge.weight++;
          }
        }
      }
    });

    const nodeList = Array.from(nodes.values())
      .map(n => ({ ...n, moIds: Array.from(n.moIds) }))
      .sort((a, b) => b.caseCount - a.caseCount);

    const edgeList = Array.from(edges.values())
      .map(e => ({ ...e, sharedMoIds: Array.from(e.sharedMoIds) }))
      .sort((a, b) => b.weight - a.weight);

    return { nodes: nodeList, edges: edgeList };
  }

  // Entities connected (directly, one hop) to a given node key -- used
  // for "what's linked to this truck" highlighting.
  function neighbors(graph, key) {
    const out = new Set();
    graph.edges.forEach(e => {
      if (e.a === key) out.add(e.b);
      if (e.b === key) out.add(e.a);
    });
    return Array.from(out);
  }

  // Repeat-entity flag: an entity appearing in >=2 cases is worth a
  // visual callout (Phase 43's "who keeps showing up") -- informational,
  // never a verdict; see entity-inspector.js's reputation framing.
  // Structural nodes are excluded: "this gatehouse keeps showing up" is
  // guaranteed by the port having two gatehouses, so surfacing it as a
  // repeat entity beside a driver who appears in three cases would put a
  // fact and an artefact on the same list.
  function repeatEntities(graph, minCases = 2) {
    return graph.nodes.filter(n => !n.structural && n.caseCount >= minCases);
  }

  // ---- Phase 4 depth: paths, components, recurring structure ----
  //
  // WHY THERE IS NO "RING DETECTION" HERE. A ring implies coordination
  // between people. This graph cannot establish coordination: an edge
  // means two entities appeared in the same case, and buildGraph connects
  // every pair in a case as a clique. So a tight, dense, alarming-looking
  // cluster of four entities is the GUARANTEED output of one single case
  // involving four entities. It is an artefact of the construction, not a
  // finding. Everything below is therefore named after the structure it
  // measures, the single-case artefact is detected and labelled first so
  // it cannot be mistaken for a result, and the only structures that
  // carry any information at all are the ones spanning more than one case.

  function adjacency(graph) {
    const adj = new Map();
    graph.nodes.forEach(n => adj.set(n.key, []));
    graph.edges.forEach(e => {
      if (adj.has(e.a)) adj.get(e.a).push(e);
      if (adj.has(e.b)) adj.get(e.b).push(e);
    });
    return adj;
  }

  function otherEnd(edge, key) { return edge.a === key ? edge.b : edge.a; }

  // Shortest chain of co-occurrences between two entities. Each hop names
  // the case(s) that produced it, because a hop with no case behind it
  // would be meaningless. A path is NOT a chain of custody and NOT
  // evidence of a relationship -- see pathCaveat().
  function shortestPath(graph, fromKey, toKey) {
    if (!graph || !fromKey || !toKey) return null;
    const known = new Set(graph.nodes.map(n => n.key));
    if (!known.has(fromKey) || !known.has(toKey)) return null;
    if (fromKey === toKey) return { nodes: [fromKey], hops: [], hopCount: 0 };

    const adj = adjacency(graph);
    const prev = new Map([[fromKey, null]]);
    const queue = [fromKey];
    let found = false;
    while (queue.length && !found) {
      const cur = queue.shift();
      for (const edge of adj.get(cur) || []) {
        const next = otherEnd(edge, cur);
        if (prev.has(next)) continue;
        prev.set(next, { from: cur, edge });
        if (next === toKey) { found = true; break; }
        queue.push(next);
      }
    }
    if (!prev.has(toKey)) return null;

    const hops = [];
    let cur = toKey;
    while (prev.get(cur)) {
      const step = prev.get(cur);
      hops.unshift({
        from: step.from, to: cur,
        viaMoIds: step.edge.sharedMoIds.slice(),
        weight: step.edge.weight,
        // A hop that passes through a site means "both ends were recorded
        // at the same gate", which nearly every movement in the port is.
        // Flagged so the caveat can say so.
        viaStructural: isStructuralKey(step.from) || isStructuralKey(cur)
      });
      cur = step.from;
    }
    const nodes = [hops.length ? hops[0].from : fromKey].concat(hops.map(h => h.to));
    const structuralHops = hops.filter(h => h.viaStructural).length;
    return { nodes, hops, hopCount: hops.length, structuralHops };
  }

  function pathCaveat(path) {
    if (!path) return 'These two entities have never appeared in a case together, directly or through any chain of shared cases.';
    if (!path.hopCount) return 'Same entity.';
    const structural = path.structuralHops
      ? ` ${path.structuralHops} of these hops passes through a site, which means only that both ends were recorded at the same gate, dock or yard — nearly every movement in this port is, so those hops carry no information at all.`
      : '';
    if (path.hopCount === 1) {
      return 'One hop: these two appeared in the same case. That is a recorded co-occurrence and nothing more.' + structural;
    }
    return `${path.hopCount} hops. Each hop is one shared case, and the entities at either end of this chain may never have appeared in a case together at all. A path through a co-occurrence graph is not a relationship, not a chain of custody, and not evidence of coordination.` + structural;
  }

  // Connected components of the co-occurrence graph.
  function components(graph) {
    const adj = adjacency(graph);
    const seen = new Set();
    const out = [];
    graph.nodes.forEach(n => {
      if (seen.has(n.key)) return;
      const members = [];
      const stack = [n.key];
      seen.add(n.key);
      while (stack.length) {
        const cur = stack.pop();
        members.push(cur);
        (adj.get(cur) || []).forEach(e => {
          const next = otherEnd(e, cur);
          if (!seen.has(next)) { seen.add(next); stack.push(next); }
        });
      }
      out.push(members);
    });
    return out;
  }

  function componentCount(graph) { return components(graph).length; }

  // Nodes whose removal breaks their component into more pieces. Useful
  // navigationally ("everything here routes through this trailer") and
  // explicitly not a finding about the entity.
  // Computed on the core graph on purpose. In the full graph a gatehouse
  // is the bridge for practically everything, which is a statement about
  // where the port's gates are and would read as one about the cases.
  function bridgeNodes(graph) {
    const core = coreGraph(graph);
    const base = componentCount(core);
    const out = [];
    core.nodes.forEach(n => {
      const sub = {
        nodes: core.nodes.filter(x => x.key !== n.key),
        edges: core.edges.filter(e => e.a !== n.key && e.b !== n.key)
      };
      // removing a node always removes it from its own component, so
      // compare against the count with that single node discounted
      const expected = base - (neighbors(core, n.key).length ? 0 : 1);
      if (componentCount(sub) > expected) out.push(n.key);
    });
    return out;
  }

  // How much of the graph's apparent connectedness is just shared
  // infrastructure. Reported as a number about the port, never as a
  // structure finding.
  function structuralMerge(graph) {
    const core = coreGraph(graph);
    const coreGroups = componentCount(core);
    const withSites = componentCount(graph);
    return {
      coreGroups,
      groupsWithSitesIncluded: withSites,
      merged: Math.max(0, coreGroups - withSites),
      structuralNodeCount: structuralNodes(graph).length
    };
  }

  // Structural characterisation of each component. The classification
  // vocabulary describes SHAPE and CASE SPREAD only.
  //
  //   SINGLE_CASE_ARTEFACT  every entity here comes from one case. This is
  //                         what one case always looks like, so it carries
  //                         no information whatsoever. Reported first and
  //                         labelled loudest, precisely so a dense little
  //                         triangle never reads as a discovery.
  //   MULTI_CASE_CLUSTER    spans 2+ cases, but no single pair recurs.
  //   RECURRING_PAIR        at least one pair co-occurred in 2+ distinct
  //                         cases. The only structure here that says
  //                         anything the case list doesn't already say --
  //                         and it says "look again", not "collusion".
  function structures(graph) {
    if (!graph || !graph.nodes.length) return [];
    // Sites are excluded here (see STRUCTURAL_KINDS): with them included,
    // one gatehouse collapses every group in the port into a single
    // component and the classification below stops meaning anything.
    const core = coreGraph(graph);
    if (!core.nodes.length) return [];
    const byKey = new Map(core.nodes.map(n => [n.key, n]));
    const bridges = new Set(bridgeNodes(graph));

    return components(core).map(memberKeys => {
      const members = memberKeys.map(k => byKey.get(k)).filter(Boolean);
      const inner = core.edges.filter(e => memberKeys.includes(e.a) && memberKeys.includes(e.b));
      const moIds = new Set();
      members.forEach(m => m.moIds.forEach(id => moIds.add(id)));
      const recurringEdges = inner.filter(e => e.sharedMoIds.length >= 2);
      const possiblePairs = members.length > 1 ? (members.length * (members.length - 1)) / 2 : 0;
      const openCases = members.reduce((a, m) => a + m.openCaseCount, 0);

      let classification;
      if (recurringEdges.length) classification = 'RECURRING_PAIR';
      else if (moIds.size >= 2) classification = 'MULTI_CASE_CLUSTER';
      else classification = 'SINGLE_CASE_ARTEFACT';

      const kinds = {};
      members.forEach(m => { kinds[m.kind] = (kinds[m.kind] || 0) + 1; });

      // Sites this group's cases were observed at -- carried for context,
      // and deliberately not part of the classification above.
      const siteKeys = new Set();
      structuralNodes(graph).forEach(sn => {
        if (sn.moIds.some(id => moIds.has(id))) siteKeys.add(sn.key);
      });

      return {
        memberKeys, members, classification,
        size: members.length,
        edgeCount: inner.length,
        density: possiblePairs ? inner.length / possiblePairs : 0,
        caseCount: moIds.size,
        moIds: Array.from(moIds),
        openCaseCount: openCases,
        recurringPairs: recurringEdges.map(e => ({ a: e.a, b: e.b, caseCount: e.sharedMoIds.length, moIds: e.sharedMoIds.slice() })),
        bridgeKeys: memberKeys.filter(k => bridges.has(k)),
        siteKeys: Array.from(siteKeys),
        kinds,
        informative: classification !== 'SINGLE_CASE_ARTEFACT'
      };
    }).sort((a, b) => {
      const rank = { RECURRING_PAIR: 0, MULTI_CASE_CLUSTER: 1, SINGLE_CASE_ARTEFACT: 2 };
      if (rank[a.classification] !== rank[b.classification]) return rank[a.classification] - rank[b.classification];
      if (b.caseCount !== a.caseCount) return b.caseCount - a.caseCount;
      return b.size - a.size;
    });
  }

  const STRUCTURE_LABEL = {
    SINGLE_CASE_ARTEFACT: 'Single-case shape',
    MULTI_CASE_CLUSTER: 'Spans several cases',
    RECURRING_PAIR: 'Pair recurs across cases'
  };

  const STRUCTURE_NOTE = {
    SINGLE_CASE_ARTEFACT: 'Every entity here comes from one case, and this graph links every entity in a case to every other. So this shape is guaranteed by the construction and tells you nothing the case itself does not.',
    MULTI_CASE_CLUSTER: 'These entities are connected across more than one case, but no single pair repeats. Ordinary in a working port, where the same trailers and drivers are reassigned constantly.',
    RECURRING_PAIR: 'A pair here appeared together in more than one separate case. That is worth a second look at both cases — it is not a finding about either entity, and reassignment patterns produce this innocently.'
  };

  function structureSummary(graph) {
    const list = structures(graph);
    const byClass = { SINGLE_CASE_ARTEFACT: 0, MULTI_CASE_CLUSTER: 0, RECURRING_PAIR: 0 };
    list.forEach(s => { byClass[s.classification] = (byClass[s.classification] || 0) + 1; });
    const merge = structuralMerge(graph);
    return {
      total: list.length,
      byClass,
      informative: list.filter(s => s.informative).length,
      artefacts: byClass.SINGLE_CASE_ARTEFACT,
      structuralNodeCount: merge.structuralNodeCount,
      mergedByStructural: merge.merged,
      groupsWithSitesIncluded: merge.groupsWithSitesIncluded
    };
  }

  return {
    buildGraph, neighbors, repeatEntities, nodeKey, kindOfKey, KIND_LABELS,
    shortestPath, pathCaveat, components, componentCount, bridgeNodes,
    structures, structureSummary, STRUCTURE_LABEL, STRUCTURE_NOTE,
    STRUCTURAL_KINDS, STRUCTURAL_NOTE, isStructuralKind, isStructuralKey,
    coreGraph, structuralNodes, structuralMerge
  };
})();
