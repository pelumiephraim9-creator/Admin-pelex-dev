'use strict';
// Multi-provider Spotlight catalogue. Returns metadata and official embed/watch URLs only;
// it never downloads or stores video files.
const E = process.env;
const CACHE = new Map();
const PENDING = new Map();
const HEALTH = new Map();
const clip = (v, n) => String(v == null ? '' : v).slice(0, n);
const ttl = Math.max(5, Math.min(48, Number(E.SPOTLIGHT_CACHE_HOURS) || 24)) * 3600000;
const enc = encodeURIComponent;
function cached(key) { const v = CACHE.get(key); return v && Date.now() - v.at < ttl ? v.value : null; }
function store(key, value) { if (CACHE.size >= 500) CACHE.delete(CACHE.keys().next().value); CACHE.set(key, { at: Date.now(), value }); return value; }
async function request(url, options, ctx, timeoutMs) {
  const t = ctx.withTimeout(timeoutMs || 16000);
  try {
    const r = await fetch(url, Object.assign({}, options || {}, { signal: t.signal }));
    const body = await r.text();
    let data; try { data = JSON.parse(body); } catch (_) { data = {}; }
    if (!r.ok) throw new Error('Provider HTTP ' + r.status);
    return data;
  } finally { t.done(); }
}
function video(provider, id, title, channel, thumbnail, url, embedUrl, extra) {
  return Object.assign({ provider, id: String(id), title: clip(title, 300), channel: clip(channel, 160),
    thumbnail: thumbnail || '', url: url || '', embedUrl: embedUrl || '', duration: null,
    published: null, views: null, playback: { embed: !!embedUrl, controls: provider === 'youtube' || provider === 'vimeo' || provider === 'pexels' || provider === 'pixabay' } }, extra || {});
}
async function youtube(q, page, ctx) {
  const tool = require('./find_videos');
  const raw = await tool.run({ interest: q, pageToken: page || '' }, ctx);
  const j = JSON.parse(raw);
  return { videos: (j.videos || []).map(v => video('youtube', v.id, v.title, v.channel, 'https://i.ytimg.com/vi/' + enc(v.id) + '/hqdefault.jpg', 'https://www.youtube.com/watch?v=' + enc(v.id), 'https://www.youtube-nocookie.com/embed/' + enc(v.id), { duration: v.length, published: v.published, views: v.views, playback: { embed: true, controls: true, seek: true, speed: true, fullscreen: true, pip: false } })), nextPageToken: j.nextPageToken || null };
}
async function vimeo(q, page, ctx) {
  if (!E.VIMEO_ACCESS_TOKEN) throw new Error('not_configured');
  const u = new URL('https://api.vimeo.com/videos');
  u.searchParams.set('query', q); u.searchParams.set('per_page', '20'); u.searchParams.set('sort', 'relevant');
  if (page) u.searchParams.set('page', String(Math.max(1, Number(page) || 1)));
  const j = await request(u, { headers: { Authorization: 'Bearer ' + E.VIMEO_ACCESS_TOKEN, Accept: 'application/vnd.vimeo.*+json;version=3.4' } }, ctx);
  return { videos: (j.data || []).map(v => video('vimeo', v.uri, v.name, v.user && v.user.name, v.pictures && v.pictures.sizes && v.pictures.sizes.slice(-1)[0] && v.pictures.sizes.slice(-1)[0].link, v.link, v.embed && v.embed.html ? 'https://player.vimeo.com/video/' + String(v.uri).split('/').pop() : '', { duration: v.duration || null, published: v.created_time || null, views: v.stats && v.stats.plays || null, playback: { embed: !!(v.embed && v.embed.html), controls: true, seek: true, speed: true, fullscreen: true, pip: true } })), nextPageToken: j.paging && j.paging.next ? String((Number(page) || 1) + 1) : null };
}
async function pexels(q, page, ctx) {
  if (!E.PEXELS_API_KEY) throw new Error('not_configured');
  const u = new URL('https://api.pexels.com/videos/search'); u.searchParams.set('query', q); u.searchParams.set('per_page', '20'); u.searchParams.set('page', String(Math.max(1, Number(page) || 1)));
  const j = await request(u, { headers: { Authorization: E.PEXELS_API_KEY } }, ctx);
  return { videos: (j.videos || []).map(v => { const f = (v.video_files || []).filter(x => x.file_type === 'video/mp4').sort((a,b)=>(b.width||0)-(a.width||0))[0]; return video('pexels', v.id, v.user && v.user.name ? 'Video by ' + v.user.name : 'Pexels video', v.user && v.user.name, v.image, v.url, f && f.link || '', { duration: v.duration, playback: { embed: !!f, controls: !!f, seek: !!f, speed: !!f, fullscreen: true, pip: !!f } }); }), nextPageToken: j.next_page ? String((Number(page) || 1) + 1) : null };
}
async function pixabay(q, page, ctx) {
  if (!E.PIXABAY_API_KEY) throw new Error('not_configured');
  const u = new URL('https://pixabay.com/api/videos/'); u.searchParams.set('key', E.PIXABAY_API_KEY); u.searchParams.set('q', q); u.searchParams.set('per_page', '20'); u.searchParams.set('page', String(Math.max(1, Number(page) || 1)));
  const j = await request(u, {}, ctx);
  return { videos: (j.hits || []).map(v => { const f = v.videos && (v.videos.large || v.videos.medium || v.videos.small); return video('pixabay', v.id, 'Pixabay video', v.user, v.picture, 'https://pixabay.com/videos/id-' + v.id + '/', f && f.url || '', { duration: v.duration, views: v.views, playback: { embed: !!f, controls: !!f, seek: !!f, speed: !!f, fullscreen: true, pip: !!f } }); }), nextPageToken: (Number(page) || 1) * 20 < (j.totalHits || 0) ? String((Number(page) || 1) + 1) : null };
}
async function dailymotionToken(ctx) {
  const id = E.DAILYMOTION_API_KEY, secret = E.DAILYMOTION_API_SECRET;
  if (!id || !secret) throw new Error('not_configured');
  const key = 'dm-token'; const hit = HEALTH.get(key); if (hit && hit.expires > Date.now()) return hit.value;
  const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: id, client_secret: secret, scope: 'read' });
  const j = await request('https://oauth2.dailymotion.com/v2/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body }, ctx);
  if (!j.access_token) throw new Error('Dailymotion authentication failed');
  HEALTH.set(key, { value: j.access_token, expires: Date.now() + Math.max(60, Number(j.expires_in) || 1800) * 800 });
  return j.access_token;
}
async function dailymotion(q, page, ctx) {
  const token = await dailymotionToken(ctx);
  const u = new URL('https://api.dailymotion.com/videos'); u.searchParams.set('search', q); u.searchParams.set('limit', '20'); u.searchParams.set('fields', 'id,title,owner.screenname,thumbnail_720_url,url,duration,views_total,created_time'); u.searchParams.set('page', String(Math.max(1, Number(page) || 1)));
  const j = await request(u, { headers: { Authorization: 'Bearer ' + token } }, ctx);
  return { videos: (j.list || []).map(v => video('dailymotion', v.id, v.title, v['owner.screenname'], v.thumbnail_720_url, v.url, 'https://www.dailymotion.com/embed/video/' + enc(v.id), { duration: v.duration, views: v.views_total, published: v.created_time ? new Date(v.created_time * 1000).toISOString() : null, playback: { embed: true, controls: true, seek: true, speed: false, fullscreen: true, pip: false } })), nextPageToken: j.has_more ? String((Number(page) || 1) + 1) : null };
}
async function internetArchive(q, page, ctx) {
  const p = Math.max(1, Number(page) || 1), u = new URL('https://archive.org/advancedsearch.php');
  u.searchParams.set('q', 'mediatype:movies AND (' + q.replace(/[^\w\s-]/g, ' ').trim() + ')'); u.searchParams.set('fl[]', 'identifier,title,creator,date'); u.searchParams.set('rows', '20'); u.searchParams.set('page', String(p)); u.searchParams.set('output', 'json');
  const j = await request(u, {}, ctx), docs = j.response && j.response.docs || [];
  return { videos: docs.map(v => video('internet_archive', v.identifier, v.title, Array.isArray(v.creator) ? v.creator.join(', ') : v.creator, 'https://archive.org/services/img/' + enc(v.identifier), 'https://archive.org/details/' + enc(v.identifier), 'https://archive.org/embed/' + enc(v.identifier), { published: v.date || null, playback: { embed: true, controls: false, seek: false, speed: false, fullscreen: true, pip: false } })), nextPageToken: p * 20 < ((j.response && j.response.numFound) || 0) ? String(p + 1) : null };
}
const PEERTUBE_DIRECTORY = 'https://instances.joinpeertube.org/api/v1/instances/hosts';
let PEERTUBE_HEALTHY_HOSTS = null;
let PEERTUBE_HEALTHY_AT = 0;
let PEERTUBE_DISCOVERY_PENDING = null;
async function discoverPeerTubeHosts(ctx) {
  if (PEERTUBE_HEALTHY_HOSTS && Date.now() - PEERTUBE_HEALTHY_AT < 1800000) return PEERTUBE_HEALTHY_HOSTS;
  if (PEERTUBE_DISCOVERY_PENDING) return PEERTUBE_DISCOVERY_PENDING;
  PEERTUBE_DISCOVERY_PENDING = (async () => {
    const manual = String(E.PEERTUBE_INSTANCES || '').split(',').map(x => x.trim().replace(/\\/+$/, '')).filter(x => /^https:\\/\\/[a-z0-9.-]+$/i.test(x));
    let directoryHosts = [];
    try {
      const directory = await request(PEERTUBE_DIRECTORY, {}, ctx, 8000);
      directoryHosts = (Array.isArray(directory.data) ? directory.data : [])
        .map(item => item && String(item.host || '').trim().toLowerCase())
        .filter(host => /^[a-z0-9.-]+$/.test(host) && !host.startsWith('.') && !host.endsWith('.'));
    } catch (_) {}
    const candidates = manual.concat(directoryHosts.map(host => 'https://' + host))
      .filter((host, index, list) => list.indexOf(host) === index).slice(0, 20);
    const checks = await Promise.all(candidates.map(async host => {
      try {
        const u = new URL('/api/v1/search/videos', host);
        u.searchParams.set('search', 'nature'); u.searchParams.set('count', '1'); u.searchParams.set('start', '0');
        const result = await request(u, {}, ctx, 5500);
        return Array.isArray(result.data) ? host : null;
      } catch (_) { return null; }
    }));
    PEERTUBE_HEALTHY_HOSTS = checks.filter(Boolean).slice(0, 5);
    PEERTUBE_HEALTHY_AT = Date.now();
    return PEERTUBE_HEALTHY_HOSTS;
  })().finally(() => { PEERTUBE_DISCOVERY_PENDING = null; });
  return PEERTUBE_DISCOVERY_PENDING;
}
async function peertube(q, page, ctx) {
  const hosts = await discoverPeerTubeHosts(ctx);
  if (!hosts.length) throw new Error('no_public_instances_available');
  const offset = Math.max(0, Number(page) || 0), all = [];
  for (const host of hosts) {
    try {
      const u = new URL('/api/v1/search/videos', host);
      u.searchParams.set('search', q); u.searchParams.set('count', '10'); u.searchParams.set('start', String(offset));
      const j = await request(u, {}, ctx);
      for (const v of j.data || []) {
        const id = v.uuid || v.id;
        if (!id) continue;
        all.push(video('peertube', id, v.name, v.channel && v.channel.displayName,
          v.thumbnailPath ? new URL(v.thumbnailPath, host).href : '',
          host + '/videos/watch/' + id, host + '/videos/embed/' + id,
          { published: v.publishedAt || null, views: v.views,
            playback: { embed: true, controls: true, seek: true, speed: false, fullscreen: true, pip: false } }));
      }
    } catch (_) {}
  }
  return { videos: all, nextPageToken: all.length ? String(offset + 10) : null };
}
const PROVIDERS = {
  youtube: { ready: () => !!E.YOUTUBE_API_KEY, search: youtube },
  vimeo: { ready: () => !!E.VIMEO_ACCESS_TOKEN, search: vimeo },
  pexels: { ready: () => !!E.PEXELS_API_KEY, search: pexels },
  pixabay: { ready: () => !!E.PIXABAY_API_KEY, search: pixabay },
  internet_archive: { ready: () => true, search: internetArchive },
  peertube: { ready: () => true, search: peertube }
};
async function run(args, ctx) {
  const action = args.action === 'providers' ? 'providers' : 'search';
  if (action === 'providers') {
    const results = [];
    for (const [name, p] of Object.entries(PROVIDERS)) {
      if (!p.ready()) continue;
      if (name === 'peertube' && !(await discoverPeerTubeHosts(ctx)).length) continue;
      const probeKey = 'probe:' + name, hit = HEALTH.get(probeKey);
      if (hit && Date.now() - hit.at < 300000) { if (hit.ok) results.push({ id: name, name: name.replace(/_/g, ' '), connected: true }); continue; }
      if (PENDING.has(probeKey)) {
        if (await PENDING.get(probeKey)) results.push({ id: name, name: name.replace(/_/g, ' '), connected: true });
        continue;
      }
      const probe = p.search('nature', '', ctx).then(result => {
        const ok = Array.isArray(result.videos); HEALTH.set(probeKey, { at: Date.now(), ok }); return ok;
      }).catch(() => { HEALTH.set(probeKey, { at: Date.now(), ok: false }); return false; }).finally(() => PENDING.delete(probeKey));
      PENDING.set(probeKey, probe);
      if (await probe) results.push({ id: name, name: name.replace(/_/g, ' '), connected: true });
    }
    return JSON.stringify({ providers: results });
  }
  const provider = String(args.provider || '').toLowerCase();
  const q = clip(args.query || '', 120).trim();
  if (!PROVIDERS[provider] || !PROVIDERS[provider].ready()) return JSON.stringify({ videos: [], nextPageToken: null, unavailable: true });
  if (provider === 'peertube' && !(await discoverPeerTubeHosts(ctx)).length) return JSON.stringify({ videos: [], nextPageToken: null, unavailable: true });
  if (q.length < 2) return JSON.stringify({ videos: [], nextPageToken: null });
  const page = clip(args.pageToken || '', 80);
  const key = provider + '|' + q.toLowerCase() + '|' + page;
  const hit = cached(key); if (hit) return JSON.stringify(hit);
  if (PENDING.has(key)) return JSON.stringify(await PENDING.get(key));
  const work = PROVIDERS[provider].search(q, page, ctx).then(result => store(key, result)).finally(() => PENDING.delete(key));
  PENDING.set(key, work);
  return JSON.stringify(await work);
}
module.exports = { name: 'spotlight_catalog', description: 'Search connected video providers for Spotlight and report provider availability. Returns video metadata and official playback links only.', parameters: { type: 'object', properties: { action: { type: 'string', enum: ['providers', 'search'] }, provider: { type: 'string' }, query: { type: 'string' }, pageToken: { type: 'string' } }, required: ['action'] }, label: a => a.action === 'providers' ? 'Checking video sources' : 'Searching ' + clip(a.provider, 30), run, enabled: () => true };
