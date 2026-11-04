// PELEX EDGE SHIELD (Cloudflare Worker)
// Sits between the Pelex website and the Render backend.
// Keep the Worker as the public API/media address; do not expose the Render URL in the browser.
//
// Cloudflare Worker > Settings > Variables and Secrets:
//   ORIGIN_URL       Text    Render backend base URL, e.g. https://pelexn8n.onrender.com
//   EDGE_SECRET      Secret  same value as Render's EDGE_SECRET
//   ALLOWED_ORIGINS  Text    optional, https://pelex.tech,https://www.pelex.tech
//
// Render must also set MEDIA_PUBLIC_URL to this Worker's public base URL.
// Example: https://admin-pelex-dev.pelumiephraim9.workers.dev

const PATHS = ['/chat', '/chat/stream', '/auth/guest', '/voice/stt'];
const GET_PATHS = ['/commands'];
const MAX_BODY = 6500000;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const allowed = String(env.ALLOWED_ORIGINS || 'https://pelex.tech,https://www.pelex.tech')
      .split(',').map(s => s.trim()).filter(Boolean);
    const origin = request.headers.get('Origin') || '';
    const okOrigin = allowed.includes(origin);
    const cors = okOrigin ? {
      'Access-Control-Allow-Origin': origin,
      'Vary': 'Origin',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '600'
    } : {};
    const reply = (status, obj) => new Response(JSON.stringify(obj), {
      status,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cors }
    });

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: okOrigin ? 204 : 403, headers: cors });
    }
    if (!env.ORIGIN_URL || !env.EDGE_SECRET) {
      return reply(500, { error: 'The shield is not set up yet.' });
    }
    const originUrl = String(env.ORIGIN_URL).replace(/\\/+$/, '');

    if (url.pathname === '/health' && request.method === 'GET') {
      try {
        const health = await fetch(originUrl + '/health', { headers: { 'X-Pelex-Edge': env.EDGE_SECRET } });
        const headers = new Headers(health.headers);
        headers.set('Cache-Control', 'no-store');
        for (const [k, v] of Object.entries(cors)) headers.set(k, v);
        return new Response(health.body, { status: health.status, statusText: health.statusText, headers });
      } catch (e) {
        return reply(502, { error: 'The server is not answering.' });
      }
    }

    // Signed media URLs support both inline preview (?view=1) and attachment download.
    // The signature and expiry are checked by Render. The edge secret is added server-side.
    // Do not redirect: stream the actual file response back through this Worker.
    if (url.pathname === '/media/download' && request.method === 'GET') {
      try {
        const headersIn = new Headers({
          'X-Pelex-Edge': env.EDGE_SECRET,
          'Accept': request.headers.get('Accept') || '*/*'
        });
        const media = await fetch(originUrl + url.pathname + url.search, {
          method: 'GET',
          headers: headersIn,
          redirect: 'manual'
        });
        const headersOut = new Headers(media.headers);
        headersOut.set('Cache-Control', 'private, no-store');
        headersOut.delete('Location');
        for (const [k, v] of Object.entries(cors)) headersOut.set(k, v);
        return new Response(media.body, {
          status: media.status,
          statusText: media.statusText,
          headers: headersOut
        });
      } catch (e) {
        return reply(502, { error: 'The media server is not answering. Try again shortly.' });
      }
    }

    const isCommandsGet = url.pathname === '/commands' && request.method === 'GET';
    if (!(PATHS.includes(url.pathname) || (GET_PATHS.includes(url.pathname) && isCommandsGet))) {
      return reply(404, { error: 'Not found' });
    }
    if (!okOrigin) return reply(403, { error: 'This address only works from the Pelex site.' });
    if (!isCommandsGet && request.method !== 'POST') return reply(405, { error: 'Method not allowed' });
    if (!isCommandsGet && !(request.headers.get('Content-Type') || '').includes('application/json')) {
      return reply(415, { error: 'Unsupported content type.' });
    }
    if (!isCommandsGet && Number(request.headers.get('Content-Length') || 0) > MAX_BODY) {
      return reply(413, { error: 'Message too large.' });
    }

    const headersIn = new Headers({
      'Content-Type': 'application/json',
      'X-Pelex-Edge': env.EDGE_SECRET,
      'Origin': origin
    });
    const ip = request.headers.get('CF-Connecting-IP');
    if (ip) headersIn.set('X-Real-Client-IP', ip);
    const auth = request.headers.get('Authorization');
    if (auth) headersIn.set('Authorization', auth);

    try {
      const upstream = await fetch(originUrl + url.pathname + url.search, {
        method: isCommandsGet ? 'GET' : 'POST',
        headers: headersIn,
        ...(isCommandsGet ? {} : { body: request.body })
      });
      const headersOut = new Headers(upstream.headers);
      for (const key of ['set-cookie', 'access-control-allow-origin', 'access-control-allow-headers', 'access-control-allow-methods', 'vary']) {
        headersOut.delete(key);
      }
      for (const [k, v] of Object.entries(cors)) headersOut.set(k, v);
      return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: headersOut
      });
    } catch (e) {
      return reply(502, { error: 'The server is not answering. Try again in a moment.' });
    }
  }
};
