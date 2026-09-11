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
        if (!g) { selectedKey = null; render(FWSimRunner.getState()); return; }
        selectedKey = g.dataset.nodeKey;
        render(FWSimRunner.getState());
      });
    }
    if (els.detail) {
      els.detail.addEventListener('click', (e) => {
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
      els.summary.textContent = graph.nodes.length
        ? `${graph.nodes.length} case-linked entities, ${graph.edges.length} connections`
        : 'No cases yet -- nothing to link.';
    }

    if (!graph.nodes.length) {
      els.svg.innerHTML = `<text x="300" y="220" text-anchor="middle" fill="#475569" font-size="13">No case-linked entities yet</text>`;
      if (els.detail) els.detail.innerHTML = '';
      return;
    }

    const positions = layout(graph.nodes);
    const neighborKeys = selectedKey ? new Set(FWNetworkEngine.neighbors(graph, selectedKey)) : null;

    const edgeSvg = graph.edges.map(e => {
      const pa = positions.get(e.a), pb = positions.get(e.b);
      if (!pa || !pb) return '';
      const dimmed = selectedKey && e.a !== selectedKey && e.b !== selectedKey;
      const w = Math.min(1 + e.weight * 1.2, 6);
      const opacity = dimmed ? 0.08 : 0.45;
      const stroke = (!dimmed && selectedKey) ? '#f87171' : '#64748b';
      return `<line x1="${pa.x}" y1="${pa.y}" x2="${pb.x}" y2="${pb.y}" stroke="${stroke}" stroke-width="${w}" stroke-opacity="${opacity}" />`;
    }).join('');

    const nodeSvg = graph.nodes.map(n => {
      const p = positions.get(n.key);
      if (!p) return '';
      const r = Math.min(6 + n.caseCount * 2, 18);
      const isSelected = n.key === selectedKey;
      const isNeighbor = neighborKeys && neighborKeys.has(n.key);
      const dimmed = selectedKey && !isSelected && !isNeighbor;
      const color = KIND_COLOR[n.kind] || '#94a3b8';
      const stroke = isSelected ? '#ffffff' : (n.openCaseCount > 0 ? '#f87171' : '#1f2937');
      const opacity = dimmed ? 0.25 : 1;
      return `<g data-node-key="${esc(n.key)}" style="cursor:pointer" opacity="${opacity}">
        <circle cx="${p.x}" cy="${p.y}" r="${r}" fill="${color}" stroke="${stroke}" stroke-width="${isSelected ? 3 : 1.5}" />
        <text x="${p.x}" y="${p.y + r + 11}" text-anchor="middle" fill="#94a3b8" font-size="9">${esc(n.id)}</text>
      </g>`;
    }).join('');

    els.svg.innerHTML = `${edgeSvg}${nodeSvg}`;

    if (els.detail) els.detail.innerHTML = renderDetail(graph, state);
  }

  function renderDetail(graph, state) {
    if (!selectedKey) {
      const repeats = FWNetworkEngine.repeatEntities(graph, 2);
      if (!repeats.length) {
        return `<p class="text-[11px] text-slate-500">Click a node to see its linked cases and connections. No entity has appeared in 2+ cases yet.</p>`;
      }
      const rows = repeats.slice(0, 8).map(n =>
        `<li><span class="font-mono">${esc(n.id)}</span> <span class="text-slate-500">(${FWNetworkEngine.KIND_LABELS[n.kind]})</span> — ${n.caseCount} cases${n.openCaseCount ? `, <span class="text-amber-400">${n.openCaseCount} open</span>` : ''}</li>`
      ).join('');
      return `<p class="text-[11px] text-slate-500 mb-1">Click a node for detail. Entities appearing in 2+ cases:</p><ul class="text-[11px] text-slate-300 space-y-0.5 list-disc list-inside">${rows}</ul>`;
    }

    const node = graph.nodes.find(n => n.key === selectedKey);
    if (!node) return '';
    const neigh = FWNetworkEngine.neighbors(graph, selectedKey)
      .map(k => graph.nodes.find(n => n.key === k))
      .filter(Boolean);
    const neighRows = neigh.map(n => `<li><span class="font-mono">${esc(n.id)}</span> <span class="text-slate-500">(${FWNetworkEngine.KIND_LABELS[n.kind]})</span></li>`).join('');

    const viewBtn = node.kind === 'truck'
      ? `<button data-open-truck="${esc(node.id)}" id="network-open-truck-btn" class="mt-2 text-[11px] px-2 py-1 rounded bg-sky-700 hover:bg-sky-600 text-white">Open in Entity Inspector →</button>`
      : '';

    return `
      <div class="text-xs text-white font-semibold mb-1">${esc(node.id)} <span class="text-slate-500 font-normal">(${FWNetworkEngine.KIND_LABELS[node.kind]})</span></div>
      <div class="text-[11px] text-slate-400 mb-2">${node.caseCount} case${node.caseCount === 1 ? '' : 's'}${node.openCaseCount ? `, ${node.openCaseCount} currently open` : ', none currently open'}</div>
      <div class="text-[10px] font-semibold text-slate-500 uppercase mb-1">Linked entities (${neigh.length})</div>
      <ul class="text-[11px] text-slate-300 space-y-0.5 list-disc list-inside mb-1">${neighRows || '<li class="text-slate-600 list-none">none</li>'}</ul>
      ${viewBtn}
      <p class="text-[10px] text-slate-600 italic mt-2">Appearing in multiple cases is informational, not proof -- see the Entity Inspector for full case-by-case outcomes.</p>
    `;
  }

  return { init, render };
})();
