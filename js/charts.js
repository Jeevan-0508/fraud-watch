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
        labels: ['Correct', 'Incorrect'],
        datasets: [{ data: [0, 0], backgroundColor: ['#34d399', '#f87171'], borderWidth: 0 }]
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

  function update(stats) {
    decisionsChart.data.datasets[0].data = [stats.correct, stats.incorrect];
    decisionsChart.update();
    categoryChart.data.datasets[0].data = catOrder.map(c => stats.categoryCaught[c] || 0);
    categoryChart.update();
  }

  return { init, update, catOrder };
})();
