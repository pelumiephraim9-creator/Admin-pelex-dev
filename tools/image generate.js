'use strict';
// Finds real pictures on the web (Tavily, or Serper if that is all you have) so the agent does not have to generate common things from scratch.
// Needs TAVILY_API_KEY or SERPER_API_KEY. The pictures are shown with their sources.
const E = process.env;
const okUrl = u => { try { const x = new URL(u); return x.protocol === 'https:' && !x.username && x.hostname.includes('.') && u.length < 600; } catch (e) { return false; } };
const host = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return 'web'; } };
const alt = t => String(t || 'Picture').replace(/[\[\]()\r\n]+/g, ' ').trim().slice(0, 80) || 'Picture';

async function viaTavily(q, ctx) {
  const t = ctx.withTimeout(15000); let r;
  try { r = await fetch((E.TAVILY_BASE || 'https://api.tavily.com') + '/search', { method: 'POST', signal: t.signal, headers: { Authorization: 'Bearer ' + E.TAVILY_API_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: q, search_depth: 'basic', max_results: 5, include_images: true, include_image_descriptions: true, include_answer: false }) }); }
  finally { t.done(); }
  if (!r.ok) throw new Error('Tavily answered ' + r.status);
  const j = await r.json();
  return (j.images || []).map(x => typeof x === 'string' ? { url: x, title: '' } : { url: x.url, title: x.description || '' });
}
async function viaSerper(q, ctx) {
  const t = ctx.withTimeout(15000); let r;
  try { r = await fetch(E.SERPER_IMAGES_URL || 'https://google.serper.dev/images', { method: 'POST', signal: t.signal, headers: { 'X-API-KEY': E.SERPER_API_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ q, num: 8 }) }); }
  finally { t.done(); }
  if (!r.ok) throw new Error('Serper answered ' + r.status);
  const j = await r.json();
  return (j.images || []).map(x => ({ url: x.imageUrl, title: x.title || '', page: x.link }));
}
module.exports = {
  name: 'find_images',
  description: 'Search the web for real pictures of something and show them with their sources. Use FIRST for common things (an Instagram ad layout, a dashboard interface, a landmark, a product, a flag, a diagram). Only use image_generate if the person wants something custom or nothing suitable is found.',
  parameters: { type: 'object', properties: { query: { type: 'string', description: 'What to look for, in plain words' } }, required: ['query'] },
  enabled: () => !!(E.TAVILY_API_KEY || E.SERPER_API_KEY),
  label: a => 'Looking for pictures of ' + String(a.query || '').slice(0, 40),
  run: async ({ query }, ctx) => {
    const q = ctx.clip(String(query || '').trim(), 150); if (q.length < 3) throw new Error('Tell me what to look for.');
    let found = [], errs = [];
    if (E.TAVILY_API_KEY) { try { found = await viaTavily(q, ctx); } catch (e) { errs.push(e.message); } }
    if (!found.length && E.SERPER_API_KEY) { try { found = await viaSerper(q, ctx); } catch (e) { errs.push(e.message); } }
    const seen = new Set(), pics = [];
    for (const x of found) { if (!x || !okUrl(x.url) || seen.has(x.url)) continue; seen.add(x.url); pics.push(x); if (pics.length >= 4) break; }
    if (!pics.length) return 'No suitable pictures were found' + (errs.length ? ' (' + errs.join('; ') + ')' : '') + '. If the person still wants a picture, use image_generate.';
    const md = pics.map(x => `![${alt(x.title || q)}](${x.url})\n*Source: ${host(x.page || x.url)}*`).join('\n\n') + '\n\n*Pictures come from the web. Check the source before reusing them.*';
    return { text: `Found ${pics.length} picture(s) for "${q}" from ${pics.map(x => host(x.page || x.url)).join(', ')}. They are shown to the person automatically with their sources. Say what they show in one or two sentences and name the sources.`, markdown: md };
  },
};
