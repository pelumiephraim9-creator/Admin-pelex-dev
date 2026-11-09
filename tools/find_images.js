'use strict';

const clip = (v, n) => String(v == null ? '' : v).replace(/[\r\n]+/g, ' ').slice(0, n);
function safeHttpUrl(value) {
  try {
    const u = new URL(String(value || ''));
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : '';
  } catch (e) { return ''; }
}
const synthetic = /\b(ai[- ]?generated|illustration|illustrated|mock[- ]?up|3d render|cgi|concept art|digital art|vector art|cartoon|painting|drawing|wallpaper|infographic|simulation|weather forecast|forecast card|weather report|poster|flyer|banner|brochure|advertisement|chart|diagram|collage|template)\b/i;
const unrelatedRegion = /\b(benue|lagos|abuja|kano|kaduna|rivers|enugu|imo|osun|oyo|edo|delta|anambra|plateau|niger|kwara|sokoto|katsina|borno|yobe|adamawa|taraba|bauchi|gombe|jigawa|kebbi|zamfara|cross river|akwa ibom|bayelsa|ekiti|ogun|nasarawa|ebonyi)\b/i;

module.exports = {
  name: 'find_images',
  description: 'Search for EXISTING real-world photographs and genuine documentary images. Use for places, landmarks, buildings, streets, people, products, events, and real locations. Never substitute AI-generated art, mock-ups, illustrations, 3D renders, or synthetic satellite scenes for real photographs. For a place the user wants to see as it looks in real life, search for actual photographs of that place.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'The place, subject, or scene to find real photographs of.' },
      kind: { type: 'string', enum: ['photo', 'satellite', 'documentary'], description: 'Use photo by default. Use satellite only when the user explicitly asks for genuine satellite imagery.' }
    },
    required: ['query']
  },
  label: () => 'Finding real photographs',
  enabled: cfg => !!(cfg && cfg.serper),
  run: async (args, ctx) => {
    const query = clip(args && args.query, 180).trim();
    if (!query) throw new Error('Tell me what place or subject to find photographs of.');
    const kind = ['photo', 'satellite', 'documentary'].includes(String(args.kind || '').toLowerCase()) ? String(args.kind).toLowerCase() : 'photo';
    const suffix = kind === 'satellite'
      ? ' genuine satellite imagery real earth observation image not illustration'
      : kind === 'documentary'
        ? ' documentary photograph real life'
        : ' real life photograph actual photo street view';
    const t = ctx.withTimeout(15000);
    let response;
    try {
      response = await fetch('https://google.serper.dev/images', {
        method: 'POST', signal: t.signal,
        headers: { 'X-API-KEY': ctx.CFG.serper, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: query + suffix + ' -poster -flyer -infographic -weather chart -forecast graphic', num: 8, gl: 'ng', hl: 'en' })
      });
    } finally { t.done(); }
    if (!response.ok) throw new Error('Image search service returned HTTP ' + response.status + '.');
    const data = await response.json();
    const rows = (Array.isArray(data.images) ? data.images : []).filter(item => {
      const title = clip(item.title, 180);
      const source = clip(item.source, 120);
      const context = [title, source, clip(item.link, 220)].join(' ');
      if (synthetic.test(title) || synthetic.test(source)) return false;
      const requestedState = query.toLowerCase().match(/\b(ondo|lagos|osun|oyo|ekiti|ogun|benue|kaduna|kano|rivers|enugu|imo|edo|delta|anambra|plateau|niger|kwara|sokoto|katsina|borno|yobe|adamawa|taraba|bauchi|gombe|jigawa|kebbi|zamfara|cross river|akwa ibom|bayelsa|nasarawa|ebonyi)\b/);
      if (requestedState && unrelatedRegion.test(context) && !new RegExp('\\b' + requestedState[1] + '\\b', 'i').test(context)) return false;
      return !!safeHttpUrl(item.imageUrl || item.thumbnailUrl);
    }).slice(0, 2);
    if (!rows.length) return { text: 'No suitable real photographs were found for that search. Do not generate a mock-up or pretend an illustration is a real photograph. Tell the user that a verified photograph was not found.' };
    const blocks = rows.map((item, index) => {
      const imageUrl = safeHttpUrl(item.imageUrl || item.thumbnailUrl);
      const pageUrl = safeHttpUrl(item.link);
      const title = clip(item.title || query, 100) || query;
      const source = clip(item.source || 'Image source', 80);
      return '![Real photograph: ' + title.replace(/[\[\]]/g, '') + '](' + imageUrl + ')' +
        (pageUrl ? '\nSource: [' + source.replace(/[\[\]]/g, '') + '](' + pageUrl + ')' : '\nSource: ' + source);
    });
    return {
      text: 'Found ' + rows.length + ' candidate existing images. These are search results, not guaranteed live camera feeds. Identify them as photographs and show their source; do not describe them as live satellite imagery.',
      markdown: blocks.join('\n\n')
    };
  }
};
