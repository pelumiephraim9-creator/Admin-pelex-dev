// PELEX EDGE SHIELD (Cloudflare Worker)
// Sits between the website and your Render server. The browser only ever talks to this address.
// It refuses everything that is not a real chat request from pelex.tech, then forwards the rest to Render
// with a secret header. Render refuses any request that does not carry that header, so nobody can use the
// onrender.com address directly.
//
// Settings (Worker > Settings > Variables and Secrets):
//   ORIGIN_URL       Text    your Render address, for example https://admin-pelex-dev.onrender.com
//   EDGE_SECRET      Secret  a long random text. The SAME text goes into Render as EDGE_SECRET
//   ALLOWED_ORIGINS  Text    optional, default https://pelex.tech,https://www.pelex.tech

const PATHS = ['/chat', '/chat/stream', '/auth/guest'];
const MAX_BODY = 6500000;   // room for up to 6 attached images

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const allowed = String(env.ALLOWED_ORIGINS || 'https://pelex.tech,https://www.pelex.tech').split(',').map(s => s.trim()).filter(Boolean);
    const origin = request.headers.get('Origin') || '';
    const okOrigin = allowed.includes(origin);
    const cors = okOrigin ? {
      'Access-Control-Allow-Origin': origin, 'Vary': 'Origin',
      'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Max-Age': '600',
    } : {};
    const reply = (status, obj) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cors } });

    if (request.method === 'OPTIONS') return new Response(null, { status: okOrigin ? 204 : 403, headers: cors });
    if (!env.ORIGIN_URL || !env.EDGE_SECRET) return reply(500, { error: 'The shield is not set up yet.' });
    const origin_url = String(env.ORIGIN_URL).replace(/\/+$/, '');

    if (url.pathname === '/health' && request.method === 'GET') {
      try { const h = await fetch(origin_url + '/health'); return new Response(h.body, { status: h.status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cors } }); }
      catch (e) { return reply(502, { error: 'The server is not answering.' }); }
    }
    if (!PATHS.includes(url.pathname)) return reply(404, { error: 'Not found' });
    if (request.method !== 'POST') return reply(405, { error: 'Method not allowed' });
    if (!okOrigin) return reply(403, { error: 'This address only works from the Pelex site.' });
    if (!(request.headers.get('Content-Type') || '').includes('application/json')) return reply(415, { error: 'Unsupported content type.' });
    if (Number(request.headers.get('Content-Length') || 0) > MAX_BODY) return reply(413, { error: 'Message too large.' });

    const h = new Headers({ 'Content-Type': 'application/json', 'X-Pelex-Edge': env.EDGE_SECRET, 'Origin': origin });
    const ip = request.headers.get('CF-Connecting-IP'); if (ip) h.set('X-Real-Client-IP', ip);
    const auth = request.headers.get('Authorization'); if (auth) h.set('Authorization', auth);
    let up;
    try { up = await fetch(origin_url + url.pathname, { method: 'POST', headers: h, body: request.body }); }
    catch (e) { return reply(502, { error: 'The server is not answering. Try again in a moment.' }); }
    const out = new Headers(up.headers);
    for (const k of ['set-cookie', 'access-control-allow-origin', 'access-control-allow-headers', 'access-control-allow-methods', 'vary']) out.delete(k);
    for (const [k, v] of Object.entries(cors)) out.set(k, v);
    return new Response(up.body, { status: up.status, headers: out });
  },
};
