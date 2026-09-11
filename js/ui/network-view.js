/* ui/network-view.js — Fraud Network View (mega-spec Phase 4/43): a
   node-link diagram of entities that have co-occurred across cases
   (shared MOs). Built on top of FWNetworkEngine's graph, which is
   itself just a different lens on the same MO data the MO
   Intelligence Center already shows -- no new signal source here.

   Layout is a deliberately simple deterministic circle (nodes grouped
   by kind, sized by case count), not a physics engine -- this is a
   debug/analyst view, not a puzzle game, and a stable layout is more
   readable across ticks than nodes jittering as a naive force-layout
   would. Reputation/frequency is shown but framed the same way
   entity-inspector.js frames it: informational, never a verdict. */
const FWNetworkView = (() => {
  let els = {};
  let selectedKey = null;
  let pathAnchorKey = null;   // Phase 4 depth: origin of a multi-hop trace
  let tracedPath = null;      // result of the last completed trace

  const KIND_COLOR = {
    truck: '#38bdf8',   // sky
    driver: '#fbbf24',  // amber
    trailer: '#a78bfa', // violet
    carrier: '#34d399'  // emerald
  };

  function init() {
    els = {
      root: document.getElementById('network-view-root'),
      svg: document.getElementById('network-svg'),
      summary: document.getElementById('network-summary'),
      detail: document.getElementById('network-detail')
    };
    if (els.svg) {
      els.svg.addEventListener('click', (e) => {
        const g = e.target.closest('[data-node-key]');
        if (!g) { selectedKey = null; tracedPath = null; render(FWSimRunner.getState()); return; }
        const key = g.dataset.nodeKey;
        if (pathAnchorKey && key !== pathAnchorKey) {
          const graph = FWNetworkEngine.buildGraph(FWSimRunner.getState());
          tracedPath = {
            from: pathAnchorKey, to: key,
            result: FWNetworkEngine.shortestPath(graph, pathAnchorKey, key)
          };
          pathAnchorKey = null;
        }
        selectedKey = key;
        render(FWSimRunner.getState());
      });
    }
    if (els.detail) {
      els.detail.addEventListener('click', (e) => {
        const trace = e.target.closest('[data-trace-from]');
        if (trace) {
          pathAnchorKey = trace.dataset.traceFrom;
          tracedPath = null;
          render(FWSimRunner.getState());
          return;
        }
        if (e.target.closest('[data-clear-trace]')) {
          pathAnchorKey = null; tracedPath = null;
          render(FWSimRunner.getState());
          return;
        }
        const focus = e.target.closest('[data-focus-key]');
        if (focus) {
          selectedKey = focus.dataset.focusKey;
          render(FWSimRunner.getState());
          return;
        }
        const btn = e.target.closest('[data-open-truck]');
        if (!btn) return;
        if (window.FWEntityInspector) FWEntityInspector.show(btn.dataset.openTruck);
      });
    }
  }

  function layout(nodes) {
    // group by kind, each kind gets its own ring so the diagram reads
    // left-to-right as "who's linked to whom" rather than a hairball
    const kinds = ['truck', 'driver', 'trailer', 'carrier'];
    const groups = {};
    kinds.forEach(k => groups[k] = nodes.filter(n => n.kind === k));
    const cx = 300, cy = 220;
    const ringRadius = { truck: 150, driver: 95, trailer: 95, carrier: 150 };
    const ringAngleOffset = { truck: 0, driver: Math.PI, trailer: Math.PI, carrier: 0 };
    // trucks on the right half, carriers on the left half, drivers/trailers inner rings split too
    const positions = new Map();
    function place(list, radius, startAngle, spanAngle) {
      const n = list.length;
      list.forEach((node, i) => {
        const angle = n <= 1 ? startAngle : startAngle + (spanAngle * i) / (n - 1);
        positions.set(node.key, {
          x: cx + radius * Math.cos(angle),
          y: cy + radius * Math.sin(angle)
        });
      });
    }
    place(groups.truck, 170, -Math.PI / 2.4, Math.PI * 1.3);
    place(groups.carrier, 170, Math.PI / 1.6, Math.PI * 1.3);
    place(groups.driver, 90, -Math.PI / 2, Math.PI * 0.9);
    place(groups.trailer, 55, Math.PI / 2.2, Math.PI * 0.9);
    return positions;
  }

  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }

  function render(state) {
    if (!els.svg) return;
    const graph = FWNetworkEngine.buildGraph(state);

    if (els.summary) {
      if (!graph.nodes.length) {
        els.summary.textContent = 'No cases yet -- nothing to link.';
      } else {
        const st = FWNetworkEngine.structureSummary(graph);
        els.summary.textContent =
          `${graph.nodes.length} case-linked entities, ${graph.edges.length} connections · ` +
          `${st.total} separate group${st.total === 1 ? '' : 's'}, ${st.informative} spanning more than one case`;
      }
    }

    if (!graph.nodes.length) {
      els.svg.innerHTML = `<text x="300" y="220" text-anchor="middle" fill="#475569" font-size="13">No case-linked entities yet</text>`;
      if (els.detail) els.detail.innerHTML = '';
      return;
    }

    const positions = layout(graph.nodes);
    const neighborKeys = selectedKey ? new Set(FWNetworkEngine.neighbors(graph, selectedKey)) : null;

    // A traced path takes visual precedence over one-hop highlighting:
    // when the analyst asked "how are these two connected", the answer
    // should not compete with the neighbourhood shading.
    const pathNodeKeys = (tracedPath && tracedPath.result) ? new Set(tracedPath.result.nodes) : null;
    const pathEdgeIds = new Set();
    if (tracedPath && tracedPath.result) {
      tracedPath.result.hops.forEach(h => {
        pathEdgeIds.add(h.from < h.to ? h.from + '|' + h.to : h.to + '|' + h.from);
      });
    }

    const edgeSvg = graph.edges.map(e => {
      const pa = positions.get(e.a), pb = positions.get(e.b);
      if (!pa || !pb) return '';
      const edgeId = e.a < e.b ? e.a + '|' + e.b : e.b + '|' + e.a;
      const onPath = pathEdgeIds.has(edgeId);
      const dimmed = pathEdgeIds.size
        ? !onPath
        : (selectedKey && e.a !== selectedKey && e.b !== selectedKey);
      const w = onPath ? Math.min(3 + e.weight, 8) : Math.min(1 + e.weight * 1.2, 6);
      const opacity = dimmed ? 0.06 : (onPath ? 0.95 : 0.45);
      const stroke = onPath ? '#e879f9' : ((!dimmed && selectedKey) ? '#f87171' : '#64748b');
      return `<line data-edge-id="${esc(edgeId)}" x1="${pa.x}" y1="${pa.y}" x2="${pb.x}" y2="${pb.y}" stroke="${stroke}" stroke-width="${w}" stroke-opacity="${opacity}" />`;
    }).join('');

    const nodeSvg = graph.nodes.map(n => {
      const p = positions.get(n.key);
      if (!p) return '';
      const r = Math.min(6 + n.caseCount * 2, 18);
      const isSelected = n.key === selectedKey;
      const isNeighbor = neighborKeys && neighborKeys.has(n.key);
      const onPath = pathNodeKeys && pathNodeKeys.has(n.key);
      const isAnchor = n.key === pathAnchorKey;
      const dimmed = pathNodeKeys ? !onPath : (selectedKey && !isSelected && !isNeighbor);
      const color = KIND_COLOR[n.kind] || '#94a3b8';
      const stroke = isAnchor ? '#e879f9'
        : onPath ? '#e879f9'
        : isSelected ? '#ffffff'
        : (n.openCaseCount > 0 ? '#f87171' : '#1f2937');
      const opacity = dimmed ? 0.2 : 1;
      return `<g data-node-key="${esc(n.key)}" style="cursor:pointer" opacity="${opacity}">
        <circle cx="${p.x}" cy="${p.y}" r="${r}" fill="${color}" stroke="${stroke}" stroke-width="${(isSelected || onPath || isAnchor) ? 3 : 1.5}" />
        <text x="${p.x}" y="${p.y + r + 11}" text-anchor="middle" fill="#94a3b8" font-size="9">${esc(n.id)}</text>
      </g>`;
    }).join('');

    els.svg.innerHTML = `${edgeSvg}${nodeSvg}`;

    if (els.detail) els.detail.innerHTML = renderDetail(graph, state);
  }

  function shortLabel(graph, key) {
    const n = graph.nodes.find(x => x.key === key);
    if (!n) return esc(String(key));
    return `<span class="font-mono">${esc(n.id)}</span> <span class="text-slate-500">(${FWNetworkEngine.KIND_LABELS[n.kind] || n.kind})</span>`;
  }

  function renderTrace(graph) {
    if (pathAnchorKey) {
      return `<div class="bg-fuchsia-950/40 border border-fuchsia-800/60 rounded-lg p-2 mb-2">
        <div class="text-[11px] text-fuchsia-200 mb-0.5">Tracing from ${shortLabel(graph, pathAnchorKey)}</div>
        <div class="text-[10px] text-slate-400">Click another entity in the diagram to see the shortest chain of shared cases between them.</div>
        <button data-clear-trace="1" class="mt-1 text-[10px] px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700">Cancel trace</button>
      </div>`;
    }
    if (!tracedPath) return '';
    const { from, to, result } = tracedPath;
    if (!result) {
      return `<div class="bg-[#0b1119] border border-slate-800 rounded-lg p-2 mb-2">
        <div class="text-[11px] text-slate-300 mb-0.5">${shortLabel(graph, from)} → ${shortLabel(graph, to)}</div>
        <div class="text-[10px] text-amber-300/80">${FWNetworkEngine.pathCaveat(null)}</div>
        <button data-clear-trace="1" class="mt-1 text-[10px] px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700">Clear</button>
      </div>`;
    }
    const hops = result.hops.map((h, i) => `
      <li class="mb-0.5">
        <span class="text-slate-500">${i + 1}.</span> ${shortLabel(graph, h.from)} — ${shortLabel(graph, h.to)}
        <div class="text-[10px] text-slate-500 ml-3">via ${h.viaMoIds.length} shared case${h.viaMoIds.length === 1 ? '' : 's'}: ${h.viaMoIds.map(esc).join(', ')}</div>
      </li>`).join('');
    return `<div class="bg-fuchsia-950/30 border border-fuchsia-900/50 rounded-lg p-2 mb-2">
      <div class="text-[11px] text-fuchsia-200 mb-1">${result.hopCount} hop${result.hopCount === 1 ? '' : 's'}: ${shortLabel(graph, from)} → ${shortLabel(graph, to)}</div>
      <ol class="text-[11px] text-slate-300 mb-1">${hops}</ol>
      <div class="text-[10px] text-amber-300/80">${FWNetworkEngine.pathCaveat(result)}</div>
      <button data-clear-trace="1" class="mt-1 text-[10px] px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700">Clear trace</button>
    </div>`;
  }

  const STRUCTURE_TONE = {
    RECURRING_PAIR: 'border-amber-800/60',
    MULTI_CASE_CLUSTER: 'border-slate-700',
    SINGLE_CASE_ARTEFACT: 'border-slate-800'
  };

  function renderStructures(graph) {
    const list = FWNetworkEngine.structures(graph);
    if (!list.length) return '';
    const sum = FWNetworkEngine.structureSummary(graph);
    const rows = list.slice(0, 6).map(st => {
      const kinds = Object.keys(st.kinds).map(k => `${st.kinds[k]} ${k}${st.kinds[k] > 1 ? 's' : ''}`).join(', ');
      const pairs = st.recurringPairs.map(pr =>
        `<div class="text-[10px] text-amber-300/80 ml-1">${shortLabel(graph, pr.a)} + ${shortLabel(graph, pr.b)} — together in ${pr.caseCount} separate cases</div>`).join('');
      const bridges = st.bridgeKeys.length
        ? `<div class="text-[10px] text-slate-500 ml-1">everything in this group routes through ${st.bridgeKeys.map(k => shortLabel(graph, k)).join(', ')}</div>`
        : '';
      return `<div class="bg-[#0b1119] border ${STRUCTURE_TONE[st.classification]} rounded-lg p-2 mb-1.5">
        <div class="flex items-center justify-between mb-0.5">
          <span class="text-[11px] ${st.informative ? 'text-slate-200' : 'text-slate-500'}">${FWNetworkEngine.STRUCTURE_LABEL[st.classification]}</span>
          <span class="text-[10px] font-mono text-slate-500">${st.size} entities · ${st.caseCount} case${st.caseCount === 1 ? '' : 's'}</span>
        </div>
        <div class="text-[10px] text-slate-500">${kinds}${st.openCaseCount ? ` · ${st.openCaseCount} open` : ''}</div>
        ${pairs}${bridges}
        <div class="text-[10px] text-slate-600 mt-0.5">${FWNetworkEngine.STRUCTURE_NOTE[st.classification]}</div>
        <button data-focus-key="${esc(st.memberKeys[0])}" class="mt-1 text-[10px] px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700">Focus this group</button>
      </div>`;
    }).join('');
    return `<div class="mt-2">
      <div class="text-[10px] font-semibold text-slate-500 uppercase mb-1">Structure across cases</div>
      <p class="text-[10px] text-slate-500 mb-1.5">${sum.artefacts} of ${sum.total} group${sum.total === 1 ? '' : 's'} come from a single case. Those shapes are produced by how this graph is built -- every entity in a case is linked to every other -- so they are listed last and mean nothing on their own.</p>
      ${rows}
    </div>`;
  }

  function renderDetail(graph, state) {
    const trace = renderTrace(graph);
    if (!selectedKey) {
      const repeats = FWNetworkEngine.repeatEntities(graph, 2);
      if (!repeats.length) {
        return trace + `<p class="text-[11px] text-slate-500">Click a node to see its linked cases and connections. No entity has appeared in 2+ cases yet.</p>` + renderStructures(graph);
      }
      const rows = repeats.slice(0, 8).map(n =>
        `<li><span class="font-mono">${esc(n.id)}</span> <span class="text-slate-500">(${FWNetworkEngine.KIND_LABELS[n.kind]})</span> — ${n.caseCount} cases${n.openCaseCount ? `, <span class="text-amber-400">${n.openCaseCount} open</span>` : ''}</li>`
      ).join('');
      return trace + `<p class="text-[11px] text-slate-500 mb-1">Click a node for detail. Entities appearing in 2+ cases:</p><ul class="text-[11px] text-slate-300 space-y-0.5 list-disc list-inside">${rows}</ul>` + renderStructures(graph);
    }

    const node = graph.nodes.find(n => n.key === selectedKey);
    if (!node) return trace;
    const neigh = FWNetworkEngine.neighbors(graph, selectedKey)
      .map(k => graph.nodes.find(n => n.key === k))
      .filter(Boolean);
    const neighRows = neigh.map(n => `<li><span class="font-mono">${esc(n.id)}</span> <span class="text-slate-500">(${FWNetworkEngine.KIND_LABELS[n.kind]})</span></li>`).join('');

    const viewBtn = node.kind === 'truck'
      ? `<button data-open-truck="${esc(node.id)}" id="network-open-truck-btn" class="mt-2 text-[11px] px-2 py-1 rounded bg-sky-700 hover:bg-sky-600 text-white">Open in Entity Inspector →</button>`
      : '';

    return trace + `
      <div class="text-xs text-white font-semibold mb-1">${esc(node.id)} <span class="text-slate-500 font-normal">(${FWNetworkEngine.KIND_LABELS[node.kind]})</span></div>
      <div class="text-[11px] text-slate-400 mb-2">${node.caseCount} case${node.caseCount === 1 ? '' : 's'}${node.openCaseCount ? `, ${node.openCaseCount} currently open` : ', none currently open'}</div>
      <div class="text-[10px] font-semibold text-slate-500 uppercase mb-1">Linked entities (${neigh.length})</div>
      <ul class="text-[11px] text-slate-300 space-y-0.5 list-disc list-inside mb-1">${neighRows || '<li class="text-slate-600 list-none">none</li>'}</ul>
      <button data-trace-from="${esc(node.key)}" class="mt-2 mr-1 text-[11px] px-2 py-1 rounded bg-fuchsia-800 hover:bg-fuchsia-700 text-white">Trace path from here</button>
      ${viewBtn}
      <p class="text-[10px] text-slate-600 italic mt-2">Appearing in multiple cases is informational, not proof -- see the Entity Inspector for full case-by-case outcomes.</p>
    ` + renderStructures(graph);
  }

  return { init, render };
})();
