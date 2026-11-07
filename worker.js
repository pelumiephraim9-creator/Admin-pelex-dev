// PELEX EDGE SHIELD (Cloudflare Worker)
// Sits between the Pelex website and the Render backend.
// Keep the Worker as the public API/media address; do not expose the Render URL in the browser.
//
// Cloudflare Worker > Settings > Variables and Secrets:
//   ORIGIN_URL       Text    Render backend base URL, e.g. https://pelexn8n.onrender.com
//   EDGE_SECRET      Secret  same value as Render's EDGE_SECRET
//   ALLOWED_ORIGINS  Text    optional, https://pelex.tech,https://www.pelex.tech
//   PAYSTACK_SECRET_KEY        Secret  Paystack secret key (verifies x-paystack-signature)
//   FLW_SECRET_HASH            Secret  Flutterwave secret hash (verif-hash header)
//   SUPABASE_URL               Text    https://<project>.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY  Secret  Supabase service role key (writes payments to the ledger)
//
// Render must also set MEDIA_PUBLIC_URL to this Worker's public base URL.
// Example: https://admin-pelex-dev.pelumiephraim9.workers.dev

// ---- Payment webhooks (Paystack, Flutterwave): verified, then saved to the ledger. No Origin check: providers call us directly.
// A payment is saved only after its signature is verified. Each workspace has its own URL token.

const enc = new TextEncoder();
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');

async function hmacSha512Hex(secret, body) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-512' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode(body)));
}
function sameText(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// Maps a provider event to one payment, or null if it is not a successful payment.
function fromPaystack(evt) {
  if (evt.event !== 'charge.success' || !evt.data) return null;
  const d = evt.data, cust = d.customer || {};
  return { event_id: String(d.id || d.reference), event_type: evt.event, amount: Number(d.amount) / 100, currency: d.currency || null,
    customer: [cust.first_name, cust.last_name].filter(Boolean).join(' ') || cust.email || null, paid_at: d.paid_at || d.created_at || null };
}
function fromFlutterwave(evt) {
  if (evt.event !== 'charge.completed' || !evt.data || evt.data.status !== 'successful') return null;
  const d = evt.data, cust = d.customer || {};
  return { event_id: String(d.id || d.tx_ref), event_type: evt.event, amount: Number(d.amount), currency: d.currency || null,
    customer: cust.name || cust.email || null, paid_at: d.created_at || null };
}

async function saveToLedger(env, token, provider, p, raw) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/ingest_payment`, {
    method: 'POST',
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_token: token, p_provider: provider, p_event_id: p.event_id, p_event_type: p.event_type, p_amount: p.amount,
      p_currency: p.currency, p_customer: p.customer, p_paid_at: p.paid_at, p_raw: raw })
  });
  if (!r.ok) throw new Error('ingest failed: ' + r.status + ' ' + (await r.text()).slice(0, 200));
  return r.json();
}

async function handlePaymentWebhook(request, env) {
  const url = new URL(request.url);
  const [, , provider, token] = url.pathname.split('/');            // /hooks/<provider>/<token>
  if (request.method !== 'POST' || !token || !['paystack', 'flutterwave'].includes(provider)) return new Response('not found', { status: 404 });
  const body = await request.text();
  let evt; try { evt = JSON.parse(body); } catch (e) { return new Response('bad json', { status: 400 }); }

  if (provider === 'paystack') {
    const sig = request.headers.get('x-paystack-signature') || '';
    const want = await hmacSha512Hex(env.PAYSTACK_SECRET_KEY || '', body);
    if (!sameText(sig, want)) return new Response('bad signature', { status: 401 });
    const p = fromPaystack(evt);
    if (!p) return new Response('ignored', { status: 200 });
    const res = await saveToLedger(env, token, 'paystack', p, evt);
    return new Response(res, { status: 200 });
  }

  // Flutterwave: the verif-hash header must equal the secret hash set in the dashboard.
  if (!sameText(request.headers.get('verif-hash') || '', env.FLW_SECRET_HASH || '')) return new Response('bad signature', { status: 401 });
  const p = fromFlutterwave(evt);
  if (!p) return new Response('ignored', { status: 200 });
  const res = await saveToLedger(env, token, 'flutterwave', p, evt);
  return new Response(res, { status: 200 });
}

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

    if (url.pathname.startsWith('/hooks/')) {
      try { return await handlePaymentWebhook(request, env); }
      catch (e) { return new Response('webhook error', { status: 500 }); }
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: okOrigin ? 204 : 403, headers: cors });
    }
    if (!env.ORIGIN_URL || !env.EDGE_SECRET) {
      return reply(500, { error: 'The shield is not set up yet.' });
    }
    const originUrl = String(env.ORIGIN_URL).replace(/\/+$/, '');

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
