'use strict';
// Spotlight: the most watched recent YouTube videos (2026 onwards, between 2 minutes and 1 hour, embeddable, public) for one interest.
// Needs YOUTUBE_API_KEY in Render (YouTube Data API v3). Search costs quota; results are cached for an hour in memory.
const E = process.env;
const clip = (v, n) => String(v || '').slice(0, n);
const CACHE = new Map();
function isoSecs(d) { const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(d || ''); if (!m) return 0; return (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0); }
function compact(n) { n = +n || 0; if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M'; if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K'; return String(n); }
function mins(s) { const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60); return h ? h + 'h ' + m + 'm' : m + ' min'; }
const SINCE = '2026-01-01T00:00:00Z';

module.exports = {
  name: 'find_videos',
  description: 'Find the most watched recent YouTube videos for one interest (2026 onwards, 2 minutes to 1 hour, embeddable). Used for intent "videos".',
  parameters: { type: 'object', properties: { interest: { type: 'string', description: 'The interest, for example "AI automation" or "product design"' }, pageToken: { type: 'string', description: 'Next page token from an earlier search' } }, required: ['interest'] },
  label: a => 'Finding videos for ' + String(a.interest || '').slice(0, 40),
  run: async (args, ctx) => {
    const key = E.YOUTUBE_API_KEY;
    if (!key) throw new Error('Spotlight needs YOUTUBE_API_KEY in Render.');
    const interest = clip(args.interest, 120).trim();
    if (interest.length < 2) throw new Error('Choose an interest first.');
    const pageToken = clip(args.pageToken, 200);
    const cacheKey = interest.toLowerCase() + '|' + pageToken;
    const hit = CACHE.get(cacheKey);
    if (hit && Date.now() - hit.at < 3600000) return hit.json;
    const q = interest + ' tutorial';
    const base = 'https://www.googleapis.com/youtube/v3';
    const t1 = ctx.withTimeout(20000); let r1;
    try { r1 = await fetch(`${base}/search?part=snippet&type=video&videoEmbeddable=true&videoSyndicated=true&order=viewCount&publishedAfter=${SINCE}&maxResults=25${pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : ''}&safeSearch=moderate&q=${encodeURIComponent(q)}&key=${key}`, { signal: t1.signal }); }
    finally { t1.done(); }
    if (!r1.ok) throw new Error('YouTube search HTTP ' + r1.status + '. Check YOUTUBE_API_KEY and quota.');
    const s = await r1.json();
    const ids = (s.items || []).map(i => i.id && i.id.videoId).filter(Boolean);
    const nextToken = s.nextPageToken || null;
    if (!ids.length) return JSON.stringify({ videos: [], nextPageToken: nextToken });
    const t2 = ctx.withTimeout(20000); let r2;
    try { r2 = await fetch(`${base}/videos?part=contentDetails,statistics,snippet,status&id=${ids.join(',')}&key=${key}`, { signal: t2.signal }); }
    finally { t2.done(); }
    if (!r2.ok) throw new Error('YouTube details HTTP ' + r2.status);
    const d = await r2.json();
    const videos = (d.items || [])
      .filter(v => { const secs = isoSecs(v.contentDetails && v.contentDetails.duration); return secs >= 120 && secs <= 3600 && v.status && v.status.embeddable && v.status.privacyStatus === 'public' && new Date(v.snippet.publishedAt) >= new Date(SINCE); })
      .sort((a, b) => (+b.statistics.viewCount || 0) - (+a.statistics.viewCount || 0))
      .slice(0, 25)
      .map(v => ({ id: v.id, title: v.snippet.title, channel: v.snippet.channelTitle, published: v.snippet.publishedAt.slice(0, 10), views: compact(v.statistics.viewCount), length: mins(isoSecs(v.contentDetails.duration)) }));
    const json = JSON.stringify({ videos, nextPageToken: nextToken });
    CACHE.set(cacheKey, { at: Date.now(), json });
    return json;
  }
};
