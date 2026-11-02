'use strict';

function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, function (character) {
    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character];
  });
}

function buildChartSvg(a) {
  const width = 1000, height = 560, left = 92, right = 36, top = 76, bottom = 132;
  const plotWidth = width - left - right, plotHeight = height - top - bottom;
  const values = a.values.map(Number);
  const rawMin = Math.min(0, ...values), rawMax = Math.max(0, ...values);
  const span = rawMax - rawMin || 1;
  const min = rawMin - span * 0.08, max = rawMax + span * 0.12;
  const y = value => top + ((max - value) / (max - min)) * plotHeight;
  const zeroY = y(0), step = plotWidth / values.length;
  const fmt = value => Number(value).toLocaleString('en-US', { maximumFractionDigits: 2 });
  const grid = [];
  for (let i = 0; i <= 5; i++) {
    const value = max - ((max - min) * i / 5), yy = y(value);
    grid.push('<line x1="' + left + '" y1="' + yy + '" x2="' + (width - right) + '" y2="' + yy + '" stroke="#e2e8f0"/>' +
      '<text x="' + (left - 14) + '" y="' + (yy + 5) + '" text-anchor="end" font-size="13" fill="#475569">' + escapeXml(fmt(value)) + '</text>');
  }
  let marks = '';
  if (a.type === 'bar') {
    marks = values.map((value, index) => {
      const barWidth = Math.min(62, step * 0.62);
      const x = left + step * index + (step - barWidth) / 2;
      const valueY = y(value), barY = Math.min(zeroY, valueY);
      const barHeight = Math.max(1, Math.abs(zeroY - valueY));
      const labelY = value >= 0 ? Math.max(top + 14, barY - 9) : Math.min(top + plotHeight - 4, barY + barHeight + 18);
      const fill = value < 0 ? '#ef4444' : '#3b82f6';
      return '<rect x="' + x + '" y="' + barY + '" width="' + barWidth + '" height="' + barHeight + '" rx="5" fill="' + fill + '"/>' +
        '<text x="' + (x + barWidth / 2) + '" y="' + labelY + '" text-anchor="middle" font-size="13" font-weight="600" fill="#0f172a">' + escapeXml(fmt(value)) + '</text>';
    }).join('');
  } else {
    const points = values.map((value, index) => (left + step * (index + 0.5)) + ',' + y(value)).join(' ');
    marks = '<polyline points="' + points + '" fill="none" stroke="#2563eb" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>' +
      values.map((value, index) => {
        const cx = left + step * (index + 0.5), cy = y(value);
        return '<circle cx="' + cx + '" cy="' + cy + '" r="5" fill="#2563eb"/>' +
          '<text x="' + cx + '" y="' + (cy - 13) + '" text-anchor="middle" font-size="12" fill="#0f172a">' + escapeXml(fmt(value)) + '</text>';
      }).join('');
  }
  const labels = a.labels.map((label, index) => {
    const x = left + step * (index + 0.5), yy = height - bottom + 28;
    return '<text x="' + x + '" y="' + yy + '" text-anchor="end" transform="rotate(-32 ' + x + ' ' + yy + ')" font-size="13" fill="#334155">' + escapeXml(String(label).slice(0, 36)) + '</text>';
  }).join('');
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-labelledby="chart-title chart-desc">' +
    '<title id="chart-title">' + escapeXml(a.title || 'Pelex chart') + '</title>' +
    '<desc id="chart-desc">' + escapeXml(a.type) + ' chart with ' + values.length + ' data points.</desc>' +
    '<rect width="100%" height="100%" rx="18" fill="#ffffff"/>' +
    '<text x="' + (width / 2) + '" y="38" text-anchor="middle" font-size="23" font-weight="700" fill="#0f172a">' + escapeXml(a.title || 'Chart') + '</text>' +
    grid.join('') + '<line x1="' + left + '" y1="' + zeroY + '" x2="' + (width - right) + '" y2="' + zeroY + '" stroke="#64748b" stroke-width="1.5"/>' +
    marks + labels + '</svg>';
}

module.exports = {
  name: 'chart_tool',
  description: 'Create and DISPLAY a real bar or line chart in the Pelex chat from supplied numerical data. This tool visualizes data; it does NOT fetch market prices or verify statistics. For current financial/market charts, first use web_search to obtain dated, sourced figures, then chart only those verified figures. Never invent or estimate missing values. If chart creation fails, explain the failure and do not claim an image was attached.',
  parameters: {
    type: 'object',
    properties: {
      type: { type: 'string', enum: ['bar', 'line'], description: 'Chart type.' },
      title: { type: 'string', description: 'Short chart title.' },
      labels: { type: 'array', items: { type: 'string' }, description: 'One label per numeric value.' },
      values: { type: 'array', items: { type: 'number' }, description: 'Finite numeric values, in the same order as labels.' }
    },
    required: ['type', 'labels', 'values']
  },
  label: a => 'Generating ' + (a.type || 'data') + ' chart',
  async run(a, ctx) {
    if (!a || !['bar', 'line'].includes(a.type)) throw new Error('Chart type must be bar or line.');
    if (!Array.isArray(a.labels) || !Array.isArray(a.values) || a.labels.length < 1 || a.labels.length !== a.values.length || a.labels.length > 40) {
      throw new Error('Provide between 1 and 40 matching labels and values.');
    }
    const labels = a.labels.map(label => String(label == null ? '' : label).trim());
    const values = a.values.map(Number);
    if (labels.some(label => !label) || values.some(value => !Number.isFinite(value))) {
      throw new Error('Every label must be non-empty and every chart value must be a finite number.');
    }
    if (!ctx || typeof ctx.saveFile !== 'function') throw new Error('Chart image storage is unavailable on the server.');
    const title = String(a.title || 'Pelex chart').slice(0, 100);
    const svg = buildChartSvg({ type: a.type, title, labels, values });
    const file = await ctx.saveFile({
      name: 'pelex-chart.svg',
      mime: 'image/svg+xml',
      bytes: Buffer.from(svg, 'utf8'),
      folder: 'files'
    });
    return {
      text: 'The ' + a.type + ' chart "' + title + '" has been generated and attached below. It contains ' + values.length + ' input values. The chart image link is available for 48 hours.',
      markdown: '![' + title + '](' + file.url + ')'
    };
  }
};
