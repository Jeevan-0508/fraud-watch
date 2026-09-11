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
  const KIND_LABELS = { truck: 'Truck', driver: 'Driver', trailer: 'Trailer', carrier: 'Carrier' };

  function entitiesOf(mo) {
    const e = mo.entities || {};
    const list = [];
    if (e.truckId) list.push({ kind: 'truck', id: e.truckId });
    if (e.driverId) list.push({ kind: 'driver', id: e.driverId });
    if (e.trailerId) list.push({ kind: 'trailer', id: e.trailerId });
    if (e.carrierId) list.push({ kind: 'carrier', id: e.carrierId });
    return list;
  }

  function nodeKey(kind, id) { return `${kind}:${id}`; }

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
          nodes.set(key, { key, kind, id, label: id, caseCount: 0, openCaseCount: 0, moIds: new Set() });
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
  function repeatEntities(graph, minCases = 2) {
    return graph.nodes.filter(n => n.caseCount >= minCases);
  }

  return { buildGraph, neighbors, repeatEntities, nodeKey, KIND_LABELS };
})();
