/* charts.js — scoreboard visuals, Chart.js */
const FWCharts = (() => {
  let decisionsChart, categoryChart;
  const catOrder = ['cargo_loss','contractual','digital','documentary','financial','identity','insider','regulatory'];
  const catLabel = c => c.replace('_', ' ');

  function init() {
    const dCtx = document.getElementById('chart-decisions');
    const cCtx = document.getElementById('chart-categories');

    decisionsChart = new Chart(dCtx, {
      type: 'doughnut',
      data: {
        /* Three arcs, not two. The third is every shipment that reached the
           gate with no call made: it is not a variety of getting it wrong, so
           it gets the neutral slate rather than the red. Labels come from
           FWGame so the chart cannot drift from the panel beside it. */
        labels: FWGame.RESOLUTION.map(k => FWGame.RESOLUTION_LABEL[k]),
        datasets: [{
          data: FWGame.RESOLUTION.map(() => 0),
          backgroundColor: ['#34d399', '#f87171', '#64748b'],
          borderWidth: 0
        }]
      },
      options: {
        plugins: { legend: { position: 'bottom', labels: { color: '#cbd5e1', boxWidth: 12 } } },
        cutout: '65%'
      }
    });

    categoryChart = new Chart(cCtx, {
      type: 'bar',
      data: {
        labels: catOrder.map(catLabel),
        datasets: [{
          label: 'Caught',
          data: catOrder.map(() => 0),
          backgroundColor: catOrder.map(c => FW.categoryColor(c))
        }]
      },
      options: {
        indexAxis: 'y',
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: '#94a3b8', stepSize: 1 }, grid: { color: '#1c2531' } },
          y: { ticks: { color: '#cbd5e1' }, grid: { display: false } }
        }
      }
    });
  }

  /* `resolutions` is FWGame.tallyResolutions() -- already sum-asserted there.
     This module reads the buckets, it never rebuilds them. */
  function update(stats, resolutions) {
    if (!resolutions) throw new Error('FWCharts.update: needs the resolution tally; a two-way correct/incorrect split has no bucket for a shipment nobody called.');
    decisionsChart.data.datasets[0].data = FWGame.RESOLUTION.map(k => resolutions[k]);
    decisionsChart.update();
    categoryChart.data.datasets[0].data = catOrder.map(c => stats.categoryCaught[c] || 0);
    categoryChart.update();
  }

  return { init, update, catOrder };
})();
